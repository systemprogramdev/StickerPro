// Runtime city graph: projected geometry, topology and a grid index. Built once from a CityFile.
import { THRESHOLDS } from '../config/thresholds'
import { makeProjection, projectOnPolyline, type PolylineHit, type Projection } from './geo'
import { CITY_FORMAT, CITY_FORMAT_VERSION, type CityFile } from './types'

export interface Graph {
  city: CityFile
  proj: Projection
  nodeX: Float64Array
  nodeY: Float64Array
  /** Segment indices touching each node. */
  nodeSegs: number[][]
  segA: Int32Array
  segB: Int32Array
  segLen: Float64Array // meters, from the file
  segKind: Uint8Array
  segName: Int32Array
  segSector: Int32Array
  segXY: Float64Array[]
  segCum: Float64Array[] // cumulative projected length per vertex
  segIndexById: Map<string, number>
  totalMeters: number
  sectorMeters: Float64Array
  grid: Map<string, number[]>
  cell: number
}

export function validateCity(data: unknown): CityFile {
  const c = data as CityFile
  if (!c || typeof c !== 'object' || !c.manifest) throw new Error('Not a city file: missing manifest')
  if (c.manifest.format !== CITY_FORMAT) throw new Error(`Unknown format "${c.manifest.format}"`)
  if (c.manifest.version !== CITY_FORMAT_VERSION)
    throw new Error(`City file version ${c.manifest.version} is not supported (expected ${CITY_FORMAT_VERSION})`)
  if (!Array.isArray(c.nodes) || !Array.isArray(c.segments) || !Array.isArray(c.names))
    throw new Error('City file is missing nodes, segments or names')
  c.sectors ??= []
  return c
}

const key = (cx: number, cy: number) => `${cx},${cy}`

export function buildGraph(city: CityFile): Graph {
  const [w, s, e, n] = city.manifest.bounds
  const proj = makeProjection((w + e) / 2, (s + n) / 2)
  const nn = city.nodes.length
  const ns = city.segments.length
  const nodeX = new Float64Array(nn)
  const nodeY = new Float64Array(nn)
  const nodeSegs: number[][] = Array.from({ length: nn }, () => [])
  for (let i = 0; i < nn; i++) {
    const [x, y] = proj.toXY(city.nodes[i][2], city.nodes[i][1])
    nodeX[i] = x
    nodeY[i] = y
  }

  const g: Graph = {
    city,
    proj,
    nodeX,
    nodeY,
    nodeSegs,
    segA: new Int32Array(ns),
    segB: new Int32Array(ns),
    segLen: new Float64Array(ns),
    segKind: new Uint8Array(ns),
    segName: new Int32Array(ns),
    segSector: new Int32Array(ns),
    segXY: new Array(ns),
    segCum: new Array(ns),
    segIndexById: new Map(),
    totalMeters: 0,
    sectorMeters: new Float64Array(city.sectors.length),
    grid: new Map(),
    cell: THRESHOLDS.gridCellM,
  }

  for (let i = 0; i < ns; i++) {
    const sg = city.segments[i]
    g.segA[i] = sg.a
    g.segB[i] = sg.b
    g.segLen[i] = sg.len
    g.segKind[i] = sg.k
    g.segName[i] = sg.n
    g.segSector[i] = sg.s
    g.segIndexById.set(sg.id, i)
    nodeSegs[sg.a].push(i)
    if (sg.b !== sg.a) nodeSegs[sg.b].push(i)
    g.totalMeters += sg.len
    if (sg.s >= 0) g.sectorMeters[sg.s] += sg.len

    const xy = new Float64Array(sg.c.length * 2)
    const cum = new Float64Array(sg.c.length)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (let j = 0; j < sg.c.length; j++) {
      const [x, y] = proj.toXY(sg.c[j][0], sg.c[j][1])
      xy[2 * j] = x
      xy[2 * j + 1] = y
      if (j > 0) cum[j] = cum[j - 1] + Math.hypot(x - xy[2 * j - 2], y - xy[2 * j - 1])
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
    }
    g.segXY[i] = xy
    g.segCum[i] = cum

    for (let cx = Math.floor(minX / g.cell); cx <= Math.floor(maxX / g.cell); cx++) {
      for (let cy = Math.floor(minY / g.cell); cy <= Math.floor(maxY / g.cell); cy++) {
        const k = key(cx, cy)
        let list = g.grid.get(k)
        if (!list) g.grid.set(k, (list = []))
        list.push(i)
      }
    }
  }
  return g
}

/** Projected length of a segment; slices and "along" positions use this, not the file length. */
export const projLen = (g: Graph, seg: number) => {
  const cum = g.segCum[seg]
  return cum[cum.length - 1]
}

export interface Candidate extends PolylineHit {
  seg: number
}

/** Segments within `radius` meters of a projected point, nearest first. */
export function nearbySegments(g: Graph, x: number, y: number, radius: number): Candidate[] {
  const r = Math.ceil(radius / g.cell)
  const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell)
  const seen = new Set<number>()
  const out: Candidate[] = []
  for (let i = cx - r; i <= cx + r; i++) {
    for (let j = cy - r; j <= cy + r; j++) {
      const list = g.grid.get(key(i, j))
      if (!list) continue
      for (const seg of list) {
        if (seen.has(seg)) continue
        seen.add(seg)
        const hit = projectOnPolyline(x, y, g.segXY[seg], g.segCum[seg])
        if (hit.dist <= radius) out.push({ seg, ...hit })
      }
    }
  }
  return out.sort((p, q) => p.dist - q.dist || p.seg - q.seg)
}

/** Nearest segment, searching outward up to maxRadius meters. */
export function nearestSegment(g: Graph, x: number, y: number, maxRadius = 1000): Candidate | null {
  for (let r = 50; r <= maxRadius; r *= 2) {
    const c = nearbySegments(g, x, y, r)
    if (c.length) return c[0]
  }
  return null
}

/** Node shared by two segments, or -1. */
export function sharedNode(g: Graph, s1: number, s2: number): number {
  const a1 = g.segA[s1], b1 = g.segB[s1], a2 = g.segA[s2], b2 = g.segB[s2]
  if (a1 === a2 || a1 === b2) return a1
  if (b1 === a2 || b1 === b2) return b1
  return -1
}

export const otherEnd = (g: Graph, seg: number, node: number) => (g.segA[seg] === node ? g.segB[seg] : g.segA[seg])

/** Display name for a segment. Unnamed alleys become "ALLEY" plus the nearest named street. */
export function segmentLabel(g: Graph, seg: number): string {
  const n = g.segName[seg]
  if (n >= 0) return g.city.names[n]
  const kind = g.segKind[seg]
  const base = kind === 1 ? 'ALLEY' : kind === 2 ? 'PATH' : 'UNNAMED'
  for (const node of [g.segA[seg], g.segB[seg]]) {
    for (const s of g.nodeSegs[node]) {
      if (g.segName[s] >= 0) return `${base} off ${g.city.names[g.segName[s]]}`
    }
  }
  return base
}
