// Staff detection on the clean page. Each vertical strip votes with a 5-line comb on the projection of
// thin vertical runs (noteheads, stems and beams do not contribute); the per-strip hits are then
// linked horizontally, which tolerates the residual curvature left by the dewarp and staves that do
// not span the page. All thresholds are relative to staffSpace / lineThickness.
import type { BinImage } from './image'

export interface StaffPoint {
  /** Strip centre. */
  x: number
  /** y of the 5 lines at this strip. */
  ys: number[]
  /** Local line-to-line distance. */
  space: number
  /** 0–1 mean line coverage. */
  coverage: number
}

export interface StaffTrack {
  points: StaffPoint[]
  xStart: number
  xEnd: number
  /** Median y of each line. */
  lineYs: number[]
  space: number
  confidence: number
}

/** Minimum fraction of a strip's columns that must show a thin run on a line. */
const MIN_COVERAGE = 0.3
const SPACE_RANGE = [0.6, 1.4] as const
const STRIP_SPACES = 5
const MIN_STRIPS = 5
/** Strips a track may skip (dense passages, a page crease) before it ends. */
const MAX_STRIP_GAP = 6
/** Columns of a real staff with ink on its lines (text rows and dither have far fewer). */
const MIN_CONTINUITY = 0.6
/** Column gap, in staff spaces, that ends a staff when walking outwards. */
const END_GAP_SPACES = 0.75

interface Hit {
  y: number
  space: number
  score: number
  ys: number[]
  coverage: number
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  if (n === 0) return 0
  return n % 2 ? s[n >> 1] : (s[(n >> 1) - 1] + s[n >> 1]) / 2
}

/** Coverage per row: columns of the strip with a thin vertical run centred around that row. */
function stripProjection(bin: BinImage, x0: number, x1: number, thinMax: number, radius: number, colStep: number): Float32Array {
  const { width: w, height: h, data } = bin
  const raw = new Float32Array(h)
  let cols = 0
  for (let x = x0; x < x1; x += colStep) {
    cols++
    let y = 0
    while (y < h) {
      while (y < h && !data[y * w + x]) y++
      const start = y
      while (y < h && data[y * w + x]) y++
      const len = y - start
      if (len > 0 && len <= thinMax) raw[(start + y - 1) >> 1]++
    }
  }
  const out = new Float32Array(h)
  if (cols === 0) return out
  let acc = 0
  for (let y = -radius; y < h; y++) {
    if (y + radius < h) acc += raw[y + radius]
    if (y - radius - 1 >= 0) acc -= raw[y - radius - 1]
    if (y >= 0) out[y] = acc / cols
  }
  return out
}

function stripHits(cover: Float32Array, ss: number): Hit[] {
  const h = cover.length
  const sMin = Math.max(3, ss * SPACE_RANGE[0])
  const sMax = ss * SPACE_RANGE[1]
  const sStep = Math.max(0.5, ss * 0.02)
  const best = new Map<number, Hit>()
  for (let y = 0; y < h; y++) {
    for (let s = sMin; s <= sMax; s += sStep) {
      const bottom = y + Math.round(4 * s)
      if (bottom >= h) break
      // Either the first or the second line must be present: a comb is anchored on a real line.
      if (cover[y] < MIN_COVERAGE && cover[y + Math.round(s)] < MIN_COVERAGE) continue
      let present = 0
      let sum = 0
      for (let l = 0; l < 5; l++) {
        const c = cover[y + Math.round(l * s)]
        if (c >= MIN_COVERAGE) present++
        sum += Math.min(1, c)
      }
      if (present < 4) continue
      let between = 0
      for (let l = 0; l < 4; l++) between += Math.min(1, cover[y + Math.round((l + 0.5) * s)])
      // Dither, hatching or text: as much ink between the lines as on them.
      if (between / 4 > 0.5 * (sum / 5)) continue
      const score = sum - 0.5 * between
      const prev = best.get(y)
      if (!prev || score > prev.score) best.set(y, { y, space: s, score, ys: [], coverage: sum / 5 })
    }
  }
  // Greedy non-overlap, best comb first.
  const hits: Hit[] = []
  for (const hit of [...best.values()].sort((a, b) => b.score - a.score)) {
    const a0 = hit.y - hit.space / 2
    const a1 = hit.y + 4.5 * hit.space
    if (hits.some((o) => a0 < o.y + 4.5 * o.space && o.y - o.space / 2 < a1)) continue
    hit.ys = refineLines(cover, hit.y, hit.space)
    hits.push(hit)
  }
  return hits
}

