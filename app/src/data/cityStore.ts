// City data lives in OPFS as the original file text. This module is the only place
// that knows the file format; everything else gets a validated CityFile.
import { validateCity } from '../core/graph'
import type { CityFile } from '../core/types'

const FILE = 'city.json'

async function dir() {
  if (!navigator.storage?.getDirectory) throw new Error('This browser has no private file storage (OPFS)')
  return navigator.storage.getDirectory()
}

export async function readCityText(): Promise<string | null> {
  try {
    const h = await (await dir()).getFileHandle(FILE)
    return await (await h.getFile()).text()
  } catch (e) {
    if ((e as DOMException).name === 'NotFoundError') return null
    throw e
  }
}

export function parseCity(text: string): CityFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('City file is not valid JSON')
  }
  return validateCity(data)
}

/** Validate then store city file text, replacing the current city. */
export async function storeCityText(text: string): Promise<CityFile> {
  const city = parseCity(text)
  const h = await (await dir()).getFileHandle(FILE, { create: true })
  const w = await h.createWritable()
  await w.write(text)
  await w.close()
  return city
}

/** City files hosted next to the app, for one-tap setup. Not precached by the service worker. */
export const HOSTED_CITIES = [{ name: 'Philadelphia', path: 'data/philadelphia.stickerpro.json' }]

export async function fetchHostedCity(path: string): Promise<string> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  return res.text()
}
