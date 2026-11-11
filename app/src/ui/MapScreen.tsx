import { useState } from 'react'
import { controller } from '../app/controller'
import { fmtDist, fmtMi, useApp } from '../app/useApp'
import { THRESHOLDS as T } from '../config/thresholds'
import { HOSTED_CITIES } from '../data/cityStore'
import { promptInstall, useCanInstall } from '../services/install'
import { dayKey } from '../core/stats'
import { MapErrorBoundary } from './MapErrorBoundary'
import { MapView, type Pin, type StreetInfo } from './MapView'
import { RouteMenu } from './Overlays'

const ARROWS = { LEFT: '◀', RIGHT: '▶', STRAIGHT: '▲', 'U-TURN': '▼', ARRIVE: '◆' } as const

function accuracyBars(acc: number) {
  return acc <= 5 ? 5 : acc <= 10 ? 4 : acc <= 15 ? 3 : acc <= T.maxAccuracyM ? 2 : 1
}

export function Hud() {
  const s = useApp()
  const g = s.graph
  const sectorName = g && s.sector >= 0 ? g.city.sectors[s.sector]?.name : g?.city.manifest.city.split(',')[0]
  const acc = s.lastFix?.acc
  const bars = acc !== undefined ? accuracyBars(acc) : 0
  return (
    <header className="hud">
      <div className="hud-sector">
        <div className="label">Sector</div>
        <div className="title ellipsis">{(sectorName ?? 'NO CITY').toUpperCase()}</div>
      </div>
      <div>
        <div className="label">GPS</div>
        <div className={acc !== undefined && acc > T.maxAccuracyM ? 'alert' : 'num'}>
          {acc !== undefined ? `${Math.round(acc)} m` : '-- m'}
        </div>
        <div className="seg-bar small" aria-hidden>
          {[1, 2, 3, 4, 5].map((i) => (
            <i key={i} className={i <= bars ? (bars <= 1 ? 'on alert-bg' : 'on') : ''} />
          ))}
        </div>
      </div>
      {s.battery && (
        <div>
          <div className="label">Run</div>
          <div className={s.battery.pct <= T.lowBatteryPct ? 'alert' : 'num'}>
            {s.battery.pct}%{s.battery.charging ? '+' : ''}
          </div>
        </div>
      )}
    </header>
  )
}

function TurnBanner() {
  const { route, routeProgress: rp } = useApp()
  if (!route || !rp?.next) return null
  const t = rp.next
  return (
    <div className="turn-banner">
      <span className="turn-arrow">{ARROWS[t.dir]}</span>
      <div className="grow">
        <div className="label">{t.dir === 'ARRIVE' ? 'Arrive' : t.dir === 'STRAIGHT' ? 'Continue onto' : `Turn ${t.dir.toLowerCase()} onto`}</div>
        <div className="ellipsis">{t.onto || '—'}</div>
      </div>
      <div className="num big">{fmtDist(rp.toNextM)}</div>
      <button className="x" onClick={() => controller.clearRoute()} aria-label="Cancel route">
        ✕
      </button>
    </div>
  )
}

function Warnings() {
  const s = useApp()
  const canInstall = useCanInstall()
  const w: string[] = []
  if (!s.booting && !s.graph) w.push('NO CITY DATA · load it below or import a file in Settings')
  if (s.gps === 'error') w.push(`GPS ERROR · ${s.gpsError}`)
  else if (s.walk && (s.gps === 'waiting' || s.gps === 'gap')) w.push(s.gps === 'gap' ? 'GPS SIGNAL LOST · coverage paused' : 'WAITING FOR GPS')
  if (s.walk && s.lastFix && !s.lastFixOk) w.push(`LOW ACCURACY · ${Math.round(s.lastFix.acc)} m, not counting`)
  if (s.pausedNotice)
    w.push(`TRACKING PAUSED for ${Math.round((s.pausedNotice.to - s.pausedNotice.from) / 1000)} s while the app was hidden`)
  if (s.walk && !s.walk.replay && !s.wakeLock && !s.hidden) w.push('SCREEN LOCK NOT HELD · keep the app open')
  if (s.persisted === false && (!s.lastBackup || Date.now() - s.lastBackup > T.backupNagDays * 86_400_000))
    w.push(`NO BACKUP IN ${T.backupNagDays} DAYS · Stats → SYS → Export`)
  if (s.battery && !s.battery.charging && s.walk) {
    if (s.battery.pct <= T.autoEndBatteryPct + 2) w.push(`RUN ENDING · walk stops at ${T.autoEndBatteryPct}%`)
    else if (s.battery.pct <= T.lowBatteryPct) w.push(`BATTERY LOW · ${s.battery.pct}%`)
  }
  if (!w.length && !canInstall) return null
  return (
    <div className="warnings" role="alert" onClick={() => controller.dismissPaused()}>
      {w.map((t) => (
        <div key={t} className="warning">
          ⚠ {t}
        </div>
      ))}
      {canInstall && (
        <button className="map-btn go" onClick={() => promptInstall()}>
          ⤓ INSTALL APP
        </button>
      )}
      {!s.booting && !s.graph && !s.busy &&
        HOSTED_CITIES.map((c) => (
          <button key={c.path} className="map-btn go" onClick={() => controller.loadHostedCity(c.path)}>
            ↓ LOAD {c.name.toUpperCase()}
          </button>
        ))}
    </div>
  )
}

export function MapScreen({ onPin, onStreet }: { onPin: (p: Pin) => void; onStreet: (s: StreetInfo | null) => void }) {
  const s = useApp()
  const [routeMenu, setRouteMenu] = useState(false)
  const today = dayKey(Date.now())
  const todayWalks = s.walks.filter((w) => dayKey(w.start) === today && w.id !== s.walk?.id)
  const todayM = todayWalks.reduce((m, w) => m + w.distanceM, 0) + (s.walk?.distanceM ?? 0)
  const todayNew = todayWalks.reduce((m, w) => m + w.newSegments, 0) + (s.walk?.newSegments ?? 0)

  return (
    <>
      <Hud />
      <TurnBanner />
      <main className="map">
        <MapErrorBoundary>
          <MapView onPin={onPin} onStreet={onStreet} />
        </MapErrorBoundary>
        <Warnings />
        <div className="map-actions">
          <button className="map-btn" onClick={() => setRouteMenu(true)} disabled={!s.graph}>
            ⌖ ROUTE
          </button>
          {s.walk ? (
            <button className="map-btn stop" onClick={() => controller.stopWalk()}>
              ■ STOP{s.walk.replay ? ' REPLAY' : ''}
            </button>
          ) : (
            <button className="map-btn go" onClick={() => controller.startWalk()}>
              ▶ START WALK
            </button>
          )}
        </div>
      </main>
      <section className="streets">
        <div className="ellipsis">
          <span className="label">NOW </span>
          {s.street?.current ?? '—'}
        </div>
        <div className="ellipsis">
          <span className="label">NEXT </span>
          {s.street?.next || '—'}
        </div>
      </section>
      <section className="strip">
        <div>
          <div className="label">Today</div>
          <div className="num">{fmtMi(todayM)} mi</div>
        </div>
        <div>
          <div className="label">New seg</div>
          <div className="num">{todayNew}</div>
        </div>
        <div>
          <div className="label">City</div>
          <div className="num title">{s.summary ? s.summary.pct.toFixed(s.summary.pct < 10 ? 2 : 1) : '0.0'}%</div>
        </div>
      </section>
      {routeMenu && <RouteMenu onClose={() => setRouteMenu(false)} />}
    </>
  )
}
