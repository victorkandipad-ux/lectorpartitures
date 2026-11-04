// Image → gray decoding through a canvas (worker: OffscreenCanvas; fallback: main-thread canvas).
import { grayImage, type GrayImage } from './image'

/** Canvas limits (iOS): ≤ 4096 px per side and ≤ 16.7 MP. */
const MAX_SIDE = 4096
const MAX_PIXELS = 16_000_000

/** Decodes into a ≤ 16 MP canvas and reads it back as gray, in bands (64 MB RGBA copy avoided). */
export function bitmapToGray(
  bitmap: ImageBitmap,
  makeCanvas: (w: number, h: number) => OffscreenCanvas | HTMLCanvasElement,
): GrayImage {
  const s = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height), Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)))
  const w = Math.max(1, Math.round(bitmap.width * s))
  const h = Math.max(1, Math.round(bitmap.height * s))
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  const gray = grayImage(w, h)
  const band = 256
  for (let y = 0; y < h; y += band) {
    const bh = Math.min(band, h - y)
    const { data } = ctx.getImageData(0, y, w, bh)
    const o = y * w
    for (let i = 0, j = 0; i < w * bh; i++, j += 4) {
      gray.data[o + i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8
    }
  }
  canvas.width = canvas.height = 0
  return gray
}
