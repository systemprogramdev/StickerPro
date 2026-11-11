import { fmtMi, useApp } from '../app/useApp'
import { dayKey, lastDays, streak } from '../core/stats'

function SegBar({ pct, cells = 40 }: { pct: number; cells?: number }) {
  const on = Math.round((pct / 100) * cells)
  return (
    <div className="seg-bar" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: cells }, (_, i) => (
        <i key={i} className={i < on || (i === 0 && pct > 0) ? 'on' : ''} />
      ))}
    </div>
  )
}

function WeekChart({ days }: { days: { key: string; label: string; meters: number }[] }) {
  const max = Math.max(1609.344, ...days.map((d) => d.meters))
  return (
    <div className="week">
      {days.map((d) => (
        <div key={d.key} className="week-col">
          <div className="num tiny">{d.meters > 0 ? fmtMi(d.meters, 1) : ''}</div>
          <div className="week-bar">
            <i style={{ height: `${(100 * d.meters) / max}%` }} />
          </div>
          <div className="label">{d.label}</div>
        </div>
      ))}
    </div>
  )
}

export function StatsScreen({ go }: { go: (s: 'history' | 'settings') => void }) {
  const s = useApp()
  const sum = s.summary
  const now = Date.now()
  const all = s.walks.map((w) => (w.id === s.walk?.id ? s.walk : w))
  const today = all.filter((w) => dayKey(w.start) === dayKey(now))
  const totalM = all.reduce((m, w) => m + w.distanceM, 0)
  const sector = s.graph && s.sector >= 0 ? sum?.sectors[s.sector] : undefined
  const todayMs = today.reduce((m, w) => m + ((w.end ?? now) - w.start), 0)

  return (
    <main className="screen">
      <div className="screen-head">
        <span className="title">STATS</span>
        <div className="row">
          <button onClick={() => go('history')}>HISTORY</button>
          <button onClick={() => go('settings')}>SYS</button>
        </div>
      </div>

      <section className="panel">
        <div className="label">City complete · {s.graph?.city.manifest.city.split(',')[0] ?? 'no city'}</div>
        <div className="huge title">{sum ? sum.pct.toFixed(2) : '0.00'}%</div>
        <SegBar pct={sum?.pct ?? 0} />
        <div className="row spread">
          <span>
            <span className="num">{(sum?.completed ?? 0).toLocaleString()}</span>
            <span className="label"> / {(sum?.segments ?? 0).toLocaleString()} seg</span>
          </span>
          <span>
            <span className="num">{fmtMi(sum?.walkedM ?? 0, 1)}</span>
            <span className="label"> / {fmtMi(sum?.totalM ?? 0, 1)} mi</span>
          </span>
        </div>
      </section>

      <section className="panel">
        <div className="label">Last 7 days · miles</div>
        <WeekChart days={lastDays(all, now)} />
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="label">Today</div>
          <div className="num big">{fmtMi(today.reduce((m, w) => m + w.distanceM, 0))} mi</div>
          <div className="label">
            {today.reduce((m, w) => m + w.newSegments, 0)} new seg · {Math.round(todayMs / 60000)} min
          </div>
        </section>
        <section className="panel">
          <div className="label">Streak</div>
          <div className="num big">{streak(all, now)} d</div>
          <div className="label">Total {fmtMi(totalM, 1)} mi</div>
        </section>
        <section className="panel">
          <div className="label">Sector</div>
          {sector ? (
            <>
              <div className="ellipsis">{sector.name}</div>
              <div className="num big">{sector.pct.toFixed(1)}%</div>
            </>
          ) : (
            <div className="label">{s.graph?.city.sectors.length ? 'not in a sector' : 'no sector data'}</div>
          )}
        </section>
        <section className="panel">
          <div className="label">Pins</div>
          <div className="num big">{s.notes.length}</div>
          <div className="label">notes · {s.photos.length} photos</div>
        </section>
      </div>

      {!!sum?.sectors.length && (
        <section className="panel">
          <div className="label">Sectors</div>
          {sum.sectors
            .slice()
            .sort((a, b) => b.pct - a.pct)
            .map((sec) => (
              <div key={sec.index} className="sector-row">
                <span className="ellipsis grow">{sec.name}</span>
                <span className="num">{sec.pct.toFixed(1)}%</span>
                <SegBar pct={sec.pct} cells={10} />
              </div>
            ))}
        </section>
      )}
    </main>
  )
}
