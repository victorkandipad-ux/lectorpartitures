// Page structure from the clean page: staves → systems → measures. Geometry is in pixels of the clean
// page. Systems come from physical connectors (left bracket, barlines crossing the gap) or, failing
// that, from barlines aligned between neighbouring staves. A barline is confirmed by consensus among
// the staves of its system.
import type { Measure, PageStructure, Rect, Staff, System } from '../model/types'
import { barCandidates, classifyBarline, type BarCandidate, type BarGroup } from './barlines'
import { connectedComponents } from './denoise'
import type { BinImage } from './image'
import { detectStaves, lineYAt, type StaffTrack } from './staves'

export interface StructureResult {
  structure: PageStructure
  confidence: number
  needsReview: boolean
}

const REVIEW_BELOW = 0.6
/** Mean barline evidence of a system below which its measures are worth a look. */
const REVIEW_BARS_BELOW = 0.7
/** Evidence (sum of per-staff scores / staves) needed to confirm a barline. */
const SYSTEM_SUPPORT = 0.55
const SOLO_SUPPORT = 0.8
/** In staff spaces: room for clef and key before a first barline, and the narrowest plausible measure. */
const MIN_FIRST_MEASURE = 6
const MIN_MEASURE = 3
/** Beyond the outer line, in staff spaces: a barline ends on it, give or take the bleed of the ink. */
const CLEAN_END = 0.35
/** A weak stroke counts as a vote for a barline across staves from this score on. */
const AGREE_VOTE = 0.25
const AGREE_MIN_STAVES = 4
const AGREE_SHARE = 0.5
/** Largest barline slope considered (about 3 degrees), tried in this many steps per direction. */
const MAX_SHEAR = 0.05
const SHEAR_STEPS = 20
/** Strokes of adjacent staves this close, in staff spaces, line up. */
const SHEAR_MATCH = 0.4
/** Widest clef + key + time signature block. */
const MAX_HEADER = 14
const BORDER_SPACES = 1.5
/** Page-edge columns: within this fraction of the width from the border, inked over this fraction of the height. */
const EDGE_ZONE = 0.03
const EDGE_COVER = 0.5
/** Below this ink in its spaces a staff has no clef or notes: ruled, unused paper. */
const BLANK_STAFF_INK = 0.015
/** Between systems the gap must exceed every gap inside them by this factor to be used as a cue. */
const GAP_RATIO = 1.25

type ScoredCandidate = BarCandidate & { score: number }
type Evidence = 'crossing' | 'connector' | 'aligned' | null
/** Confidence penalty of a system that has no physical evidence joining its staves. */
const INFERRED_FACTOR = 0.7

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0)

/** A connected shape in the left margin (bracket, brace, system line) spanning the gap between staves. */
function leftConnector(bin: BinImage, a: StaffTrack, b: StaffTrack, ss: number, lt: number, edges: Uint8Array): boolean {
  const xRef = Math.max(a.xStart, b.xStart)
  const x0 = Math.max(0, Math.round(xRef - 4 * ss))
  const x1 = Math.min(bin.width - 1, Math.round(xRef + ss))
  const y0 = Math.max(0, Math.round(a.lineYs[0]))
  const y1 = Math.min(bin.height - 1, Math.round(b.lineYs[4]))
  const cw = x1 - x0 + 1
  const ch = y1 - y0 + 1
  if (cw <= 0 || ch <= 0) return false
  const data = new Uint8Array(cw * ch)
  for (let y = 0; y < ch; y++) data.set(bin.data.subarray((y + y0) * bin.width + x0, (y + y0) * bin.width + x0 + cw), y * cw)
  for (let x = 0; x < cw; x++) if (edges[x + x0]) for (let y = 0; y < ch; y++) data[y * cw + x] = 0
  const cc = connectedComponents({ width: cw, height: ch, data })
  const need0 = a.lineYs[4] - y0 + lt
  const need1 = b.lineYs[0] - y0 - lt
  for (let c = 0; c < cc.count; c++) if (cc.minY[c] <= need0 && cc.maxY[c] >= need1) return true
  return false
}

