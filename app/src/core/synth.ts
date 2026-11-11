// Synthetic GPS tracks for replay mode and tests. Pure.
import { pointAlong } from './geo'
import { nearestSegment, otherEnd, projLen, type Graph } from './graph'
import type { Fix } from './types'

/** Small seeded PRNG so synthetic tracks are reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand: () => number) {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

export interface SynthOptions {
  speed?: number // m/s
  interval?: number // seconds between fixes
  noiseM?: number // standard deviation of position noise
  accuracy?: number
  t0?: number
  seed?: number
}

/** Fixes along a projected XY polyline. */
export function fixesAlongXY(g: Graph, pts: [number, number][], o: SynthOptions = {}): Fix[] {
  const speed = o.speed ?? 1.4
  const interval = o.interval ?? 1
  const rand = mulberry32(o.seed ?? 1)
  const xy = new Float64Array(pts.flat())
  const cum = new Float64Array(pts.length)
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  const total = cum[cum.length - 1]
  const out: Fix[] = []
  let t = o.t0 ?? 1_700_000_000_000
  // Real GPS error drifts slowly rather than jumping each fix, so use AR(1) noise.
  const rho = 0.9
  const sigma = o.noiseM ?? 0
  let ex = gaussian(rand) * sigma
  let ey = gaussian(rand) * sigma
  for (let d = 0; d <= total + 1e-6; d += speed * interval) {
    const [x, y] = pointAlong(xy, cum, d)
    const [x2, y2] = pointAlong(xy, cum, Math.min(total, d + 1))
    ex = rho * ex + Math.sqrt(1 - rho * rho) * gaussian(rand) * sigma
    ey = rho * ey + Math.sqrt(1 - rho * rho) * gaussian(rand) * sigma
    const nx = x + ex
    const ny = y + ey
    const [lon, lat] = g.proj.toLonLat(nx, ny)
    const heading = (Math.atan2(x2 - x, y2 - y) * 180) / Math.PI
    out.push({ t, lat, lon, acc: o.accuracy ?? 6, speed, heading: (heading + 360) % 360 })
    t += interval * 1000
  }
  return out
}

/** A random walk along the street network starting near a point. */
export function randomWalk(g: Graph, lon: number, lat: number, meters: number, o: SynthOptions = {}): Fix[] {
  const rand = mulberry32((o.seed ?? 7) + 1)
  const [x0, y0] = g.proj.toXY(lon, lat)
  const start = nearestSegment(g, x0, y0, 5000)
  if (!start) return []
  let node = g.segA[start.seg]
  let prevSeg = -1
  const pts: [number, number][] = [[g.nodeX[node], g.nodeY[node]]]
  let walked = 0
  while (walked < meters) {
    const options = g.nodeSegs[node].filter((s) => s !== prevSeg)
    const seg = options.length ? options[Math.floor(rand() * options.length)] : prevSeg
    if (seg < 0) break
    const xy = g.segXY[seg]
    const n = xy.length / 2
    const fwd = g.segA[seg] === node
    for (let i = 1; i < n; i++) {
      const j = fwd ? i : n - 1 - i
      pts.push([xy[2 * j], xy[2 * j + 1]])
    }
    walked += projLen(g, seg)
    node = otherEnd(g, seg, node)
    prevSeg = seg
  }
  return fixesAlongXY(g, pts, { noiseM: 4, accuracy: 8, ...o })
}
