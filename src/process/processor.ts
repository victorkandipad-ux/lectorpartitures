// Main-thread side of page processing: prepares the source (photo file or rendered PDF page), calls
// the pipeline worker and stores the result. A single background queue processes every page whose
// pipelineVersion is older than the current one (new imports and pipeline upgrades alike).
import * as Comlink from 'comlink'
import { create } from 'zustand'
import { db as defaultDb, type AtrilDB } from '../db/schema'
import { getBlob, newId } from '../db/repo'
import { isVectorPage, openPdf, renderPdfPage, type PdfHandle } from '../import/pdf'
import type { Page, Work } from '../model/types'
import { bitmapToGray } from '../pipeline/decode'
import type { GrayImage } from '../pipeline/image'
import { PIPELINE_VERSION } from '../pipeline/version'
import type { PipelineWorkerApi, ProcessRequest, ProcessResponse } from '../workers/pipeline.worker'

let remote: Comlink.Remote<PipelineWorkerApi> | null = null

export function pipelineWorker(): Comlink.Remote<PipelineWorkerApi> {
  remote ??= Comlink.wrap<PipelineWorkerApi>(
    new Worker(new URL('../workers/pipeline.worker.ts', import.meta.url), { type: 'module', name: 'pipeline' }),
  )
  return remote
}

/** Starts loading OpenCV in the worker (e.g. while the user fills the metadata dialog). */
export function warmUpPipeline() {
  void pipelineWorker()
    .warmUp()
    .catch(() => {})
}

let canDecode: Promise<boolean> | null = null

/** Hands the source to the worker, decoding it here first if the worker cannot. */
async function prepareSource(src: Blob | ImageBitmap): Promise<{ source: Blob | ImageBitmap | GrayImage; transfer: Transferable[] }> {
  canDecode ??= pipelineWorker()
    .canDecode()
    .catch(() => false)
  if (await canDecode) return { source: src, transfer: src instanceof Blob ? [] : [src] }
  const bitmap = src instanceof Blob ? await createImageBitmap(src, { imageOrientation: 'from-image' }) : src
  try {
    const gray = bitmapToGray(bitmap, (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }))
    return { source: gray, transfer: [gray.data.buffer as ArrayBuffer] }
  } finally {
    bitmap.close()
  }
}

async function grayToJpeg(img: GrayImage): Promise<ArrayBuffer> {
  const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
  const ctx = canvas.getContext('2d')!
  const data = ctx.createImageData(img.width, img.height)
  for (let i = 0; i < img.data.length; i++) {
    data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = img.data[i]
    data.data[i * 4 + 3] = 255
  }
  ctx.putImageData(data, 0, 0)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8))
  canvas.width = canvas.height = 0
  if (!blob) throw new Error('Thumbnail encoding failed')
  return blob.arrayBuffer()
}

interface ProcessingState {
  pageId: string | null
  workId: string | null
}
export const useProcessing = create<ProcessingState>(() => ({ pageId: null, workId: null }))

export function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

/** Opened PDFs, reused across the pages of a work while the queue runs. */
class PdfCache {
  private map = new Map<string, Promise<PdfHandle>>()
  async get(db: AtrilDB, work: Work): Promise<PdfHandle> {
    let p = this.map.get(work.id)
    if (!p) {
      p = (async () => {
        const blob = await getBlob(db, work.pdfBlobId)
        if (!blob) throw new Error('PDF blob missing')
        return openPdf(await blob.arrayBuffer())
      })()
      this.map.set(work.id, p)
    }
    return p
  }
  async closeAll() {
    for (const p of this.map.values()) await p.then((h) => h.close()).catch(() => {})
    this.map.clear()
  }
}