/**
 * Columns near the left/right image border with ink over a large part of the page height: what is left
 * of a page or table edge. They touch the staff lines, so the component cleanup cannot remove them.
 */
function edgeColumns(bin: BinImage): Uint8Array {
  const { width: w, height: h, data } = bin
  const mask = new Uint8Array(w)
  const zone = Math.round(EDGE_ZONE * w)
  const scan = (x: number) => {
    let ink = 0
    for (let y = 0; y < h; y++) ink += data[y * w + x]
    if (ink > EDGE_COVER * h) mask[x] = 1
  }
  for (let x = 0; x < zone; x++) scan(x)
  for (let x = w - zone; x < w; x++) scan(x)
  return mask
}

function nearEdgeColumn(mask: Uint8Array, x: number, tol: number): boolean {
  for (let i = Math.max(0, Math.round(x - tol)); i <= Math.min(mask.length - 1, Math.round(x + tol)); i++) if (mask[i]) return true
  return false
}

/** Ink of a staff's spaces (rows between the lines) as a fraction: clefs and rests count, lines do not. */
function spaceInk(bin: BinImage, t: StaffTrack, lt: number): number {
  const { width: w, data } = bin
  const margin = lt / 2 + 1
  const x0 = Math.round(t.xStart)
  const x1 = Math.round(t.xEnd)
  let ink = 0
  let n = 0
  for (let x = x0; x <= x1; x += 2) {
    for (let l = 0; l < 4; l++) {
      const a = Math.ceil(lineYAt(t, l, x) + margin)
      const b = Math.floor(lineYAt(t, l + 1, x) - margin)
      for (let y = a; y <= b; y++) {
        ink += data[y * w + x]
        n++
      }
    }
  }
  return n ? ink / n : 0
}

function pairEvidence(
  bin: BinImage,
  a: StaffTrack,
  b: StaffTrack,
  ca: BarCandidate[],
  cb: BarCandidate[],
  ss: number,
  lt: number,
  edges: Uint8Array,
): Evidence {
  // Staves that do not share a horizontal range cannot be in one system.
  const overlap = Math.min(a.xEnd, b.xEnd) - Math.max(a.xStart, b.xStart)
  if (overlap < 0.5 * Math.min(a.xEnd - a.xStart, b.xEnd - b.xStart)) return null
  const gap = b.lineYs[0] - a.lineYs[4]
  const reach = gap - 0.75 * ss
  const tol = 0.8 * ss
  for (const p of ca) {
    if (p.hasHead || p.cover < 0.95 || p.extDown < reach) continue
    if (cb.some((q) => !q.hasHead && q.cover >= 0.95 && Math.abs(q.x - p.x) <= tol)) return 'crossing'
  }
  if (leftConnector(bin, a, b, ss, lt, edges)) return 'connector'
  // Disconnected but aligned barlines (voice over piano), only for close staves.
  const clean = (c: BarCandidate) => !c.hasHead && c.cover >= 0.95 && c.extUp <= 1.2 * ss && c.extDown <= 1.2 * ss
  const pa = ca.filter(clean)
  const pb = cb.filter(clean)
  const most = Math.max(pa.length, pb.length)
  if (most < 2 || gap > 12 * ss) return null
  const aligned = pa.filter((p) => pb.some((q) => Math.abs(q.x - p.x) <= tol)).length
  return aligned >= 2 && aligned >= 0.6 * most ? 'aligned' : null
}

/**
 * Last resort when no staves are physically joined: a repeating pattern of gaps, the gap between
 * systems being clearly the largest one. `gaps[i]` separates staff i and i + 1.
 */
function periodicGroups(gaps: number[]): number[][] | null {
  const n = gaps.length + 1
  for (let p = 2; p * 2 <= n; p++) {
    if (n % p !== 0) continue
    const between = gaps.filter((_, i) => (i + 1) % p === 0)
    const within = gaps.filter((_, i) => (i + 1) % p !== 0)
    if (Math.min(...between) < GAP_RATIO * Math.max(...within)) continue
    return Array.from({ length: n / p }, (_, k) => Array.from({ length: p }, (_, j) => k * p + j))
  }
  return null
}

