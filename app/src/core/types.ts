// City file format (version 1) and shared domain types. Pure data, no browser APIs.

export const CITY_FORMAT = 'stickerpro-city'
export const CITY_FORMAT_VERSION = 1

export type SegmentKind = 0 | 1 | 2 // street, alley, path
export const KIND_NAMES = ['street', 'alley', 'path'] as const

export interface CityManifest {
  format: typeof CITY_FORMAT
  version: number
  city: string
  bounds: [number, number, number, number] // west, south, east, north
  builtAt: string
  totals: { segments: number; meters: number; streetMeters: number; alleyMeters: number; pathMeters: number }
}

export interface CitySegment {
  id: string // stable: "<wayId>:<nodeA>:<nodeB>"
  a: number // node index
  b: number // node index
  n: number // name index, -1 for unnamed
  k: SegmentKind
  len: number // meters
  s: number // sector index, -1 for none
  c: [number, number][] // [lon, lat] polyline from node a to node b
}

export interface CitySector {
  name: string
  polygon?: [number, number][][] // rings of [lon, lat]
}

export interface CityFile {
  manifest: CityManifest
  nodes: [number, number, number][] // [osmId, lat, lon]
  segments: CitySegment[]
  names: string[]
  sectors: CitySector[]
}

export interface Fix {
  t: number // ms epoch
  lat: number
  lon: number
  acc: number // meters
  speed: number | null // m/s
  heading: number | null // degrees from north
}

/** Per-segment coverage update emitted by the matcher. */
export interface CoverageUpdate {
  seg: number
  mask: number
  completedAt: number | null
}
