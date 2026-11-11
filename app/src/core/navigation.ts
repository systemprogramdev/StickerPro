// Following an active route and naming the current and next street. Pure.
import { projectOnPolyline } from './geo'
import { otherEnd, segmentLabel, type Graph } from './graph'
import type { Route, Turn } from './planner'

export interface RouteGeometry {
  xy: Float64Array
  cum: Float64Array
}

export function routeGeometry(g: Graph, route: Route): RouteGeometry {
  const xy = new Float64Array(route.coords.length * 2)
  const cum = new Float64Array(route.coords.length)
  route.coords.forEach(([lon, lat], i) => {
    const [x, y] = g.proj.toXY(lon, lat)
    xy[2 * i] = x
    xy[2 * i + 1] = y
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(x - xy[2 * i - 2], y - xy[2 * i - 1])
  })
  return { xy, cum }
}

export interface RouteProgress {
  offRouteM: number
  alongM: number
  remainingM: number
  next: Turn | null
  toNextM: number
}

/**
 * Where the player is on the route. `minAlong` keeps progress from jumping backwards
 * on routes that double back over the same street.
 */
export function routeProgress(g: Graph, route: Route, geo: RouteGeometry, lon: number, lat: number, minAlong = 0): RouteProgress {
  const [x, y] = g.proj.toXY(lon, lat)
  // Only search the route from slightly behind the last known progress onward.
  let startIdx = 0
  while (startIdx < geo.cum.length - 2 && geo.cum[startIdx + 1] < minAlong - 50) startIdx++
  const sub = geo.xy.subarray(startIdx * 2)
  const subCum = geo.cum.subarray(startIdx)
  const hit = projectOnPolyline(x, y, sub, subCum)
  const total = geo.cum[geo.cum.length - 1]
  const next = route.turns.find((t) => t.at > hit.along + 2) ?? null
  return {
    offRouteM: hit.dist,
    alongM: hit.along,
    remainingM: Math.max(0, total - hit.along),
    next,
    toNextM: next ? Math.max(0, next.at - hit.along) : 0,
  }
}

/** Current street name and the next cross street in the direction of travel. */
export function streetContext(g: Graph, seg: number, forward: boolean): { current: string; next: string } {
  const current = segmentLabel(g, seg)
  const node = forward ? g.segB[seg] : g.segA[seg]
  const name = g.segName[seg]
  let next = ''
  for (const s of g.nodeSegs[node]) {
    if (s === seg) continue
    if (name >= 0 && g.segName[s] === name) continue
    if (g.segName[s] >= 0) {
      next = g.city.names[g.segName[s]]
      break
    }
    if (!next) next = segmentLabel(g, s)
  }
  if (!next) {
    // Dead end or continuation: look one node further along the same street.
    const cont = g.nodeSegs[node].find((s) => s !== seg && g.segName[s] === name)
    if (cont !== undefined) {
      const far = otherEnd(g, cont, node)
      const cross = g.nodeSegs[far].find((s) => s !== cont && g.segName[s] !== name && g.segName[s] >= 0)
      if (cross !== undefined) next = g.city.names[g.segName[cross]]
    }
  }
  return { current, next }
}
