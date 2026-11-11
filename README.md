# StickerPro

**Walk 100% of a city: every street, block and alley.**

StickerPro is a single-player walking game that runs as an offline web app on an Android phone. Carry the phone on your walks with the screen on. It records your GPS track, matches it to the street network, and lights up each street segment as you complete it. Between walks you can see how much of the city you've covered, your daily stats, and maps of past walks. It can also plan routes that take you down streets you haven't walked yet.

**Play it:** https://systemprogramdev.github.io/StickerPro/

Everything you create stays on your phone. There are no accounts, no backend and no tracking.

![Status](https://img.shields.io/badge/status-field%20testing-ff3dd4) ![Platform](https://img.shields.io/badge/platform-Chrome%20on%20Android-00e5ff) ![Offline](https://img.shields.io/badge/works-offline-ffb000)

---

## Contents

- [How to play](#how-to-play)
- [Features](#features)
- [Screens](#screens)
- [How matching works](#how-matching-works)
- [Route planner](#route-planner)
- [Data and privacy](#data-and-privacy)
- [Tech stack](#tech-stack)
- [Project layout](#project-layout)
- [Architecture](#architecture)
- [Data model](#data-model)
- [City data prep tool](#city-data-prep-tool)
- [City file format](#city-file-format)
- [Development](#development)
- [Testing](#testing)
- [Tuning](#tuning)
- [Deployment](#deployment)
- [Roadmap and open decisions](#roadmap-and-open-decisions)
- [Attribution](#attribution)

---

## How to play

1. **Open the app** in Chrome on Android: https://systemprogramdev.github.io/StickerPro/
2. **Install it.** Tap **⤓ INSTALL APP** on the map, or use Chrome's **⋮ → Install app**. The app then runs full screen from your home screen and works with no network.
3. **Load the city.** Tap **↓ LOAD PHILADELPHIA**. The street data (about 11 MB) downloads once and is stored on the phone.
4. **Allow location** when Chrome asks.
5. **Wait for a good GPS fix.** The **GPS** reading in the top bar should be under 25 m.
6. **Tap ▶ START WALK** and walk. Streets you complete glow cyan, and your raw track is drawn in magenta.
7. **Keep the app in front with the screen on.** Tap **Lock** to make the screen ignore touches while the phone is in a pocket. Hold for 2 seconds to unlock.
8. **Tap ■ STOP** when you're done. You'll get a summary of miles, new segments and time.

**The battery is the run clock.** A walk lasts until the battery runs low. At 5% the walk ends automatically and you get a summary. Nothing is lost if the phone dies: every GPS fix is saved as it arrives.

### Tips

- Launch it from the home-screen icon, not a browser tab. The screen-awake lock is more reliable that way.
- If you switch apps or the screen turns off, tracking pauses. The app tells you how long it was paused when you come back.
- Tap any street on the map to see its name, length and coverage (16 slices).
- **Back up after walks.** The end-of-walk summary has **SAVE BACKUP** (to Downloads) and **SHARE BACKUP** (to Drive, email or another app). Both are also under Stats → SYS. Clearing Chrome's site data wipes everything.
- Browsers can't write files to your phone in the background, so automatic backups aren't possible. Each backup takes one tap.

---

## Features

| Area | What it does |
| --- | --- |
| **Tracking** | Records a GPS fix about every second with high accuracy. Fixes worse than 25 m are stored but not counted. A gap of more than 10 s without a fix breaks the track, so coverage is never joined across it. |
| **Crash-safe** | Each fix is written to IndexedDB before anything else happens. If Chrome is killed mid-walk, reopening the app resumes the walk with every point. |
| **Street matching** | A web worker matches each fix to nearby street segments using distance, heading and continuity, then marks coverage along the segment. |
| **Progress** | City % = walked length ÷ total length. Per-sector (neighborhood) progress when sector data is supplied, with a "SECTOR CLEARED" moment when one reaches 100%. |
| **Stats** | Today (miles, new segments, time), last-7-days chart, total miles, streak, current sector, note and photo counts. |
| **History** | One entry per walk, with its track on a map, miles, new segments, time, rejected fixes and battery used. |
| **Notes and photos** | Pin a text note or a camera photo at your current position. Photos are downscaled to 1600 px. Tap a pin to view or delete it. |
| **Route planner** | Nearest unwalked street, loop walk with a distance budget, or clear the current sector. Shown as a dashed line with a turn banner. Recalculates if you're more than 30 m off route for over 10 s. |
| **Battery run clock** | Battery % in the top bar. The walk ends automatically at 5%. |
| **Touch lock** | A full-screen overlay that ignores touches. Hold 2 s to unlock. |
| **Backup** | Export everything (tracks, progress, notes, photos) to one JSON file, and restore it later. |
| **Rebuild progress** | Replays every stored track to recompute coverage from scratch, for example after changing the matching rules. |
| **Replay mode** | For development. Simulate walks or replay GPX/JSON tracks at 1–30× speed, without going outside. |
| **Offline** | A service worker precaches the app and fonts. City data lives on the device. An "UPDATE READY" prompt appears for new versions, and the app never reloads on its own during a walk. |

### Warning states

These show as magenta system warnings on the map:

- `NO CITY DATA`: load or import a city
- `WAITING FOR GPS` / `GPS SIGNAL LOST`
- `LOW ACCURACY`: the current fix isn't being counted
- `TRACKING PAUSED`: the app was hidden for a while
- `SCREEN LOCK NOT HELD`
- `NO BACKUP IN 7 DAYS`: only when the browser hasn't granted persistent storage (installing the app usually fixes that)
- `MAP UNAVAILABLE`: no WebGL; tracking, stats and backup still work
- `BATTERY LOW` / `RUN ENDING`

---

## Screens

The interface is designed for 390 × 844 portrait and one-thumb use outdoors. The look is cyberpunk: glowing streets on near-black, hard edges, terminal type.

**Map.** The top bar shows the sector, GPS accuracy with a quality bar, and battery. Below it are a turn banner (when a route is active), the map, and the current and next street. The bottom strip shows today's miles, new segments and city %. The bottom buttons are **Map · Stats · Note · Photo · Lock**.

**Stats.** Large city % with a segmented bar, segments and miles walked out of the total, a 7-day chart, panels for today, streak, sector and pins, and per-sector bars.

**History.** A list of walks. Each one opens a map of its track with its numbers, plus *replay* and *delete*.

**System** (Stats → SYS). City data download and import, backup export and restore, rebuild progress, scanlines toggle, replay mode, the debug screen, and OpenStreetMap attribution.

**Debug.** GPS state, wake lock, the current walk, and a live table of incoming fixes (rejected ones in magenta) with the segment each matched.

### Palette

| Role | Color |
| --- | --- |
| Background | `#05070A` |
| Unwalked street | `#1C4448` |
| Unwalked alley | `#163539` |
| Walked street | `#00E5FF` |
| Position, route, alerts, lock | `#FF3DD4` |
| Numbers and battery | `#FFB000` |
| Primary text | `#9FE8EE` |
| Label text | `#5FA8A8` |
| Frame lines | `#0E5C66` |

Type: **Orbitron 800** for headers and the city %, **Share Tech Mono** for everything else. Both fonts are bundled with the app.

---

## How matching works

The core logic is in `app/src/core/matcher.ts`. It's deterministic: the same fixes in the same order always produce the same progress.

1. **Filter.** Fixes with accuracy worse than 25 m are ignored for matching. They are still stored.
2. **Gap check.** More than 10 s since the last accepted fix resets continuity, so nothing is filled across the gap.
3. **Candidates.** A 200 m grid index returns the segments within 20 m of the fix.
4. **Scoring.** For each candidate:
   - start with its distance from the fix in meters
   - add up to 15 m if the walking direction disagrees with the segment's direction (the direction comes from the last few fixes, or from the GPS heading)
   - subtract 5 m if it's the same segment as the last match
   - add 8 m if it isn't the same segment or one that touches it

   The lowest score wins.
5. **Coverage.** Each segment is split into **16 slices** along its length. The slice under the fix is marked. Slices between consecutive fixes on the same segment are filled in. When you turn onto a connected segment, the first segment is filled to the shared intersection and the new one from it.
6. **Completion.**
   - Normal segments complete at **14 of 16** slices.
   - Segments **shorter than 30 m** complete when passed end to end (all 16 slices).
   - **Alleys** also complete when one continuous pass reaches both end nodes, because GPS is weakest in alleys.

Raw tracks are the source of truth. **Rebuild progress** replays every stored walk through a fresh matcher and must reproduce the live result, and there's a test that checks this.

---

## Route planner

`app/src/core/planner.ts` runs in the worker and uses Dijkstra over the street graph.

- **Nearest unwalked.** The shortest path from your position to the closest incomplete segment, then along it.
- **Loop walk.** You pick a budget (1, 2, 3 or 5 mi). It greedily chains nearby incomplete segments while the walk back to the start still fits the budget, then returns you to where you started.
- **Clear this sector.** Greedily chains every incomplete segment in the current sector. This needs sector data.

Routes show as a dashed magenta line. The turn banner shows the next turn (LEFT / RIGHT / STRAIGHT / U-TURN / ARRIVE), the street name and the distance. If you're more than 30 m off the route for over 10 s, it recalculates.

---

## Data and privacy

- **No backend.** The app is static files. Nothing you record is sent anywhere.
- **On-device storage:**
  - **IndexedDB** (Dexie) holds walks, every track point, per-segment progress, notes and photos.
  - **OPFS** (Origin Private File System) holds the city data file.
- **Persistent storage** is requested on first run. If the browser refuses, the app warns you to export backups.
- **Backups** are a single JSON file you save to Downloads or share to another app. Restoring one replaces all stored data.
- The only network request the app makes on its own is the one-time city download when you tap **LOAD PHILADELPHIA**.

---

## Tech stack

| Area | Choice |
| --- | --- |
| App | React 19, TypeScript, Vite, vite-plugin-pwa (Workbox) |
| Map | MapLibre GL JS, drawing streets from our own GeoJSON with `feature-state` for walked segments. No basemap tiles, no CDN. |
| Location | `navigator.geolocation.watchPosition` (`enableHighAccuracy: true`, `maximumAge: 0`) |
| Screen | Screen Wake Lock API, re-acquired when the app becomes visible again |
| Storage | IndexedDB via Dexie; OPFS for city files |
| Heavy work | A Web Worker for matching and route planning |
| Battery | `navigator.getBattery()`; the run clock is hidden if it's unavailable |
| Prep tool | Python with osmnx, shapely and pyproj |
| Tests | Vitest |
| Hosting | GitHub Pages via GitHub Actions |

**Target:** Chrome on Android, portrait. GPS and service workers need a secure context, so use HTTPS or `localhost`. Opening the build from a `file://` path won't work.

---

## Project layout

```
StickerPro/
├── app/                      Web app (React + TypeScript + Vite)
│   ├── public/
│   │   ├── data/             Hosted city files (one-tap download)
│   │   └── pwa-*.png         App icons
│   ├── scripts/make-icons.mjs  Generates placeholder PWA icons
│   └── src/
│       ├── core/             Pure logic, no DOM or browser APIs (portable, unit-tested)
│       │   ├── graph.ts        City graph, projection, grid index, street labels
│       │   ├── matcher.ts      GPS fixes → per-segment coverage masks
│       │   ├── planner.ts      Nearest / loop / sector routes, turn list
│       │   ├── navigation.ts   Route following, current and next street
│       │   ├── progress.ts     City and sector totals
│       │   ├── stats.ts        7-day chart and streak
│       │   ├── synth.ts        Synthetic GPS tracks for replay and tests
│       │   ├── geo.ts          Geometry helpers
│       │   └── types.ts        City file format and shared types
│       ├── worker/           Engine worker (matcher + planner) and its client
│       ├── data/             Dexie DB, OPFS city store, backup
│       ├── services/         GPS and replay sources, wake lock, battery, install prompt
│       ├── app/              Controller (walk lifecycle) and the React state hook
│       ├── ui/               Screens, overlays, map styling
│       └── config/           thresholds.ts (every tunable number), palette.ts
├── prep/                     Python city data prep tool
├── fixtures/                 Unit-test graph
├── city/                     Generated city files (gitignored)
├── design/                   Mockup screenshots
├── BRIEF.md                  Full product brief
└── CLAUDE.md                 Build and test commands
```

---

## Architecture

```
 watchPosition ─┐
                ├─► FixSource ─► Controller ──► IndexedDB (point written first)
 ReplaySource ──┘                    │
                                     ├──► Engine worker ─► Matcher ─► coverage updates
                                     │                  └► Planner ─► routes
                                     ├──► progress table + map feature-state
                                     └──► React UI (useSyncExternalStore)
```

- **Location service** (`services/location.ts`) wraps `watchPosition`. `ReplaySource` feeds recorded or synthetic tracks in its place, with the same interface.
- **Controller** (`app/controller.ts`) owns the walk lifecycle. It processes fixes through a strict queue, so order is preserved and every fix is stored before it's matched. It also handles crash recovery, gap detection, wake lock, battery auto-end, route following, notes and photos, backup and rebuild.
- **City data loader** (`data/cityStore.ts` + `core/graph.ts`) is the only place that knows the file format. It validates the manifest and builds the in-memory graph and grid index.
- **Engine worker** (`worker/`) is a thin message layer over `core/`. The core modules have no browser dependencies, so they can be unit tested and ported later.
- **Map** (`ui/MapView.tsx`) draws all segments from one GeoJSON source and updates `feature-state` (`done`, `partial`) per segment as coverage changes. Walked streets get a wide glow at 22% opacity under a thin bright line.

---

## Data model

| Entity | Key fields | Stored in |
| --- | --- | --- |
| City graph (read-only) | nodes, segments (id, node A/B, name, kind, length, sector, polyline), names, sectors, manifest | OPFS |
| Progress | stable segment id, 16-bit coverage mask, completed-at | IndexedDB `progress` |
| Walk | id, start, end, distance, new segments, battery at start and end, replay flag, end reason | IndexedDB `walks` |
| Track point | walk id, time, lat, lon, accuracy, speed, heading, accepted flag | IndexedDB `points` |
| Note | id, time, lat, lon, text | IndexedDB `notes` |
| Photo | id, time, lat, lon, image blob | IndexedDB `photos` |

Segment ids are **stable across data refreshes**. They're built from the OpenStreetMap way id plus the node pair, `"<wayId>:<nodeA>:<nodeB>"`, so progress survives re-running the prep tool.

---

## City data prep tool

`prep/prep.py` turns OpenStreetMap data into the single file the app imports. It runs once per city, on a computer.

```bash
cd prep
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# A real city (default: Philadelphia)
.venv/bin/python prep.py --place "Philadelphia, Pennsylvania, USA" --out ../city/

# With neighborhood sectors from a GeoJSON file
.venv/bin/python prep.py --place "..." --out ../city/ --sectors hoods.geojson --sector-name-field NAME

# Count park paths and footways too
.venv/bin/python prep.py --place "..." --out ../city/ --include-paths

# Regenerate the unit-test fixture
.venv/bin/python prep.py --fixture --out ../fixtures/
```

**What it does**

1. Downloads the street network inside the city boundary.
2. Filters it down to what counts toward 100%.
3. Splits ways at intersections and merges pass-through nodes, so each segment runs from one intersection to the next.
4. Computes each segment's length in meters and keeps its shape.
5. Assigns stable segment ids and builds the names table.
6. Assigns each segment to a sector, if you supply boundaries.
7. Writes the file and prints totals.

**Default filter**

- **Included:** residential, tertiary, secondary, primary (and their `_link` roads), unclassified, living street, pedestrian, and `service=alley`.
- **Excluded:** motorways and ramps, trunk roads, `access=private|no`, `foot=no`, driveways, parking aisles, and sidewalks or crossings mapped as separate lines.
- **Optional:** park paths and footways (`--include-paths`).

**Philadelphia output** (current build):

```
Philadelphia, Pennsylvania, USA: 52,745 segments, 2,981.5 mi total
  streets 2,621.2 mi · alleys 360.3 mi · paths 0.0 mi
```

---

## City file format

This is version 1: a single JSON file (`*.stickerpro.json`).

```jsonc
{
  "manifest": {
    "format": "stickerpro-city",
    "version": 1,
    "city": "Philadelphia, Pennsylvania, USA",
    "bounds": [west, south, east, north],
    "builtAt": "2026-11-11T18:28:00+00:00",
    "totals": { "segments": 52745, "meters": 0, "streetMeters": 0, "alleyMeters": 0, "pathMeters": 0 }
  },
  "nodes": [[osmId, lat, lon], ...],
  "segments": [{
    "id": "wayId:nodeA:nodeB",
    "a": 0, "b": 1,          // node indices
    "n": 12,                 // name index, -1 if unnamed
    "k": 0,                  // kind: 0 street, 1 alley, 2 path
    "len": 104.2,            // meters
    "s": -1,                 // sector index, -1 if none
    "c": [[lon, lat], ...]   // polyline from node a to node b
  }],
  "names": ["Walnut Street", ...],
  "sectors": [{ "name": "Rittenhouse", "polygon": [[[lon, lat], ...]] }]
}
```

The app checks `format` and `version` on import and refuses files it doesn't understand. Unnamed alleys are labelled **"ALLEY off &lt;nearest named street&gt;"**.

---

## Development

Requirements: Node 24+, npm. Python 3.11+ only if you want to run the prep tool.

```bash
cd app
npm install
npm run dev        # http://localhost:5180 (service worker disabled in dev)
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run build` | Typecheck and production build with service worker |
| `npm run preview` | Serve the build on http://localhost:4180, for testing offline mode and install |
| `npm run lint` | oxlint |
| `npm run icons` | Regenerate placeholder PWA icons |

### Testing on a real phone over USB

1. Enable USB debugging on the phone and connect it.
2. Install the Android platform tools (`brew install android-platform-tools`), then run `adb reverse tcp:5180 tcp:5180`.
3. Open `localhost:5180` in Chrome on the phone. Localhost counts as a secure context, so GPS works with hot reload.
4. Open `chrome://inspect` on the computer to use the phone's console and DevTools.

### Testing without walking

Go to **Stats → SYS → Replay mode**:

- **SIM 0.5 / 1 / 2 MI** generates a random walk along the street network, with realistic drifting GPS noise, starting at your last position or the city center.
- **REPLAY GPX / JSON FILE** feeds a recorded track in place of GPS.
- **History → walk → REPLAY 10×** re-runs a past walk.
- The speed buttons (1–30×) set playback speed.

Replays are recorded as walks marked *replay*, so you can delete them from History afterwards. Deleting a walk rebuilds progress automatically.

---

## Testing

```bash
cd app && npm test
```

The matcher and planner tests run on a small fixture graph (`fixtures/fixture-city.json`). It has two parallel streets 60 m apart, cross streets, an unnamed alley between them, a 25 m stub, and two sectors.

| Test | Checks |
| --- | --- |
| Straight walk | Completes every walked segment and nothing else |
| Turn | Completes both streets at a corner |
| Partial segment | Coverage is recorded, but the segment isn't complete |
| GPS gap | No coverage is filled across a 15 s gap (with a no-gap control) |
| Parallel streets | Walking one of two streets 60 m apart doesn't credit the other |
| Bad accuracy | Fixes worse than 25 m are ignored |
| Alley pass | Completes on one continuous pass between its end nodes, and not when entered and left from the same end |
| Short segment | Completes when passed end to end, not halfway |
| Determinism | Replaying a track gives identical masks |
| Rebuild | Replaying stored walks reproduces live progress |
| Planner | Nearest unwalked, a loop within budget that returns to the start, and a sector route that covers every incomplete segment |

---

## Tuning

Every threshold lives in **`app/src/config/thresholds.ts`**. These are starting values, to be tuned after real walks.

| Setting | Default | Meaning |
| --- | --- | --- |
| `maxAccuracyM` | 25 m | Fixes worse than this are stored but not matched |
| `gapSeconds` | 10 s | Time without a fix that breaks the track and coverage |
| `distanceStepM` | 5 m | Minimum movement counted toward walk distance (also at least half the fix accuracy) |
| `matchRadiusM` | 20 m | Search radius for candidate segments |
| `coverageSlices` / `completeSlices` | 16 / 14 | Slices per segment, and how many complete it |
| `shortSegmentM` | 30 m | Shorter segments must be passed end to end |
| `alleyEndM` | 12 m | Distance from an alley end node that counts as reaching it |
| `headingPenaltyM` | 15 m | Score penalty for walking at 90° to a segment |
| `sameSegmentBonusM` / `farSegmentPenaltyM` | 5 / 8 m | Continuity preferences |
| `gridCellM` | 200 m | Spatial index cell size |
| `offRouteM` / `offRouteSeconds` | 30 m / 10 s | When to recalculate a route |
| `autoEndBatteryPct` / `lowBatteryPct` | 5% / 15% | When the walk auto-ends, and when the low-battery warning shows |
| `photoMaxPx` | 1600 | Long-side limit for stored photos |
| `unlockHoldMs` | 2000 ms | Hold time to unlock the touch lock |

After changing a matching threshold, use **Rebuild progress** to recompute coverage from your raw tracks.

---

## Deployment

The app is static files. A push to `main` runs `.github/workflows/deploy.yml`, which:

1. installs dependencies and runs the tests,
2. builds with `BASE_PATH=/<repo-name>/`,
3. publishes `app/dist` to GitHub Pages.

The service worker precaches the app shell, icons and fonts. City files are **not** precached: they download once, on demand, into OPFS. When a new version is deployed, open apps show **UPDATE READY**, and they never reload on their own during a walk.

To host somewhere else (Cloudflare Pages, Netlify, …), run `npm run build` in `app/` with `BASE_PATH` set to the path the site will be served from, and upload `app/dist`.

---

## Roadmap and open decisions

Build order and status:

1. ✅ Scaffold and tracking: offline app, walks, crash recovery, debug screen, replay
2. ✅ Prep tool: city graph and test fixture
3. ✅ City import and map
4. ✅ Matching and progress: worker, coverage masks, rebuild, tests
5. ✅ Stats, history and backup
6. ✅ Notes and photos
7. 🟡 Street names and sectors: HUD names and per-sector progress are done; **map labels when zoomed in still need bundled glyphs**
8. ✅ Route planner: nearest, loop and sector (greedy)
9. ✅ Run clock, touch lock, warning states
10. 🔜 **Field testing and tuning thresholds from real walks**

**Open decisions**

- [ ] **Trunk roads.** These are excluded by default, which leaves out most of Roosevelt Boulevard. Should they count?
- [ ] **Park paths and footways.** Off by default (`--include-paths`).
- [ ] **Sector boundaries.** None yet. Supply a neighborhood GeoJSON to enable per-sector progress and "clear this sector".
- [ ] **Streak day.** Currently any day with a walk that completes at least one new segment.
- [ ] **Map data format.** GeoJSON for now. Measure load time and memory on the phone before considering PMTiles.

**Out of scope for now:** multiplayer and accounts, territories and decay mechanics, iOS and landscape, screen-off tracking (that would need a native wrapper such as Capacitor), and a firmware port to the LilyGO T-Deck Plus. The matcher and planner are kept free of browser APIs so that port stays possible.

---

## Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/). The hosted city files are derived from OpenStreetMap and are covered by the ODbL.

Fonts: [Orbitron](https://fonts.google.com/specimen/Orbitron) and [Share Tech Mono](https://fonts.google.com/specimen/Share+Tech+Mono), both under the SIL Open Font License, bundled via Fontsource.

Built with [MapLibre GL JS](https://maplibre.org/), [Dexie](https://dexie.org/), [Vite](https://vite.dev/), [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) and [osmnx](https://osmnx.readthedocs.io/).
