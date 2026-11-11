import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/orbitron/800.css'
import '@fontsource/share-tech-mono/400.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import { setWorkerUrl } from 'maplibre-gl'
// MapLibre finds its worker relative to its own file name, which bundling changes. Point it at the bundled worker.
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import './index.css'
import App from './App.tsx'

setWorkerUrl(mapWorkerUrl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
