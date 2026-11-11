// Fix sources: real GPS, or a recorded/synthetic track replayed in its place.
import type { Fix } from '../core/types'

export interface FixSource {
  readonly kind: 'gps' | 'replay'
  start(onFix: (f: Fix) => void, onError: (msg: string) => void, onEnd?: () => void): void
  stop(): void
}

export class GpsSource implements FixSource {
  readonly kind = 'gps'
  private id: number | null = null

  start(onFix: (f: Fix) => void, onError: (msg: string) => void) {
    if (!('geolocation' in navigator)) return onError('Geolocation is not available')
    this.stop()
    this.id = navigator.geolocation.watchPosition(
      (p) =>
        onFix({
          t: p.timestamp,
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          acc: p.coords.accuracy,
          speed: p.coords.speed,
          heading: p.coords.heading,
        }),
      (e) => onError(e.code === e.PERMISSION_DENIED ? 'Location permission denied' : e.message || 'Location error'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    )
  }

  stop() {
    if (this.id !== null) navigator.geolocation.clearWatch(this.id)
    this.id = null
  }
}

/** Plays fixes with their original spacing divided by `speed`, re-timed to start now. */
export class ReplaySource implements FixSource {
  readonly kind = 'replay'
  speed: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private i = 0
  private readonly fixes: Fix[]

  constructor(fixes: Fix[], speed = 1) {
    this.fixes = fixes
    this.speed = speed
  }

  get progress() {
    return this.fixes.length ? this.i / this.fixes.length : 1
  }

  start(onFix: (f: Fix) => void, _onError: (msg: string) => void, onEnd?: () => void) {
    this.stop()
    if (!this.fixes.length) return onEnd?.()
    const t0 = this.fixes[0].t
    const base = Date.now()
    const step = () => {
      const f = this.fixes[this.i]
      onFix({ ...f, t: base + (f.t - t0) })
      this.i++
      if (this.i >= this.fixes.length) {
        this.timer = null
        return onEnd?.()
      }
      const wait = (this.fixes[this.i].t - f.t) / this.speed
      this.timer = setTimeout(step, Math.max(0, wait))
    }
    step()
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

/** Parse a GPX file or a JSON array of fixes into fixes. */
export function parseTrackFile(text: string): Fix[] {
  const trimmed = text.trim()
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const data = JSON.parse(trimmed)
    const arr = Array.isArray(data) ? data : data.points ?? data.fixes
    if (!Array.isArray(arr)) throw new Error('JSON track must be an array of fixes')
    return arr.map((p: Record<string, number>) => ({
      t: typeof p.t === 'number' ? p.t : Date.parse(String(p.time)),
      lat: p.lat,
      lon: p.lon ?? p.lng,
      acc: p.acc ?? p.accuracy ?? 5,
      speed: p.speed ?? null,
      heading: p.heading ?? null,
    }))
  }
  const doc = new DOMParser().parseFromString(trimmed, 'application/xml')
  const pts = [...doc.querySelectorAll('trkpt, rtept, wpt')]
  if (!pts.length) throw new Error('No track points found in GPX')
  let t = Date.now()
  return pts.map((el) => {
    const time = el.querySelector('time')?.textContent
    t = time ? Date.parse(time) : t + 1000
    return { t, lat: Number(el.getAttribute('lat')), lon: Number(el.getAttribute('lon')), acc: 5, speed: null, heading: null }
  })
}
