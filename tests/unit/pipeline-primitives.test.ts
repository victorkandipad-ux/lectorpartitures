import { unzlibSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { encodePng1bit, packRows, readPng } from '../../src/export/png1bit'
import { denoise } from '../../src/pipeline/denoise'
import { estimateDewarp } from '../../src/pipeline/dewarp'
import { applyHomography, fullQuad, remapComposite, squareToQuad } from '../../src/pipeline/geometry'
import { grayImage, otsu, resizeArea, type BinImage } from '../../src/pipeline/image'
import { staffMetrics } from '../../src/pipeline/runlength'
import { integrals, sauvola, threshold } from '../../src/pipeline/sauvola'
import { estimateSkew } from '../../src/pipeline/skew'
import type { Quad } from '../../src/model/types'
import { rng, synthScore } from '../support/synth'

function randomGray(w: number, h: number, seed = 1) {
  const r = rng(seed)
  const img = grayImage(w, h)
  for (let i = 0; i < img.data.length; i++) img.data[i] = Math.floor(r() * 256)
  return img
}

const inkCount = (b: BinImage) => b.data.reduce((s, v) => s + v, 0)

describe('integral images', () => {
  it('match direct sums over arbitrary windows (also for a band)', () => {
    const img = randomGray(37, 29)
    const y0 = 5
    const { sum, sq, stride } = integrals(img, y0, 25)
    const r = rng(7)
    for (let n = 0; n < 50; n++) {
      const xa = Math.floor(r() * 30)
      const xb = xa + 1 + Math.floor(r() * (37 - xa - 1))
      const ya = y0 + Math.floor(r() * 10)
      const yb = ya + 1 + Math.floor(r() * (25 - ya - 1))
      let s = 0
      let q = 0
      for (let y = ya; y < yb; y++)
        for (let x = xa; x < xb; x++) {
          const v = img.data[y * 37 + x]
          s += v
          q += v * v
        }
      const A = (ya - y0) * stride
      const B = (yb - y0) * stride
      expect(sum[B + xb] - sum[A + xb] - sum[B + xa] + sum[A + xa]).toBe(s)
      expect(sq[B + xb] - sq[A + xb] - sq[B + xa] + sq[A + xa]).toBe(q)
    }
  })
})

describe('sauvola', () => {
  it('matches a brute-force reference, across band boundaries', () => {
    const img = randomGray(41, 50, 3)
    const window = 9
    const k = 0.3
    const out = sauvola(img, { window, k, band: 7 })
    const r = window >> 1
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        let s = 0
        let q = 0
        let n = 0
        for (let yy = Math.max(0, y - r); yy <= Math.min(img.height - 1, y + r); yy++)
          for (let xx = Math.max(0, x - r); xx <= Math.min(img.width - 1, x + r); xx++) {
            const v = img.data[yy * img.width + xx]
            s += v
            q += v * v
            n++
          }
        const m = s / n
        const sd = Math.sqrt(Math.max(0, q / n - m * m))
        const t = m * (1 + k * (sd / 128 - 1))
        expect(out.data[y * img.width + x]).toBe(img.data[y * img.width + x] <= t ? 1 : 0)
      }
  })

  it('keeps large solid areas filled thanks to the dark floor', () => {
    const img = grayImage(60, 60, 240)
    for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) img.data[y * 60 + x] = 20
    const hollow = sauvola(img, { window: 15, k: 0.2 })
    const filled = sauvola(img, { window: 15, k: 0.2, darkFloor: 80 })
    expect(hollow.data[30 * 60 + 30]).toBe(0)
    expect(filled.data[30 * 60 + 30]).toBe(1)
  })
})

describe('staff metrics', () => {
  it('measures staff space and line thickness', () => {
    const g = synthScore({ width: 800, height: 600, staffSpace: 18, lineThickness: 3, staves: [80, 260, 440] })
    const m = staffMetrics(threshold(g, 128))!
    expect(Math.abs(m.staffSpace - 18)).toBeLessThan(0.6)
    expect(Math.abs(m.lineThickness - 3)).toBeLessThan(0.6)
    expect(m.confidence).toBeGreaterThan(0.3)
  })
  it('returns null on a blank page', () => {
    expect(staffMetrics(threshold(grayImage(100, 100, 255), 128))).toBeNull()
  })
})

describe('skew', () => {
  it.each([-12, -3.5, 0, 2, 7.25])('estimates %f degrees', (angle) => {
    const g = synthScore({ width: 1000, height: 800, staffSpace: 16, lineThickness: 2, staves: [150, 350, 550], angleDeg: angle })
    const s = estimateSkew(threshold(g, 128))
    expect(Math.abs(s.angleDeg - angle)).toBeLessThan(0.15)
  })
})

