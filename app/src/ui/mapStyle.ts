// Shared MapLibre sources and layers. No remote sources or glyphs, so maps work offline.
import type { FeatureCollection, LineString } from 'geojson'
import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap, StyleSpecification } from 'maplibre-gl'
import { PALETTE as C } from '../config/palette'
import type { Graph } from '../core/graph'

const cityGeoCache = new WeakMap<Graph, FeatureCollection<LineString>>()

export function cityGeoJSON(g: Graph): FeatureCollection<LineString> {
  let fc = cityGeoCache.get(g)
  if (!fc) {
    fc = {
      type: 'FeatureCollection',
      features: g.city.segments.map((s, i) => ({
        type: 'Feature',
        id: i,
        properties: { k: s.k },
        geometry: { type: 'LineString', coordinates: s.c },
      })),
    }
    cityGeoCache.set(g, fc)
  }
  return fc
}

const done: ExpressionSpecification = ['boolean', ['feature-state', 'done'], false]
const partial: ExpressionSpecification = ['boolean', ['feature-state', 'partial'], false]
const width = (base: number): ExpressionSpecification => ['interpolate', ['exponential', 1.6], ['zoom'], 11, base * 0.4, 14, base, 18, base * 4]

// Zoom must be the outermost expression, so scale per kind at each zoom stop. Alleys and paths draw thinner.
const kindWidth = (scale: number): ExpressionSpecification => ['case', ['==', ['get', 'k'], 0], scale * 1.5, scale]

export const streetLayers: LayerSpecification[] = [
  {
    id: 'walked-glow',
    type: 'line',
    source: 'city',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': C.walked, 'line-width': width(7), 'line-opacity': ['case', done, 0.22, 0] },
  },
  {
    id: 'streets',
    type: 'line',
    source: 'city',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', done, C.walked, partial, '#2B7077', ['==', ['get', 'k'], 0], C.streetUnwalked, C.alleyUnwalked],
      'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, kindWidth(0.4), 14, kindWidth(1), 18, kindWidth(4)],
    },
  },
]

export function baseStyle(g: Graph | null): StyleSpecification {
  return {
    version: 8,
    sources: g ? { city: { type: 'geojson', data: cityGeoJSON(g) } } : {},
    layers: [{ id: 'bg', type: 'background', paint: { 'background-color': C.bg } }, ...(g ? streetLayers : [])],
  }
}

/** Polygon approximating a circle of `r` meters, for GPS accuracy. */
export function circle(lon: number, lat: number, r: number, n = 40): [number, number][] {
  const out: [number, number][] = []
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI
    out.push([lon + (r * Math.cos(a)) / kx, lat + (r * Math.sin(a)) / 110_574])
  }
  return out
}

/** Apply every segment's done/partial state to a map. */
export function applyAllCoverage(map: MapLibreMap, masks: Uint16Array, completedAt: Float64Array) {
  if (!map.getSource('city')) return
  map.removeFeatureState({ source: 'city' })
  for (let i = 0; i < masks.length; i++) {
    if (masks[i] || completedAt[i]) map.setFeatureState({ source: 'city', id: i }, { done: completedAt[i] > 0, partial: masks[i] > 0 })
  }
}