/** Sub-row position of each line: coverage centroid around its comb position. */
function refineLines(cover: Float32Array, y: number, s: number): number[] {
  const r = Math.max(1, Math.round(s / 5))
  const ys: number[] = []
  for (let l = 0; l < 5; l++) {
    const c = y + Math.round(l * s)
    let sum = 0
    let sw = 0
    for (let i = Math.max(0, c - r); i <= Math.min(cover.length - 1, c + r); i++) {
      const v = cover[i] * cover[i]
      sum += i * v
      sw += v
    }
    ys.push(sw > 0 ? sum / sw : c)
  }
  return ys
}

/** y of `line` at column x (piecewise linear between strips, flat beyond the ends). */
export function lineYAt(t: StaffTrack, line: number, x: number): number {
  const p = t.points
  if (x <= p[0].x) return p[0].ys[line]
  const last = p[p.length - 1]
  if (x >= last.x) return last.ys[line]
  let lo = 0
  let hi = p.length - 1
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1
    if (p[m].x <= x) lo = m
    else hi = m
  }
  const a = (x - p[lo].x) / (p[hi].x - p[lo].x)
  return p[lo].ys[line] + (p[hi].ys[line] - p[lo].ys[line]) * a
}

/** Removes strips whose comb jumped away from its neighbours (residual curvature stays). */
function dropOutliers(points: StaffPoint[]): StaffPoint[] {
  const space = median(points.map((p) => p.space))
  const kept = points.filter((p, i) => {
    const near = points.slice(Math.max(0, i - 2), i + 3).map((q) => q.ys[0])
    return Math.abs(p.ys[0] - median(near)) <= 0.6 * space
  })
  return kept.length >= MIN_STRIPS ? kept : points
}

function finishTrack(points: StaffPoint[]): StaffTrack {
  const kept = dropOutliers(points)
  const lineYs = [0, 1, 2, 3, 4].map((l) => median(kept.map((p) => p.ys[l])))
  return {
    points: kept,
    xStart: kept[0].x,
    xEnd: kept[kept.length - 1].x,
    lineYs,
    space: (lineYs[4] - lineYs[0]) / 4,
    confidence: 0,
  }
}

/** Walks outwards from the track ends while at least 3 of the 5 lines still have ink. */
function extendEnds(bin: BinImage, t: StaffTrack, ss: number, lt: number) {
  const { width: w, height: h, data } = bin
  const r = Math.max(1, Math.round(lt / 2))
  const staffy = (x: number) => {
    let hits = 0
    for (let l = 0; l < 5; l++) {
      const y = Math.round(lineYAt(t, l, x))
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy
        if (yy >= 0 && yy < h && data[yy * w + x]) {
          hits++
          break
        }
      }
    }
    return hits >= 3
  }
  const gap = Math.max(2, END_GAP_SPACES * ss)
  const walk = (from: number, dir: 1 | -1) => {
    let last = from
    for (let x = from; x >= 0 && x < w && Math.abs(x - last) <= gap; x += dir) if (staffy(x)) last = x
    return last
  }
  t.xStart = walk(Math.max(0, Math.min(w - 1, Math.round(t.xStart))), -1)
  t.xEnd = walk(Math.max(0, Math.min(w - 1, Math.round(t.xEnd))), 1)
}

/** Mean fraction of columns, over the 5 lines, with ink on the line. */
function lineContinuity(bin: BinImage, t: StaffTrack, lt: number): number {
  const { width: w, height: h, data } = bin
  const r = Math.max(1, Math.round(lt / 2))
  const x0 = Math.round(t.xStart)
  const x1 = Math.round(t.xEnd)
  let sum = 0
  for (let l = 0; l < 5; l++) {
    let hit = 0
    for (let x = x0; x <= x1; x++) {
      const y = Math.round(lineYAt(t, l, x))
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r); yy++) {
        if (data[yy * w + x]) {
          hit++
          break
        }
      }
    }
    sum += hit / Math.max(1, x1 - x0 + 1)
  }
  return sum / 5
}

