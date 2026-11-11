// Single-file backup of everything in IndexedDB. Photos are embedded as data URLs.
import { db, type NoteRow, type PhotoRow, type PointRow, type ProgressRow, type WalkRow } from './db'

const FORMAT = 'stickerpro-backup'
const VERSION = 1

interface BackupFile {
  format: typeof FORMAT
  version: number
  exportedAt: string
  walks: WalkRow[]
  points: PointRow[]
  progress: ProgressRow[]
  notes: NoteRow[]
  photos: (Omit<PhotoRow, 'blob'> & { data: string })[]
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })

export async function exportBackup(): Promise<{ blob: Blob; name: string; counts: string }> {
  const [walks, points, progress, notes, photos] = await Promise.all([
    db.walks.toArray(),
    db.points.toArray(),
    db.progress.toArray(),
    db.notes.toArray(),
    db.photos.toArray(),
  ])
  const out: BackupFile = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    walks,
    points,
    progress,
    notes,
    photos: await Promise.all(photos.map(async ({ blob, ...p }) => ({ ...p, data: await blobToDataUrl(blob) }))),
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  return {
    blob: new Blob([JSON.stringify(out)], { type: 'application/json' }),
    name: `stickerpro-backup-${stamp}.json`,
    counts: `${walks.length} walks, ${points.length} points, ${notes.length} notes, ${photos.length} photos`,
  }
}

/** Replace all stored data with a backup file's contents. */
export async function importBackup(file: File): Promise<string> {
  let data: BackupFile
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('Backup is not valid JSON')
  }
  if (data?.format !== FORMAT) throw new Error('Not a StickerPro backup')
  if (data.version !== VERSION) throw new Error(`Backup version ${data.version} is not supported`)
  const photos: PhotoRow[] = await Promise.all(
    data.photos.map(async ({ data: url, ...p }) => ({ ...p, blob: await (await fetch(url)).blob() })),
  )
  await db.transaction('rw', [db.walks, db.points, db.progress, db.notes, db.photos, db.meta], async () => {
    await Promise.all([db.walks.clear(), db.points.clear(), db.progress.clear(), db.notes.clear(), db.photos.clear()])
    await db.meta.delete('activeWalk')
    await db.walks.bulkAdd(data.walks)
    await db.points.bulkAdd(data.points)
    await db.progress.bulkAdd(data.progress)
    await db.notes.bulkAdd(data.notes)
    await db.photos.bulkAdd(photos)
  })
  return `${data.walks.length} walks, ${data.points.length} points, ${data.notes.length} notes, ${photos.length} photos`
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
