// Tiny synthetic score renderer for unit tests (exact ground truth).
import { grayImage, type GrayImage } from '../../src/pipeline/image'

export interface SynthOptions {
  width: number
  height: number
  staffSpace: number
  lineThickness: number
  /** y of the first line of each staff. */
  staves: number[]
  x0?: number
  x1?: number
  /** Line direction angle in degrees (y down). */
  angleDeg?: number
  /** Vertical displacement as a function of x (page curl). */
  curve?: (x: number) => number
  ink?: number
  paper?: number
}

/** Renders 5-line staves with barlines every 12 staff spaces and some filled noteheads. */
export function synthScore(o: SynthOptions): GrayImage {
  const img = grayImage(o.width, o.height, o.paper ?? 235)
  const ink = o.ink ?? 30
  const x0 = o.x0 ?? Math.round(o.width * 0.08)
  const x1 = o.x1 ?? Math.round(o.width * 0.92)
  const tan = Math.tan(((o.angleDeg ?? 0) * Math.PI) / 180)
  const cx = o.width / 2
  const dy = (x: number) => (x - cx) * tan + (o.curve ? o.curve(x) : 0)
  const put = (x: number, y: number) => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi >= 0 && yi >= 0 && xi < o.width && yi < o.height) img.data[yi * o.width + xi] = ink
  }
  for (const top of o.staves) {
    for (let l = 0; l < 5; l++) {
      const y = top + l * o.staffSpace
      for (let x = x0; x <= x1; x++) for (let t = 0; t < o.lineThickness; t++) put(x, y + t + dy(x))
    }
    const bar = Math.round(o.staffSpace * 12)
    for (let x = x0; x <= x1; x += bar) {
      for (let y = top; y <= top + 4 * o.staffSpace + o.lineThickness; y++)
        for (let t = 0; t < o.lineThickness; t++) put(x + t, y + dy(x))
    }
    for (let x = x0 + o.staffSpace * 3; x < x1 - o.staffSpace * 2; x += o.staffSpace * 4) {
      const ny = top + 2 * o.staffSpace + (Math.round(x / o.staffSpace) % 3) * (o.staffSpace / 2)
      for (let yy = -o.staffSpace / 2; yy <= o.staffSpace / 2; yy++)
        for (let xx = -0.65 * o.staffSpace; xx <= 0.65 * o.staffSpace; xx++)
          if ((xx / (0.65 * o.staffSpace)) ** 2 + (yy / (0.5 * o.staffSpace)) ** 2 <= 1) put(x + xx, ny + yy + dy(x + xx))
    }
  }
  return img
}

/** Deterministic PRNG. */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
