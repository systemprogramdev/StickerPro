// App controller: owns the walk lifecycle and wires location, storage, the engine worker and the UI.
import { THRESHOLDS as T } from '../config/thresholds'
import { haversine } from '../core/geo'
import { buildGraph, nearestSegment, type Graph } from '../core/graph'
import { routeGeometry, routeProgress, streetContext, type RouteGeometry, type RouteProgress } from '../core/navigation'
import type { PlanMode, Route } from '../core/planner'
import { newlyClearedSectors, summarize, type ProgressSummary } from '../core/progress'
import { randomWalk } from '../core/synth'
import type { Fix } from '../core/types'
import { downloadBlob, exportBackup, importBackup } from '../data/backup'
import { fetchHostedCity, parseCity, readCityText, storeCityText } from '../data/cityStore'
import { db, getMeta, setMeta, walkPoints, type NoteRow, type PhotoRow, type PointRow, type ProgressRow, type WalkRow } from '../data/db'
import { downscaleImage, requestPersistence, WakeLock, watchBattery, type BatteryState } from '../services/device'
import { GpsSource, parseTrackFile, ReplaySource, type FixSource } from '../services/location'
import { Engine } from '../worker/engine'

export interface DebugFix {
  fix: Fix
  ok: boolean
  seg: number
}

export interface Toast {
  kind: 'info' | 'error' | 'sector'
  text: string
  id: number
}

export interface Settings {
  scanlines: boolean
}

export interface AppState {
  booting: boolean
  busy: string | null
  graph: Graph | null
  cityText: string | null
  summary: ProgressSummary | null
  walk: WalkRow | null
  gps: 'off' | 'waiting' | 'ok' | 'gap' | 'error'
  gpsError: string | null
  lastFix: Fix | null
  lastFixOk: boolean
  debug: DebugFix[]
  track: [number, number][][] // current walk, accepted fixes, split at gaps
  street: { current: string; next: string } | null
  sector: number
  route: Route | null
  routeProgress: RouteProgress | null
  battery: BatteryState | null
  wakeLock: boolean
  persisted: boolean | null
  lastBackup: number | null
  hidden: boolean
  pausedNotice: { from: number; to: number } | null
  replay: { speed: number } | null
  walks: WalkRow[]
  notes: NoteRow[]
  photos: PhotoRow[]
  toast: Toast | null
  walkSummary: WalkRow | null
  settings: Settings
  locked: boolean
}

export type CoverageEvent = { seg: number; done: boolean; partial: boolean }[] | 'all'

const initial: AppState = {
  booting: true,
  busy: null,
  graph: null,
  cityText: null,
  summary: null,
  walk: null,
  gps: 'off',
  gpsError: null,
  lastFix: null,
  lastFixOk: false,
  debug: [],
  track: [],
  street: null,
  sector: -1,
  route: null,
  routeProgress: null,
  battery: null,
  wakeLock: false,
  persisted: null,
  lastBackup: null,
  hidden: false,
  pausedNotice: null,
  replay: null,
  walks: [],
  notes: [],
  photos: [],
  toast: null,
  walkSummary: null,
  settings: { scanlines: true },
  locked: false,
}

export class Controller {
  state: AppState = initial
  masks: Uint16Array = new Uint16Array(0)
  completedAt: Float64Array = new Float64Array(0)

