import { useEffect, useState } from 'react'
import { controller } from '../app/controller'
import { fmtDate, fmtDuration, fmtMi, useApp } from '../app/useApp'
import { THRESHOLDS as T } from '../config/thresholds'
import { walkPoints, type WalkRow } from '../data/db'
import { TrackMap } from './TrackMap'

function WalkDetail({ walk, onBack }: { walk: WalkRow; onBack: () => void }) {
  const s = useApp()
  const [lines, setLines] = useState<[number, number][][] | null>(null)
  const [counts, setCounts] = useState({ total: 0, rejected: 0 })
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    void walkPoints(walk.id).then((pts) => {
      const out: [number, number][][] = []
      let prevT = -Infinity
      for (const p of pts) {
        if (!p.ok) continue
        if (p.t - prevT > T.gapSeconds * 1000) out.push([])
        out[out.length - 1].push([p.lon, p.lat])
        prevT = p.t
      }
      setLines(out)
      setCounts({ total: pts.length, rejected: pts.filter((p) => !p.ok).length })
    })
  }, [walk.id])

  return (
    <main className="screen">
      <div className="screen-head">
        <button onClick={onBack}>◀ BACK</button>
        <span className="title">WALK {walk.id}</span>
      </div>
      {lines && <TrackMap graph={s.graph} lines={lines} />}
      <section className="panel">
        <div className="label">
          {fmtDate(walk.start)}
          {walk.replay ? ' · REPLAY' : ''}
          {walk.endReason && walk.endReason !== 'stopped' ? ` · ${walk.endReason.toUpperCase()}` : ''}
        </div>
        <div className="grid3">
          <div>
            <div className="label">Miles</div>
            <div className="num big">{fmtMi(walk.distanceM)}</div>
          </div>
          <div>
            <div className="label">New seg</div>
            <div className="num big">{walk.newSegments}</div>
          </div>
          <div>
            <div className="label">Time</div>
            <div className="num big">{fmtDuration((walk.end ?? Date.now()) - walk.start)}</div>
          </div>
        </div>
        <div className="label">
          {counts.total} fixes · {counts.rejected} rejected
          {walk.batteryStart !== null && ` · battery ${walk.batteryStart}% → ${walk.batteryEnd ?? '?'}%`}
        </div>
      </section>
      <div className="row">
        <button className="grow" disabled={!!s.walk || !s.graph} onClick={() => controller.startReplay('walk', walk.id, 10)}>
          ↻ REPLAY 10×
        </button>
        {confirmDelete ? (
          <button className="grow danger" onClick={() => controller.deleteWalk(walk.id).then(onBack)}>
            CONFIRM DELETE
          </button>
        ) : (
          <button className="grow" disabled={s.walk?.id === walk.id} onClick={() => setConfirmDelete(true)}>
            DELETE WALK
          </button>
        )}
      </div>
    </main>
  )
}

export function HistoryScreen({ onBack }: { onBack: () => void }) {
  const s = useApp()
  const [open, setOpen] = useState<WalkRow | null>(null)
  if (open) return <WalkDetail walk={s.walks.find((w) => w.id === open.id) ?? open} onBack={() => setOpen(null)} />
  return (
    <main className="screen">
      <div className="screen-head">
        <button onClick={onBack}>◀ BACK</button>
        <span className="title">HISTORY</span>
      </div>
      {!s.walks.length && <div className="warning">⚠ NO WALKS RECORDED YET</div>}
      <ul className="list">
        {s.walks.map((w) => (
          <li key={w.id}>
            <button className="list-item" onClick={() => setOpen(w)}>
              <span className="grow">
                {fmtDate(w.start)}
                {w.replay && <span className="label"> · replay</span>}
                {w.end === null && <span className="alert"> · ACTIVE</span>}
              </span>
              <span className="num">{fmtMi(w.distanceM)} mi</span>
              <span className="label">+{w.newSegments}</span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
