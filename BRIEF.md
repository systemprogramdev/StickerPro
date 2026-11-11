# City walk game: build brief for Claude Code

Nov 11, 2026 · @emer

## What we are building

A single-player game whose goal is to walk 100% of a city: every street, block and alley. It runs as an offline web app on a dedicated spare Android phone that is carried on walks with the screen on.

During a walk the app records GPS, matches the track to street segments, and marks them complete. Between walks it shows city completion, daily stats and maps of past walks. The player can pin notes and photos to locations, and a route planner suggests walks that cover unwalked streets.

The phone's battery is the run clock: a walk lasts until the battery is nearly empty, so battery drain is accepted and background tracking is not needed.

**Done looks like this:** the player installs the app, imports the city data file, walks for an hour with the phone in hand or pocket, and afterwards sees the new streets lit up, an updated city percent, and the walk in their history. Nothing is lost if the phone dies mid-walk.

**Default city:** Philadelphia, PA, set as a parameter in the data prep tool.

## Stack and hard constraints

The app is a static React and TypeScript web app with no backend. Everything the player creates stays on the phone.

| Area | Choice | Notes |
| --- | --- | --- |
| App | React, TypeScript, Vite, vite-plugin-pwa | Installable to the home screen and fully offline after first load |
| Map | MapLibre GL JS | Draw streets from our own graph and style walked segments with feature-state. Start with a GeoJSON source; move to a PMTiles vector file only if load time or memory is a problem on the phone |
| Location | `navigator.geolocation.watchPosition` with `enableHighAccuracy: true`, `maximumAge: 0` | Roughly one fix per second on Chrome for Android |
| Screen | Screen Wake Lock API | Re-acquire on `visibilitychange`, since the lock drops when the app loses focus |
| Storage | IndexedDB (Dexie) for tracks, progress, notes and photos; OPFS for the city data files | Call `navigator.storage.persist()` on first run and warn if it is refused |
| Heavy work | Web Worker for matching and route planning | Keep these modules free of DOM and browser APIs so they can be unit tested and ported later |
| Battery | `navigator.getBattery()` | Available in Chrome on Android; hide the run clock if missing |
| Prep tool | Python CLI (osmnx or pyosmium, shapely, pyproj) | Runs on the PC, not the phone |
| Tests | Vitest | Matching and planner logic must have tests |

**Constraints that shape the design**

- Target is Chrome on Android only, portrait only. No iOS support needed.
- Location and service workers need a secure context: HTTPS or `localhost`. Opening the build from a file path will not work.
- No network during walks. The phone may have no SIM. Bundle fonts and all assets locally; do not load anything from a CDN at runtime.
- The screen stays on during a walk. Tracking with the screen off is out of scope.
- Data safety comes first: every GPS fix is written to storage as it arrives, so a dead battery or a killed tab loses seconds, not the walk.
- Units are miles and feet.

## Architecture and data model

Raw GPS tracks are the source of truth, and progress is derived from them. If the matching rules change, a "rebuild progress" action replays every stored track and recomputes it.

**Modules**

- **Location service:** wraps `watchPosition`, the wake lock and gap detection.
- **Track recorder:** writes each fix to storage immediately and manages walk start, stop and crash recovery.
- **City data loader:** imports the city files, validates the manifest and builds the in-memory graph and spatial index.
- **Matcher (worker):** turns fixes into segment coverage.
- **Progress store:** per-segment coverage, city and sector totals.
- **Planner (worker):** shortest paths and suggested routes over the graph.
- **UI:** map, stats, history, notes and photos, settings.

**Data**

| Entity | Key fields | Stored in |
| --- | --- | --- |
| City graph (imported, read-only) | Nodes: id, lat, lon. Segments: id, node A, node B, name id, kind (street, alley, path), length in meters, polyline. Names table. Sector polygons. Manifest with city, bounds, totals, build date | OPFS |
| Progress | Segment id, 16-bit coverage mask (16 slices along the segment), completed-at time | IndexedDB |
| Walk | Id, start and end time, distance, new segments, battery at start and end | IndexedDB |
| Track point | Walk id, time, lat, lon, accuracy in meters, speed, heading, accepted or rejected flag | IndexedDB |
| Note | Id, time, lat, lon, text | IndexedDB |
| Photo | Id, time, lat, lon, image blob, optional note id | IndexedDB |

**Rules for the graph format**

- Segment ids must be stable across prep runs (derive them from the OpenStreetMap way id plus the node pair), so progress survives a data refresh.
- Store topology, not just lines: which segments meet at each node. The planner needs it.
- Keep the file format behind the single loader module. Start with whatever is quickest (JSON is fine) and tighten to a compact binary later if size or load time demands it.
- Build a grid index (cells of about 200 m mapping to segment ids) so matching only looks at nearby segments.

## City data prep tool

A Python command-line tool turns OpenStreetMap data into the files the app imports. It runs once per city on the PC, for example `python prep.py --place "Philadelphia, Pennsylvania, USA" --out city/`.