/**
 * Most engravings repeat one system layout on a page. When the layout of the majority of the staves
 * is clear, it fixes the two typical mistakes: a system split for lack of a connector, and two systems
 * joined by something that is not a barline (a margin rule, chance alignment). Returns the groups and
 * the ones that only exist because of this rule.
 */
function regularize(groups: number[][], links: Evidence[], gaps: number[]): { groups: number[][]; inferred: Set<number[]> } {
  const inferred = new Set<number[]>()
  const total = groups.reduce((n, g) => n + g.length, 0)
  const bySize = new Map<number, number>()
  for (const g of groups) bySize.set(g.length, (bySize.get(g.length) ?? 0) + g.length)
  let size = 0
  let share = 0
  // On a tie, the size seen more often (the smaller one).
  for (const [k, v] of bySize) {
    if (v > share || (v === share && k < size)) {
      size = k
      share = v
    }
  }
  if (share * 2 < total) return { groups, inferred }
  if (size === 1) {
    const periodic = periodicGroups(gaps)
    if (periodic) {
      for (const g of periodic) inferred.add(g)
      return { groups: periodic, inferred }
    }
  }
  const out: number[][] = []
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    if (g.length < size) {
      // Merge consecutive fragments that add up exactly to the page layout.
      const merged = [...g]
      let j = i
      while (merged.length < size && j + 1 < groups.length && groups[j + 1].length < size) merged.push(...groups[++j])
      if (merged.length === size) {
        out.push(merged)
        inferred.add(merged)
        i = j
        continue
      }
      out.push(g)
    } else if (g.length > size && g.length % size === 0) {
      // Split a block unless a barline really crosses the gap between the would-be systems.
      const cuts: number[] = []
      for (let k = size; k < g.length; k += size) if (links[g[k]] !== 'crossing') cuts.push(k)
      let from = 0
      for (const c of [...cuts, g.length]) {
        out.push(g.slice(from, c))
        from = c
      }
    } else out.push(g)
  }
  return { groups: out, inferred }
}

/** Strokes that end exactly on the outer lines or span to the neighbouring staff. */
function cleanEnds(c: BarCandidate, gapUp: number, gapDown: number, ss: number): boolean {
  const ok = (ext: number, gap: number) => ext <= CLEAN_END * ss || (gap > 0 && ext >= gap - 0.75 * ss)
  return ok(c.extUp, gapUp) && ok(c.extDown, gapDown)
}

/**
 * Barlines of a page are ruled with one pen: the width of its unmistakable strokes tells them apart from
 * stems, which are usually thinner. Returns 0 when the page has too few of them to tell.
 */
function typicalBarWidth(cands: BarCandidate[][], gaps: { up: number; down: number }[], ss: number): number {
  const widths: number[] = []
  cands.forEach((list, i) => {
    for (const c of list) if (c.cover >= 0.97 && c.uniform && !c.hasHead && cleanEnds(c, gaps[i].up, gaps[i].down, ss)) widths.push(c.width)
  })
  if (widths.length < 3) return 0
  widths.sort((x, y) => x - y)
  return widths[widths.length >> 1]
}

/**
 * How much a candidate looks like a barline in its staff (0–1). Nothing is rejected outright: a real
 * barline can touch a dynamic or lose a few rows, and the system's consensus decides.
 */
function barScore(c: BarCandidate, gapUp: number, gapDown: number, typical: number, ss: number): number {
  const margin = Math.max(1.5, 0.25 * typical)
  const widthOk = typical === 0 || c.width >= typical - margin
  if (!c.hasHead && c.cover >= 0.95 && c.uniform && widthOk && cleanEnds(c, gapUp, gapDown, ss)) return 1
  const spans = (ext: number, gap: number) => gap > 0 && ext >= gap - 0.75 * ss
  if (c.hasHead) {
    if (spans(c.extUp, gapUp) || spans(c.extDown, gapDown)) return 0.7
    // A stroke of the barline's width heading for the neighbour: a barline broken in the gap.
    const heads = (ext: number, gap: number) => gap > 0 && ext >= ss
    return widthOk && c.cover >= 0.97 && (heads(c.extUp, gapUp) || heads(c.extDown, gapDown)) ? 0.5 : 0.2
  }
  const free = 1.2 * ss
  const overshoot = (ext: number, gap: number) => ext > free && !spans(ext, gap)
  const shape = overshoot(c.extUp, gapUp) || overshoot(c.extDown, gapDown) ? 0.6 : 1
  const fill = c.cover >= 0.95 ? 1 : c.cover >= 0.85 ? 0.6 : 0.3
  // Clefs and time signatures cross the whole staff too, but with a varying width.
  const ruled = c.uniform ? 1 : 0.5
  const pen = widthOk ? 1 : 0.6
  return shape * fill * ruled * pen
}

