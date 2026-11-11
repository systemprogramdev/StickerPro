// Thin wrappers around device APIs: wake lock, battery, persistent storage.

interface BatteryManager extends EventTarget {
  level: number
  charging: boolean
}

export interface BatteryState {
  pct: number
  charging: boolean
}

/** Calls back on every battery change. Returns false when the Battery API is missing. */
export async function watchBattery(cb: (b: BatteryState) => void): Promise<boolean> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> }
  if (!nav.getBattery) return false
  try {
    const b = await nav.getBattery()
    const emit = () => cb({ pct: Math.round(b.level * 100), charging: b.charging })
    b.addEventListener('levelchange', emit)
    b.addEventListener('chargingchange', emit)
    emit()
    return true
  } catch {
    return false
  }
}

/** Holds a screen wake lock while wanted, re-acquiring it when the page becomes visible again. */
export class WakeLock {
  private sentinel: WakeLockSentinel | null = null
  private wanted = false
  onChange?: (held: boolean) => void

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (this.wanted && document.visibilityState === 'visible') void this.acquire()
    })
  }

  get held() {
    return !!this.sentinel && !this.sentinel.released
  }

  async request() {
    this.wanted = true
    await this.acquire()
  }

  async release() {
    this.wanted = false
    await this.sentinel?.release().catch(() => {})
    this.sentinel = null
    this.onChange?.(false)
  }

  private async acquire() {
    if (!('wakeLock' in navigator) || this.held) return
    try {
      this.sentinel = await navigator.wakeLock.request('screen')
      this.sentinel.addEventListener('release', () => this.onChange?.(false))
      this.onChange?.(true)
    } catch {
      this.onChange?.(false)
    }
  }
}

/** Ask for persistent storage. Returns true if storage will not be evicted. */
export async function requestPersistence(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}

/** Downscale an image so its long side is at most maxPx, as JPEG. */
export async function downscaleImage(file: Blob, maxPx: number, quality: number): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}
