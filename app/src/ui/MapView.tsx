import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { Map as MapLibreMap, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { controller } from '../app/controller'
import { useApp } from '../app/useApp'
import { PALETTE as C } from '../config/palette'
import { applyAllCoverage, baseStyle, circle } from './mapStyle'

export type Pin = { kind: 'note' | 'photo'; id: number }
export type StreetInfo = { seg: number }

const PHILLY: [number, number] = [-75.1652, 39.9526]
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
const fc = (features: Feature<Geometry>[]): FeatureCollection => ({ type: 'FeatureCollection', features })

export function MapView({ onPin, onStreet }: { onPin: (p: Pin) => void; onStreet: (s: StreetInfo | null) => void }) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [loaded, setLoaded] = useState(0) // bumps when a style with the city finishes loading
  const [follow, setFollow] = useState(true)
  const s = useApp()
  const cb = useRef({ onPin, onStreet })
  cb.current = { onPin, onStreet }

  // Create the map once.
  useEffect(() => {
    const map = new MapLibreMap({
      container: el.current!,
      center: PHILLY,
      zoom: 15,
      style: baseStyle(null),
      attributionControl: { compact: true, customAttribution: '© OpenStreetMap contributors' },
      dragRotate: false,
      pitchWithRotate: false,
    })
    map.touchZoomRotate.disableRotation()
    map.on('dragstart', () => setFollow(false))
    mapRef.current = map
    if (import.meta.env.DEV) (window as unknown as { __map: MapLibreMap }).__map = map
    return () => map.remove()
  }, [])

  // (Re)load the style when the city changes, then add overlay layers.
  useEffect(() => {
    const map = mapRef.current!
    const g = s.graph
    map.setStyle(baseStyle(g), { diff: false })
    map.once('style.load', () => {
      for (const id of ['route', 'track', 'acc', 'pins'] as const) map.addSource(id, { type: 'geojson', data: empty })
      map.addSource('pos', { type: 'geojson', data: empty })
      map.addLayer({ id: 'acc', type: 'fill', source: 'acc', paint: { 'fill-color': C.accent, 'fill-opacity': 0.1 } })
      map.addLayer({
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-join': 'round' },
        paint: { 'line-color': C.accent, 'line-width': 3, 'line-dasharray': [2, 1.5] },
      })
      map.addLayer({ id: 'track', type: 'line', source: 'track', paint: { 'line-color': C.accent, 'line-width': 1.5, 'line-opacity': 0.75 } })
      map.addLayer({
        id: 'pins',
        type: 'circle',
        source: 'pins',
        paint: {
          'circle-radius': 7,
          'circle-color': ['match', ['get', 'kind'], 'note', C.number, C.text],
          'circle-stroke-color': C.bg,
          'circle-stroke-width': 2,
        },
      })
      map.addLayer({
        id: 'pos',
        type: 'circle',
        source: 'pos',
        paint: { 'circle-radius': 8, 'circle-color': C.accent, 'circle-stroke-color': C.bg, 'circle-stroke-width': 3 },
      })
      if (g) {
        applyAllCoverage(map, controller.masks, controller.completedAt)
        if (!controller.state.lastFix) {
          const [w, so, e, n] = g.city.manifest.bounds
          map.jumpTo({ center: [(w + e) / 2, (so + n) / 2] })
        }
      }
      setLoaded((n) => n + 1)
    })
  }, [s.graph])

  // Coverage changes stream in from the controller.
  useEffect(
    () =>
      controller.onCoverage((e) => {
        const map = mapRef.current
        if (!map?.getSource('city')) return
        if (e === 'all') return applyAllCoverage(map, controller.masks, controller.completedAt)
        for (const u of e) map.setFeatureState({ source: 'city', id: u.seg }, { done: u.done, partial: u.partial })
      }),
    [],
  )

  // Taps: pins first, then streets.
  useEffect(() => {
    const map = mapRef.current!
    const click = (ev: MapMouseEvent) => {
      const box: [[number, number], [number, number]] = [
        [ev.point.x - 12, ev.point.y - 12],
        [ev.point.x + 12, ev.point.y + 12],
      ]
      const layers = ['pins', 'streets'].filter((l) => map.getLayer(l))
      const hits = map.queryRenderedFeatures(box, { layers })
      const pin = hits.find((h) => h.layer.id === 'pins')
      if (pin) return cb.current.onPin({ kind: pin.properties.kind, id: pin.properties.id })
      const st = hits.find((h) => h.layer.id === 'streets')
      cb.current.onStreet(st ? { seg: Number(st.id) } : null)
    }
    map.on('click', click)
    return () => void map.off('click', click)
  }, [])

  const src = (id: string) => mapRef.current?.getSource(id) as GeoJSONSource | undefined

  useEffect(() => {
    src('track')?.setData(fc(s.track.filter((l) => l.length > 1).map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }))))
  }, [s.track, loaded])

  useEffect(() => {
    src('route')?.setData(s.route ? fc([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: s.route.coords } }]) : empty)
  }, [s.route, loaded])

  useEffect(() => {
    const pins: Feature<Geometry>[] = [
      ...s.notes.map((n) => ({ type: 'Feature' as const, properties: { kind: 'note', id: n.id }, geometry: { type: 'Point' as const, coordinates: [n.lon, n.lat] } })),
      ...s.photos.map((p) => ({ type: 'Feature' as const, properties: { kind: 'photo', id: p.id }, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] } })),
    ]
    src('pins')?.setData(fc(pins))
  }, [s.notes, s.photos, loaded])

  useEffect(() => {
    const f = s.lastFix
    if (!f) return
    src('pos')?.setData(fc([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } }]))
    src('acc')?.setData(fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(f.lon, f.lat, f.acc)] } }]))
    if (follow) mapRef.current?.easeTo({ center: [f.lon, f.lat], duration: 300 })
  }, [s.lastFix, follow, loaded])

  return (
    <>
      <div ref={el} style={{ position: 'absolute', inset: 0 }} />
      {!follow && s.lastFix && (
        <button className="map-btn center-btn" onClick={() => setFollow(true)} aria-label="Center on position">
          ◎ CENTER
        </button>
      )}
    </>
  )
}
