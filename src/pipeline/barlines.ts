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
  /** Same width over the staff: a ruled stroke, unlike the strokes of a clef or a time signature. */
  uniform: boolean
}

/** Fraction of the rows between lines that must have ink (weak candidates are scored low). */
const MIN_COVER = 0.75
/** Horizontal tolerance (hand-drawn or slightly slanted strokes), in staff spaces. */
const TILT_TOLERANCE = 0.15
/** Thick barlines of old engravings, or a double barline whose strokes merged. */
const MAX_WIDTH_SPACES = 2
/** What a notehead (and an accidental touching it) can stick out of its stem. */
const MAX_HEAD_SPACES = 2.5

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

/**
 * A blob wider than a stem, tall as a notehead, on the stroke itself: what lies beyond its ends (a note or
 * a slur right above a barline that stops at the staff) is not attached to it.
 */
function hasNotehead(
  bin: BinImage,
  t: StaffTrack,
  x: number,
  strokeWidth: number,
  extUp: number,
  extDown: number,
  ss: number,
  lt: number,
  tol: number,
): boolean {
  const top = lineYAt(t, 0, x)
  const bottom = lineYAt(t, 4, x)
  const lines = [0, 1, 2, 3, 4].map((l) => lineYAt(t, l, x))
  // Relative to the stroke: every row of a thick barline is wide, and that is no notehead.
  const minWidth = Math.max(0.7 * ss, strokeWidth + 0.45 * ss)
  // Wide rows within one notehead height, not necessarily contiguous: an open head only has wide
  // rows at its top and bottom arcs.
  const needRows = Math.max(3, 0.25 * ss)
  const window = Math.round(1.2 * ss)
  const wide: number[] = []
  const y0 = Math.round(top - Math.min(extUp + lt, 1.5 * ss))
  const y1 = bottom + Math.min(extDown + lt, 1.5 * ss)
  for (let y = y0; y <= y1; y++) {
    if (lines.some((ly) => Math.abs(ly - y) <= lt / 2 + 1)) continue
    const run = runAt(bin, x, y, tol)
    if (!run || run.b - run.a + 1 < minWidth || run.b - run.a + 1 > strokeWidth + MAX_HEAD_SPACES * ss) continue
    // A head leaves the stem on one side. Ink on both sides is a staff line bleeding past its nominal
    // thickness, or a slur crossing the stroke.
    const left = x - run.a
    const right = run.b - x
    if (Math.min(left, right) > 0.5 * Math.max(left, right)) continue
    wide.push(y)
    while (y - wide[0] > window) wide.shift()
    if (wide.length >= needRows) return true
  }
  return false
}

/**
 * Something attached to one side only of the stroke near its ends: the arcs of an open notehead (mostly
 * hidden by a staff line), a beam or a flag. A slur crossing a barline leaves on both sides.
 */
function oneSidedAtEnds(
  bin: BinImage,
  t: StaffTrack,
  x: number,
  extUp: number,
  extDown: number,
  strokeWidth: number,
  ss: number,
  lt: number,
  tol: number,
): boolean {
  const lines = [0, 1, 2, 3, 4].map((l) => lineYAt(t, l, x))
  const reach = 0.3 * ss
  const near = Math.max(1, 0.1 * ss)
  // Inwards only: beyond its end, the ink is not attached to the stroke.
  const ends = [
    [lines[0] - extUp, lines[0] - extUp + 0.8 * ss],
    [lines[4] + extDown - 0.8 * ss, lines[4] + extDown],
  ]
  for (const [from, to] of ends) {
    let rows = 0
    for (let y = Math.round(from); y <= to; y++) {
      if (lines.some((ly) => Math.abs(ly - y) <= lt / 2 + 1)) continue
      const run = runAt(bin, x, y, tol)
      // Longer than any head: a staff line crossing the row where the residual curl tilts it.
      if (!run || run.b - run.a + 1 > strokeWidth + MAX_HEAD_SPACES * ss) continue
      const half = strokeWidth / 2
      const left = x - run.a - half
      const right = run.b - x - half
      if (run.b - run.a + 1 > strokeWidth && ((left >= reach && right < near) || (right >= reach && left < near))) rows++
    }
    if (rows >= 2) return true
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
    const spread = widths.length ? widths[(widths.length * 3) >> 2] - widths[widths.length >> 2] : 0
    if (width <= MAX_WIDTH_SPACES * ss) {
      const margin = Math.ceil(lt / 2) + 1
      const extUp = extension(bin, x, Math.round(lineYAt(t, 0, x)) - margin, -1, maxExtension, tol)
      const extDown = extension(bin, x, Math.round(lineYAt(t, 4, x)) + margin, 1, maxExtension, tol)
      out.push({
        x: strokeCentre(bin, x, rows, tol),
        width,
        cover: rows.length ? covered / rows.length : 0,
        extUp,
        extDown,
        hasHead: hasNotehead(bin, t, x, width, extUp, extDown, ss, lt, tol) || oneSidedAtEnds(bin, t, x, extUp, extDown, width, ss, lt, tol),
        uniform: spread <= Math.max(2, 0.2 * ss),
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
  const half = 0.15 * ss
  for (let d = 0.3 * ss; d <= 1.3 * ss; d += Math.max(1, 0.1 * ss)) {
    const cx = x + side * d
    const dot = (a: number, b: number) => {
      const cy = (lineYAt(t, a, cx) + lineYAt(t, b, cx)) / 2
      return inkBox(bin, cx - half, cy - half, cx + half, cy + half)
    }
    if (dot(1, 2) >= 0.6 && dot(2, 3) >= 0.6 && dot(0, 1) < 0.3 && dot(3, 4) < 0.3) return true
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
