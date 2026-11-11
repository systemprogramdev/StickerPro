// Turns a stream of GPS fixes into per-segment coverage masks. Deterministic: the same
// fixes in the same order always produce the same masks. No DOM or browser APIs.
import { THRESHOLDS as T } from '../config/thresholds'
import { axisDiff, bearingDiff, bearingXY } from './geo'
import { nearbySegments, projLen, sharedNode, type Graph } from './graph'
import type { CoverageUpdate, Fix } from './types'

const FULL = (1 << T.coverageSlices) - 1

export function popcount(m: number): number {
  let c = 0
  while (m) {
    m &= m - 1
    c++
  }
  return c
}

export interface MatchResult {
  accepted: boolean
  seg: number // -1 if unmatched
  along: number
  forward: boolean // moving from node a toward node b
  updates: CoverageUpdate[]
}

interface Last {
  seg: number
  along: number
  forward: boolean
}

// Where the track was when the GPS went quiet (tunnel, covered street, app hidden).
interface Bridge extends Last {
  t: number
  x: number
  y: number
}

export class Matcher {
  readonly masks: Uint16Array
  readonly completedAt: Float64Array // 0 = not complete
  private recent: { x: number; y: number }[] = []
  private prevT = -Infinity
  private last: Last | null = null
  private alley: { seg: number; ends: number } | null = null
  private bridge: Bridge | null = null
  private changed = new Set<number>()
  private now = 0
  private readonly g: Graph

  constructor(g: Graph, masks?: Uint16Array, completedAt?: Float64Array) {
    this.g = g
    const n = g.segA.length
    this.masks = masks ?? new Uint16Array(n)
    this.completedAt = completedAt ?? new Float64Array(n)
  }

  /** Break continuity, e.g. at the start of a walk. Coverage is kept. */
  reset() {
    this.recent = []
    this.prevT = -Infinity
    this.last = null
    this.alley = null
    this.bridge = null
  }

  push(fix: Fix): MatchResult {
    const g = this.g
    const none: MatchResult = { accepted: false, seg: -1, along: 0, forward: true, updates: [] }
    if (!(fix.acc <= T.maxAccuracyM)) return none

    if (fix.t - this.prevT > T.gapSeconds * 1000) {
      const end = this.recent[this.recent.length - 1]
      const bridge = this.last && end ? { ...this.last, t: this.prevT, x: end.x, y: end.y } : null
      this.reset()
      this.bridge = bridge
    }
    this.prevT = fix.t
    this.now = fix.t
    this.changed.clear()

    const [x, y] = g.proj.toXY(fix.lon, fix.lat)
    this.recent.push({ x, y })
    if (this.recent.length > T.headingWindow) this.recent.shift()
    const heading = this.heading(fix)

    // After a gap, carry on from where the signal was lost if walking could explain the jump.
    // Only the same or an adjacent segment is filled, so a bridge never crosses a block.
    const b = this.bridge
    this.bridge = null
    if (b && fix.t - b.t <= T.bridgeMaxSeconds * 1000 && Math.hypot(x - b.x, y - b.y) <= (T.bridgeMaxSpeedMps * (fix.t - b.t)) / 1000) {
      this.last = { seg: b.seg, along: b.along, forward: b.forward }
    }

    const cands = nearbySegments(g, x, y, T.matchRadiusM)
    if (!cands.length) {
      // Off the network: keep heading history but drop segment continuity.
      this.last = null
      this.alley = null
      return { ...none, accepted: true }
    }

    let best = cands[0]
    let bestScore = Infinity
    for (const c of cands) {
      let score = c.dist
      if (heading !== null) score += (axisDiff(heading, c.bearing) / 90) * T.headingPenaltyM
      if (this.last) {
        if (c.seg === this.last.seg) score -= T.sameSegmentBonusM
        else if (sharedNode(g, c.seg, this.last.seg) < 0) score += T.farSegmentPenaltyM
      }
      if (score < bestScore) {
        bestScore = score
        best = c
      }
    }

    const seg = best.seg
    const along = best.along
    const L = projLen(g, seg)
    let forward = heading !== null ? bearingDiff(heading, best.bearing) <= 90 : true

    const last = this.last
    if (last && last.seg === seg) {
      this.fill(seg, last.along, along)
      if (Math.abs(along - last.along) > 0.5) forward = along > last.along
      else forward = last.forward
      this.alleyTouchEnds(seg, along, L)
    } else if (last && sharedNode(g, last.seg, seg) >= 0) {
      const node = sharedNode(g, last.seg, seg)
      const lastL = projLen(g, last.seg)
      const lastEnd = g.segA[last.seg] === node ? 0 : lastL
      const newStart = g.segA[seg] === node ? 0 : L
      this.fill(last.seg, last.along, lastEnd)
      if (this.alley && this.alley.seg === last.seg) this.alleyEnd(last.seg, node)
      this.alley = null
      this.fill(seg, newStart, along)
      forward = newStart === 0
      if (g.segKind[seg] === 1) {
        this.alley = { seg, ends: 0 }
        this.alleyEnd(seg, node)
      }
      this.alleyTouchEnds(seg, along, L)
    } else {
      this.alley = g.segKind[seg] === 1 ? { seg, ends: 0 } : null
      this.fill(seg, along, along)
      this.alleyTouchEnds(seg, along, L)
    }

    this.last = { seg, along, forward }
    const updates: CoverageUpdate[] = []
    for (const s of [...this.changed].sort((p, q) => p - q)) {
      updates.push({ seg: s, mask: this.masks[s], completedAt: this.completedAt[s] || null })
    }
    return { accepted: true, seg, along, forward, updates }
  }

