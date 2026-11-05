// Barline candidates of one staff and their classification. A candidate is a thin vertical stroke
// crossing every space of the staff. Stems are told apart by what surrounds them: a notehead attached
// to the stroke, or an extension beyond the staff that does not reach the neighbouring staff. The
// final decision (consensus across the staves of a system) belongs to structure.ts.
import type { BarlineType } from '../model/types'
import type { BinImage } from './image'
import { lineYAt, type StaffTrack } from './staves'

export interface BarCandidate {
  x: number
  /** Median stroke width over the staff spaces. */
  width: number
  /** 0–1 ink coverage over the staff spaces. */
  cover: number
  /** Length of the stroke beyond the outer lines. */
  extUp: number
  extDown: number
  /** A notehead-sized blob is attached to the stroke. */
  hasHead: boolean
}

/** Fraction of the rows between lines that must have ink (weak candidates are scored low). */
const MIN_COVER = 0.75
/** Horizontal tolerance (hand-drawn or slightly slanted strokes), in staff spaces. */
const TILT_TOLERANCE = 0.15
const MAX_WIDTH_SPACES = 1.2

/** Horizontal ink run around (x, y), looking up to `tol` columns away from x. */
function runAt(bin: BinImage, x: number, y: number, tol: number): { a: number; b: number } | null {
  const { width: w, height: h, data } = bin
  if (y < 0 || y >= h) return null
  const row = y * w
  let cx = -1
  for (let d = 0; d <= tol && cx < 0; d++) {
    if (x - d >= 0 && data[row + x - d]) cx = x - d
    else if (x + d < w && data[row + x + d]) cx = x + d
  }
  if (cx < 0) return null
  let a = cx
  let b = cx
  while (a > 0 && data[row + a - 1]) a--
  while (b < w - 1 && data[row + b + 1]) b++
  return { a, b }
}

/** Rows between the lines of a staff at column x, excluding the rows the lines occupy. */
function spaceRows(t: StaffTrack, x: number, lt: number): number[] {
  const rows: number[] = []
  const margin = lt / 2 + 1
  for (let l = 0; l < 4; l++) {
    const y0 = lineYAt(t, l, x) + margin
    const y1 = lineYAt(t, l + 1, x) - margin
    for (let y = Math.ceil(y0); y <= y1; y++) rows.push(y)
  }
  return rows
}

function extension(bin: BinImage, x: number, from: number, dir: 1 | -1, max: number, tol: number): number {
  let y = from
  let n = 0
  let miss = 0
  let cx = x
  while (n < max && miss < 2) {
    const run = runAt(bin, cx, y, tol)
    if (run) {
      miss = 0
      // Follow the stroke unless the run is a horizontal feature.
      if (run.b - run.a <= 2 * tol + 2) cx = (run.a + run.b) >> 1
    } else miss++
    y += dir
    n++
  }
  return Math.max(0, n - miss)
}

/** A blob wider than a stem, tall as a notehead, touching the stroke within or next to the staff. */
function hasNotehead(bin: BinImage, t: StaffTrack, x: number, ss: number, lt: number, tol: number): boolean {
  const top = lineYAt(t, 0, x)
  const bottom = lineYAt(t, 4, x)
  const lines = [0, 1, 2, 3, 4].map((l) => lineYAt(t, l, x))
  const minWidth = 0.7 * ss
  // Wide rows within one notehead height, not necessarily contiguous: an open head only has wide
  // rows at its top and bottom arcs.
  const needRows = Math.max(3, 0.25 * ss)
  const window = Math.round(1.2 * ss)
  const wide: number[] = []
  for (let y = Math.round(top - 1.5 * ss); y <= bottom + 1.5 * ss; y++) {
    if (lines.some((ly) => Math.abs(ly - y) <= lt / 2 + 1)) continue
    const run = runAt(bin, x, y, tol)
    if (!run || run.b - run.a + 1 < minWidth) continue
    wide.push(y)
    while (y - wide[0] > window) wide.shift()
    if (wide.length >= needRows) return true
  }
  return false
}

