// Connected-component cleanup on run-length encoding (memory ∝ number of runs, not pixels).
// Removes specks smaller than a staccato dot and solid dark blobs touching the page border
// (page edges, binding shadows, fingers). Thresholds are relative to the staff metrics.
import type { BinImage } from './image'

export interface Components {
  /** Per run: row, start (inclusive), end (exclusive), component label. */
  row: Int32Array
  start: Int32Array
  end: Int32Array
  label: Int32Array
  nRuns: number
  /** Per component (0..count-1): area and bounding box. */
  count: number
  area: Int32Array
  minX: Int32Array
  maxX: Int32Array
  minY: Int32Array
  maxY: Int32Array
}

export function connectedComponents(bin: BinImage): Components {
  const { width: w, height: h, data } = bin
  let cap = 1 << 16
  let row = new Int32Array(cap)
  let start = new Int32Array(cap)
  let end = new Int32Array(cap)
  let parent = new Int32Array(cap)
  let n = 0
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  let prevA = 0
  let prevB = 0
  for (let y = 0; y < h; y++) {
    const curA = n
    const base = y * w
    let x = 0
    while (x < w) {
      while (x < w && !data[base + x]) x++
      if (x >= w) break
      const s = x
      while (x < w && data[base + x]) x++
      if (n === cap) {
        cap *= 2
        const grow = (a: Int32Array) => {
          const b = new Int32Array(cap)
          b.set(a)
          return b
        }
        row = grow(row)
        start = grow(start)
        end = grow(end)
        parent = grow(parent)
      }
      row[n] = y
      start[n] = s
      end[n] = x
      parent[n] = n
      n++
    }
    // 8-connectivity: runs touch if [s-1, e+1) overlaps a previous-row run.
    let p = prevA
    for (let r = curA; r < n; r++) {
      while (p < prevB && end[p] < start[r]) p++
      for (let q = p; q < prevB && start[q] <= end[r]; q++) {
        const a = find(r)
        const b = find(q)
        if (a !== b) parent[a < b ? b : a] = a < b ? a : b
      }
    }
    prevA = curA
    prevB = n
  }
  const label = new Int32Array(n)
  const remap = new Int32Array(n).fill(-1)
  let count = 0
  for (let r = 0; r < n; r++) {
    const root = find(r)
    if (remap[root] < 0) remap[root] = count++
    label[r] = remap[root]
  }
  const area = new Int32Array(count)
  const minX = new Int32Array(count).fill(w)
  const maxX = new Int32Array(count).fill(-1)
  const minY = new Int32Array(count).fill(h)
  const maxY = new Int32Array(count).fill(-1)
  for (let r = 0; r < n; r++) {
    const c = label[r]
    area[c] += end[r] - start[r]
    if (start[r] < minX[c]) minX[c] = start[r]
    if (end[r] - 1 > maxX[c]) maxX[c] = end[r] - 1
    if (row[r] < minY[c]) minY[c] = row[r]
    if (row[r] > maxY[c]) maxY[c] = row[r]
  }
  return { row, start, end, label, nRuns: n, count, area, minX, maxX, minY, maxY }
}

export interface DenoiseStats {
  components: number
  specks: number
  /** Solid dark areas: page edges, binding shadows, fingers, stains. */
  borderBlobs: number
  /** Long isolated hairlines: page borders and folds (staff lines and barlines stay connected to the staff). */
  edgeLines: number
}

export function denoise(bin: BinImage, staffSpace: number, lineThickness: number): DenoiseStats {
  const { width: w, height: h, data } = bin
  const cc = connectedComponents(bin)
  const remove = new Uint8Array(cc.count)
  const speckArea = Math.max(2, 0.02 * staffSpace * staffSpace)
  const speckSize = Math.max(2, 0.25 * staffSpace)
  const thick = 2 * lineThickness + 1
  let specks = 0
  let borderBlobs = 0
  let edgeLines = 0
  for (let c = 0; c < cc.count; c++) {
    const bw = cc.maxX[c] - cc.minX[c] + 1
    const bh = cc.maxY[c] - cc.minY[c] + 1
    const a = cc.area[c]
    if (a < speckArea && Math.max(bw, bh) < speckSize) {
      remove[c] = 1
      specks++
      continue
    }
    const touches = cc.minX[c] === 0 || cc.minY[c] === 0 || cc.maxX[c] === w - 1 || cc.maxY[c] === h - 1
    const fill = a / (bw * bh)
    const huge = a > 0.2 * w * h
    // No music symbol is a solid area thicker than ~1.5 staff spaces in both directions.
    const solid = fill > 0.6 && Math.min(bw, bh) > 1.5 * staffSpace && a > 4 * staffSpace * staffSpace
    if ((touches && fill > 0.5 && Math.min(bw, bh) > thick && a > staffSpace * staffSpace) || (huge && fill > 0.5) || solid) {
      remove[c] = 1
      borderBlobs++
      continue
    }
    // Only near the page border, so that an isolated staff line is never mistaken for one.
    const vertical = bh > bw
    const long = vertical ? bh : bw
    const nearEdge = vertical
      ? cc.minX[c] < 0.08 * w || cc.maxX[c] > 0.92 * w
      : cc.minY[c] < 0.08 * h || cc.maxY[c] > 0.92 * h
    if (nearEdge && long > 0.4 * (vertical ? h : w) && Math.min(bw, bh) < 1.5 * staffSpace && fill > 0.3 && long / Math.min(bw, bh) > 20) {
      remove[c] = 1
      edgeLines++
    }
  }
  for (let r = 0; r < cc.nRuns; r++) {
    if (!remove[cc.label[r]]) continue
    const o = cc.row[r] * w
    data.fill(0, o + cc.start[r], o + cc.end[r])
  }
  return { components: cc.count, specks, borderBlobs, edgeLines }
}