  private heading(fix: Fix): number | null {
    const r = this.recent
    if (r.length >= 2) {
      const a = r[0], b = r[r.length - 1]
      if (Math.hypot(b.x - a.x, b.y - a.y) >= T.headingMinMoveM) return bearingXY(b.x - a.x, b.y - a.y)
    }
    if (fix.heading !== null && Number.isFinite(fix.heading) && (fix.speed ?? 0) >= 0.5) return fix.heading
    return null
  }

  private slice(seg: number, along: number): number {
    const L = projLen(this.g, seg)
    if (L <= 0) return 0
    return Math.max(0, Math.min(T.coverageSlices - 1, Math.floor((along / L) * T.coverageSlices)))
  }

  private fill(seg: number, a1: number, a2: number) {
    const lo = this.slice(seg, Math.min(a1, a2))
    const hi = this.slice(seg, Math.max(a1, a2))
    let bits = 0
    for (let i = lo; i <= hi; i++) bits |= 1 << i
    const before = this.masks[seg]
    const after = before | bits
    if (after !== before) {
      this.masks[seg] = after
      this.changed.add(seg)
    }
    this.checkComplete(seg)
  }

  private checkComplete(seg: number) {
    if (this.completedAt[seg]) return
    const m = this.masks[seg]
    const done = this.g.segLen[seg] < T.shortSegmentM ? m === FULL : popcount(m) >= T.completeSlices
    if (done) this.complete(seg)
  }

  private complete(seg: number) {
    if (this.completedAt[seg]) return
    this.completedAt[seg] = this.now
    this.changed.add(seg)
  }

  // Alleys complete when one continuous pass reaches both end nodes.
  private alleyEnd(seg: number, node: number) {
    if (!this.alley || this.alley.seg !== seg) return
    this.alley.ends |= this.g.segA[seg] === node ? 1 : 0
    this.alley.ends |= this.g.segB[seg] === node ? 2 : 0
    if (this.alley.ends === 3) this.complete(seg)
  }

  private alleyTouchEnds(seg: number, along: number, L: number) {
    if (!this.alley || this.alley.seg !== seg) return
    if (along <= T.alleyEndM) this.alley.ends |= 1
    if (along >= L - T.alleyEndM) this.alley.ends |= 2
    if (this.alley.ends === 3) this.complete(seg)
  }
}

/** Recompute coverage from scratch by replaying walks in order. */
export function replayWalks(g: Graph, walks: Iterable<Fix[]>): Matcher {
  const m = new Matcher(g)
  for (const fixes of walks) {
    m.reset()
    for (const f of fixes) m.push(f)
  }
  return m
}
