// Route planning over the city graph: nearest unwalked, loop walk, clear sector. Pure.
import { THRESHOLDS as T } from '../config/thresholds'
import { bearingXY } from './geo'
import { nearestSegment, otherEnd, projLen, segmentLabel, type Graph } from './graph'

export interface RouteStep {
  seg: number
  from: number // node
  to: number // node
}

export interface Turn {
  at: number // meters along the route
  dir: 'LEFT' | 'RIGHT' | 'STRAIGHT' | 'U-TURN' | 'ARRIVE'
  onto: string
}

export interface Route {
  mode: PlanMode
  coords: [number, number][] // [lon, lat]
  meters: number
  newMeters: number // length of incomplete segments the route covers
  steps: RouteStep[]
  turns: Turn[]
}

export type PlanMode = 'nearest' | 'loop' | 'sector'

class Heap {
  private k: number[] = []
  private v: number[] = []
  get size() {
    return this.k.length
  }
  push(key: number, val: number) {
    const k = this.k, v = this.v
    let i = k.length
    k.push(key)
    v.push(val)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (k[p] <= key) break
      k[i] = k[p]; v[i] = v[p]
      i = p
    }
    k[i] = key; v[i] = val
  }
  pop(): [number, number] {
    const k = this.k, v = this.v
    const topK = k[0], topV = v[0]
    const lk = k.pop()!, lv = v.pop()!
    if (k.length) {
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        let mk = lk
        if (l < k.length && k[l] < mk) { m = l; mk = k[l] }
        if (r < k.length && k[r] < mk) { m = r; mk = k[r] }
        if (m === i) break
        k[i] = k[m]; v[i] = v[m]
        i = m
      }
      k[i] = lk; v[i] = lv
    }
    return [topK, topV]
  }
}

interface Search {
  dist: Float64Array
  prevSeg: Int32Array
  found: number // node where the search stopped, or -1
}

function dijkstra(
  g: Graph,
  sources: { node: number; cost: number }[],
  stop?: (node: number) => boolean,
): Search {
  const n = g.nodeX.length
  const dist = new Float64Array(n).fill(Infinity)
  const prevSeg = new Int32Array(n).fill(-1)
  const heap = new Heap()
  for (const s of sources) {
    if (s.cost < dist[s.node]) {
      dist[s.node] = s.cost
      heap.push(s.cost, s.node)
    }
  }
  while (heap.size) {
    const [d, u] = heap.pop()
    if (d > dist[u]) continue
    if (stop?.(u)) return { dist, prevSeg, found: u }
    for (const seg of g.nodeSegs[u]) {
      const v = otherEnd(g, seg, u)
      const nd = d + g.segLen[seg]
      if (nd < dist[v]) {
        dist[v] = nd
        prevSeg[v] = seg
        heap.push(nd, v)
      }
    }
  }
  return { dist, prevSeg, found: -1 }
}

function pathTo(g: Graph, s: Search, node: number): RouteStep[] {
  const steps: RouteStep[] = []
  let v = node
  while (s.prevSeg[v] >= 0) {
    const seg = s.prevSeg[v]
    const u = otherEnd(g, seg, v)
    steps.push({ seg, from: u, to: v })
    v = u
  }
  return steps.reverse()
}

interface Start {
  seg: number
  along: number
  x: number
  y: number
}

function snap(g: Graph, lon: number, lat: number): Start | null {
  const [x, y] = g.proj.toXY(lon, lat)
  const c = nearestSegment(g, x, y, 3200)
  return c ? { seg: c.seg, along: c.along, x: c.x, y: c.y } : null
}

function startSources(g: Graph, st: Start) {
  const L = projLen(g, st.seg)
  return [
    { node: g.segA[st.seg], cost: st.along },
    { node: g.segB[st.seg], cost: L - st.along },
  ]
}