interface ConfirmedBar {
  x: number
  width: number
  support: number
  /** Most of its votes are uniform strokes. */
  ruled: boolean
}

/**
 * Horizontal drift of the barlines per row: hand-ruled scores and residual rotation slant the whole system,
 * and over many staves that exceeds the clustering tolerance. The slope that best lines up the barline-like
 * strokes of adjacent staves wins; zero unless another one is clearly better.
 */
function systemShear(cands: ScoredCandidate[][], tracks: StaffTrack[], ss: number): number {
  if (cands.length < 2) return 0
  const strong = cands.map((list) => list.filter((c) => c.score >= 0.5).map((c) => c.x).sort((a, b) => a - b))
  const matches = (slope: number) => {
    let n = 0
    for (let i = 1; i < strong.length; i++) {
      const dx = slope * (tracks[i].lineYs[0] - tracks[i - 1].lineYs[0])
      let k = 0
      for (const x of strong[i - 1]) {
        while (k < strong[i].length && strong[i][k] - dx < x - SHEAR_MATCH * ss) k++
        if (k < strong[i].length && strong[i][k] - dx <= x + SHEAR_MATCH * ss) n++
      }
    }
    return n
  }
  const base = matches(0)
  let best = 0
  let bestN = base
  for (let k = -SHEAR_STEPS; k <= SHEAR_STEPS; k++) {
    const slope = (k * MAX_SHEAR) / SHEAR_STEPS
    const n = matches(slope)
    if (n > bestN) {
      bestN = n
      best = slope
    }
  }
  return bestN >= 1.25 * base + 2 ? best : 0
}

/** Clusters the staves' scored candidates by x and keeps those with enough total evidence. */
function consensusBars(cands: ScoredCandidate[][], tracks: StaffTrack[], ss: number): ConfirmedBar[] {
  const shear = systemShear(cands, tracks, ss)
  const refY = tracks[0].lineYs[0]
  const aligned = (c: ScoredCandidate, staff: number) => c.x - shear * (tracks[staff].lineYs[0] - refY)
  const all = cands
    .flatMap((list, i) => list.map((c) => ({ c, staff: i, ax: aligned(c, i) })))
    .sort((a, b) => a.ax - b.ax)
  // The strokes of one thick double barline can each survive in a different staff.
  const tol = (a: ScoredCandidate, b: ScoredCandidate) => 0.8 * ss + (a.width + b.width) / 4
  const out: ConfirmedBar[] = []
  let i = 0
  while (i < all.length) {
    let j = i + 1
    while (j < all.length && all[j].ax - all[j - 1].ax <= tol(all[j].c, all[j - 1].c)) j++
    const group = all.slice(i, j)
    i = j
    // Best vote per staff. Staves the x falls outside of (indented, shorter) do not vote.
    const best = new Map<number, number>()
    for (const g of group) best.set(g.staff, Math.max(best.get(g.staff) ?? 0, g.c.score))
    const voters = group.filter((g) => g.c.score >= 0.5)
    const x = mean((voters.length ? voters : group).map((g) => g.c.x))
    const eligible = Math.max(1, tracks.filter((t) => x >= t.xStart - ss && x <= t.xEnd + ss).length)
    const support = [...best.values()].reduce((a, b) => a + b, 0) / eligible
    // Rough strokes (a manuscript) lined up across many staves: stems don't do that without a head.
    const agreeing = [...best.values()].filter((v) => v >= AGREE_VOTE).length
    const unanimous = agreeing >= AGREE_MIN_STAVES && agreeing >= AGREE_SHARE * eligible
    if (support < (eligible === 1 ? SOLO_SUPPORT : SYSTEM_SUPPORT) && !unanimous) continue
    // Two strokes in one staff within the cluster: a double or final barline, keep them apart.
    const strokes = new Map<number, ScoredCandidate[]>()
    for (const g of group) if (g.c.score >= 0.5) strokes.set(g.staff, [...(strokes.get(g.staff) ?? []), g.c])
    const lists = [...strokes.values()]
    const pair = lists.find((l) => l.filter((c) => c.score >= 0.8).length >= 2)?.filter((c) => c.score >= 0.8)
    if (pair) {
      for (const c of pair) out.push({ x: c.x, width: c.width, support, ruled: c.uniform })
      continue
    }
    const widths = lists.flat().map((c) => c.width)
    const ruled = group.filter((g) => g.c.uniform).length * 2 > group.length
    out.push({ x, width: widths.length ? mean(widths) : mean(group.map((g) => g.c.width)), support, ruled })
  }
  return out
}

