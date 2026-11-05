// Helpers shared by the bench runs: fixture loading and structure overlays.
import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { rgbaToGray, type BinImage, type GrayImage } from '../src/pipeline/image'
import type { PageStructure } from '../src/model/types'

export const FIXTURES_DIR = 'bench/fixtures/real'

export function loadFixture(file: string): GrayImage {
  const d = jpeg.decode(readFileSync(`${FIXTURES_DIR}/${file}`), { useTArray: true, maxMemoryUsageInMB: 1024 })
  return rgbaToGray(d.data, d.width, d.height)
}

/** JPEG of the clean page with staves (blue), system boxes (orange) and barlines (green). */
export function structureOverlay(bin: BinImage, s: PageStructure | null, maxSide = 1400): Buffer {
  const scale = Math.min(1, maxSide / Math.max(bin.width, bin.height))
  const w = Math.round(bin.width * scale)
  const h = Math.round(bin.height * scale)
  const rgba = new Uint8Array(w * h * 4)
  const ink = new Float32Array(w * h)
  const area = new Uint16Array(w * h)
  for (let y = 0; y < bin.height; y++) {
    const oy = Math.min(h - 1, Math.floor(y * scale))
    for (let x = 0; x < bin.width; x++) {
      const o = oy * w + Math.min(w - 1, Math.floor(x * scale))
      ink[o] += bin.data[y * bin.width + x]
      area[o]++
    }
  }
  for (let i = 0; i < w * h; i++) {
    const v = 255 - Math.round((255 * ink[i]) / Math.max(1, area[i]))
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v
    rgba[i * 4 + 3] = 255
  }
  const put = (x: number, y: number, c: number[]) => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return
    const o = (yi * w + xi) * 4
    rgba[o] = c[0]
    rgba[o + 1] = c[1]
    rgba[o + 2] = c[2]
  }
  const hline = (x0: number, x1: number, y: number, c: number[]) => {
    for (let x = x0 * scale; x <= x1 * scale; x++) put(x, y * scale, c)
  }
  const vline = (x: number, y0: number, y1: number, c: number[], thick = 1) => {
    for (let y = y0 * scale; y <= y1 * scale; y++) for (let t = 0; t < thick; t++) put(x * scale + t, y, c)
  }
  const barColor: Record<string, number[]> = {
    single: [0, 170, 0],
    double: [190, 0, 190],
    final: [220, 0, 0],
    'repeat-l': [0, 170, 170],
    'repeat-r': [0, 170, 170],
    'repeat-lr': [0, 170, 170],
  }
  for (const sys of s?.systems ?? []) {
    const b = sys.bbox
    hline(b.x, b.x + b.w, b.y, [255, 140, 0])
    hline(b.x, b.x + b.w, b.y + b.h, [255, 140, 0])
    vline(b.x, b.y, b.y + b.h, [255, 140, 0])
    vline(b.x + b.w, b.y, b.y + b.h, [255, 140, 0])
    for (const st of sys.staves) for (const y of st.lineYs) hline(b.x, b.x + b.w, y, [40, 90, 255])
    for (const m of sys.measures) vline(m.xEnd, b.y, b.y + b.h, barColor[m.barline], 2)
  }
  return Buffer.from(jpeg.encode({ data: rgba, width: w, height: h }, 80).data)
}