/** The lead-in from the snapped position to the node a search started from. */
function leadIn(g: Graph, st: Start, firstNode: number): [number, number][] {
  const coords = g.city.segments[st.seg].c
  const cum = g.segCum[st.seg]
  const out: [number, number][] = [g.proj.toLonLat(st.x, st.y)]
  if (firstNode === g.segA[st.seg]) {
    for (let i = cum.length - 1; i >= 0; i--) if (cum[i] < st.along) out.push(coords[i])
  } else {
    for (let i = 0; i < cum.length; i++) if (cum[i] > st.along) out.push(coords[i])
  }
  return out
}

function buildRoute(g: Graph, mode: PlanMode, lead: [number, number][], steps: RouteStep[], done: (s: number) => boolean): Route {
  const coords: [number, number][] = [...lead]
  const newSegs = new Set<number>()
  for (const st of steps) {
    const c = g.city.segments[st.seg].c
    const ordered = st.from === g.segA[st.seg] ? c : [...c].reverse()
    for (const p of ordered) {
      const lastP = coords[coords.length - 1]
      if (!lastP || lastP[0] !== p[0] || lastP[1] !== p[1]) coords.push(p)
    }
    if (!done(st.seg)) newSegs.add(st.seg)
  }
  let meters = 0
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = g.proj.toXY(coords[i - 1][0], coords[i - 1][1])
    const [x2, y2] = g.proj.toXY(coords[i][0], coords[i][1])
    meters += Math.hypot(x2 - x1, y2 - y1)
  }
  let newMeters = 0
  for (const s of newSegs) newMeters += g.segLen[s]
  return { mode, coords, meters, newMeters, steps, turns: turnsFor(g, steps, meters - stepsLength(g, steps)) }
}

const stepsLength = (g: Graph, steps: RouteStep[]) => steps.reduce((m, s) => m + projLen(g, s.seg), 0)

function travelBearing(g: Graph, st: RouteStep, atStart: boolean): number {
  const xy = g.segXY[st.seg]
  const n = xy.length / 2
  const fwd = st.from === g.segA[st.seg]
  // Direction of travel along the segment, sampled at its start or end.
  const i = atStart ? (fwd ? 0 : n - 1) : fwd ? n - 2 : 1
  const j = atStart ? (fwd ? 1 : n - 2) : fwd ? n - 1 : 0
  return bearingXY(xy[2 * j] - xy[2 * i], xy[2 * j + 1] - xy[2 * i + 1])
}

function turnsFor(g: Graph, steps: RouteStep[], offset: number): Turn[] {
  const turns: Turn[] = []
  let at = offset
  for (let i = 0; i < steps.length; i++) {
    at += projLen(g, steps[i].seg)
    const next = steps[i + 1]
    if (!next) break
    const inB = travelBearing(g, steps[i], false)
    const outB = travelBearing(g, next, true)
    const delta = ((outB - inB + 540) % 360) - 180 // -180..180, positive = right
    const sameName = segmentLabel(g, steps[i].seg) === segmentLabel(g, next.seg)
    if (next.seg === steps[i].seg) {
      turns.push({ at, dir: 'U-TURN', onto: segmentLabel(g, next.seg) })
    } else if (Math.abs(delta) > T.turnAngleDeg) {
      turns.push({ at, dir: Math.abs(delta) > 160 ? 'U-TURN' : delta > 0 ? 'RIGHT' : 'LEFT', onto: segmentLabel(g, next.seg) })
    } else if (!sameName) {
      turns.push({ at, dir: 'STRAIGHT', onto: segmentLabel(g, next.seg) })
    }
  }
  turns.push({ at: offset + stepsLength(g, steps), dir: 'ARRIVE', onto: steps.length ? segmentLabel(g, steps[steps.length - 1].seg) : '' })
  return turns
}

