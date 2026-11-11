import { LngLatBounds, Map as MapLibreMap } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import { controller } from '../app/controller'
import { PALETTE as C } from '../config/palette'
import type { Graph } from '../core/graph'
import { applyAllCoverage, baseStyle } from './mapStyle'

/** A static map of one walk's track over the street network. */
export function TrackMap({ graph, lines }: { graph: Graph | null; lines: [number, number][][] }) {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const map = new MapLibreMap({ container: el.current!, style: baseStyle(graph), attributionControl: false, dragRotate: false })
    map.touchZoomRotate.disableRotation()
    map.on('load', () => {
      if (graph) applyAllCoverage(map, controller.masks, controller.completedAt)
      map.addSource('track', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: lines.filter((l) => l.length > 1).map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })),
        },
      })
      map.addLayer({ id: 'track', type: 'line', source: 'track', paint: { 'line-color': C.accent, 'line-width': 2.5 } })
      const pts = lines.flat()
      if (pts.length) {
        const b = pts.reduce((bb, p) => bb.extend(p), new LngLatBounds(pts[0], pts[0]))
        map.fitBounds(b, { padding: 32, duration: 0, maxZoom: 17 })
      }
    })
    return () => map.remove()
  }, [graph, lines])

  return <div ref={el} className="track-map" />
}
