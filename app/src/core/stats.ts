// Day-based stats: last 7 days, streak. Pure; days are local calendar days.

export interface WalkSummary {
  start: number
  end: number | null
  distanceM: number
  newSegments: number
}

export const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const addDays = (t: number, n: number) => {
  const d = new Date(t)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

export function lastDays(walks: WalkSummary[], now: number, days = 7) {
  const out: { key: string; label: string; meters: number; newSegments: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const t = addDays(now, -i)
    const key = dayKey(t)
    const ws = walks.filter((w) => dayKey(w.start) === key)
    out.push({
      key,
      label: new Date(t).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase().slice(0, 2),
      meters: ws.reduce((m, w) => m + w.distanceM, 0),
      newSegments: ws.reduce((m, w) => m + w.newSegments, 0),
    })
  }
  return out
}

/** Consecutive streak days ending today (or yesterday, if today has no qualifying walk yet). */
export function streak(walks: WalkSummary[], now: number): number {
  const days = new Set(walks.filter((w) => w.newSegments > 0).map((w) => dayKey(w.start)))
  let t = days.has(dayKey(now)) ? now : addDays(now, -1)
  let n = 0
  while (days.has(dayKey(t))) {
    n++
    t = addDays(t, -1)
  }
  return n
}