/** Drops strokes much wider than the system's typical barline, unless they close it (clefs, time signatures). */
function dropWide(bars: ConfirmedBar[], xStart: number, xEnd: number, ss: number): ConfirmedBar[] {
  if (bars.length < 2) return bars
  const typical = [...bars].sort((a, b) => a.width - b.width)[bars.length >> 1].width
  return bars.filter((b, i) => {
    // A wide stroke is a thick barline in the middle of a system, but a clef or digit in its header.
    const inHeader = b.x - xStart <= MAX_HEADER * ss
    if (b.width <= (inHeader ? 1.4 : 1.8) * typical || (b.ruled && !inHeader)) return true
    const partner = bars[i - 1] && b.x - bars[i - 1].x <= 1.5 * ss
    return partner || xEnd - b.x <= 2 * ss
  })
}

function buildMeasures(
  bin: BinImage,
  tracks: StaffTrack[],
  bars: ConfirmedBar[],
  ss: number,
  sysId: string,
): Measure[] {
  const xStart = Math.min(...tracks.map((t) => t.xStart))
  const xEnd = Math.max(...tracks.map((t) => t.xEnd))
  // Strokes close together are one barline (double, final, repeat).
  const groups: (BarGroup & { support: number })[] = []
  for (const b of bars) {
    const half = b.width / 2
    const last = groups[groups.length - 1]
    if (last && b.x - half - last.x1 <= 1.5 * ss) {
      last.x1 = b.x + half
      last.strokes.push({ x: b.x, width: b.width })
      last.support = Math.max(last.support, b.support)
    } else {
      groups.push({ x0: b.x - half, x1: b.x + half, strokes: [{ x: b.x, width: b.width }], support: b.support })
    }
  }
  const measures: Measure[] = []
  let start = xStart
  for (const g of groups) {
    // Near the start of the system: the opening line, or a clef / key / time signature.
    if (measures.length === 0 && g.x0 - start < MIN_FIRST_MEASURE * ss) {
      if (g.x0 - start < 2 * ss) start = Math.max(start, g.x1)
      continue
    }
    if (g.x0 - start < MIN_MEASURE * ss) continue
    const barline = classifyBarline(bin, tracks, g, ss)
    // A start repeat right after clef and key opens the first measure: there is no music before it.
    if (measures.length === 0 && barline === 'repeat-r' && g.x0 - start < MAX_HEADER * ss) {
      start = (g.x0 + g.x1) / 2
      continue
    }
    measures.push({
      id: `${sysId}m${measures.length}`,
      xStart: start,
      xEnd: (g.x0 + g.x1) / 2,
      barline,
      confidence: clamp01(g.support),
    })
    start = (g.x0 + g.x1) / 2
  }
  // What remains after the last barline is an open measure, unless it is only a courtesy clef/key.
  const rest = xEnd - start
  if (measures.length === 0) {
    measures.push({ id: `${sysId}m0`, xStart: start, xEnd, barline: 'single', confidence: 0.3 })
  } else if (rest >= 6 * ss) {
    measures.push({ id: `${sysId}m${measures.length}`, xStart: start, xEnd, barline: 'single', confidence: 0.6 })
  } else {
    measures[measures.length - 1].xEnd = Math.max(measures[measures.length - 1].xEnd, xEnd)
  }
  return measures
}