export function detectStaves(bin: BinImage, ss: number, lt: number): StaffTrack[] {
  const { width: w } = bin
  const stripW = Math.max(16, Math.round(STRIP_SPACES * ss))
  const thinMax = Math.max(lt * 1.8 + 1, lt + 2)
  const radius = Math.max(1, Math.round(lt / 3))
  const colStep = Math.max(1, Math.floor(ss / 8))
  const nStrips = Math.max(1, Math.floor(w / stripW))
  const realW = w / nStrips

  interface Open {
    points: StaffPoint[]
    lastStrip: number
  }
  const open: Open[] = []
  const done: Open[] = []
  for (let i = 0; i < nStrips; i++) {
    const x0 = Math.round(i * realW)
    const x1 = Math.round((i + 1) * realW)
    const hits = stripHits(stripProjection(bin, x0, x1, thinMax, radius, colStep), ss)
    const used = new Set<Open>()
    // Link hits top to bottom to the closest compatible open track.
    for (const hit of hits.sort((a, b) => a.y - b.y)) {
      let bestT: Open | null = null
      let bestD = Infinity
      for (const t of open) {
        if (used.has(t)) continue
        const last = t.points[t.points.length - 1]
        const d = Math.abs(last.ys[0] - hit.ys[0])
        if (d < bestD && d <= 0.7 * hit.space && Math.abs(last.space - hit.space) <= 0.2 * hit.space) {
          bestD = d
          bestT = t
        }
      }
      const point: StaffPoint = { x: (x0 + x1) / 2, ys: hit.ys, space: hit.space, coverage: hit.coverage }
      if (bestT) {
        bestT.points.push(point)
        bestT.lastStrip = i
        used.add(bestT)
      } else {
        const t = { points: [point], lastStrip: i }
        open.push(t)
        used.add(t)
      }
    }
    for (let k = open.length - 1; k >= 0; k--) {
      if (i - open[k].lastStrip > MAX_STRIP_GAP) done.push(...open.splice(k, 1))
    }
  }
  done.push(...open)

  let tracks = done.filter((t) => t.points.length >= MIN_STRIPS).map((t) => finishTrack(t.points))
  tracks = mergeTracks(tracks)
  for (const t of tracks) extendEnds(bin, t, ss, lt)
  tracks = tracks.filter((t) => lineContinuity(bin, t, lt) >= MIN_CONTINUITY)
  for (const t of tracks) {
    const spanStrips = Math.max(1, Math.round((t.points[t.points.length - 1].x - t.points[0].x) / realW) + 1)
    const continuity = Math.min(1, t.points.length / spanStrips)
    const coverage = Math.min(1, median(t.points.map((p) => p.coverage)) / 0.7)
    t.confidence = continuity * coverage
  }
  // Short and doubtful: rows of text. A real short staff (ossia) has solid, continuous lines.
  const widest = Math.max(0, ...tracks.map((t) => t.xEnd - t.xStart))
  tracks = tracks.filter((t) => t.confidence >= 0.6 || t.xEnd - t.xStart >= 0.3 * widest)
  return tracks.sort((a, b) => a.lineYs[0] - b.lineYs[0])
}

/** Joins fragments of one staff (same row, interrupted by a gap) and drops overlapping duplicates. */
function mergeTracks(tracks: StaffTrack[]): StaffTrack[] {
  const sorted = [...tracks].sort((a, b) => b.points.length - a.points.length)
  const out: StaffTrack[] = []
  for (const t of sorted) {
    const mate = out.find((o) => {
      const x = (t.points[0].x + t.points[t.points.length - 1].x) / 2
      // Same row, or a comb overlapping the 5-line band of a longer staff: real staves never overlap.
      return Math.abs(lineYAt(o, 0, x) - lineYAt(t, 0, x)) <= 4.2 * o.space
    })
    if (!mate) {
      out.push(t)
      continue
    }
    const xMid = (t.points[0].x + t.points[t.points.length - 1].x) / 2
    if (Math.abs(lineYAt(mate, 0, xMid) - lineYAt(t, 0, xMid)) > 0.7 * mate.space) continue
    const a0 = mate.points[0].x
    const a1 = mate.points[mate.points.length - 1].x
    const extra = t.points.filter((p) => p.x < a0 || p.x > a1)
    if (extra.length === 0) continue
    const merged = finishTrack([...mate.points, ...extra].sort((p, q) => p.x - q.x))
    Object.assign(mate, merged)
  }
  return out
}