describe('geometry', () => {
  it('square→quad maps the unit square corners', () => {
    const q: Quad = [
      { x: 10, y: 20 },
      { x: 300, y: 5 },
      { x: 320, y: 400 },
      { x: -5, y: 380 },
    ]
    const H = squareToQuad(q)
    const corners = [applyHomography(H, 0, 0), applyHomography(H, 1, 0), applyHomography(H, 1, 1), applyHomography(H, 0, 1)]
    corners.forEach((c, i) => {
      expect(c.x).toBeCloseTo(q[i].x, 6)
      expect(c.y).toBeCloseTo(q[i].y, 6)
    })
  })

  it('identity chain reproduces the image', () => {
    const g = randomGray(64, 48, 9)
    const out = remapComposite(g, { quad: fullQuad(64, 48), refW: 64, refH: 48, angleDeg: 0, dewarp: null }, 64, 48)
    let maxDiff = 0
    for (let i = 0; i < g.data.length; i++) maxDiff = Math.max(maxDiff, Math.abs(g.data[i] - out.data[i]))
    expect(maxDiff).toBeLessThanOrEqual(1)
  })

  it('area resize averages blocks', () => {
    const g = grayImage(4, 2)
    g.data.set([0, 100, 200, 255, 50, 150, 0, 0])
    expect(Array.from(resizeArea(g, 2, 1).data)).toEqual([75, 114])
  })
})

describe('dewarp', () => {
  const ss = 16
  const curve = (x: number) => 25 * ((x - 500) / 500) ** 2
  const opts = { width: 1000, height: 800, staffSpace: ss, lineThickness: 2, staves: [150, 350, 550], curve }

  /** Rows where a line covers most of the width (a curved line covers only a short span). */
  const straightRows = (b: BinImage) => {
    let rows = 0
    for (let y = 0; y < b.height; y++) {
      let c = 0
      for (let x = 100; x < 900; x++) c += b.data[y * b.width + x]
      if (c > 500) rows++
    }
    return rows
  }

  it('measures the curvature and straightens the lines', () => {
    const g = synthScore(opts)
    const bin = threshold(g, 128)
    const f = estimateDewarp(bin, ss, 2)
    expect(f).not.toBeNull()
    expect(f!.maxAbs).toBeGreaterThan(15)
    expect(f!.maxAbs).toBeLessThan(35)
    const out = remapComposite(g, { quad: fullQuad(1000, 800), refW: 1000, refH: 800, angleDeg: 0, dewarp: f }, 1000, 800)
    expect(straightRows(bin)).toBe(0)
    // Every one of the 3 × 5 lines is straight again (sub-pixel residuals may split it over 2 rows).
    expect(straightRows(threshold(out, 128))).toBeGreaterThanOrEqual(15)
  })

  it('returns null for straight pages', () => {
    const bin = threshold(synthScore({ ...opts, curve: undefined }), 128)
    expect(estimateDewarp(bin, ss, 2)).toBeNull()
  })
})

describe('denoise', () => {
  it('removes specks and border blobs but keeps staff lines and dots', () => {
    const ss = 20
    const g = synthScore({ width: 600, height: 400, staffSpace: ss, lineThickness: 3, staves: [100] })
    const bin = threshold(g, 128)
    const set = (x: number, y: number) => (bin.data[y * 600 + x] = 1)
    set(300, 300) // speck
    set(301, 300)
    for (let y = 300; y < 306; y++) for (let x = 400; x < 406; x++) set(x, y) // staccato-sized dot
    for (let y = 0; y < 400; y++) for (let x = 0; x < 25; x++) set(x, y) // dark page edge
    const before = inkCount(bin)
    const stats = denoise(bin, ss, 3)
    expect(stats.specks).toBe(1)
    expect(stats.borderBlobs).toBe(1)
    expect(bin.data[300 * 600 + 300]).toBe(0)
    expect(bin.data[302 * 600 + 402]).toBe(1)
    expect(bin.data[200 * 600 + 10]).toBe(0)
    expect(bin.data[101 * 600 + 300]).toBe(1)
    expect(before - inkCount(bin)).toBe(2 + 400 * 25)
  })
})

describe('1-bit PNG', () => {
  it('round-trips pixels through IHDR + IDAT', () => {
    const w = 13
    const h = 5
    const bin: BinImage = { width: w, height: h, data: new Uint8Array(w * h) }
    const r = rng(5)
    for (let i = 0; i < bin.data.length; i++) bin.data[i] = r() > 0.5 ? 1 : 0
    const info = readPng(encodePng1bit(bin, 300))
    expect(info).toMatchObject({ width: w, height: h, bitDepth: 1, colorType: 0 })
    const rows = unzlibSync(info.idat)
    expect(rows).toEqual(packRows(bin))
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const byte = rows[y * 3 + 1 + (x >> 3)]
        expect((byte >> (7 - (x & 7))) & 1).toBe(bin.data[y * w + x] ? 0 : 1)
      }
  })
})

describe('otsu', () => {
  it('splits a bimodal histogram', () => {
    const d = new Uint8Array(1000)
    d.fill(30, 0, 300)
    d.fill(220, 300)
    const t = otsu(d)
    expect(t).toBeGreaterThanOrEqual(30)
    expect(t).toBeLessThan(220)
  })
})
