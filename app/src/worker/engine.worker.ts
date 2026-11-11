// Matching and route planning off the main thread. A thin message layer over core/.
import { buildGraph, validateCity, type Graph } from '../core/graph'
import { Matcher } from '../core/matcher'
import { plan } from '../core/planner'
import type { EngineRequest, EngineResponse } from './protocol'

let g: Graph | null = null
let matcher: Matcher | null = null

const reply = (msg: EngineResponse) => postMessage(msg)

onmessage = (e: MessageEvent<EngineRequest>) => {
  const req = e.data
  try {
    switch (req.type) {
      case 'init': {
        g = buildGraph(validateCity(JSON.parse(req.cityText)))
        matcher = new Matcher(g)
        for (const [seg, mask, completedAt] of req.progress) {
          matcher.masks[seg] = mask
          matcher.completedAt[seg] = completedAt ?? 0
        }
        return reply({ id: req.id, type: 'ok' })
      }
      case 'reset':
        matcher?.reset()
        return reply({ id: req.id, type: 'ok' })
      case 'fixes': {
        if (!matcher) throw new Error('No city loaded')
        const results = req.fixes.map((f) => matcher!.push(f))
        return reply({ id: req.id, type: 'matched', results })
      }
      case 'rebuild': {
        if (!g) throw new Error('No city loaded')
        const m = new Matcher(g)
        const newPerWalk: number[] = []
        for (const fixes of req.walks) {
          m.reset()
          let n = 0
          for (const f of fixes) for (const u of m.push(f).updates) if (u.completedAt === f.t) n++
          newPerWalk.push(n)
        }
        matcher = m
        // Rebuilding mid-walk would lose continuity; the caller only rebuilds between walks.
        return reply({ id: req.id, type: 'rebuilt', masks: m.masks, completedAt: m.completedAt, newPerWalk })
      }
      case 'plan': {
        if (!g || !matcher) throw new Error('No city loaded')
        const done = matcher.completedAt
        const route = plan(g, (s) => done[s] > 0, req.mode, req.lon, req.lat, req.opts)
        return reply({ id: req.id, type: 'route', route })
      }
    }
  } catch (err) {
    reply({ id: req.id, type: 'error', message: (err as Error).message })
  }
}
