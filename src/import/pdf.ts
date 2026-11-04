// pdf.js wrapper. The library is loaded lazily (legacy build: compatible with iOS 17.0) and parses
// in its own worker. Its runtime assets (JBIG2/OpenJPEG wasm, fonts, cmaps) are copied to
// <base>/pdfjs/ at build time and precached, so scanned PDFs open offline.
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { makeThumbnail } from './images'
import type { PdfPageRef } from '../model/types'

/** Hard caps for any rendering: iOS limits canvases to ~16.7 MP and memory is tight. */
export const MAX_RENDER_SIDE = 4096
export const MAX_RENDER_PIXELS = 16_000_000
/** Nominal resolution used for page dimensions (export keeps the original page size in points). */
export const NOMINAL_DPI = 300

let pdfjsPromise: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null

async function loadPdfjs() {
  pdfjsPromise ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ])
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })()
  return pdfjsPromise
}

export interface PdfHandle {
  doc: PDFDocumentProxy
  /** Releases the document and its worker resources. */
  close: () => Promise<void>
}

export async function openPdf(data: ArrayBuffer): Promise<PdfHandle> {
  const pdfjs = await loadPdfjs()
  const assets = `${import.meta.env.BASE_URL}pdfjs/`
  // pdf.js transfers the buffer to its worker: pass a copy so callers keep theirs.
  const task = pdfjs.getDocument({
    data: new Uint8Array(data.slice(0)),
    wasmUrl: `${assets}wasm/`,
    standardFontDataUrl: `${assets}standard_fonts/`,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    iccUrl: `${assets}iccs/`,
    enableXfa: false,
  })
  const doc = await task.promise
  return { doc, close: () => task.destroy() }
}

/** Clamps a requested render scale so the output respects the canvas limits. */
export function clampScale(widthAt1: number, heightAt1: number, scale: number): number {
  let s = scale
  s = Math.min(s, MAX_RENDER_SIDE / widthAt1, MAX_RENDER_SIDE / heightAt1)
  s = Math.min(s, Math.sqrt(MAX_RENDER_PIXELS / (widthAt1 * heightAt1)))
  return s
}

export async function renderPdfPage(
  doc: PDFDocumentProxy,
  index: number,
  targetWidthPx: number,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(index + 1)
  try {
    const base = page.getViewport({ scale: 1 })
    const scale = clampScale(base.width, base.height, targetWidthPx / base.width)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    return canvas
  } finally {
    page.cleanup()
  }
}

export interface PdfImportInfo {
  pages: (PdfPageRef & { width: number; height: number; dpi: number })[]
  thumbnail: Blob
}

/** Reads page sizes and renders a thumbnail of the first page. */
export async function inspectPdf(data: ArrayBuffer): Promise<PdfImportInfo> {
  const { doc, close } = await openPdf(data)
  try {
    const pages: PdfImportInfo['pages'] = []
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1)
      const vp = page.getViewport({ scale: 1 }) // 1 unit = 1 pt, rotation applied
      pages.push({
        index: i,
        widthPt: vp.width,
        heightPt: vp.height,
        width: Math.round((vp.width / 72) * NOMINAL_DPI),
        height: Math.round((vp.height / 72) * NOMINAL_DPI),
        dpi: NOMINAL_DPI,
      })
      page.cleanup()
    }
    const first = await renderPdfPage(doc, 0, 720)
    const thumbnail = await makeThumbnail(first)
    first.width = first.height = 0 // release canvas memory early (iOS)
    return { pages, thumbnail }
  } finally {
    await close()
  }
}

/**
 * A page is treated as a scan when it paints a few raster images (one per scanned page, sometimes
 * split in strips). Vector engravings paint none, or many tiny ones (Type3 bitmap glyphs, logos).
 */
export async function isVectorPage(doc: PDFDocumentProxy, index: number): Promise<boolean> {
  const pdfjs = await loadPdfjs()
  const page = await doc.getPage(index + 1)
  try {
    const ops = await page.getOperatorList()
    const O = pdfjs.OPS as Record<string, number>
    const imageOps = new Set(
      [
        'paintImageXObject',
        'paintInlineImageXObject',
        'paintImageMaskXObject',
        'paintImageXObjectRepeat',
        'paintImageMaskXObjectRepeat',
        'paintImageMaskXObjectGroup',
        'paintInlineImageXObjectGroup',
        'paintJpegXObject',
      ]
        .map((n) => O[n])
        .filter((v) => v !== undefined),
    )
    let images = 0
    for (const fn of ops.fnArray) if (imageOps.has(fn)) images++
    return images === 0 || images > 8
  } finally {
    page.cleanup()
  }
}