**What it does**

1. Downloads the street network inside the city boundary.
2. Filters to what counts toward 100% (see below).
3. Splits ways at intersections into segments and merges pass-through nodes, so one segment runs from one intersection to the next.
4. Computes each segment's length in meters and keeps its shape.
5. Assigns stable segment ids and builds the names table.
6. Assigns each segment to a sector (neighborhood) if boundary data is supplied.
7. Writes the graph, names, sectors and a manifest, and prints totals: segment count and total miles, split by street and alley.

**Default filter (keep configurable)**

- Include: residential, tertiary, secondary, primary, unclassified, living street and pedestrian streets, plus service roads tagged as alleys.
- Exclude: motorways and ramps, roads with no foot access, anything tagged private, driveways, parking aisles, and sidewalks or crossings mapped as separate lines (they would double-count the street).
- Park paths and footways: excluded by default behind a flag. See open decisions.

**Details that matter**

- Unnamed alleys are common. Leave the name empty; the app labels them "ALLEY" with the nearest named street.
- Also produce a small fixture graph (a few blocks, including two parallel streets about 60 m apart and an alley between them) for unit tests.
- OpenStreetMap data requires attribution. The app must show "© OpenStreetMap contributors" on its settings or about screen.

## Features and acceptance criteria

Each feature below lists what it must do and how to tell it works. Put every numeric threshold in one config file; they are starting values to tune after real walks.

**Tracking**

- Start and stop a walk. While active, hold the wake lock and record every fix with its accuracy.
- Fixes with accuracy worse than 25 m are stored but flagged and not used for matching.
- More than 10 seconds without a fix is a gap. Do not connect track or coverage across a gap.
- If the app was hidden or the screen went off, show a clear "tracking paused" state on return.
- Accept: force-close Chrome mid-walk, reopen, and the walk resumes with every point up to the last fix.

**Matching**

- For each accepted fix, find segments within 20 m using the grid index.
- Choose by distance, agreement between the fix heading and the segment direction, and continuity with the previously matched segment (prefer the same or an adjacent one).
- Mark the coverage slice at the matched point, and fill the slices between consecutive fixes on the same segment.
- A segment is complete at 14 of 16 slices. Segments shorter than 30 m complete when passed end to end.
- Alleys complete when the track passes both end nodes in one continuous pass, since GPS is weakest there.
- Runs live in the worker during a walk.
- Accept: replaying the same recorded track always gives the same progress. Tests on the fixture graph cover a straight walk, a turn, a partial segment, a GPS gap, and walking one of two parallel streets without crediting the other.

**Progress**

- City percent is walked length divided by total length. Show the same per sector.
- Fire a "sector cleared" moment when a sector reaches 100%.
- Accept: "rebuild progress" from raw tracks reproduces the live result.

**Stats and history**

- Today: miles, new segments, time.
- History: one entry per walk with its track on a map and its numbers.
- Last 7 days chart, total miles, streak.

**Notes and photos**

- Note: type text, save it at the current position, show it as a pin, tap to read.
- Photo: capture with `<input type="file" accept="image/*" capture="environment">`, downscale to at most 1600 px on the long side, store with the current position, show as a pin.

**Route planner**

- Nearest unwalked: shortest path from the current position to the closest incomplete segment. Build this first.
- Loop walk: given a distance budget, build a loop from the current position that chains nearby incomplete segments and returns to the start. A greedy approach is fine.
- Clear this sector: a route covering every incomplete segment in the current sector (Chinese postman on that subgraph; greedy pairing of odd nodes is acceptable).
- Show the route as a dashed line with the next turn, street name and distance. Recalculate when the player is more than 30 m off the route for over 10 seconds.

**Battery run clock**

- Show battery percent in the HUD as run time remaining.
- At 5%, end the walk automatically and show a summary.

**Touch lock**

- A full-screen overlay that ignores touches so the phone can sit in a pocket. Hold for 2 seconds to unlock.

**Backup**

- Export all tracks, progress, notes and photos to a single file in phone storage, and import it to restore. Browser storage can be wiped by clearing site data, so this is required, not optional.

**Replay mode (for development)**

- Feed a recorded or synthetic track into the location service in place of real GPS, at adjustable speed. This lets matching, progress and the planner be built and tested on the PC without walking.

## UI direction

The look is cyberpunk: glowing street lines on near-black, hard edges, terminal type. The interface must stay readable outdoors and usable with one thumb while walking.

**Palette**

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

**Type:** Orbitron (weight 800) for headers and the city percent, Share Tech Mono for everything else. Bundle both in the app.

**Style rules**

- Walked streets glow: draw a wide line at about 22% opacity under a thin bright one.
- Square corners, 1 px frame lines, segmented bars. No rounded cards, gradients or drop shadows.
- Touch targets at least 48 px tall.
- Optional subtle scanline overlay, with a setting to turn it off.
- Design at 390 × 844 portrait.

