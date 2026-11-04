// Staff metrics from vertical run-lengths (Fujinaga / Cardoso). The most frequent black run is the
// staff-line thickness; the most frequent distance between consecutive thin black runs is the
// line-to-line distance, which we call `staffSpace` everywhere in the code base.
import type { BinImage } from './image'

export interface StaffMetrics {
  /** Line-to-line distance (period of the staff), px. */
  staffSpace: number
  lineThickness: number
  /** 0–1: how dominant the staff period is among all vertical run pairs. */
  confidence: number
  /** Number of thin-run pairs that voted for the period (evidence size). */
  votes: number
}

function refinedMode(hist: Float64Array, from: number): { mode: number; value: number; peak: number } {
  let mode = from
  for (let i = from; i < hist.length; i++) if (hist[i] > hist[mode]) mode = i
  const a = hist[mode - 1] ?? 0
  const b = hist[mode]
  const c = hist[mode + 1] ?? 0
  const s = a + b + c
  const value = s > 0 ? (mode * b + (mode - 1) * a + (mode + 1) * c) / s : mode
  return { mode, value, peak: s }
}

export function staffMetrics(bin: BinImage, maxColumns = 600): StaffMetrics | null {
  const { width: w, height: h, data } = bin
  const maxLen = Math.max(8, Math.min(400, h >> 2))
  const black = new Float64Array(maxLen + 1)
  const step = Math.max(1, Math.floor(w / maxColumns))
  // Run lists per sampled column: starts and lengths of black runs.
  const runs: number[][] = []
  for (let x = 0; x < w; x += step) {
    const col: number[] = []
    let y = 0
    while (y < h) {
      while (y < h && !data[y * w + x]) y++
      const start = y
      while (y < h && data[y * w + x]) y++
      const len = y - start
      if (len > 0) {
        if (len <= maxLen) black[len]++
        col.push(start, len)
      }
    }
    runs.push(col)
  }
  const lt = refinedMode(black, 1)
  if (lt.peak === 0) return null
  const thinMax = Math.max(lt.mode * 2 + 1, lt.mode + 2)
  const pairs = new Float64Array(maxLen + 1)
  let totalPairs = 0
  for (const col of runs) {
    for (let i = 2; i < col.length; i += 2) {
      const l0 = col[i - 1]
      const l1 = col[i + 1]
      if (l0 > thinMax || l1 > thinMax) continue
      const d = Math.round(col[i] + l1 / 2 - (col[i - 2] + l0 / 2))
      if (d > 0 && d <= maxLen) {
        pairs[d]++
        totalPairs++
      }
    }
  }
  // Ignore implausibly small periods (noise, text strokes): a staff space is ≥ 2 line thicknesses.
  const ss = refinedMode(pairs, Math.max(3, Math.ceil(lt.value * 2)))
  if (ss.peak === 0 || totalPairs === 0) return null
  return {
    staffSpace: ss.value,
    lineThickness: lt.value,
    confidence: Math.min(1, ss.peak / totalPairs),
    votes: ss.peak,
  }
}
