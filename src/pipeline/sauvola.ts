// Sauvola binarization with integral images, computed in horizontal bands so that memory stays
// O(width × (band + window)) even for 16 MP pages (two full Float64 integrals would need ~250 MB).
import type { BinImage, GrayImage } from './image'

export interface Integrals {
  /** (rows + 1) × (width + 1) sums of pixel values and of their squares. */
  sum: Float64Array
  sq: Float64Array
  stride: number
}

/** Integral images of rows [y0, y1) of `img`. Row 0 / column 0 are zero padding. */
export function integrals(img: GrayImage, y0 = 0, y1 = img.height): Integrals {
  const w = img.width
  const stride = w + 1
  const rows = y1 - y0
  const sum = new Float64Array((rows + 1) * stride)
  const sq = new Float64Array((rows + 1) * stride)
  const d = img.data
  for (let y = 0; y < rows; y++) {
    let rs = 0
    let rq = 0
    const src = (y0 + y) * w
    const o = (y + 1) * stride
    const p = y * stride
    for (let x = 0; x < w; x++) {
      const v = d[src + x]
      rs += v
      rq += v * v
      sum[o + x + 1] = sum[p + x + 1] + rs
      sq[o + x + 1] = sq[p + x + 1] + rq
    }
  }
  return { sum, sq, stride }
}

export interface SauvolaOptions {
  /** Window side in pixels (odd). */
  window: number
  /** Sensitivity, typically 0.2–0.5. */
  k?: number
  /** Dynamic range of the standard deviation. */
  R?: number
  /** Pixels darker than this are always ink (prevents hollow noteheads/beams inside large dark areas). */
  darkFloor?: number
  /** Pixels lighter than this are never ink (suppresses paper texture). */
  lightCeil?: number
  /** Rows per band (memory/speed trade-off). */
  band?: number
}

export function sauvola(img: GrayImage, opts: SauvolaOptions): BinImage {
  const { width: w, height: h, data } = img
  const k = opts.k ?? 0.2
  const R = opts.R ?? 128
  const darkFloor = opts.darkFloor ?? -1
  const lightCeil = opts.lightCeil ?? 256
  const r = Math.max(1, opts.window >> 1)
  const band = opts.band ?? 256
  const out = new Uint8Array(w * h)
  for (let by = 0; by < h; by += band) {
    const bEnd = Math.min(h, by + band)
    const iy0 = Math.max(0, by - r)
    const iy1 = Math.min(h, bEnd + r + 1)
    const { sum, sq, stride } = integrals(img, iy0, iy1)
    for (let y = by; y < bEnd; y++) {
      const ya = Math.max(0, y - r) - iy0
      const yb = Math.min(h - 1, y + r) - iy0 + 1
      const rowA = ya * stride
      const rowB = yb * stride
      const hh = yb - ya
      for (let x = 0; x < w; x++) {
        const v = data[y * w + x]
        if (v < darkFloor) {
          out[y * w + x] = 1
          continue
        }
        if (v >= lightCeil) continue
        const xa = x - r < 0 ? 0 : x - r
        const xb = x + r >= w ? w : x + r + 1
        const n = hh * (xb - xa)
        const s = sum[rowB + xb] - sum[rowA + xb] - sum[rowB + xa] + sum[rowA + xa]
        const q = sq[rowB + xb] - sq[rowA + xb] - sq[rowB + xa] + sq[rowA + xa]
        const m = s / n
        const variance = q / n - m * m
        const sd = variance > 0 ? Math.sqrt(variance) : 0
        const t = m * (1 + k * (sd / R - 1))
        if (v <= t) out[y * w + x] = 1
      }
    }
  }
  return { width: w, height: h, data: out }
}

/** Simple global threshold (used for vector PDF renderings). */
export function threshold(img: GrayImage, t: number): BinImage {
  const out = new Uint8Array(img.data.length)
  for (let i = 0; i < out.length; i++) out[i] = img.data[i] < t ? 1 : 0
  return { width: img.width, height: img.height, data: out }
}
