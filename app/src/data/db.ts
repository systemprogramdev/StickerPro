// IndexedDB storage for everything the player creates. Raw track points are the source of truth.
import Dexie, { type EntityTable } from 'dexie'

export interface WalkRow {
  id: number
  start: number
  end: number | null
  distanceM: number
  newSegments: number
  batteryStart: number | null
  batteryEnd: number | null
  replay: boolean
  endReason?: string
}

export interface PointRow {
  id: number
  walkId: number
  t: number
  lat: number
  lon: number
  acc: number
  speed: number | null
  heading: number | null
  ok: 0 | 1 // used for matching
}

export interface ProgressRow {
  segId: string // stable segment id from the city file
  mask: number
  completedAt: number | null
}

export interface NoteRow {
  id: number
  t: number
  lat: number
  lon: number
  text: string
}

export interface PhotoRow {
  id: number
  t: number
  lat: number
  lon: number
  blob: Blob
  noteId: number | null
}

export interface MetaRow {
  key: string
  value: unknown
}

export const db = new Dexie('stickerpro') as Dexie & {
  walks: EntityTable<WalkRow, 'id'>
  points: EntityTable<PointRow, 'id'>
  progress: EntityTable<ProgressRow, 'segId'>
  notes: EntityTable<NoteRow, 'id'>
  photos: EntityTable<PhotoRow, 'id'>
  meta: EntityTable<MetaRow, 'key'>
}

db.version(1).stores({
  walks: '++id, start',
  points: '++id, walkId, [walkId+t]',
  progress: 'segId',
  notes: '++id, t',
  photos: '++id, t',
  meta: 'key',
})

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value })
}

export const walkPoints = (walkId: number) => db.points.where('[walkId+t]').between([walkId, -Infinity], [walkId, Infinity]).toArray()
