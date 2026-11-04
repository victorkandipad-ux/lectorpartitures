import { readFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildCleanPdf, pageSizePt } from '../../src/export/pdf'
import { encodePng1bit } from '../../src/export/png1bit'
import { liveMats, type CV } from '../../src/pipeline/cv'
import { detectDocument } from '../../src/pipeline/document'
import { applyHomography, squareToQuad } from '../../src/pipeline/geometry'
import { grayImage, rgbaToGray, sampleBilinear, type GrayImage } from '../../src/pipeline/image'
import { runPipeline } from '../../src/pipeline/index'
import type { Quad } from '../../src/model/types'
import { loadOpenCVNode } from '../support/opencv-node'
import { synthScore } from '../support/synth'

let cv: CV
beforeAll(async () => {
  cv = await loadOpenCVNode()
})

/** Places a score page as a perspective quad on a dark, textured table. */
function photoOf(page: GrayImage, quad: Quad, w: number, h: number): GrayImage {
  const out = grayImage(w, h)
  // Inverse map by sampling: for each output pixel find (u, v) with a fine search is costly; instead
  // forward-splat a supersampled grid of the page.
  for (let i = 0; i < out.data.length; i++) out.data[i] = 60 + ((i * 7919) % 23)
  const H = squareToQuad(quad)
  const n = 3
  for (let y = 0; y < page.height * n; y++)
    for (let x = 0; x < page.width * n; x++) {
      const u = x / (page.width * n)
      const v = y / (page.height * n)
      const p = applyHomography(H, u, v)
      const xi = Math.round(p.x)
      const yi = Math.round(p.y)
      if (xi >= 0 && yi >= 0 && xi < w && yi < h) out.data[yi * w + xi] = sampleBilinear(page, x / n, y / n, 255)
    }
  return out
}

describe('document detection', () => {
  it('finds a page photographed in perspective on a dark table', () => {
    const page = synthScore({ width: 600, height: 840, staffSpace: 10, lineThickness: 2, staves: [100, 250, 400, 550, 700] })
    const quad: Quad = [
      { x: 180, y: 120 },
      { x: 820, y: 160 },
      { x: 870, y: 1050 },
      { x: 120, y: 1010 },
    ]
    const photo = photoOf(page, quad, 1000, 1200)
    const doc = detectDocument(cv, photo)
    expect(doc).not.toBeNull()
    doc!.quad.forEach((p, i) => {
      expect(Math.hypot(p.x - quad[i].x, p.y - quad[i].y)).toBeLessThan(12)
    })
    expect(liveMats()).toBe(0)
  })

  it('does not crop a scan without background (no quad)', () => {
    const page = synthScore({ width: 600, height: 840, staffSpace: 10, lineThickness: 2, staves: [100, 250, 400, 550, 700] })
    expect(detectDocument(cv, page)).toBeNull()
    expect(liveMats()).toBe(0)
  })
})

describe('pipeline on synthetic photos', () => {
  it('rectifies, deskews and binarizes a skewed page photo', () => {
    const page = synthScore({
      width: 600,
      height: 840,
      staffSpace: 10,
      lineThickness: 2,
      staves: [100, 250, 400, 550, 700],
      angleDeg: 4,
    })
    const quad: Quad = [
      { x: 180, y: 120 },
      { x: 820, y: 160 },
      { x: 870, y: 1050 },
      { x: 120, y: 1010 },
    ]
    const r = runPipeline({ gray: photoOf(page, quad, 1000, 1200), kind: 'photo' }, cv)
    expect(r.corners).not.toBeNull()
    expect(Math.abs(r.skewDeg - 4)).toBeLessThan(0.6)
    expect(r.staffSpace).not.toBeNull()
    // Output resolution normalizes the staff space to ≈ 300 dpi engraving (≈ 20.7 px), capped at 2× source.
    expect(r.staffSpace!).toBeGreaterThan(15)
    expect(r.staffSpace!).toBeLessThan(24)
    expect(liveMats()).toBe(0)
  })
})

