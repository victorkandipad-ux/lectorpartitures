// Minimal 1-bit grayscale PNG encoder. The clean page is stored like this (≈ 100–300 KB per page)
// and its IDAT stream is embedded as-is in exported PDFs (Flate + PNG predictor), so exporting
// never recompresses. A generic encoder (UPNG) would need a 4-byte-per-pixel RGBA copy first.
import { zlibSync } from 'fflate'
import type { BinImage } from '../pipeline/image'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

/** Packs rows MSB-first with a leading filter byte (0 = none). PNG gray 1-bit: 0 = black, 1 = white. */
export function packRows(bin: BinImage): Uint8Array {
  const { width: w, height: h, data } = bin
  const rowBytes = (w + 7) >> 3
  const out = new Uint8Array(h * (rowBytes + 1))
  for (let y = 0; y < h; y++) {
    const o = y * (rowBytes + 1) + 1
    const src = y * w
    for (let xb = 0; xb < rowBytes; xb++) {
      let byte = 0
      const x0 = xb * 8
      for (let bit = 0; bit < 8; bit++) {
        const x = x0 + bit
        // Padding bits are white.
        const white = x >= w || !data[src + x]
        byte = (byte << 1) | (white ? 1 : 0)
      }
      out[o + xb] = byte
    }
  }
  return out
}

export function encodePng1bit(bin: BinImage, dpi?: number): Uint8Array {
  const idat = zlibSync(packRows(bin), { level: 6 })
  const chunks: [string, Uint8Array][] = []
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, bin.width)
  dv.setUint32(4, bin.height)
  ihdr[8] = 1 // bit depth
  ihdr[9] = 0 // grayscale
  chunks.push(['IHDR', ihdr])
  if (dpi) {
    const phys = new Uint8Array(9)
    const ppm = Math.round(dpi / 0.0254)
    new DataView(phys.buffer).setUint32(0, ppm)
    new DataView(phys.buffer).setUint32(4, ppm)
    phys[8] = 1
    chunks.push(['pHYs', phys])
  }
  chunks.push(['IDAT', idat], ['IEND', new Uint8Array(0)])
  const total = 8 + chunks.reduce((s, [, d]) => s + 12 + d.length, 0)
  const out = new Uint8Array(total)
  out.set(SIGNATURE, 0)
  const view = new DataView(out.buffer)
  let p = 8
  for (const [type, d] of chunks) {
    view.setUint32(p, d.length)
    for (let i = 0; i < 4; i++) out[p + 4 + i] = type.charCodeAt(i)
    out.set(d, p + 8)
    view.setUint32(p + 8 + d.length, crc32(out, p + 4, p + 8 + d.length))
    p += 12 + d.length
  }
  return out
}

export interface PngInfo {
  width: number
  height: number
  bitDepth: number
  colorType: number
  /** Concatenated IDAT payload (a zlib stream). */
  idat: Uint8Array
}

export function readPng(bytes: Uint8Array): PngInfo {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('Not a PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 8
  let info: Omit<PngInfo, 'idat'> | null = null
  const parts: Uint8Array[] = []
  while (p < bytes.length) {
    const len = view.getUint32(p)
    const type = String.fromCharCode(...bytes.subarray(p + 4, p + 8))
    const data = bytes.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      info = {
        width: view.getUint32(p + 8),
        height: view.getUint32(p + 12),
        bitDepth: data[8],
        colorType: data[9],
      }
    } else if (type === 'IDAT') parts.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  if (!info) throw new Error('PNG without IHDR')
  const size = parts.reduce((s, d) => s + d.length, 0)
  const idat = new Uint8Array(size)
  let o = 0
  for (const d of parts) {
    idat.set(d, o)
    o += d.length
  }
  return { ...info, idat }
}
