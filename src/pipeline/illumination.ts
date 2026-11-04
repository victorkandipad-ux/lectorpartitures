// Paper background estimate: a high percentile of each block (blocks larger than any ink feature,
// sized from the staff space) followed by a max filter and smoothing. Dividing by it flattens
// shadows, gradients and yellowed paper before binarization.
import type { Background } from './geometry'
import type { GrayImage } from './image'

export function estimateBackground(img: GrayImage, staffSpace: number): Background {
  const { width: w, height: h, data } = img
  const cell = Math.max(8, Math.round(2.5 * staffSpace))
  const gw = Math.max(1, Math.ceil(w / cell))
  const gh = Math.max(1, Math.ceil(h / cell))
  const grid = new Float32Array(gw * gh)
  const hist = new Uint32Array(256)
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      hist.fill(0)
      const x0 = gx * cell
      const y0 = gy * cell
      const x1 = Math.min(w, x0 + cell)
      const y1 = Math.min(h, y0 + cell)
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[data[y * w + x]]++
      const target = Math.floor((x1 - x0) * (y1 - y0) * 0.1)
      let acc = 0
      let v = 255
      for (; v > 0; v--) {
        acc += hist[v]
        if (acc > target) break
      }
      grid[gy * gw + gx] = v
    }
  }
  // Max filter 3×3: blocks dominated by ink (big beams, clusters) borrow from paper neighbours.
  const maxed = new Float32Array(grid.length)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let m = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= gh) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= gw) continue
          m = Math.max(m, grid[yy * gw + xx])
        }
      }
      maxed[y * gw + x] = m
    }
  }
  // Two 3×3 box blurs ≈ a smooth gaussian over the grid.
  let cur = maxed
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(cur.length)
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let s = 0
        let n = 0
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy
          if (yy < 0 || yy >= gh) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= gw) continue
            s += cur[yy * gw + xx]
            n++
          }
        }
        next[y * gw + x] = s / n
      }
    }
    cur = next
  }
  // Never divide by something darker than a fraction of the brightest paper (protects dark areas).
  let top = 0
  for (const v of cur) top = Math.max(top, v)
  const floor = top * 0.35
  for (let i = 0; i < cur.length; i++) if (cur[i] < floor) cur[i] = floor
  return { grid: cur, gw, gh, cell }
}

/** Divides an image by its background (same frame). */
export function normalizeIllumination(img: GrayImage, bg: Background): GrayImage {
  const { width: w, height: h, data } = img
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bg.gh - 1, Math.max(0, (y + 0.5) / bg.cell - 0.5))
    const y0 = fy | 0
    const y1 = Math.min(bg.gh - 1, y0 + 1)
    const ay = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bg.gw - 1, Math.max(0, (x + 0.5) / bg.cell - 0.5))
      const x0 = fx | 0
      const x1 = Math.min(bg.gw - 1, x0 + 1)
      const ax = fx - x0
      const g = bg.grid
      const top = g[y0 * bg.gw + x0] + (g[y0 * bg.gw + x1] - g[y0 * bg.gw + x0]) * ax
      const bot = g[y1 * bg.gw + x0] + (g[y1 * bg.gw + x1] - g[y1 * bg.gw + x0]) * ax
      const b = top + (bot - top) * ay
      const v = (data[y * w + x] * 255) / b
      out[y * w + x] = v > 255 ? 255 : v
    }
  }
  return { width: w, height: h, data: out }
}
