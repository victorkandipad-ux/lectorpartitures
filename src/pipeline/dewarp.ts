// Page curvature from staff lines. The deskewed page is cut into vertical strips; inside each
// horizontal band, the row profile of every strip is correlated with its neighbour to find how far
// the lines move vertically. Shifts are chained from the central strip outwards, smoothed with a
// weighted cubic per band and interpolated across bands → a vertical displacement field dy(x, y).
// All sizes are relative to the staff space.
import type { BinImage } from './image'

export interface DewarpField {
  /** x of each strip centre and y of each band centre, in the analysed image's pixels. */
  xs: number[]
  ys: number[]
  /** dy per band (rows) and strip (columns): content at (x, y) of the straight page is found at y + dy. */
  grid: number[][]
  maxAbs: number
}

function polyFit(xs: number[], ys: number[], ws: number[], degree: number): number[] | null {
  const n = degree + 1
  const A = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0))
  let wsum = 0
  for (let i = 0; i < xs.length; i++) {
    const w = ws[i]
    if (w <= 0) continue
    wsum += w
    const pow: number[] = [1]
    for (let k = 1; k < 2 * n; k++) pow.push(pow[k - 1] * xs[i])
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) A[r][c] += w * pow[r + c]
      A[r][n] += w * pow[r] * ys[i]
    }
  }
  if (wsum === 0) return null
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-12) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]
    }
  }
  return A.map((row, i) => row[n] / row[i])
}

const evalPoly = (coef: number[], x: number) => coef.reduceRight((acc, c) => acc * x + c, 0)

export function estimateDewarp(bin: BinImage, staffSpace: number, lineThickness: number): DewarpField | null {
  const { width: w, height: h, data } = bin
  const S = Math.max(6, Math.min(48, Math.round(w / (6 * staffSpace))))
  const sw = w / S
  // Row profiles per strip: fraction of ink in the row.
  const prof = Array.from({ length: S }, () => new Float32Array(h))
  for (let s = 0; s < S; s++) {
    const x0 = Math.floor(s * sw)
    const x1 = Math.floor((s + 1) * sw)
    const inv = 1 / (x1 - x0)
    const p = prof[s]
    for (let y = 0; y < h; y++) {
      let c = 0
      const row = y * w
      for (let x = x0; x < x1; x++) c += data[row + x]
      p[y] = c * inv
    }
  }
  const bh = Math.max(4, Math.round(10 * staffSpace))
  const step = Math.max(2, bh >> 1)
  const m = Math.max(1, Math.floor(0.4 * staffSpace))
  const minEnergy = 3 * Math.max(1, lineThickness) * 0.6
  const center = S >> 1
  const xsNorm: number[] = []
  const xs: number[] = []
  for (let s = 0; s < S; s++) {
    xs.push((s + 0.5) * sw)
    xsNorm.push(((s + 0.5) * sw - w / 2) / (w / 2))
  }
  const ys: number[] = []
  const grid: (number[] | null)[] = []
  for (let y0 = 0; ; y0 += step) {
    const y1 = Math.min(h, y0 + bh)
    ys.push((y0 + y1) / 2)
    // Link shifts between neighbouring strips.
    const link = new Array<number>(S).fill(0)
    const linkW = new Array<number>(S).fill(0)
    for (let s = 0; s + 1 < S; s++) {
      const a = prof[s]
      const b = prof[s + 1]
      let ea = 0
      let eb = 0
      let ma = 0
      let mb = 0
      for (let y = y0; y < y1; y++) {
        ea += a[y] * a[y]
        eb += b[y] * b[y]
        ma += a[y]
        mb += b[y]
      }
      if (ma < minEnergy || mb < minEnergy || ea === 0 || eb === 0) continue
      const norm = Math.sqrt(ea * eb)
      const cs: number[] = []
      for (let d = -m; d <= m; d++) {
        let c = 0
        for (let y = y0; y < y1; y++) {
          const yy = y + d
          if (yy >= 0 && yy < h) c += a[y] * b[yy]
        }
        cs.push(c / norm)
      }
      let bi = 0
      for (let i = 1; i < cs.length; i++) if (cs[i] > cs[bi]) bi = i
      if (cs[bi] < 0.5 || bi === 0 || bi === cs.length - 1) continue // weak or at the search border
      const den = cs[bi - 1] - 2 * cs[bi] + cs[bi + 1]
      const sub = den < 0 ? (0.5 * (cs[bi - 1] - cs[bi + 1])) / den : 0
      link[s] = bi - m + sub
      linkW[s] = cs[bi]
    }
    // Chain from the centre: off[s] = position of the content of strip s relative to the centre.
    const off = new Array<number>(S).fill(0)
    const wt = new Array<number>(S).fill(0)
    wt[center] = 1
    for (let s = center; s + 1 < S; s++) {
      off[s + 1] = off[s] + link[s]
      wt[s + 1] = linkW[s] > 0 ? Math.min(wt[s] || 1, linkW[s]) : 0
    }
    for (let s = center - 1; s >= 0; s--) {
      off[s] = off[s + 1] - link[s]
      wt[s] = linkW[s] > 0 ? Math.min(wt[s + 1] || 1, linkW[s]) : 0
    }
    const valid = wt.filter((v) => v > 0).length
    const coef = valid >= Math.max(4, S / 3) ? polyFit(xsNorm, off, wt, valid >= 8 ? 3 : 2) : null
    if (coef) {
      const c0 = evalPoly(coef, xsNorm[center])
      grid.push(xsNorm.map((x) => evalPoly(coef, x) - c0))
    } else grid.push(null)
    if (y1 >= h) break
  }
  // Fill bands without evidence from the nearest band that has it.
  const filled: number[][] = []
  for (let i = 0; i < grid.length; i++) {
    let best: number[] | null = null
    for (let d = 0; d < grid.length && !best; d++) best = grid[i - d] ?? grid[i + d] ?? null
    filled.push(best ?? new Array<number>(S).fill(0))
  }
  let maxAbs = 0
  for (const row of filled) for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v))
  if (!grid.some(Boolean) || maxAbs < 0.3 * staffSpace) return null
  return { xs, ys, grid: filled, maxAbs }
}

/** Bilinear interpolation of the displacement field (clamped at the borders). */
export function sampleField(f: DewarpField, x: number, y: number): number {
  const { xs, ys, grid } = f
  const locate = (arr: number[], v: number): [number, number, number] => {
    if (v <= arr[0]) return [0, 0, 0]
    const last = arr.length - 1
    if (v >= arr[last]) return [last, last, 0]
    let i = 0
    while (arr[i + 1] < v) i++
    return [i, i + 1, (v - arr[i]) / (arr[i + 1] - arr[i])]
  }
  const [r0, r1, ty] = locate(ys, y)
  const [c0, c1, tx] = locate(xs, x)
  const top = grid[r0][c0] + (grid[r0][c1] - grid[r0][c0]) * tx
  const bot = grid[r1][c0] + (grid[r1][c1] - grid[r1][c0]) * tx
  return top + (bot - top) * ty
}
