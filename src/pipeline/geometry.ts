// Composite geometric mapping: output pixel → (dewarp) → (deskew) → (perspective) → source pixel.
// The whole chain is evaluated per pixel in a single pass, so the image is interpolated only once and
// no full-size coordinate maps are allocated. Illumination normalization happens in the same pass.
import { sampleField, type DewarpField } from './dewarp'
import type { GrayImage } from './image'
import type { Point, Quad } from '../model/types'

/** Projective map from the unit square to a quad (Heckbert): (0,0)→q0, (1,0)→q1, (1,1)→q2, (0,1)→q3. */
export interface Homography {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
  g: number
  h: number
}

export function squareToQuad(q: Quad): Homography {
  const [p0, p1, p2, p3] = q
  const dx1 = p1.x - p2.x
  const dx2 = p3.x - p2.x
  const dx3 = p0.x - p1.x + p2.x - p3.x
  const dy1 = p1.y - p2.y
  const dy2 = p3.y - p2.y
  const dy3 = p0.y - p1.y + p2.y - p3.y
  let g = 0
  let h = 0
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1
    g = (dx3 * dy2 - dx2 * dy3) / den
    h = (dx1 * dy3 - dx3 * dy1) / den
  }
  return {
    a: p1.x - p0.x + g * p1.x,
    b: p3.x - p0.x + h * p3.x,
    c: p0.x,
    d: p1.y - p0.y + g * p1.y,
    e: p3.y - p0.y + h * p3.y,
    f: p0.y,
    g,
    h,
  }
}

export function applyHomography(H: Homography, u: number, v: number): Point {
  const z = H.g * u + H.h * v + 1
  return { x: (H.a * u + H.b * v + H.c) / z, y: (H.d * u + H.e * v + H.f) / z }
}

export const fullQuad = (w: number, h: number): Quad => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
]

/** Natural size of the rectified quad (longest opposite edges). */
export function quadSize(q: Quad): { width: number; height: number } {
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
  return {
    width: Math.max(d(q[0], q[1]), d(q[3], q[2])),
    height: Math.max(d(q[0], q[3]), d(q[1], q[2])),
  }
}

export const scaleQuad = (q: Quad, s: number): Quad => q.map((p) => ({ x: p.x * s, y: p.y * s })) as Quad

/**
 * The chain is defined on the "reference frame" R (the rectified analysis image, size refW × refH):
 *   straight point p_D → p_K = (x, y + dy(x, y)) → p_R = c + Rot(angle)·(p_K − c) → source = H(p_R / size).
 */
export interface GeometryChain {
  quad: Quad
  refW: number
  refH: number
  angleDeg: number
  dewarp: DewarpField | null
}

/** Illumination background sampled in reference-frame coordinates. */
export interface Background {
  /** Grid of background gray levels; cell (i, j) centred at ((j + .5)·cell, (i + .5)·cell). */
  grid: Float32Array
  gw: number
  gh: number
  cell: number
}

function sampleBackground(bg: Background, x: number, y: number): number {
  const fx = Math.min(bg.gw - 1, Math.max(0, x / bg.cell - 0.5))
  const fy = Math.min(bg.gh - 1, Math.max(0, y / bg.cell - 0.5))
  const x0 = fx | 0
  const y0 = fy | 0
  const x1 = Math.min(bg.gw - 1, x0 + 1)
  const y1 = Math.min(bg.gh - 1, y0 + 1)
  const ax = fx - x0
  const ay = fy - y0
  const g = bg.grid
  const top = g[y0 * bg.gw + x0] + (g[y0 * bg.gw + x1] - g[y0 * bg.gw + x0]) * ax
  const bot = g[y1 * bg.gw + x0] + (g[y1 * bg.gw + x1] - g[y1 * bg.gw + x0]) * ax
  return top + (bot - top) * ay
}

/**
 * Renders the output image (outW × outH) from `src` through the chain, optionally dividing by the
 * background. `srcScale` converts quad coordinates (source pixels) to `src` pixels when `src` was
 * pre-downscaled.
 */
