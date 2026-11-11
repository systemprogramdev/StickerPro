import type { MatchResult } from '../core/matcher'
import type { PlanMode, Route } from '../core/planner'
import type { Fix } from '../core/types'

type Req<T> = T & { id: number }

export type EngineRequest =
  | Req<{ type: 'init'; cityText: string; progress: [seg: number, mask: number, completedAt: number | null][] }>
  | Req<{ type: 'reset' }>
  | Req<{ type: 'fixes'; fixes: Fix[] }>
  | Req<{ type: 'rebuild'; walks: Fix[][] }>
  | Req<{ type: 'plan'; mode: PlanMode; lon: number; lat: number; opts: { budgetM?: number; sector?: number } }>

export type EngineResponse =
  | Req<{ type: 'ok' }>
  | Req<{ type: 'error'; message: string }>
  | Req<{ type: 'matched'; results: MatchResult[] }>
  | Req<{ type: 'rebuilt'; masks: Uint16Array; completedAt: Float64Array; newPerWalk: number[] }>
  | Req<{ type: 'route'; route: Route | null }>

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type EngineCall = DistributiveOmit<EngineRequest, 'id'>