  private listeners = new Set<() => void>()
  private coverageListeners = new Set<(e: CoverageEvent) => void>()
  private engine = new Engine()
  private wake = new WakeLock()
  private gpsSource = new GpsSource()
  private source: FixSource | null = null
  private queue: Promise<void> = Promise.resolve()
  private lastFixWall = 0
  private prevAccepted: Fix | null = null
  private anchor: Fix | null = null
  private hiddenAt: number | null = null
  private routeGeo: RouteGeometry | null = null
  private routeRequest: { mode: PlanMode; opts: { budgetM?: number; sector?: number } } | null = null
  private offRouteSince: number | null = null
  private replanning = false
  private toastId = 0
  private started = false

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getState = () => this.state
  onCoverage(fn: (e: CoverageEvent) => void) {
    this.coverageListeners.add(fn)
    return () => void this.coverageListeners.delete(fn)
  }

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    const id = ++this.toastId
    this.set({ toast: { kind, text, id } })
    setTimeout(() => this.state.toast?.id === id && this.set({ toast: null }), kind === 'sector' ? 8000 : 4000)
  }

  // ---------- Startup ----------

  async init() {
    if (this.started) return
    this.started = true
    this.wake.onChange = (held) => this.set({ wakeLock: held })
    document.addEventListener('visibilitychange', this.onVisibility)
    setInterval(this.tick, 1000)
    void watchBattery((b) => this.onBattery(b))
    const askPersist = () => void requestPersistence().then((persisted) => this.set({ persisted }))
    askPersist()
    // Chrome usually grants persistent storage once the app is installed.
    window.addEventListener('appinstalled', askPersist)
    this.set({ lastBackup: (await getMeta<number>('lastBackup')) ?? null })

    const settings = (await getMeta<Settings>('settings')) ?? initial.settings
    this.set({ settings })
    try {
      const text = await readCityText()
      if (text) await this.loadCity(text)
    } catch (e) {
      this.toast(`City data failed to load: ${(e as Error).message}`, 'error')
    }
    await this.refreshLists()
    await this.recoverWalk()
    this.useSource(this.gpsSource)
    this.set({ booting: false })
  }

  private async loadCity(text: string) {
    this.set({ busy: 'Loading city data…' })
    try {
      const city = parseCity(text)
      const graph = buildGraph(city)
      const n = graph.segA.length
      this.masks = new Uint16Array(n)
      this.completedAt = new Float64Array(n)
      const rows = await db.progress.toArray()
      const progress: [number, number, number | null][] = []
      for (const r of rows) {
        const i = graph.segIndexById.get(r.segId)
        if (i === undefined) continue // segment no longer in the data: kept in storage, not shown
        this.masks[i] = r.mask
        this.completedAt[i] = r.completedAt ?? 0
        progress.push([i, r.mask, r.completedAt])
      }
      await this.engine.call({ type: 'init', cityText: text, progress })
      this.set({ graph, cityText: text, summary: summarize(graph, this.completedAt), route: null, routeProgress: null })
      this.emitCoverage('all')
    } finally {
      this.set({ busy: null })
    }
  }

  importCity(file: File) {
    return this.installCity('Importing city data…', () => file.text())
  }

  /** Download a city file hosted with the app and store it on the device. */
  loadHostedCity(path: string) {
    return this.installCity('Downloading city data…', () => fetchHostedCity(path))
  }

  private async installCity(busy: string, getText: () => Promise<string>) {
    if (this.state.walk) return this.toast('Stop the walk before importing city data', 'error')
    try {
      this.set({ busy })
      const text = await getText()
      const city = await storeCityText(text)
      await this.loadCity(text)
      const t = city.manifest.totals
      this.toast(`Imported ${city.manifest.city.split(',')[0]}: ${t.segments.toLocaleString()} segments, ${(t.meters / 1609.344).toFixed(1)} mi`)
    } catch (e) {
      this.toast(`Import failed: ${(e as Error).message}`, 'error')
    } finally {
      this.set({ busy: null })
    }
  }

  private async refreshLists() {
    const [walks, notes, photos] = await Promise.all([
      db.walks.orderBy('start').reverse().toArray(),
      db.notes.toArray(),
      db.photos.toArray(),
    ])
    this.set({ walks, notes, photos })
  }

  // ---------- Location ----------

  private useSource(src: FixSource) {
    this.source?.stop()
    this.source = src
    this.lastFixWall = Date.now()
    this.set({ gps: 'waiting', gpsError: null })
    src.start(
      (f) => this.enqueue(() => this.onFix(f)),
      (msg) => this.set({ gps: 'error', gpsError: msg }),
      () => this.enqueue(() => this.onReplayEnd()),
    )
  }

  private enqueue(job: () => Promise<void>) {
    this.queue = this.queue.then(job).catch((e) => {
      console.error(e)
      this.toast(`Error: ${(e as Error).message}`, 'error')
    })
  }

  private tick = () => {
    if (!this.source || this.state.gps === 'error' || this.state.gps === 'off') return
    const stale = Date.now() - this.lastFixWall > T.gapSeconds * 1000
    if (stale && this.state.gps === 'ok') this.set({ gps: this.state.walk ? 'gap' : 'waiting' })
    if (this.state.pausedNotice && Date.now() - this.state.pausedNotice.to > T.pausedNoticeMs) this.set({ pausedNotice: null })
  }

  private onVisibility = () => {
    const hidden = document.visibilityState === 'hidden'
    if (hidden) {
      this.hiddenAt = Date.now()
      this.set({ hidden })
      return
    }
    const from = this.hiddenAt
    this.hiddenAt = null
    this.set({ hidden, pausedNotice: this.state.walk && from && Date.now() - from > 2000 ? { from, to: Date.now() } : null })
    // Chrome may stop delivering fixes while hidden; restart the GPS watch to be safe.
    if (this.source === this.gpsSource) this.useSource(this.gpsSource)
  }

  private async onFix(fix: Fix) {
    this.lastFixWall = Date.now()
    const ok = fix.acc <= T.maxAccuracyM
    const walk = this.state.walk
    const g = this.state.graph
    let seg = -1
    let forward = true

    if (walk) {
      // Data safety first: the fix is stored before anything else happens.
      await db.points.add({ walkId: walk.id, ...fix, ok: ok ? 1 : 0 } as PointRow)
      const patch: Partial<WalkRow> = {}
      if (ok) {
        const gap = !this.prevAccepted || fix.t - this.prevAccepted.t > T.gapSeconds * 1000
        const track = gap ? [...this.state.track, [[fix.lon, fix.lat] as [number, number]]] : [...this.state.track]
        if (!gap) track[track.length - 1] = [...track[track.length - 1], [fix.lon, fix.lat]]
        if (gap) this.anchor = fix
        else if (this.anchor) {
          const d = haversine(this.anchor.lat, this.anchor.lon, fix.lat, fix.lon)
          // Count distance in steps larger than the fix's own error, so standing still adds nothing.
          if (d >= Math.max(T.distanceStepM, fix.acc / 2)) {
            patch.distanceM = walk.distanceM + d
            this.anchor = fix
          }
        }
        this.prevAccepted = fix
        this.set({ track })
      }
      if (g) {
        const { results } = await this.engine.call<'matched'>({ type: 'fixes', fixes: [fix] })
        const r = results[0]
        seg = r.seg
        forward = r.forward
        const fresh = await this.applyUpdates(r.updates)
        if (fresh.length) patch.newSegments = walk.newSegments + fresh.length
      }
      if (Object.keys(patch).length) {
        await db.walks.update(walk.id, patch)
        this.set({ walk: { ...walk, ...patch } })
      }
    }

    // Street, sector and route follow the latest position whether or not a walk is running.
    let street = this.state.street
    let sector = this.state.sector
    if (g && ok) {
      if (seg < 0) {
        const [x, y] = g.proj.toXY(fix.lon, fix.lat)
        const near = nearestSegment(g, x, y, 25)
        if (near && near.dist <= 25) {
          seg = near.seg
          forward = fix.heading === null ? true : Math.abs(((fix.heading - near.bearing + 540) % 360) - 180) <= 90
        }
      }
      street = seg >= 0 ? streetContext(g, seg, forward) : null
      sector = seg >= 0 ? g.segSector[seg] : sector
    }
    const debug = [{ fix, ok, seg }, ...this.state.debug].slice(0, 100)
    this.set({ lastFix: fix, lastFixOk: ok, debug, gps: 'ok', gpsError: null, street, sector })
    if (ok) this.followRoute(fix)
  }

  /** Persist coverage changes and return segments completed by this batch. */
  private async applyUpdates(updates: { seg: number; mask: number; completedAt: number | null }[]) {
    const g = this.state.graph
    if (!g || !updates.length) return []
    const fresh: number[] = []
    const rows = updates.map((u) => {
      if (u.completedAt && !this.completedAt[u.seg]) fresh.push(u.seg)
      this.masks[u.seg] = u.mask
      this.completedAt[u.seg] = u.completedAt ?? 0
      return { segId: g.city.segments[u.seg].id, mask: u.mask, completedAt: u.completedAt }
    })
    await db.progress.bulkPut(rows)
    this.emitCoverage(updates.map((u) => ({ seg: u.seg, done: !!u.completedAt, partial: u.mask > 0 })))
    if (fresh.length) {
      this.set({ summary: summarize(g, this.completedAt) })
      for (const s of newlyClearedSectors(g, this.completedAt, fresh)) this.toast(`SECTOR CLEARED: ${g.city.sectors[s].name}`, 'sector')
    }
    return fresh
  }

  private emitCoverage(e: CoverageEvent) {
    for (const l of this.coverageListeners) l(e)
  }

  // ---------- Walks ----------

  async startWalk(source: FixSource = this.gpsSource) {
    if (this.state.walk) return
    const replay = source.kind === 'replay'
    const id = await db.walks.add({
      start: Date.now(),
      end: null,
      distanceM: 0,
      newSegments: 0,
      batteryStart: this.state.battery?.pct ?? null,
      batteryEnd: null,
      replay,
    } as WalkRow)
    await setMeta('activeWalk', id)
    const walk = (await db.walks.get(id))!
    this.prevAccepted = null
    this.anchor = null
    if (this.state.graph) await this.engine.call({ type: 'reset' })
    this.set({ walk, track: [], walkSummary: null, pausedNotice: null, replay: replay ? { speed: (source as ReplaySource).speed } : null })
    await this.wake.request()
    this.useSource(source)
  }

  /** Ends the walk after every fix already received has been stored. */
  stopWalk(reason = 'stopped'): Promise<void> {
    // Stop new fixes from arriving, then finish inside the queue so ordering is kept.
    if (this.source !== this.gpsSource) this.source?.stop()
    return new Promise((resolve) => this.enqueue(() => this.finishWalk(reason).finally(resolve)))
  }

  private async finishWalk(reason: string) {
    const walk = this.state.walk
    if (!walk) return
    const end = Date.now()
    const patch = { end, batteryEnd: this.state.battery?.pct ?? null, endReason: reason }
    await db.walks.update(walk.id, patch)
    await db.meta.delete('activeWalk')
    await this.wake.release()
    const done = { ...walk, ...patch }
    this.set({ walk: null, walkSummary: done, replay: null })
    if (this.source !== this.gpsSource) this.useSource(this.gpsSource)
    await this.refreshLists()
  }

  private async recoverWalk() {
    const id = await getMeta<number>('activeWalk')
    if (id === undefined) return
    const walk = await db.walks.get(id)
    if (!walk || walk.end !== null) return db.meta.delete('activeWalk')
    const points = await walkPoints(id)
    if (walk.replay) {
      // A replay cannot resume; close it at its last point.
      await db.walks.update(id, { end: points.at(-1)?.t ?? walk.start, endReason: 'interrupted' })
      await db.meta.delete('activeWalk')
      return this.refreshLists()
    }
    const ok = points.filter((p) => p.ok)
    const track: [number, number][][] = []
    let prev: PointRow | null = null
    for (const p of ok) {
      if (!prev || p.t - prev.t > T.gapSeconds * 1000) track.push([])
      track[track.length - 1].push([p.lon, p.lat])
      prev = p
    }
    const last = ok.at(-1)
    this.prevAccepted = last ? toFix(last) : null
    this.anchor = this.prevAccepted
    if (this.state.graph) {
      // Re-feed the walk so the matcher regains continuity; coverage is already stored.
      await this.engine.call({ type: 'reset' })
      if (points.length) await this.engine.call({ type: 'fixes', fixes: points.map(toFix) })
    }
    this.set({ walk, track })
    await this.wake.request()
    this.toast(`WALK RECOVERED · ${points.length} points kept`)
  }

  private onBattery(b: BatteryState) {
    this.set({ battery: b })
    if (this.state.walk && !b.charging && b.pct <= T.autoEndBatteryPct) void this.stopWalk('battery')
  }

  // ---------- Replay ----------

  async startReplay(kind: 'synthetic' | 'walk' | 'file', arg?: number | File, speed = 5) {
    if (this.state.walk) return this.toast('Stop the current walk first', 'error')
    let fixes: Fix[] = []
    try {
      if (kind === 'synthetic') {
        const g = this.state.graph
        if (!g) return this.toast('Import city data first', 'error')
        const f = this.state.lastFix
        const [lon, lat] = f ? [f.lon, f.lat] : g.proj.toLonLat(0, 0)
        fixes = randomWalk(g, lon, lat, (arg as number) ?? 1600, { seed: Date.now() % 100000, t0: Date.now() })
      } else if (kind === 'walk') {
        fixes = (await walkPoints(arg as number)).map(toFix)
      } else {
        fixes = parseTrackFile(await (arg as File).text())
      }
    } catch (e) {
      return this.toast(`Replay failed: ${(e as Error).message}`, 'error')
    }
    if (!fixes.length) return this.toast('Nothing to replay', 'error')
    await this.startWalk(new ReplaySource(fixes, speed))
    this.toast(`REPLAY · ${fixes.length} fixes at ${speed}×`)
  }

  setReplaySpeed(speed: number) {
    if (this.source instanceof ReplaySource) {
      this.source.speed = speed
      this.set({ replay: { speed } })
    }
  }

  private async onReplayEnd() {
    if (this.state.walk?.replay) await this.finishWalk('replay finished')
  }

  // ---------- Route planner ----------

  async plan(mode: PlanMode, opts: { budgetM?: number; sector?: number } = {}) {
    const f = this.state.lastFix
    if (!this.state.graph) return this.toast('Import city data first', 'error')
    if (!f) return this.toast('Waiting for a GPS position', 'error')
    if (mode === 'sector') opts = { ...opts, sector: opts.sector ?? this.state.sector }
    if (mode === 'sector' && (opts.sector ?? -1) < 0) return this.toast('No sector here. Sector data was not imported.', 'error')
    this.set({ busy: 'Planning route…' })
    try {
      const { route } = await this.engine.call<'route'>({ type: 'plan', mode, lon: f.lon, lat: f.lat, opts })
      if (!route) return this.toast('No unwalked streets found for that route', 'error')
      this.routeRequest = { mode, opts }
      this.setRoute(route)
      this.toast(`ROUTE · ${(route.meters / 1609.344).toFixed(2)} mi · ${(route.newMeters / 1609.344).toFixed(2)} mi new`)
    } catch (e) {
      this.toast(`Planning failed: ${(e as Error).message}`, 'error')
    } finally {
      this.set({ busy: null })
    }
  }

  private setRoute(route: Route | null) {
    const g = this.state.graph
    this.routeGeo = route && g ? routeGeometry(g, route) : null
    this.offRouteSince = null
    let routeProgress: RouteProgress | null = null
    const f = this.state.lastFix
    if (route && g && f && this.routeGeo) routeProgress = routeProgressSafe(g, route, this.routeGeo, f, 0)
    this.set({ route, routeProgress })
  }

  clearRoute() {
    this.routeRequest = null
    this.setRoute(null)
  }

  private followRoute(fix: Fix) {
    const { route, graph } = this.state
    if (!route || !graph || !this.routeGeo) return
    const rp = routeProgressSafe(graph, route, this.routeGeo, fix, this.state.routeProgress?.alongM ?? 0)
    this.set({ routeProgress: rp })
    if (rp.remainingM < 15 && rp.offRouteM < T.offRouteM) {
      this.toast('ROUTE COMPLETE')
      return this.clearRoute()
    }
    if (rp.offRouteM > T.offRouteM) {
      this.offRouteSince ??= fix.t
      if (fix.t - this.offRouteSince > T.offRouteSeconds * 1000 && !this.replanning && this.routeRequest) {
        this.replanning = true
        const { mode, opts } = this.routeRequest
        void this.plan(mode, opts).finally(() => (this.replanning = false))
      }
    } else this.offRouteSince = null
  }

  // ---------- Notes and photos ----------

  private position(): Fix | null {
    const f = this.state.lastFix
    if (!f || Date.now() - this.lastFixWall > 120_000) {
      this.toast('No recent GPS position', 'error')
      return null
    }
    return f
  }

  async addNote(text: string) {
    const f = this.position()
    if (!f || !text.trim()) return false
    await db.notes.add({ t: Date.now(), lat: f.lat, lon: f.lon, text: text.trim() } as NoteRow)
    await this.refreshLists()
    this.toast('NOTE PINNED')
    return true
  }

  async addPhoto(file: File) {
    const f = this.position()
    if (!f) return
    this.set({ busy: 'Saving photo…' })
    try {
      const blob = await downscaleImage(file, T.photoMaxPx, T.photoQuality)
      await db.photos.add({ t: Date.now(), lat: f.lat, lon: f.lon, blob, noteId: null } as PhotoRow)
      await this.refreshLists()
      this.toast('PHOTO PINNED')
    } catch (e) {
      this.toast(`Photo failed: ${(e as Error).message}`, 'error')
    } finally {
      this.set({ busy: null })
    }
  }

  async deletePin(kind: 'note' | 'photo', id: number) {
    await (kind === 'note' ? db.notes.delete(id) : db.photos.delete(id))
    await this.refreshLists()
  }

  // ---------- Maintenance ----------

  async rebuildProgress() {
    const g = this.state.graph
    if (!g) return this.toast('Import city data first', 'error')
    if (this.state.walk) return this.toast('Stop the walk before rebuilding', 'error')
    this.set({ busy: 'Rebuilding progress from raw tracks…' })
    try {
      const walks = await db.walks.orderBy('start').toArray()
      const tracks = await Promise.all(walks.map((w) => walkPoints(w.id).then((ps) => ps.map(toFix))))
      const r = await this.engine.call<'rebuilt'>({ type: 'rebuild', walks: tracks })
      this.masks = r.masks
      this.completedAt = r.completedAt
      const rows: ProgressRow[] = []
      for (let i = 0; i < r.masks.length; i++) {
        if (r.masks[i] || r.completedAt[i]) rows.push({ segId: g.city.segments[i].id, mask: r.masks[i], completedAt: r.completedAt[i] || null })
      }
      await db.transaction('rw', db.progress, db.walks, async () => {
        // Progress for segments missing from the current city data is kept as is.
        const known = new Set(g.city.segments.map((s) => s.id))
        await db.progress.filter((p) => known.has(p.segId)).delete()
        await db.progress.bulkPut(rows)
        await Promise.all(walks.map((w, i) => db.walks.update(w.id, { newSegments: r.newPerWalk[i] })))
      })
      this.set({ summary: summarize(g, this.completedAt) })
      this.emitCoverage('all')
      await this.refreshLists()
      this.toast(`REBUILT · ${rows.length} segments touched over ${walks.length} walks`)
    } catch (e) {
      this.toast(`Rebuild failed: ${(e as Error).message}`, 'error')
    } finally {
      this.set({ busy: null })
    }
  }

  async deleteWalk(id: number) {
    await db.transaction('rw', db.walks, db.points, async () => {
      await db.points.where('walkId').equals(id).delete()
      await db.walks.delete(id)
    })
    await this.refreshLists()
    await this.rebuildProgress()
  }

  /** Save a backup file. "share" opens Android's share sheet (Drive, email, …) where supported. */
  async exportBackup(mode: 'download' | 'share' = 'download') {
    this.set({ busy: 'Exporting backup…' })
    try {
      const { blob, name, counts } = await exportBackup()
      const file = new File([blob], name, { type: 'application/json' })
      let shared = false
      if (mode === 'share' && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'StickerPro backup' })
          shared = true
        } catch (e) {
          if ((e as DOMException).name === 'AbortError') return
          // The tap's permission can expire while the backup is built; fall back to a download.
        }
      }
      if (!shared) downloadBlob(blob, name)
      const lastBackup = Date.now()
      await setMeta('lastBackup', lastBackup)
      this.set({ lastBackup })
      this.toast(`BACKUP ${shared ? 'SHARED' : 'SAVED TO DOWNLOADS'} · ${counts}`)
    } catch (e) {
      this.toast(`Export failed: ${(e as Error).message}`, 'error')
    } finally {
      this.set({ busy: null })
    }
  }

  async importBackup(file: File) {
    if (this.state.walk) return this.toast('Stop the walk before restoring', 'error')
    this.set({ busy: 'Restoring backup…' })
    try {
      const counts = await importBackup(file)
      if (this.state.cityText) await this.loadCity(this.state.cityText)
      await this.refreshLists()
      this.toast(`RESTORED · ${counts}`)
    } catch (e) {
      this.toast(`Restore failed: ${(e as Error).message}`, 'error')
    } finally {
      this.set({ busy: null })
    }
  }

  async updateSettings(patch: Partial<Settings>) {
    const settings = { ...this.state.settings, ...patch }
    this.set({ settings })
    await setMeta('settings', settings)
  }

  setLocked(locked: boolean) {
    this.set({ locked })
  }

  dismissSummary() {
    this.set({ walkSummary: null })
  }

  dismissPaused() {
    this.set({ pausedNotice: null })
  }
}

const toFix = (p: PointRow): Fix => ({ t: p.t, lat: p.lat, lon: p.lon, acc: p.acc, speed: p.speed, heading: p.heading })

function routeProgressSafe(g: Graph, route: Route, geo: RouteGeometry, f: Fix, minAlong: number) {
  return routeProgress(g, route, geo, f.lon, f.lat, minAlong)
}

export const controller = new Controller()