/** Row with the least ink between two rows (preferring the middle), over a horizontal range. */
function valleyRow(bin: BinImage, y0: number, y1: number, x0: number, x1: number): number {
  const { width: w, data } = bin
  let best = Math.round((y0 + y1) / 2)
  let bestCost = Infinity
  const mid = (y0 + y1) / 2
  const half = Math.max(1, (y1 - y0) / 2)
  for (let y = Math.round(y0); y <= y1; y++) {
    let ink = 0
    for (let x = x0; x <= x1; x++) ink += data[y * w + x]
    const cost = ink + (x1 - x0 + 1) * 0.02 * (Math.abs(y - mid) / half)
    if (cost < bestCost) {
      bestCost = cost
      best = y
    }
  }
  return best
}

/** Walks away from the staff until a blank band `blank` rows tall (or `max` rows). */
function outerRow(bin: BinImage, from: number, dir: 1 | -1, x0: number, x1: number, blank: number, max: number): number {
  const { width: w, height: h, data } = bin
  let last = from
  for (let y = from, n = 0; y >= 0 && y < h && n < max && Math.abs(y - last) <= blank; y += dir, n++) {
    for (let x = x0; x <= x1; x++) {
      if (data[y * w + x]) {
        last = y
        break
      }
    }
  }
  return last
}

/** Includes the brace or bracket: ink columns left of the staff start, without a blank gap. */
function leftEdge(bin: BinImage, tracks: StaffTrack[], ss: number): number {
  const { width: w, data } = bin
  const y0 = Math.max(0, Math.round(tracks[0].lineYs[0]))
  const y1 = Math.min(bin.height - 1, Math.round(tracks[tracks.length - 1].lineYs[4]))
  const xStart = Math.min(...tracks.map((t) => t.xStart))
  const limit = Math.max(0, Math.round(xStart - 3 * ss))
  const gap = Math.max(1, Math.round(0.3 * ss))
  let last = Math.round(xStart)
  for (let x = Math.round(xStart) - 1; x >= limit && last - x <= gap; x--) {
    for (let y = y0; y <= y1; y++) {
      if (data[y * w + x]) {
        last = x
        break
      }
    }
  }
  return last
}