export function remapComposite(
  src: GrayImage,
  chain: GeometryChain,
  outW: number,
  outH: number,
  opts: { background?: Background | null; srcScale?: number } = {},
): GrayImage {
  const { refW, refH, dewarp } = chain
  const srcScale = opts.srcScale ?? 1
  const bg = opts.background ?? null
  const H = squareToQuad(scaleQuad(chain.quad, srcScale))
  const k = refW / outW // output px → reference px (same aspect ratio by construction)
  const rad = (chain.angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cx = refW / 2
  const cy = refH / 2
  const out = new Uint8Array(outW * outH)
  // Dewarp: per-row strip values, then linear interpolation along x via precomputed indices.
  const nStrips = dewarp ? dewarp.xs.length : 0
  const rowVals = new Float64Array(nStrips)
  const colI0 = new Int32Array(outW)
  const colI1 = new Int32Array(outW)
  const colT = new Float32Array(outW)
  if (dewarp) {
    const xs = dewarp.xs
    let i = 0
    for (let x = 0; x < outW; x++) {
      const rx = (x + 0.5) * k
      while (i + 1 < xs.length && xs[i + 1] < rx) i++
      if (rx <= xs[0]) {
        colI0[x] = colI1[x] = 0
      } else if (i + 1 >= xs.length) {
        colI0[x] = colI1[x] = xs.length - 1
      } else {
        colI0[x] = i
        colI1[x] = i + 1
        colT[x] = (rx - xs[i]) / (xs[i + 1] - xs[i])
      }
    }
  }
  for (let y = 0; y < outH; y++) {
    const ry = (y + 0.5) * k
    if (dewarp) for (let s = 0; s < nStrips; s++) rowVals[s] = sampleField(dewarp, dewarp.xs[s], ry)
    const o = y * outW
    for (let x = 0; x < outW; x++) {
      const rx = (x + 0.5) * k
      let ky = ry
      if (dewarp) {
        const a = rowVals[colI0[x]]
        ky += a + (rowVals[colI1[x]] - a) * colT[x]
      }
      const dx = rx - cx
      const dy = ky - cy
      const px = cx + dx * cos - dy * sin
      const py = cy + dx * sin + dy * cos
      const u = px / refW
      const v = py / refH
      const z = H.g * u + H.h * v + 1
      const sx = (H.a * u + H.b * v + H.c) / z - 0.5
      const sy = (H.d * u + H.e * v + H.f) / z - 0.5
      let val = sampleGray(src, sx, sy)
      if (bg) {
        const b = sampleBackground(bg, px, py)
        val = b > 1 ? (val * 255) / b : 255
      }
      out[o + x] = val > 255 ? 255 : val
    }
  }
  return { width: outW, height: outH, data: out }
}

/** Bilinear sample, white outside the image (inlined fast path of sampleBilinear). */
function sampleGray(img: GrayImage, x: number, y: number): number {
  const w = img.width
  const h = img.height
  if (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5) return 255
  const cx = x < 0 ? 0 : x > w - 1 ? w - 1 : x
  const cy = y < 0 ? 0 : y > h - 1 ? h - 1 : y
  const x0 = cx | 0
  const y0 = cy | 0
  const x1 = x0 + 1 < w ? x0 + 1 : x0
  const y1 = y0 + 1 < h ? y0 + 1 : y0
  const ax = cx - x0
  const ay = cy - y0
  const d = img.data
  const r0 = y0 * w
  const r1 = y1 * w
  const top = d[r0 + x0] + (d[r0 + x1] - d[r0 + x0]) * ax
  const bot = d[r1 + x0] + (d[r1 + x1] - d[r1 + x0]) * ax
  return top + (bot - top) * ay
}

/** Maps a reference-frame point back to source coordinates (for overlays/diagnostics). */
export function refToSource(chain: GeometryChain, x: number, y: number): Point {
  const H = squareToQuad(chain.quad)
  const rad = (chain.angleDeg * Math.PI) / 180
  const cx = chain.refW / 2
  const cy = chain.refH / 2
  const dy = chain.dewarp ? sampleField(chain.dewarp, x, y) : 0
  const ddx = x - cx
  const ddy = y + dy - cy
  const px = cx + ddx * Math.cos(rad) - ddy * Math.sin(rad)
  const py = cy + ddx * Math.sin(rad) + ddy * Math.cos(rad)
  return applyHomography(H, px / chain.refW, py / chain.refH)
}
