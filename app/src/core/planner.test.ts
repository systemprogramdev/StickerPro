import { describe, expect, it } from 'vitest'
import { loadFixture, seg } from './fixture.test-util'
import { planLoop, planNearest, planSector } from './planner'

const g = loadFixture()
const lonlat = (node: number) => g.proj.toLonLat(g.nodeX[node], g.nodeY[node])

describe('planner on the fixture graph', () => {
  it('nearest unwalked routes to the closest incomplete segment', () => {
    const a01 = seg(g, 1, 'A0', 'A1')
    const done = new Set([a01, seg(g, 3, 'A0', 'B0')])
    const [lon, lat] = lonlat(g.segA[a01])
    const r = planNearest(g, (s) => done.has(s), lon, lat)!
    expect(r).not.toBeNull()
    const last = r.steps[r.steps.length - 1]
    expect(done.has(last.seg)).toBe(false)
    // From A0 the closest unwalked segments start at A1, 100 m away.
    expect(r.meters).toBeGreaterThan(100)
    expect(r.meters).toBeLessThan(200)
  })

  it('nearest unwalked walks the current segment when it is unwalked', () => {
    const [lon, lat] = lonlat(g.segA[seg(g, 1, 'A0', 'A1')])
    const r = planNearest(g, () => false, lon, lat)!
    expect(r.steps).toHaveLength(0)
    expect(r.coords.length).toBeGreaterThan(1)
  })

  it('loop walk returns to the start within budget', () => {
    const [lon, lat] = lonlat(g.segA[seg(g, 1, 'A0', 'A1')])
    const r = planLoop(g, () => false, lon, lat, 600)!
    expect(r.meters).toBeLessThanOrEqual(600 + 1)
    expect(r.newMeters).toBeGreaterThan(0)
    const first = r.coords[0], end = r.coords[r.coords.length - 1]
    expect(Math.abs(first[0] - end[0]) + Math.abs(first[1] - end[1])).toBeLessThan(1e-6)
  })

  it('clear sector covers every incomplete segment in the sector', () => {
    const [lon, lat] = lonlat(g.segA[seg(g, 1, 'A0', 'A1')])
    const r = planSector(g, () => false, lon, lat, 1)!
    const covered = new Set(r.steps.map((s) => s.seg))
    for (let i = 0; i < g.segSector.length; i++) if (g.segSector[i] === 1) expect(covered.has(i)).toBe(true)
    expect(r.turns[r.turns.length - 1].dir).toBe('ARRIVE')
  })
})
