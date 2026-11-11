import { useEffect, useRef, useState } from 'react'
import { controller } from '../app/controller'
import { fmtDate, fmtDuration, fmtFt, fmtMi, useApp } from '../app/useApp'
import { THRESHOLDS as T } from '../config/thresholds'
import { popcount } from '../core/matcher'
import { segmentLabel } from '../core/graph'
import { KIND_NAMES } from '../core/types'
import type { Pin, StreetInfo } from './MapView'

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="screen-head">
          <span className="title">{title}</span>
          <button onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function RouteMenu({ onClose }: { onClose: () => void }) {
  const s = useApp()
  const run = (p: Promise<void>) => {
    onClose()
    void p
  }
  return (
    <Sheet title="ROUTE" onClose={onClose}>
      <button onClick={() => run(controller.plan('nearest'))}>NEAREST UNWALKED</button>
      <div className="label">Loop walk · distance budget</div>
      <div className="row">
        {[1, 2, 3, 5].map((mi) => (
          <button key={mi} className="grow" onClick={() => run(controller.plan('loop', { budgetM: mi * 1609.344 }))}>
            {mi} MI
          </button>
        ))}
      </div>
      <button disabled={s.sector < 0} onClick={() => run(controller.plan('sector'))}>
        CLEAR THIS SECTOR{s.sector < 0 ? ' · no sector data' : ''}
      </button>
      {s.route && (
        <button className="danger" onClick={() => run(Promise.resolve(controller.clearRoute()))}>
          CANCEL ROUTE
        </button>
      )}
    </Sheet>
  )
}

export function NoteSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  return (
    <Sheet title="NEW NOTE" onClose={onClose}>
      <textarea autoFocus rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="What is here?" />
      <button disabled={!text.trim()} onClick={() => controller.addNote(text).then((ok) => ok && onClose())}>
        PIN AT CURRENT POSITION
      </button>
    </Sheet>
  )
}

export function PinSheet({ pin, onClose }: { pin: Pin; onClose: () => void }) {
  const s = useApp()
  const [confirm, setConfirm] = useState(false)
  const note = pin.kind === 'note' ? s.notes.find((n) => n.id === pin.id) : undefined
  const photo = pin.kind === 'photo' ? s.photos.find((p) => p.id === pin.id) : undefined
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!photo) return
    const u = URL.createObjectURL(photo.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [photo])
  const item = note ?? photo
  if (!item) return null
  return (
    <Sheet title={pin.kind === 'note' ? 'NOTE' : 'PHOTO'} onClose={onClose}>
      <div className="label">{fmtDate(item.t)}</div>
      {note && <p className="note-text">{note.text}</p>}
      {url && <img className="photo" src={url} alt="Pinned photo" />}
      {confirm ? (
        <button className="danger" onClick={() => controller.deletePin(pin.kind, pin.id).then(onClose)}>
          CONFIRM DELETE
        </button>
      ) : (
        <button onClick={() => setConfirm(true)}>DELETE</button>
      )}
    </Sheet>
  )
}

export function StreetSheet({ info, onClose }: { info: StreetInfo; onClose: () => void }) {
  const { graph: g } = useApp()
  if (!g) return null
  const seg = info.seg
  const mask = controller.masks[seg]
  const done = controller.completedAt[seg]
  return (
    <Sheet title="STREET" onClose={onClose}>
      <div className="big">{segmentLabel(g, seg)}</div>
      <div className="label">
        {KIND_NAMES[g.segKind[seg]]} · {fmtFt(g.segLen[seg])} · {g.city.segments[seg].id}
      </div>
      <div className="seg-bar">
        {Array.from({ length: T.coverageSlices }, (_, i) => (
          <i key={i} className={mask & (1 << i) ? 'on' : ''} />
        ))}
      </div>
      <div>{done ? <span className="num">WALKED {fmtDate(done)}</span> : <span className="label">{popcount(mask)} / {T.coverageSlices} slices</span>}</div>
    </Sheet>
  )
}

export function WalkSummarySheet() {
  const { walkSummary: w } = useApp()
  if (!w) return null
  const reason = w.endReason === 'battery' ? 'BATTERY RUN ENDED' : w.replay ? 'REPLAY COMPLETE' : 'WALK COMPLETE'
  return (
    <Sheet title={reason} onClose={() => controller.dismissSummary()}>
      <div className="grid3">
        <div>
          <div className="label">Miles</div>
          <div className="num big">{fmtMi(w.distanceM)}</div>
        </div>
        <div>
          <div className="label">New seg</div>
          <div className="num big">{w.newSegments}</div>
        </div>
        <div>
          <div className="label">Time</div>
          <div className="num big">{fmtDuration((w.end ?? Date.now()) - w.start)}</div>
        </div>
      </div>
      {w.batteryStart !== null && (
        <div className="label">
          Battery {w.batteryStart}% → {w.batteryEnd ?? '?'}%
        </div>
      )}
      {!w.replay && (
        <div className="row">
          <button className="grow" onClick={() => controller.exportBackup()}>
            SAVE BACKUP
          </button>
          <button className="grow" onClick={() => controller.exportBackup('share')}>
            SHARE BACKUP
          </button>
        </div>
      )}
      <button onClick={() => controller.dismissSummary()}>OK</button>
    </Sheet>
  )
}

/** Full-screen touch lock. Hold for two seconds to unlock. */
export function LockOverlay() {
  const [held, setHeld] = useState(0)
  const timer = useRef<number | null>(null)
  const startT = useRef(0)
  const s = useApp()

  const stop = () => {
    if (timer.current) cancelAnimationFrame(timer.current)
    timer.current = null
    setHeld(0)
  }
  const start = (e: React.PointerEvent) => {
    e.preventDefault()
    startT.current = performance.now()
    const step = () => {
      const p = (performance.now() - startT.current) / T.unlockHoldMs
      if (p >= 1) {
        stop()
        controller.setLocked(false)
        return
      }
      setHeld(p)
      timer.current = requestAnimationFrame(step)
    }
    timer.current = requestAnimationFrame(step)
  }

  return (
    <div className="lock" onPointerDown={start} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop} onContextMenu={(e) => e.preventDefault()}>
      <div className="title lock-title">LOCKED</div>
      <div className="label">{s.walk ? `Walk active · ${fmtMi(s.walk.distanceM)} mi · +${s.walk.newSegments} seg` : 'No walk active'}</div>
      <div className="lock-bar">
        <i style={{ width: `${held * 100}%` }} />
      </div>
      <div className="label">HOLD 2 S TO UNLOCK</div>
    </div>
  )
}

export function Toast() {
  const { toast, busy } = useApp()
  if (busy) return <div className="toast">{busy}</div>
  if (!toast) return null
  return <div className={`toast ${toast.kind}`}>{toast.text}</div>
}