export function barCandidates(bin: BinImage, t: StaffTrack, ss: number, lt: number, maxExtension: number): BarCandidate[] {
  const { width: w, data } = bin
  const tol = Math.max(1, Math.round(TILT_TOLERANCE * ss))
  const x0 = Math.max(0, Math.round(t.xStart - ss))
  const x1 = Math.min(w - 1, Math.round(t.xEnd + ss))
  const out: BarCandidate[] = []
  let cStart = -1
  const close = (end: number) => {
    // Most straight column of the cluster.
    let bestX = cStart
    let bestInk = -1
    for (let x = cStart; x <= end; x++) {
      let ink = 0
      for (const y of spaceRows(t, x, lt)) if (data[y * w + x]) ink++
      if (ink > bestInk) {
        bestInk = ink
        bestX = x
      }
    }
    const x = bestX
    const widths: number[] = []
    const rows = spaceRows(t, x, lt)
    let covered = 0
    for (const y of rows) {
      const run = runAt(bin, x, y, tol)
      if (run) {
        covered++
        widths.push(run.b - run.a + 1)
      }
    }
    widths.sort((a, b) => a - b)
    const width = widths.length ? widths[widths.length >> 1] : 0
    if (width <= MAX_WIDTH_SPACES * ss) {
      const margin = Math.ceil(lt / 2) + 1
      out.push({
        x: strokeCentre(bin, x, rows, tol),
        width,
        cover: rows.length ? covered / rows.length : 0,
        extUp: extension(bin, x, Math.round(lineYAt(t, 0, x)) - margin, -1, maxExtension, tol),
        extDown: extension(bin, x, Math.round(lineYAt(t, 4, x)) + margin, 1, maxExtension, tol),
        hasHead: hasNotehead(bin, t, x, ss, lt, tol),
      })
    }
    cStart = -1
  }
  for (let x = x0; x <= x1; x++) {
    const rows = spaceRows(t, x, lt)
    const allowed = Math.floor(rows.length * (1 - MIN_COVER))
    let misses = 0
    for (const y of rows) {
      if (!runAt(bin, x, y, tol) && ++misses > allowed) break
    }
    const ok = rows.length > 0 && misses <= allowed
    if (ok && cStart < 0) cStart = x
    if (!ok && cStart >= 0) close(x - 1)
  }
  if (cStart >= 0) close(x1)
  return out
}

/** Median centre of the stroke's horizontal runs over the staff spaces. */
function strokeCentre(bin: BinImage, x: number, rows: number[], tol: number): number {
  const centres: number[] = []
  for (const y of rows) {
    const run = runAt(bin, x, y, tol)
    if (run) centres.push((run.a + run.b) / 2)
  }
  centres.sort((a, b) => a - b)
  return centres.length ? centres[centres.length >> 1] : x
}

/** Ink fraction of a box. */
function inkBox(bin: BinImage, x0: number, y0: number, x1: number, y1: number): number {
  const { width: w, height: h, data } = bin
  const ax = Math.max(0, Math.round(x0))
  const bx = Math.min(w - 1, Math.round(x1))
  const ay = Math.max(0, Math.round(y0))
  const by = Math.min(h - 1, Math.round(y1))
  let ink = 0
  let n = 0
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) (n++, (ink += data[y * w + x]))
  return n ? ink / n : 0
}

/** Repeat dots in the two middle spaces, on the given side of the x range. */
export function hasRepeatDots(bin: BinImage, t: StaffTrack, x: number, side: -1 | 1, ss: number): boolean {
  const half = 0.25 * ss
  for (let d = 0.3 * ss; d <= 1.3 * ss; d += Math.max(1, 0.1 * ss)) {
    const cx = x + side * d
    const dot = (a: number, b: number) => {
      const cy = (lineYAt(t, a, cx) + lineYAt(t, b, cx)) / 2
      return inkBox(bin, cx - half, cy - half, cx + half, cy + half)
    }
    if (dot(1, 2) >= 0.5 && dot(2, 3) >= 0.5 && dot(0, 1) < 0.3 && dot(3, 4) < 0.3) return true
  }
  return false
}

export interface BarGroup {
  /** Left and right edges of the group of strokes. */
  x0: number
  x1: number
  strokes: { x: number; width: number }[]
}

/** Barline type from the strokes of a group and the repeat dots beside it. */
export function classifyBarline(bin: BinImage, tracks: StaffTrack[], g: BarGroup, ss: number): BarlineType {
  const votes = (side: -1 | 1) => {
    const edge = side < 0 ? g.x0 : g.x1
    return tracks.filter((t) => hasRepeatDots(bin, t, edge, side, ss)).length * 2 >= tracks.length
  }
  const left = votes(-1)
  const right = votes(1)
  if (left && right) return 'repeat-lr'
  if (left) return 'repeat-l'
  if (right) return 'repeat-r'
  if (g.strokes.length >= 2) {
    const widths = g.strokes.map((s) => s.width)
    return Math.max(...widths) >= 1.6 * Math.min(...widths) ? 'final' : 'double'
  }
  return 'single'
}