**Screens**

- **Map:** top HUD (sector name, GPS accuracy in meters with a quality bar, battery as run percent), a turn banner when a route is active, the map, then a bottom strip with current and next street, today's miles, new segments and city percent. Bottom buttons: Map, Stats, Note, Photo, Lock.
- **Stats:** large city percent with a segmented bar, segments and miles walked of total, 7-day chart, panels for today, streak, current sector, and note and photo counts.
- **History:** list of walks, each opening its track and numbers.
- **Settings:** import city data, export and import backup, rebuild progress, scanlines toggle, OpenStreetMap attribution.

**States to design, styled as system warnings:** no city data imported, waiting for GPS, low accuracy, tracking paused, storage not persistent, battery low and run ending.

**Note on the HUD:** the browser reports accuracy in meters but not satellite count or fix type, so show accuracy only.

Reference mockups of the Map and Stats screens are on a private canvas: [mockups](https://claude.ai/artifact/E1HpDWEN4DzaVwzNCyvDPq). Save screenshots into the repo's `design/` folder so they can be read during the build.

## Build order

Build one milestone at a time and stop after each for a test on the phone. Do not build ahead: real walks will change the thresholds and probably the plan.

1. **Scaffold and tracking.** Vite, React, TypeScript, installable offline app. Start and stop a walk, save every fix, hold the wake lock, recover after a crash. A debug screen lists incoming fixes. Replay mode works. *Test: walk around the block, then force-close and reopen mid-walk.*
2. **Prep tool.** Produce the city graph, names and manifest, plus the test fixture graph. *Test: totals print and look plausible; spot-check a known alley and a known highway exclusion.*
3. **City import and map.** Import the city files through the file picker into OPFS. Render streets, live position and the raw track in the palette. *Test: the map loads on the phone in a few seconds and pans smoothly.*
4. **Matching and progress.** Worker, coverage masks, city percent, rebuild from raw tracks, unit tests. *Test: replay a recorded walk and check the lit segments against where the walk went.*
5. **Stats, history and backup.** Stats screen, walk history, export and import. Backup lands here, before many real walks accumulate.
6. **Notes and photos.**
7. **Street names and sectors.** Current and next street in the HUD, map labels when zoomed in, per-sector progress.
8. **Route planner.** Nearest unwalked first, then loop walk, then clear sector.
9. **Run clock, touch lock and warning states.** Battery HUD and auto-end, lock overlay, the warning states, visual polish.

## Dev loop and deployment

Develop against the real phone over USB, and deploy as static files to any HTTPS host.

**Development**

- Enable USB debugging on the phone, connect it, and run `adb reverse tcp:5173 tcp:5173`.
- Open `localhost:5173` in Chrome on the phone. Localhost is a secure context, so GPS works against the Vite dev server with hot reload.
- Use `chrome://inspect` on the PC for the phone's console and DevTools.
- Use replay mode on the PC for anything that does not need real GPS.

**Deployment**

- Build to static files and host on Cloudflare Pages, Netlify or GitHub Pages.
- Open the URL once in Chrome on the phone and install it to the home screen. After that it runs offline.
- The service worker precaches the app shell and fonts. When a new version is available, show an "update ready" prompt; never reload automatically during a walk.

**City data**

- City files are not bundled with the app or hosted. Copy them to the phone over USB and load them with the "Import city data" button.
- Check the manifest version on import and refuse files the app does not understand.

**Suggested repo layout**

- `app/` the web app
- `prep/` the Python prep tool
- `fixtures/` the test graph and sample tracks
- `design/` mockup screenshots
- `CLAUDE.md` build and test commands, plus a pointer to this brief

## Out of scope and open decisions

Keep the first version simple and single-player. The items below are deliberately left out, and the open decisions each have a default to use unless told otherwise.

**Out of scope for now**

- Multiplayer, accounts, any backend or sync.
- Territories, mile-goal challenges, and patrol "sentinels" that reset progress. If added later, keep explored progress permanent and put anything that decays or gets captured in a separate layer.
- A firmware port to the LilyGO T-Deck Plus. It may come later, which is why the matcher and planner must stay free of browser APIs and the graph format must stay behind one loader.
- A native wrapper for screen-off tracking (Capacitor would be the route).
- iOS and landscape layouts.

**Open decisions**

- [ ] City boundary. Default: Philadelphia city limits.
- [ ] Whether park paths and footways count toward 100%. Default: no, streets and alleys only.
- [ ] Source for sector boundaries. Default: skip sectors until a neighborhood boundary file is supplied, and show city-wide progress only.
- [ ] What counts as a streak day. Default: any day with a recorded walk that completes at least one new segment.
- [ ] Map data as GeoJSON or a PMTiles file. Default: GeoJSON, then measure load time and memory on the phone before deciding.

If one of these blocks a milestone, ask before choosing something other than the default.