export function detectStructure(bin: BinImage, staffSpace: number, lineThickness: number): StructureResult {
  const ss = staffSpace
  const lt = lineThickness
  const tracks = detectStaves(bin, ss, lt)
  const empty: StructureResult = {
    structure: { staffSpace: ss, lineThickness: lt, systems: [] },
    confidence: 0,
    needsReview: true,
  }
  if (tracks.length === 0) return empty

  // Candidates per staff. Extensions are measured up to the farthest neighbour gap.
  const gaps = tracks.map((t, i) => {
    const up = i > 0 ? t.lineYs[0] - tracks[i - 1].lineYs[4] : 0
    const down = i + 1 < tracks.length ? tracks[i + 1].lineYs[0] - t.lineYs[4] : 0
    return { up, down }
  })
  const raw = tracks.map((t, i) => barCandidates(bin, t, ss, lt, Math.ceil(Math.max(gaps[i].up, gaps[i].down, 2 * ss) + ss)))
  // A stroke against the image border is a page edge left by the crop, never a barline.
  const margin = BORDER_SPACES * ss
  const edges = edgeColumns(bin)
  const typical = typicalBarWidth(raw, gaps, ss)
  const cands: ScoredCandidate[][] = raw.map((list, i) =>
    list
      .filter((c) => c.x >= margin && c.x <= bin.width - 1 - margin && !nearEdgeColumn(edges, c.x, 0.5 * ss))
      .map((c) => ({ ...c, score: barScore(c, gaps[i].up, gaps[i].down, typical, ss) })),
  )

  // Group consecutive staves.
  // links[i] = what joins staff i to the staff above it.
  const links: Evidence[] = [null]
  const initial: number[][] = [[0]]
  for (let i = 1; i < tracks.length; i++) {
    links[i] = pairEvidence(bin, tracks[i - 1], tracks[i], cands[i - 1], cands[i], ss, lt, edges)
    if (links[i]) initial[initial.length - 1].push(i)
    else initial.push([i])
  }
  const staffGaps = tracks.slice(1).map((t, i) => t.lineYs[0] - tracks[i].lineYs[4])
  const reg = regularize(initial, links, staffGaps)
  const inferred = reg.inferred
  // Ruled, unused paper: a lone staff with neither music nor a convincing barline.
  const hasBars = (i: number) => cands[i].some((c) => c.score >= 0.8)
  const unused = (i: number) => !hasBars(i) && spaceInk(bin, tracks[i], lt) < BLANK_STAFF_INK
  const groups = reg.groups
    .map((g) => {
      // At the ends of a system too: nothing connects a blank staff but its proximity.
      let a = 0
      let b = g.length
      while (a < b && unused(g[a])) a++
      while (b > a && unused(g[b - 1])) b--
      return g.slice(a, b)
    })
    .filter((g) => g.length > 0)
  if (groups.length === 0) return empty

  const systems: System[] = groups.map((idx, n) => {
    const ts = idx.map((i) => tracks[i])
    const id = `s${n}`
    const xEnd = Math.max(...ts.map((t) => t.xEnd))
    const xStart = Math.min(...ts.map((t) => t.xStart))
    const bars = dropWide(consensusBars(idx.map((i) => cands[i]), ts, ss), xStart, xEnd, ss)
    const measures = buildMeasures(bin, ts, bars, ss, id)
    const staves: Staff[] = ts.map((t) => ({ lineYs: t.lineYs, confidence: t.confidence }))
    return { id, bbox: { x: 0, y: 0, w: 0, h: 0 }, confidence: 0, staves, measures }
  })

  // Boxes: systems share the valley row between them; the outer ones stop at a blank band.
  systems.forEach((s, n) => {
    const ts = groups[n].map((i) => tracks[i])
    const xLeft = leftEdge(bin, ts, ss)
    const xRight = Math.max(...ts.map((t) => t.xEnd))
    const top = lineYTop(ts)
    const bottom = lineYBottom(ts)
    let y0: number
    let y1: number
    if (n > 0) {
      const prev = groups[n - 1].map((i) => tracks[i])
      y0 = valleyRow(bin, lineYBottom(prev) + lt, top - lt, xLeft, Math.round(xRight))
    } else y0 = outerRow(bin, Math.round(top), -1, xLeft, Math.round(xRight), Math.round(1.5 * ss), Math.round(10 * ss))
    if (n + 1 < systems.length) {
      const next = groups[n + 1].map((i) => tracks[i])
      y1 = valleyRow(bin, bottom + lt, lineYTop(next) - lt, xLeft, Math.round(xRight))
    } else y1 = outerRow(bin, Math.round(bottom), 1, xLeft, Math.round(xRight), Math.round(1.5 * ss), Math.round(10 * ss))
    const bbox: Rect = { x: xLeft, y: y0, w: xRight - xLeft + 1, h: y1 - y0 + 1 }
    s.bbox = bbox
    const staffConf = mean(s.staves.map((t) => t.confidence))
    const barConf = mean(s.measures.map((m) => m.confidence))
    s.confidence = clamp01(0.5 * staffConf + 0.5 * barConf) * (inferred.has(groups[n]) ? INFERRED_FACTOR : 1)
  })

  const confidence = mean(systems.map((s) => s.confidence))
  return {
    structure: { staffSpace: ss, lineThickness: lt, systems },
    confidence,
    needsReview:
      confidence < REVIEW_BELOW ||
      systems.some((s) => s.confidence < 0.4 || mean(s.measures.map((m) => m.confidence)) < REVIEW_BARS_BELOW),
  }
}

const lineYTop = (ts: StaffTrack[]) => Math.min(...ts.map((t) => lineYAt(t, 0, (t.xStart + t.xEnd) / 2)))
const lineYBottom = (ts: StaffTrack[]) => Math.max(...ts.map((t) => lineYAt(t, 4, (t.xStart + t.xEnd) / 2)))
