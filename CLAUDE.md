# StickerPro

City walk game: walk 100% of a city's streets. Offline PWA for Chrome on Android, portrait only.
Full spec and milestone order: [BRIEF.md](BRIEF.md). Build one milestone at a time and stop for a phone test.

## Layout
- `app/` React + TypeScript + Vite + vite-plugin-pwa web app
  - `src/core/` pure logic, no DOM or browser APIs (portable, unit-tested): `graph` (city graph + grid index), `matcher` (fixes → 16-slice coverage masks), `planner` (nearest / loop / sector routes), `navigation` (route following, current/next street), `progress`, `stats`, `synth` (synthetic tracks)
  - `src/worker/` engine worker running matcher + planner; `engine.ts` is the promise client
  - `src/data/` Dexie DB (`db.ts`), OPFS city store (`cityStore.ts`, the only module that knows the file format), backup export/import
  - `src/services/` GPS + replay fix sources, wake lock, battery, image downscale
  - `src/app/controller.ts` walk lifecycle; every fix is written to IndexedDB before anything else
  - `src/ui/` screens and overlays; `mapStyle.ts` holds MapLibre layers
  - `src/config/thresholds.ts` every tunable number; `src/config/palette.ts` map colors (mirror of CSS vars in `src/index.css`)
- `prep/` Python CLI that builds city files from OpenStreetMap
- `fixtures/fixture-city.json` unit-test graph (two parallel streets 60 m apart, an alley, a short stub, two sectors)
- `city/` generated city files (gitignored); copy to the phone and import via Settings
- `design/` mockup screenshots

## Prep tool (run in `prep/`)
- Setup once: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
- City: `.venv/bin/python prep.py --place "Philadelphia, Pennsylvania, USA" --out ../city/` (add `--sectors hoods.geojson --sector-name-field NAME` for neighborhoods, `--include-paths` for footways)
- Fixture: `.venv/bin/python prep.py --fixture --out ../fixtures/`

## Commands (run in `app/`)
- `npm run dev` dev server on http://localhost:5180 (port 5173 is used by other projects on this machine; service worker disabled in dev)
- `npm test` Vitest once; `npm run test:watch` watch mode
- `npm run build` typecheck + production build with service worker
- `npm run preview` serve the build on http://localhost:4180 (test offline/install here)
- `npm run lint` oxlint
- `npm run icons` regenerate placeholder PWA icons

## Phone dev loop
1. USB debugging on, phone connected, `adb reverse tcp:5180 tcp:5180`
2. Open `localhost:5180` in Chrome on the phone (secure context, so GPS works)
3. `chrome://inspect` on the PC for the phone's DevTools
4. On the PC, Settings → Replay mode simulates walks (SIM) or replays GPX/JSON tracks without walking

## Rules
- No CDN or network at runtime; fonts come from `@fontsource/*` and are bundled.
- Units: miles and feet. Square corners, 1px frames, no gradients/shadows/rounded cards. Touch targets ≥ 48px.
- Show "© OpenStreetMap contributors" in the app.
