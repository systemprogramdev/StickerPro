// Generates solid PWA icons (no deps): near-black square, magenta frame, cyan cross-street grid.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
function png(size, pad) {
  const bg = [5, 7, 10], cyan = [0, 229, 255], dim = [28, 68, 72], mag = [255, 61, 212]
  const raw = Buffer.alloc(size * (size * 3 + 1))
  const f = Math.max(2, Math.round(size / 48))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size; x++) {
      let c = bg
      const ix = x - pad, iy = y - pad, inner = size - 2 * pad
      if (ix >= 0 && iy >= 0 && ix < inner && iy < inner) {
        const gx = (ix / inner) * 4, gy = (iy / inner) * 4
        const onX = Math.abs(gx - Math.round(gx)) * inner / 4 < f, onY = Math.abs(gy - Math.round(gy)) * inner / 4 < f
        if (onX || onY) c = (Math.round(gy) <= 2 && onY) || (Math.round(gx) === 1 && onX) ? cyan : dim
        if (ix < f * 2 || iy < f * 2 || ix >= inner - f * 2 || iy >= inner - f * 2) c = mag
      }
      raw.set(c, y * (size * 3 + 1) + 1 + x * 3)
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
writeFileSync('public/pwa-192.png', png(192, 16))
writeFileSync('public/pwa-512.png', png(512, 40))
writeFileSync('public/pwa-maskable-512.png', png(512, 104))
writeFileSync('public/apple-touch-icon.png', png(180, 14))
