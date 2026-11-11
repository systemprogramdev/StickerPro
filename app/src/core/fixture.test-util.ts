// Helpers for tests on the fixture graph (fixtures/fixture-city.json, made by prep.py --fixture).
import fixture from '../../../fixtures/fixture-city.json'
import { buildGraph, validateCity, type Graph } from './graph'
import { fixesAlongXY, type SynthOptions } from './synth'
import type { CityFile, Fix } from './types'

export const loadFixture = (): Graph => buildGraph(validateCity(structuredClone(fixture) as unknown as CityFile))

// Same local frame prep.py used to lay out the fixture, in meters.
const LAT0 = 39.949
const LON0 = -75.172
const KY = 111_195
const KX = KY * Math.cos((LAT0 * Math.PI) / 180)

export const P = {
  A0: [0, 0], A1: [100, 0], A2: [200, 0], A3: [300, 0],
  B0: [0, 60], B1: [100, 60], B2: [200, 60], B3: [300, 60],
  M1: [100, 30], M2: [200, 30], S: [300, 85],
} as const satisfies Record<string, readonly [number, number]>

const NODE_ID = Object.fromEntries(Object.keys(P).map((k, i) => [k, 1000 + i])) as Record<keyof typeof P, number>

/** Segment index for the fixture edge between two named points. */
export function seg(g: Graph, way: number, p: keyof typeof P, q: keyof typeof P): number {
  const [a, b] = [NODE_ID[p], NODE_ID[q]].sort((x, y) => x - y)
  const i = g.segIndexById.get(`${way}:${a}:${b}`)
  if (i === undefined) throw new Error(`no segment ${way}:${p}-${q}`)
  return i
}

/** Fixes walking through fixture-frame points (meters). */
export function walk(g: Graph, pts: readonly (readonly [number, number])[], o: SynthOptions = {}): Fix[] {
  const xy = pts.map(([x, y]) => g.proj.toXY(LON0 + x / KX, LAT0 + y / KY))
  return fixesAlongXY(g, xy, o)
}
