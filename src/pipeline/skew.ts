// Skew estimation from staff lines: the projection of ink along the true line direction is the
// sharpest (maximum sum of squared bins). Staff lines dominate the score, so text and symbols barely
// affect the result.
import type { BinImage } from './image'

export interface SkewResult {
  /** Angle of the staff lines in degrees (positive = lines go down to the right, y axis down). */
  angleDeg: number
  /** Ratio of the best score to the median score: >1.5 means a clear line direction. */
  sharpness: number
}

/** Ink samples per half of the page. */
const HALF_POINTS = 60_000
/** Degrees between the halves from which the page counts as curled. */
const CURL_DISAGREEMENT = 0.5

function inkSample(bin: BinImage, maxPoints: number, x0 = 0, x1 = bin.width): { xs: Float32Array; ys: Float32Array; n: number } {
  const { width: w, height: h, data } = bin
  let count = 0
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = x0; x < x1; x++) count += data[row + x]
  }
  const stride = Math.max(1, Math.ceil(count / maxPoints))
  const n = Math.ceil(count / stride)
  const xs = new Float32Array(n)
  const ys = new Float32Array(n)
  let k = 0
  let c = 0
  const cx = w / 2
  const cy = h / 2
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = x0; x < x1; x++) {
      if (!data[row + x]) continue
      if (c++ % stride === 0 && k < n) {
        xs[k] = x - cx
        ys[k] = y - cy
        k++
      }
    }
  }
  return { xs, ys, n: k }
}

function score(xs: Float32Array, ys: Float32Array, n: number, angleRad: number, bins: Float64Array, offset: number): number {
  bins.fill(0)
  const s = Math.sin(angleRad)
  const c = Math.cos(angleRad)
  for (let i = 0; i < n; i++) {
    const p = Math.round(ys[i] * c - xs[i] * s) + offset
    bins[p]++
  }
  let sum = 0
  for (let i = 0; i < bins.length; i++) sum += bins[i] * bins[i]
  return sum
}

export function estimateSkew(bin: BinImage, maxDeg = 15, maxPoints = 200_000, x0 = 0, x1 = bin.width): SkewResult {
  const { xs, ys, n } = inkSample(bin, maxPoints, x0, x1)
  if (n < 100) return { angleDeg: 0, sharpness: 0 }
  const diag = Math.ceil(Math.hypot(bin.width, bin.height))
  const bins = new Float64Array(diag + 2)
  const offset = (diag >> 1) + 1
  const rad = Math.PI / 180
  const coarse: number[] = []
  let best = 0
  let bestA = 0
  for (let a = -maxDeg; a <= maxDeg + 1e-9; a += 0.25) {
    const s = score(xs, ys, n, a * rad, bins, offset)
    coarse.push(s)
    if (s > best) {
      best = s
      bestA = a
    }
  }
  for (let a = bestA - 0.25; a <= bestA + 0.25 + 1e-9; a += 0.02) {
    const s = score(xs, ys, n, a * rad, bins, offset)
    if (s > best) {
      best = s
      bestA = a
    }
  }
  coarse.sort((p, q) => p - q)
  const median = coarse[coarse.length >> 1] || 1
  return { angleDeg: Math.round(bestA * 100) / 100, sharpness: best / median }
}

/**
 * Skew of the page as a whole. On a curled page the global projection locks on to the slope of one side,
 * and what is left exceeds what the dewarp can follow: when both halves disagree the rotation is their
 * mean, and the dewarp takes care of the curve that remains.
 */
export function estimatePageSkew(bin: BinImage): SkewResult {
  const whole = estimateSkew(bin)
  if (whole.sharpness <= 1.2) return whole
  const mid = bin.width >> 1
  const left = estimateSkew(bin, 15, HALF_POINTS, 0, mid)
  const right = estimateSkew(bin, 15, HALF_POINTS, mid, bin.width)
  if (left.sharpness <= 1.2 || right.sharpness <= 1.2) return whole
  if (Math.abs(left.angleDeg - right.angleDeg) < CURL_DISAGREEMENT) return whole
  return { angleDeg: Math.round(((left.angleDeg + right.angleDeg) / 2) * 100) / 100, sharpness: whole.sharpness }
}

/** Rotates a binary image so that lines at `angleDeg` become horizontal (nearest neighbour). */
export function rotateBin(bin: BinImage, angleDeg: number): BinImage {
  const { width: w, height: h, data } = bin
  const out = new Uint8Array(w * h)
  const a = (angleDeg * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  const cx = w / 2
  const cy = h / 2
  for (let y = 0; y < h; y++) {
    const dy = y - cy
    for (let x = 0; x < w; x++) {
      const dx = x - cx
      // Destination (straight) → source (skewed): rotate by +angle.
      const sx = Math.round(cx + dx * c - dy * s)
      const sy = Math.round(cy + dx * s + dy * c)
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) out[y * w + x] = data[sy * w + sx]
    }
  }
  return { width: w, height: h, data: out }
}
