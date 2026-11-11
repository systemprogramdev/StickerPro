import { describe, expect, it } from 'vitest'
import { P, loadFixture, seg, walk } from './fixture.test-util'
import { Matcher, popcount, replayWalks } from './matcher'
import { summarize } from './progress'
import type { Fix } from './types'

const g = loadFixture()
const run = (fixes: Fix[]) => {
  const m = new Matcher(g)
  for (const f of fixes) m.push(f)
  return m
}
const done = (m: Matcher, s: number) => m.completedAt[s] > 0

const alpha = [seg(g, 1, 'A0', 'A1'), seg(g, 1, 'A1', 'A2'), seg(g, 1, 'A2', 'A3')]
const beta = [seg(g, 2, 'B0', 'B1'), seg(g, 2, 'B1', 'B2'), seg(g, 2, 'B2', 'B3')]
const alley = seg(g, 7, 'M1', 'M2')

describe('matcher on the fixture graph', () => {
  it('straight walk completes every segment walked and nothing else', () => {
    const m = run(walk(g, [P.A0, P.A3], { noiseM: 3, seed: 1 }))
    for (const s of alpha) expect(done(m, s)).toBe(true)
    const others = [...beta, alley, seg(g, 4, 'M1', 'B1'), seg(g, 6, 'A3', 'B3')]
    for (const s of others) expect(done(m, s)).toBe(false)
    expect(summarize(g, m.completedAt).completed).toBe(3)
  })

  it('a turn completes both streets of the corner', () => {
    const m = run(walk(g, [P.A0, P.A1, P.M1, P.B1], { noiseM: 3, seed: 2 }))
    expect(done(m, alpha[0])).toBe(true)
    expect(done(m, seg(g, 4, 'A1', 'M1'))).toBe(true)
    expect(done(m, seg(g, 4, 'M1', 'B1'))).toBe(true)
    expect(done(m, alpha[1])).toBe(false)
    expect(done(m, alley)).toBe(false)
  })

  it('a partial segment is covered but not complete', () => {
    const m = run(walk(g, [P.A0, [50, 0]], { seed: 3 }))
    expect(done(m, alpha[0])).toBe(false)
    const slices = popcount(m.masks[alpha[0]])
    expect(slices).toBeGreaterThanOrEqual(7)
    expect(slices).toBeLessThanOrEqual(9)
  })

  it('does not fill coverage across a GPS gap too fast to have been walked', () => {
    const before = walk(g, [[100, 0], [130, 0]], { seed: 4 })
    const after = walk(g, [[170, 0], [200, 0]], { seed: 5, t0: before[before.length - 1].t + 15_000 })
    const m = run([...before, ...after])
    const mask = m.masks[alpha[1]]
    expect(done(m, alpha[1])).toBe(false)
    // Slices for 40..60 m along the segment stay empty.
    for (const i of [7, 8]) expect(mask & (1 << i)).toBe(0)

    // Control: the same fixes without the gap fill the middle and complete it.
    const fixes = walk(g, [[100, 0], [200, 0]], { seed: 4 })
    expect(done(run(fixes), alpha[1])).toBe(true)
  })

  it('bridges a GPS gap on the same street at walking speed (tunnel, hidden app)', () => {
    const before = walk(g, [[100, 0], [130, 0]], { seed: 4 })
    const after = walk(g, [[170, 0], [200, 0]], { seed: 5, t0: before[before.length - 1].t + 60_000 })
    expect(done(run([...before, ...after]), alpha[1])).toBe(true)
  })

  it('bridges a gap around a corner onto the adjacent street', () => {
    const before = walk(g, [P.A0, [80, 0]], { seed: 10 })
    const after = walk(g, [[100, 12], P.M1, P.B1], { seed: 11, t0: before[before.length - 1].t + 30_000 })
    const m = run([...before, ...after])
    expect(done(m, alpha[0])).toBe(true)
    expect(done(m, seg(g, 4, 'A1', 'M1'))).toBe(true)
  })

  it('does not bridge a gap longer than the bridge limit', () => {
    const before = walk(g, [[100, 0], [130, 0]], { seed: 4 })
    const after = walk(g, [[170, 0], [200, 0]], { seed: 5, t0: before[before.length - 1].t + 400_000 })
    expect(done(run([...before, ...after]), alpha[1])).toBe(false)
  })

  it('walking one of two parallel streets does not credit the other', () => {
    const m = run(walk(g, [P.B0, P.B3], { noiseM: 6, seed: 6 }))
    for (const s of beta) expect(done(m, s)).toBe(true)
    for (const s of alpha) expect(m.masks[s]).toBe(0)
    expect(m.masks[alley]).toBe(0)
  })

  it('ignores fixes with poor accuracy', () => {
    const fixes = walk(g, [P.A0, P.A1], { accuracy: 40, seed: 7 })
    const m = run(fixes)
    expect(m.masks[alpha[0]]).toBe(0)
  })

  it('completes an alley on one continuous pass between its end nodes', () => {
    const m = run(walk(g, [P.A1, P.M1, P.M2, P.A2], { noiseM: 4, seed: 8 }))
    expect(done(m, alley)).toBe(true)
  })

  it('does not complete an alley entered and left from the same end', () => {
    const m = run(walk(g, [P.A1, P.M1, [140, 30], P.M1, P.A1], { seed: 9 }))
    expect(done(m, alley)).toBe(false)
  })

  it('completes a short segment passed end to end', () => {
    const stub = seg(g, 8, 'B3', 'S')
    const m = run(walk(g, [P.A3, P.B3, P.S], { seed: 10 }))
    expect(done(m, stub)).toBe(true)
    const half = run(walk(g, [P.A3, P.B3, [300, 72]], { seed: 10 }))
    expect(done(half, stub)).toBe(false)
  })

  it('replaying the same track always gives the same progress', () => {
    const fixes = walk(g, [P.A0, P.A1, P.M1, P.M2, P.B2, P.B3, P.S], { noiseM: 5, seed: 11 })
    const a = run(fixes)
    const b = run(fixes)
    expect([...a.masks]).toEqual([...b.masks])
    expect([...a.completedAt]).toEqual([...b.completedAt])
  })

  it('rebuilding from stored walks reproduces live progress', () => {
    const w1 = walk(g, [P.A0, P.A3], { noiseM: 3, seed: 12 })
    const w2 = walk(g, [P.B3, P.B0, P.A0], { noiseM: 3, seed: 13, t0: w1[w1.length - 1].t + 3_600_000 })
    const live = new Matcher(g)
    for (const w of [w1, w2]) {
      live.reset()
      for (const f of w) live.push(f)
    }
    const rebuilt = replayWalks(g, [w1, w2])
    expect([...rebuilt.masks]).toEqual([...live.masks])
    expect([...rebuilt.completedAt]).toEqual([...live.completedAt])
  })
})
