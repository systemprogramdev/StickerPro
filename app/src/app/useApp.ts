import { useSyncExternalStore } from 'react'
import { controller, type AppState } from './controller'

export function useApp(): AppState {
  return useSyncExternalStore(controller.subscribe, controller.getState)
}

export const fmtMi = (m: number, digits = 2) => (m / 1609.344).toFixed(digits)
export const fmtFt = (m: number) => `${Math.round(m * 3.28084).toLocaleString()} ft`
/** Short distance for turn banners: feet under a tenth of a mile, miles above. */
export const fmtDist = (m: number) => (m < 161 ? fmtFt(m) : `${fmtMi(m, 1)} mi`)
export const fmtDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`
}
export const fmtDate = (t: number) =>
  new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
