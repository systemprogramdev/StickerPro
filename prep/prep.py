#!/usr/bin/env python3
"""StickerPro city data prep.

Turns OpenStreetMap data into the single city file the app imports.

    python prep.py --place "Philadelphia, Pennsylvania, USA" --out city/
    python prep.py --fixture --out ../fixtures/
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

FORMAT = "stickerpro-city"
VERSION = 1
KIND_STREET, KIND_ALLEY, KIND_PATH = 0, 1, 2
M_PER_MILE = 1609.344

# What counts toward 100%. Keep in sync with the brief's default filter.
STREET_HIGHWAYS = {
    "residential", "tertiary", "tertiary_link", "secondary", "secondary_link",
    "primary", "primary_link", "unclassified", "living_street", "pedestrian",
}
PATH_HIGHWAYS = {"footway", "path", "cycleway", "steps", "track", "bridleway"}
EXCLUDED_ACCESS = {"private", "no"}
EXCLUDED_FOOTWAY = {"sidewalk", "crossing"}


def first(v):
    """OSM tags may be lists after simplification; take the first value."""
    if isinstance(v, list):
        return v[0] if v else None
    return v


def as_set(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return set()
    return set(v) if isinstance(v, list) else {v}


def classify(data: dict, include_paths: bool) -> int | None:
    """Kind for an edge that counts toward 100%, or None to drop it."""
    hw = as_set(data.get("highway"))
    if as_set(data.get("access")) & EXCLUDED_ACCESS:
        return None
    if as_set(data.get("foot")) & {"no", "private"}:
        return None
    if as_set(data.get("footway")) & EXCLUDED_FOOTWAY:
        return None
    if hw & STREET_HIGHWAYS:
        return KIND_STREET
    if "service" in hw:
        return KIND_ALLEY if "alley" in as_set(data.get("service")) else None
    if include_paths and hw & PATH_HIGHWAYS:
        return KIND_PATH
    return None


def round_coord(lon: float, lat: float) -> list[float]:
    return [round(lon, 6), round(lat, 6)]


def build_from_osm(args) -> dict:
    import osmnx as ox
    from shapely.geometry import LineString

    ox.settings.useful_tags_way = list(set(ox.settings.useful_tags_way) | {"service", "access", "foot", "footway", "name", "area"})
    ox.settings.log_console = False

    highways = sorted(STREET_HIGHWAYS | {"service"} | (PATH_HIGHWAYS if args.include_paths else set()))
    custom_filter = f'["highway"~"^({"|".join(highways)})$"]["area"!~"yes"]'
    print(f"Downloading street network for {args.place} ...", file=sys.stderr)
    G = ox.graph_from_place(args.place, network_type="all", custom_filter=custom_filter, simplify=False, retain_all=True)
    print(f"  raw: {len(G.nodes)} nodes, {len(G.edges)} edges", file=sys.stderr)

    drop = [(u, v, k) for u, v, k, d in G.edges(keys=True, data=True) if classify(d, args.include_paths) is None]
    G.remove_edges_from(drop)
    G.remove_nodes_from([n for n in list(G.nodes) if G.degree(n) == 0])
    for u, v, k, d in G.edges(keys=True, data=True):
        d["kind"] = classify(d, args.include_paths)
    # Merge pass-through nodes so each segment runs intersection to intersection,
    # but never merge across a change in kind or name.
    G = ox.simplify_graph(G, edge_attr_aggs=None, node_attrs_include=None, edge_attrs_differ=["kind", "name"], remove_rings=False)
    U = ox.convert.to_undirected(G)
    print(f"  kept: {len(U.nodes)} nodes, {len(U.edges)} segments", file=sys.stderr)

    node_index: dict[int, int] = {}
    nodes = []
    for n, d in U.nodes(data=True):
        node_index[n] = len(nodes)
        nodes.append([int(n), round(d["y"], 7), round(d["x"], 7)])

    names: list[str] = []
    name_index: dict[str, int] = {}
    segments = []
    seen_ids: set[str] = set()
    for u, v, k, d in U.edges(keys=True, data=True):
        a, b = (u, v) if u <= v else (v, u)
        geom = d.get("geometry")
        if geom is None:
            geom = LineString([(U.nodes[a]["x"], U.nodes[a]["y"]), (U.nodes[b]["x"], U.nodes[b]["y"])])
        coords = list(geom.coords)
        ax, ay = U.nodes[a]["x"], U.nodes[a]["y"]
        if (coords[0][0] - ax) ** 2 + (coords[0][1] - ay) ** 2 > (coords[-1][0] - ax) ** 2 + (coords[-1][1] - ay) ** 2:
            coords.reverse()
        osmids = d.get("osmid")
        way = min(osmids) if isinstance(osmids, list) else osmids
        sid = f"{way}:{a}:{b}"
        dup = 1
        while sid in seen_ids:  # parallel edges between the same pair of nodes
            dup += 1
            sid = f"{way}:{a}:{b}:{dup}"
        seen_ids.add(sid)
        name = first(d.get("name"))
        if isinstance(name, float):
            name = None
        ni = -1
        if name:
            if name not in name_index:
                name_index[name] = len(names)
                names.append(name)
            ni = name_index[name]
        segments.append({
            "id": sid,
            "a": node_index[a],
            "b": node_index[b],
            "n": ni,
            "k": int(d["kind"]),
            "len": round(float(d["length"]), 2),
            "s": -1,
            "c": [round_coord(x, y) for x, y in coords],
        })

    segments.sort(key=lambda s: s["id"])
    xs = [n[2] for n in nodes]
    ys = [n[1] for n in nodes]
    return {
        "city": args.place,
        "bounds": [min(xs), min(ys), max(xs), max(ys)],
        "nodes": nodes,
        "segments": segments,
        "names": names,
        "sectors": [],
    }


def assign_sectors(city: dict, path: Path, name_field: str) -> None:
    from shapely.geometry import LineString, shape
    from shapely.strtree import STRtree

    gj = json.loads(path.read_text())
    polys, sectors = [], []
    for f in gj["features"]:
        geom = shape(f["geometry"])
        name = str(f["properties"].get(name_field) or f"Sector {len(sectors) + 1}")
        rings = []
        parts = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
        for p in parts:  # flattened: outer ring and holes of every part
            rings.append([round_coord(*c) for c in p.exterior.coords])
            rings.extend([round_coord(*c) for c in r.coords] for r in p.interiors)
        sectors.append({"name": name, "polygon": rings})
        polys.append(geom)
    tree = STRtree(polys)
    for s in city["segments"]:
        mid = LineString(s["c"]).interpolate(0.5, normalized=True)
        hits = [i for i in tree.query(mid) if polys[i].contains(mid)]
        s["s"] = int(hits[0]) if hits else -1
    city["sectors"] = sectors


def build_fixture() -> dict:
    """A few blocks: two parallel streets 60 m apart, an alley between them, cross streets,
    a short stub, and two sectors. Coordinates are near Rittenhouse Square, Philadelphia."""
    lat0, lon0 = 39.9490, -75.1720
    ky = 111_195.0
    kx = ky * math.cos(math.radians(lat0))

    def ll(x, y):
        return [round(lon0 + x / kx, 7), round(lat0 + y / ky, 7)]

    pts = {
        "A0": (0, 0), "A1": (100, 0), "A2": (200, 0), "A3": (300, 0),
        "B0": (0, 60), "B1": (100, 60), "B2": (200, 60), "B3": (300, 60),
        "M1": (100, 30), "M2": (200, 30), "S": (300, 85),
    }
    node_ids = {k: 1000 + i for i, k in enumerate(pts)}
    nodes = [[node_ids[k], ll(*xy)[1], ll(*xy)[0]] for k, xy in pts.items()]
    idx = {k: i for i, k in enumerate(pts)}
    names = ["Alpha St", "Beta St", "First St", "Second St", "Third St", "Fourth St", "Stub Ct"]
    edges = [  # (way, from, to, name index, kind)
        (1, "A0", "A1", 0, KIND_STREET), (1, "A1", "A2", 0, KIND_STREET), (1, "A2", "A3", 0, KIND_STREET),
        (2, "B0", "B1", 1, KIND_STREET), (2, "B1", "B2", 1, KIND_STREET), (2, "B2", "B3", 1, KIND_STREET),
        (3, "A0", "B0", 2, KIND_STREET),
        (4, "A1", "M1", 3, KIND_STREET), (4, "M1", "B1", 3, KIND_STREET),
        (5, "A2", "M2", 4, KIND_STREET), (5, "M2", "B2", 4, KIND_STREET),
        (6, "A3", "B3", 5, KIND_STREET),
        (7, "M1", "M2", -1, KIND_ALLEY),
        (8, "B3", "S", 6, KIND_STREET),
    ]
    segments = []
    for way, f, t, n, k in edges:
        (x1, y1), (x2, y2) = pts[f], pts[t]
        a, b = sorted([f, t], key=lambda p: node_ids[p])
        coords = [ll(*pts[a]), ll(*pts[b])]
        segments.append({
            "id": f"{way}:{node_ids[a]}:{node_ids[b]}",
            "a": idx[a],
            "b": idx[b],
            "n": n,
            "k": k,
            "len": round(math.hypot(x2 - x1, y2 - y1), 2),
            "s": 0 if (x1 + x2) / 2 < 150 else 1,
            "c": coords,
        })
    west = [ll(-20, -20), ll(150, -20), ll(150, 100), ll(-20, 100), ll(-20, -20)]
    east = [ll(150, -20), ll(320, -20), ll(320, 100), ll(150, 100), ll(150, -20)]
    xs = [n[2] for n in nodes]
    ys = [n[1] for n in nodes]
    return {
        "city": "Fixture",
        "bounds": [min(xs), min(ys), max(xs), max(ys)],
        "nodes": nodes,
        "segments": segments,
        "names": names,
        "sectors": [{"name": "West", "polygon": [west]}, {"name": "East", "polygon": [east]}],
    }


def finish(city: dict) -> dict:
    totals = {"segments": len(city["segments"]), "meters": 0.0, "streetMeters": 0.0, "alleyMeters": 0.0, "pathMeters": 0.0}
    for s in city["segments"]:
        totals["meters"] += s["len"]
        totals[["streetMeters", "alleyMeters", "pathMeters"][s["k"]]] += s["len"]
    totals = {k: round(v, 1) if isinstance(v, float) else v for k, v in totals.items()}
    manifest = {
        "format": FORMAT,
        "version": VERSION,
        "city": city.pop("city"),
        "bounds": [round(v, 6) for v in city.pop("bounds")],
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "totals": totals,
    }
    return {"manifest": manifest, **city}


def print_totals(m: dict) -> None:
    t = m["totals"]
    print(f"{m['city']}: {t['segments']:,} segments, {t['meters'] / M_PER_MILE:,.1f} mi total")
    print(f"  streets {t['streetMeters'] / M_PER_MILE:,.1f} mi · alleys {t['alleyMeters'] / M_PER_MILE:,.1f} mi · paths {t['pathMeters'] / M_PER_MILE:,.1f} mi")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--place", default="Philadelphia, Pennsylvania, USA", help="OSM place name for the city boundary")
    ap.add_argument("--out", default="city/", help="output directory")
    ap.add_argument("--include-paths", action="store_true", help="count park paths and footways toward 100%%")
    ap.add_argument("--sectors", type=Path, help="GeoJSON of neighborhood polygons")
    ap.add_argument("--sector-name-field", default="name", help="property holding each sector's name")
    ap.add_argument("--fixture", action="store_true", help="write the small unit-test graph instead of a real city")
    args = ap.parse_args()

    city = build_fixture() if args.fixture else build_from_osm(args)
    if args.sectors and not args.fixture:
        assign_sectors(city, args.sectors, args.sector_name_field)
    out = finish(city)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    fname = "fixture-city.json" if args.fixture else f"{out['manifest']['city'].split(',')[0].strip().lower().replace(' ', '-')}.stickerpro.json"
    path = out_dir / fname
    path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print_totals(out["manifest"])
    print(f"Wrote {path} ({path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
