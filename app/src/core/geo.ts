// Geometry helpers. Matching works in a flat local projection (meters) centered on the city,
// which is accurate to well under a meter per 100 m across a city-sized area.

const R = 6371008.8
const RAD = Math.PI / 180

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD
  const dLon = (lon2 - lon1) * RAD
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export interface Projection {
  toXY(lon: number, lat: number): [number, number]
  toLonLat(x: number, y: number): [number, number]
}

export function makeProjection(lon0: number, lat0: number): Projection {
  const kx = Math.cos(lat0 * RAD) * R * RAD
  const ky = R * RAD
  return {
    toXY: (lon, lat) => [(lon - lon0) * kx, (lat - lat0) * ky],
    toLonLat: (x, y) => [x / kx + lon0, y / ky + lat0],
  }
}

/** Bearing in degrees clockwise from north (+y) for a vector in local XY. */
export function bearingXY(dx: number, dy: number): number {
  const b = Math.atan2(dx, dy) / RAD
  return b < 0 ? b + 360 : b
}

/** Smallest difference between two bearings, 0..180. */
export function bearingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/** Difference between a heading and an undirected line, 0..90. */
export function axisDiff(heading: number, lineBearing: number): number {
  const d = bearingDiff(heading, lineBearing)
  return d > 90 ? 180 - d : d
}

export interface PolylineHit {
  dist: number // distance from point to polyline
  along: number // distance along polyline to the nearest point
  bearing: number // bearing of the polyline piece at that point (a -> b direction)
  x: number
  y: number
}

/** Nearest point on a polyline given as flat [x0, y0, x1, y1, ...] with cumulative lengths. */
export function projectOnPolyline(px: number, py: number, xy: Float64Array, cum: Float64Array): PolylineHit {
  let best: PolylineHit = { dist: Infinity, along: 0, bearing: 0, x: 0, y: 0 }
  const n = xy.length / 2
  for (let i = 0; i < n - 1; i++) {
    const ax = xy[2 * i], ay = xy[2 * i + 1]
    const bx = xy[2 * i + 2], by = xy[2 * i + 3]
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const qx = ax + t * dx, qy = ay + t * dy
    const d = Math.hypot(px - qx, py - qy)
    if (d < best.dist) {
      best = { dist: d, along: cum[i] + t * (cum[i + 1] - cum[i]), bearing: bearingXY(dx, dy), x: qx, y: qy }
    }
  }
  return best
}

/** Point at a given distance along a polyline. */
export function pointAlong(xy: Float64Array, cum: Float64Array, along: number): [number, number] {
  const n = xy.length / 2
  if (along <= 0) return [xy[0], xy[1]]
  for (let i = 0; i < n - 1; i++) {
    if (along <= cum[i + 1]) {
      const seg = cum[i + 1] - cum[i]
      const t = seg > 0 ? (along - cum[i]) / seg : 0
      return [xy[2 * i] + t * (xy[2 * i + 2] - xy[2 * i]), xy[2 * i + 1] + t * (xy[2 * i + 3] - xy[2 * i + 1])]
    }
  }
  return [xy[2 * n - 2], xy[2 * n - 1]]
}

/** Ray-casting point-in-polygon over [lon, lat] rings (first ring outer, rest holes). */
export function pointInPolygon(lon: number, lat: number, rings: [number, number][][]): boolean {
  let inside = false
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}
