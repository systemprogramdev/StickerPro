import { useRef, useState } from 'react'
import { controller } from '../app/controller'
import { fmtMi, useApp } from '../app/useApp'
import { HOSTED_CITIES } from '../data/cityStore'

function FileButton({ label, accept, onFile, disabled }: { label: string; accept: string; onFile: (f: File) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button disabled={disabled} onClick={() => ref.current?.click()}>
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onFile(f)
        }}
      />
    </>
  )
}

const SPEEDS = [1, 2, 5, 10, 30]

export function SettingsScreen({ onBack, onDebug }: { onBack: () => void; onDebug: () => void }) {
  const s = useApp()
  const [speed, setSpeed] = useState(5)
  const [confirmRestore, setConfirmRestore] = useState<File | null>(null)
  const m = s.graph?.city.manifest

  return (
    <main className="screen">
      <div className="screen-head">
        <button onClick={onBack}>◀ BACK</button>
        <span className="title">SYSTEM</span>
      </div>

      <section className="panel">
        <div className="label">City data</div>
        {m ? (
          <div>
            {m.city} · {m.totals.segments.toLocaleString()} seg · {fmtMi(m.totals.meters, 0)} mi
            <div className="label">built {m.builtAt.slice(0, 10)} · format v{m.version}</div>
          </div>
        ) : (
          <div className="alert">NO CITY DATA</div>
        )}
        {HOSTED_CITIES.map((c) => (
          <button key={c.path} disabled={!!s.walk} onClick={() => controller.loadHostedCity(c.path)}>
            ↓ {m ? 'RE-DOWNLOAD' : 'DOWNLOAD'} {c.name.toUpperCase()}
          </button>
        ))}
        <FileButton label="IMPORT CITY FILE" accept=".json,application/json" disabled={!!s.walk} onFile={(f) => controller.importCity(f)} />
      </section>

      <section className="panel">
        <div className="label">Backup · tracks, progress, notes, photos</div>
        <div className="row">
          <button className="grow" onClick={() => controller.exportBackup()}>
            EXPORT BACKUP
          </button>
          <FileButton label="RESTORE" accept=".json,application/json" disabled={!!s.walk} onFile={setConfirmRestore} />
        </div>
        {confirmRestore && (
          <div className="confirm">
            <div className="alert">Replace ALL stored walks, progress, notes and photos with {confirmRestore.name}?</div>
            <div className="row">
              <button className="grow danger" onClick={() => controller.importBackup(confirmRestore).then(() => setConfirmRestore(null))}>
                REPLACE
              </button>
              <button className="grow" onClick={() => setConfirmRestore(null)}>
                CANCEL
              </button>
            </div>
          </div>
        )}
        <div className="label">
          Storage: {s.persisted === true ? 'persistent' : s.persisted === false ? 'NOT persistent, may be cleared by the browser' : 'unknown'}
        </div>
      </section>

      <section className="panel">
        <div className="label">Progress</div>
        <button disabled={!s.graph || !!s.walk} onClick={() => controller.rebuildProgress()}>
          REBUILD PROGRESS FROM TRACKS
        </button>
      </section>

      <section className="panel">
        <div className="label">Display</div>
        <button aria-pressed={s.settings.scanlines} onClick={() => controller.updateSettings({ scanlines: !s.settings.scanlines })}>
          SCANLINES: {s.settings.scanlines ? 'ON' : 'OFF'}
        </button>
      </section>

      <section className="panel">
        <div className="label">Replay mode · dev</div>
        <div className="row">
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              className="grow"
              aria-pressed={(s.replay?.speed ?? speed) === sp}
              onClick={() => {
                setSpeed(sp)
                controller.setReplaySpeed(sp)
              }}
            >
              {sp}×
            </button>
          ))}
        </div>
        <div className="row">
          {[0.5, 1, 2].map((mi) => (
            <button key={mi} className="grow" disabled={!!s.walk || !s.graph} onClick={() => controller.startReplay('synthetic', mi * 1609.344, speed)}>
              SIM {mi} MI
            </button>
          ))}
        </div>
        <FileButton label="REPLAY GPX / JSON FILE" accept=".gpx,.json,application/gpx+xml,application/json" disabled={!!s.walk} onFile={(f) => controller.startReplay('file', f, speed)} />
        <div className="label">Simulated walks start at the last GPS position, or the city center.</div>
      </section>

      <section className="panel">
        <button onClick={onDebug}>DEBUG · INCOMING FIXES</button>
      </section>

      <section className="panel">
        <div className="label">About</div>
        <div>StickerPro · walk 100% of the city</div>
        <div className="label">Map data © OpenStreetMap contributors, available under the Open Database License.</div>
      </section>
    </main>
  )
}

export function DebugScreen({ onBack }: { onBack: () => void }) {
  const s = useApp()
  const label = (seg: number) => (seg >= 0 && s.graph ? s.graph.city.segments[seg].id : '—')
  return (
    <main className="screen">
      <div className="screen-head">
        <button onClick={onBack}>◀ BACK</button>
        <span className="title">DEBUG</span>
      </div>
      <section className="panel mono-sm">
        <div>
          gps <span className="num">{s.gps}</span> {s.gpsError ?? ''} · wake lock <span className="num">{s.wakeLock ? 'held' : 'no'}</span>
        </div>
        <div>
          walk <span className="num">{s.walk ? `#${s.walk.id}${s.walk.replay ? ' replay' : ''}` : 'none'}</span> · track lines{' '}
          <span className="num">{s.track.length}</span> · battery <span className="num">{s.battery ? `${s.battery.pct}%` : 'n/a'}</span>
        </div>
      </section>
      <table className="fixes">
        <thead>
          <tr>
            <th>time</th>
            <th>lat, lon</th>
            <th>acc</th>
            <th>spd</th>
            <th>seg</th>
          </tr>
        </thead>
        <tbody>
          {s.debug.map((d, i) => (
            <tr key={i} className={d.ok ? '' : 'rejected'}>
              <td>{new Date(d.fix.t).toLocaleTimeString('en-US', { hour12: false })}</td>
              <td>
                {d.fix.lat.toFixed(5)}, {d.fix.lon.toFixed(5)}
              </td>
              <td>{Math.round(d.fix.acc)}</td>
              <td>{d.fix.speed === null ? '—' : d.fix.speed.toFixed(1)}</td>
              <td className="ellipsis">{label(d.seg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