/** Shortest route from a position to the closest incomplete segment, then along it. */
export function planNearest(g: Graph, done: (s: number) => boolean, lon: number, lat: number): Route | null {
  const st = snap(g, lon, lat)
  if (!st) return null
  if (!done(st.seg)) {
    // Already on an unwalked segment: walk it to the end with more of it left.
    const L = projLen(g, st.seg)
    const toB = L - st.along >= st.along
    const end = toB ? g.segB[st.seg] : g.segA[st.seg]
    const lead = leadIn(g, st, end)
    return buildRoute(g, 'nearest', lead, [], done)
  }
  const s = dijkstra(g, startSources(g, st), (u) => g.nodeSegs[u].some((seg) => !done(seg)))
  if (s.found < 0) return null
  const path = pathTo(g, s, s.found)
  const first = path.length ? path[0].from : s.found
  const target = g.nodeSegs[s.found].filter((seg) => !done(seg)).sort((a, b) => g.segLen[b] - g.segLen[a] || a - b)[0]
  path.push({ seg: target, from: s.found, to: otherEnd(g, target, s.found) })
  return buildRoute(g, 'nearest', leadIn(g, st, first), path, done)
}

/** Greedy chain of nearby incomplete segments within a distance budget, back to the start. */
export function planLoop(g: Graph, done: (s: number) => boolean, lon: number, lat: number, budgetM: number): Route | null {
  const st = snap(g, lon, lat)
  if (!st) return null
  const L = projLen(g, st.seg)
  const startNode = st.along <= L - st.along ? g.segA[st.seg] : g.segB[st.seg]
  const leadM = Math.min(st.along, L - st.along)
  const home = dijkstra(g, [{ node: startNode, cost: 0 }])
  const used = new Set<number>()
  const isTarget = (seg: number) => !done(seg) && !used.has(seg)
  const steps: RouteStep[] = []
  let cur = startNode
  let total = leadM
  for (let iter = 0; iter < 2000; iter++) {
    const s = dijkstra(g, [{ node: cur, cost: 0 }], (u) => g.nodeSegs[u].some(isTarget))
    if (s.found < 0) break
    const seg = g.nodeSegs[s.found].filter(isTarget).sort((a, b) => g.segLen[b] - g.segLen[a] || a - b)[0]
    const end = otherEnd(g, seg, s.found)
    const cost = s.dist[s.found] + g.segLen[seg]
    if (total + cost + home.dist[end] > budgetM) break
    steps.push(...pathTo(g, s, s.found), { seg, from: s.found, to: end })
    used.add(seg)
    total += cost
    cur = end
  }
  if (!steps.length) return null
  const back = dijkstra(g, [{ node: cur, cost: 0 }], (u) => u === startNode)
  steps.push(...pathTo(g, back, startNode))
  return buildRoute(g, 'loop', leadIn(g, st, startNode), steps, done)
}

/** Greedy route covering every incomplete segment in a sector. */
export function planSector(g: Graph, done: (s: number) => boolean, lon: number, lat: number, sector: number): Route | null {
  const st = snap(g, lon, lat)
  if (!st || sector < 0) return null
  const used = new Set<number>()
  const isTarget = (seg: number) => g.segSector[seg] === sector && !done(seg) && !used.has(seg)
  const steps: RouteStep[] = []
  let sources = startSources(g, st)
  let first = -1
  for (let iter = 0; iter < 20000; iter++) {
    const s = dijkstra(g, sources, (u) => g.nodeSegs[u].some(isTarget))
    if (s.found < 0) break
    const path = pathTo(g, s, s.found)
    if (first < 0) first = path.length ? path[0].from : s.found
    const seg = g.nodeSegs[s.found].filter(isTarget).sort((a, b) => g.segLen[b] - g.segLen[a] || a - b)[0]
    const end = otherEnd(g, seg, s.found)
    steps.push(...path, { seg, from: s.found, to: end })
    used.add(seg)
    sources = [{ node: end, cost: 0 }]
  }
  if (!steps.length) return null
  return buildRoute(g, 'sector', leadIn(g, st, first), steps, done)
}

export function plan(
  g: Graph,
  done: (s: number) => boolean,
  mode: PlanMode,
  lon: number,
  lat: number,
  opts: { budgetM?: number; sector?: number },
): Route | null {
  if (mode === 'nearest') return planNearest(g, done, lon, lat)
  if (mode === 'loop') return planLoop(g, done, lon, lat, opts.budgetM ?? 3200)
  return planSector(g, done, lon, lat, opts.sector ?? -1)
}
