// City and sector totals from per-segment completion. Pure.
import type { Graph } from './graph'

export interface SectorProgress {
  index: number
  name: string
  walkedM: number
  totalM: number
  pct: number
}

export interface ProgressSummary {
  walkedM: number
  totalM: number
  pct: number
  completed: number
  segments: number
  sectors: SectorProgress[]
}

export function summarize(g: Graph, completedAt: ArrayLike<number>): ProgressSummary {
  let walkedM = 0
  let completed = 0
  const sectorWalked = new Float64Array(g.sectorMeters.length)
  for (let i = 0; i < g.segLen.length; i++) {
    if (!completedAt[i]) continue
    completed++
    walkedM += g.segLen[i]
    const s = g.segSector[i]
    if (s >= 0) sectorWalked[s] += g.segLen[i]
  }
  const sectors = g.city.sectors.map((sec, i) => ({
    index: i,
    name: sec.name,
    walkedM: sectorWalked[i],
    totalM: g.sectorMeters[i],
    pct: g.sectorMeters[i] > 0 ? (100 * sectorWalked[i]) / g.sectorMeters[i] : 0,
  }))
  return {
    walkedM,
    totalM: g.totalMeters,
    pct: g.totalMeters > 0 ? (100 * walkedM) / g.totalMeters : 0,
    completed,
    segments: g.segLen.length,
    sectors,
  }
}

/** Sectors that reached 100% because of the given newly completed segments. */
export function newlyClearedSectors(g: Graph, completedAt: ArrayLike<number>, newSegs: number[]): number[] {
  const touched = new Set(newSegs.map((s) => g.segSector[s]).filter((s) => s >= 0))
  const cleared: number[] = []
  for (const sector of touched) {
    let all = true
    for (let i = 0; i < g.segSector.length && all; i++) if (g.segSector[i] === sector && !completedAt[i]) all = false
    if (all) cleared.push(sector)
  }
  return cleared
}