const FIXTURES = ['01_dvorak_sonatina_op100_tema', '14_commodore_perry_p2', '21_bach_jc_sonata_op16']

describe('pipeline on real fixtures', () => {
  it.each(FIXTURES)('%s', (name) => {
    const d = jpeg.decode(readFileSync(`bench/fixtures/real/${name}.jpg`), { useTArray: true, maxMemoryUsageInMB: 1024 })
    const gray = rgbaToGray(d.data, d.width, d.height)
    const r = runPipeline({ gray, kind: 'photo', diagnostics: true }, cv)
    expect(liveMats()).toBe(0)
    expect(r.staffSpace).not.toBeNull()
    expect(r.staffConfidence).toBeGreaterThan(0.3)
    expect(r.clean.width).toBeLessThanOrEqual(4096)
    expect(r.clean.height).toBeLessThanOrEqual(4096)
    expect(r.clean.width * r.clean.height).toBeLessThanOrEqual(16_000_000)
    // Ink coverage of a clean score page: a few percent, never a black page.
    const ink = r.clean.data.reduce((s, v) => s + v, 0) / r.clean.data.length
    expect(ink).toBeGreaterThan(0.02)
    expect(ink).toBeLessThan(0.3)
    expect(r.steps.map((s) => s.name)).toEqual([
      'analysis',
      'document',
      'rectified',
      'prelimBinarization',
      'skew',
      'staffMetrics',
      'dewarp',
      'background',
      'remap',
      'sauvola',
      'cleanup',
    ])
  })

  it('vector PDF pages skip geometry and cleanup', () => {
    const g = synthScore({ width: 800, height: 1100, staffSpace: 20, lineThickness: 2, staves: [100, 400, 700], paper: 255, ink: 0 })
    const r = runPipeline({ gray: g, kind: 'pdf-vector', dpi: 300 }, null)
    expect(r.clean.width).toBe(800)
    expect(r.dpi).toBe(300)
    expect(r.steps.map((s) => s.name)).toEqual(['threshold', 'staffMetrics'])
  })
})

describe('clean PDF export', () => {
  it('embeds 1-bit DeviceGray images at the original page size', async () => {
    const page = synthScore({ width: 500, height: 700, staffSpace: 12, lineThickness: 2, staves: [100, 300] })
    const r = runPipeline({ gray: page, kind: 'pdf-raster', dpi: 300 }, null)
    const png = encodePng1bit(r.clean, r.dpi)
    const bytes = await buildCleanPdf(
      [
        { png, widthPt: 595.28, heightPt: 841.89 },
        { png, ...pageSizePt({ cleanWidth: 2480, cleanHeight: 3508, cleanDpi: 300 }) },
      ],
      { title: 'Prueba', composer: 'Anónimo' },
    )
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getTitle()).toBe('Prueba')
    const [p1, p2] = doc.getPages()
    expect(p1.getWidth()).toBeCloseTo(595.28, 1)
    expect(p2.getWidth()).toBeCloseTo(595.2, 0)
    expect(p2.getHeight()).toBeCloseTo(841.9, 0)
    const xobjects = p1.node.Resources()!.lookup(PDFName.of('XObject'), PDFDict)
    const img = xobjects.lookup(xobjects.keys()[0]) as PDFRawStream
    const dict = img.dict
    expect(dict.get(PDFName.of('ColorSpace'))).toBe(PDFName.of('DeviceGray'))
    expect((dict.get(PDFName.of('BitsPerComponent')) as PDFNumber).asNumber()).toBe(1)
    expect((dict.get(PDFName.of('Width')) as PDFNumber).asNumber()).toBe(r.clean.width)
    expect(dict.get(PDFName.of('Filter'))).toBe(PDFName.of('FlateDecode'))
    // The image data is the PNG's IDAT stream, untouched.
    expect(img.contents.length).toBeLessThan(png.length)
  })
})