/** Runs the pipeline on one page without storing anything. */
export async function processPage(
  db: AtrilDB,
  page: Page,
  opts: { diagnostics?: boolean; pdfs?: PdfCache } = {},
): Promise<{ res: ProcessResponse; isVector?: boolean }> {
  const work = await db.works.get(page.workId)
  if (!work) throw new Error('Work not found')
  const worker = pipelineWorker()
  const thumbnail = page.index === 0 && !opts.diagnostics
  if (page.pdfPage) {
    const pdfs = opts.pdfs ?? new PdfCache()
    try {
      const { doc } = await pdfs.get(db, work)
      const isVector = page.isVector ?? (await isVectorPage(doc, page.pdfPage.index))
      const canvas = await renderPdfPage(doc, page.pdfPage.index, page.width)
      const dpi = (canvas.width / page.pdfPage.widthPt) * 72
      const bitmap = await createImageBitmap(canvas)
      canvas.width = canvas.height = 0
      const { source, transfer } = await prepareSource(bitmap)
      const req: ProcessRequest = {
        source,
        kind: isVector ? 'pdf-vector' : 'pdf-raster',
        dpi,
        diagnostics: opts.diagnostics,
        thumbnail,
      }
      const res = await worker.process(Comlink.transfer(req, transfer))
      return { res, isVector }
    } finally {
      if (!opts.pdfs) await pdfs.closeAll()
    }
  }
  const blob = await getBlob(db, page.originalBlobId)
  if (!blob) throw new Error('Image blob missing')
  const { source, transfer } = await prepareSource(blob)
  const req: ProcessRequest = { source, kind: 'photo', corners: page.corners, diagnostics: opts.diagnostics, thumbnail }
  const res = await worker.process(Comlink.transfer(req, transfer))
  return { res }
}

async function saveResult(db: AtrilDB, page: Page, res: ProcessResponse, isVector?: boolean) {
  const png = res.png
  const bytes = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer
  const thumb = res.thumbnail ? await grayToJpeg(res.thumbnail) : null
  await db.transaction('rw', db.pages, db.blobs, db.works, async () => {
    const current = await db.pages.get(page.id)
    if (!current) return // deleted while processing
    const cleanBlobId = current.cleanBlobId ?? newId()
    await db.blobs.put({ id: cleanBlobId, bytes, type: 'image/png' })
    await db.pages.update(page.id, {
      cleanBlobId,
      cleanWidth: res.width,
      cleanHeight: res.height,
      cleanDpi: res.dpi,
      detectedCorners: res.corners,
      isVector,
      analysis: {
        staffSpace: res.staffSpace,
        lineThickness: res.lineThickness,
        staffConfidence: res.staffConfidence,
        skewDeg: res.skewDeg,
        dewarpMaxPx: res.dewarpMaxPx,
        docConfidence: res.docConfidence,
        ms: res.wallMs,
      },
      auto: res.structure,
      confidence: res.confidence,
      needsReview: res.needsReview,
      pipelineVersion: PIPELINE_VERSION,
      pipelineError: undefined,
    })
    if (thumb) {
      const work = await db.works.get(page.workId)
      if (work) await db.blobs.put({ id: work.thumbBlobId, bytes: thumb, type: 'image/jpeg' })
    }
  })
}

let running = false
let again = false

/** Processes all pending pages, one at a time. Safe to call repeatedly. */
export async function kickQueue(db: AtrilDB = defaultDb): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  const pdfs = new PdfCache()
  try {
    do {
      again = false
      for (;;) {
        const pending = await db.pages.filter((p) => p.pipelineVersion < PIPELINE_VERSION).toArray()
        if (pending.length === 0) break
        pending.sort((a, b) => a.index - b.index)
        const page = pending[0]
        useProcessing.setState({ pageId: page.id, workId: page.workId })
        try {
          const { res, isVector } = await processPage(db, page, { pdfs })
          await saveResult(db, page, res, isVector)
          console.info(`page ${page.id} processed in ${res.wallMs} ms`, res.steps.map((s) => `${s.name}:${s.ms}`).join(' '))
        } catch (err) {
          console.error('processing failed:', err)
          await db.pages.update(page.id, { pipelineVersion: PIPELINE_VERSION, pipelineError: describeError(err) })
        }
      }
    } while (again)
  } finally {
    await pdfs.closeAll()
    useProcessing.setState({ pageId: null, workId: null })
    running = false
  }
}
