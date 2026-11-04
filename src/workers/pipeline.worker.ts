/// <reference lib="webworker" />
// Pipeline worker: decodes the page, runs the cleaning pipeline and encodes the 1-bit PNG.
// The main thread only decodes when the worker lacks OffscreenCanvas (see ProcessRequest.source).
import * as Comlink from 'comlink'
import { encodePng1bit } from '../export/png1bit'
import { loadOpenCV } from '../pipeline/cv'
import { bitmapToGray } from '../pipeline/decode'
import { grayImage, type BinImage, type GrayImage } from '../pipeline/image'
import { runPipeline, type DiagStep, type SourceKind } from '../pipeline/index'
import type { Quad } from '../model/types'

const THUMB_WIDTH = 360

export interface ProcessRequest {
  /**
   * Photo file or rendered PDF page; already-decoded gray pixels when the worker has no
   * OffscreenCanvas (iOS < 16.4, some WebKit builds).
   */
  source: Blob | ImageBitmap | GrayImage
  kind: SourceKind
  /** Normalized (0–1) user corners. */
  corners?: Quad
  dpi?: number
  diagnostics?: boolean
  thumbnail?: boolean
}

export interface ProcessResponse {
  png: Uint8Array
  width: number
  height: number
  dpi: number
  /** Normalized (0–1) detected corners. */
  corners: Quad | null
  docConfidence: number | null
  staffSpace: number | null
  lineThickness: number | null
  staffConfidence: number
  skewDeg: number
  dewarpMaxPx: number
  totalMs: number
  /** Includes decoding and encoding. */
  wallMs: number
  steps: DiagStep[]
  thumbnail?: GrayImage
}

async function decode(source: Blob | ImageBitmap | GrayImage): Promise<GrayImage> {
  if ('data' in source) return source
  const bitmap = source instanceof Blob ? await createImageBitmap(source, { imageOrientation: 'from-image' }) : source
  try {
    return bitmapToGray(bitmap, (w, h) => new OffscreenCanvas(w, h))
  } finally {
    bitmap.close()
  }
}

/** Small gray thumbnail (ink coverage per cell); the main thread encodes it as JPEG. */
function thumbnailOf(bin: BinImage): GrayImage {
  const w = Math.min(THUMB_WIDTH, bin.width)
  const h = Math.max(1, Math.round((bin.height * w) / bin.width))
  const fx = bin.width / w
  const fy = bin.height / h
  const out = grayImage(w, h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx))
      let ink = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) ink += bin.data[yy * bin.width + xx]
      out.data[y * w + x] = 255 - Math.round((255 * ink) / ((x1 - x0) * (y1 - y0)))
    }
  }
  return out
}

const api = {
  /** Loads OpenCV ahead of time (called when the user picks a photo). */
  async warmUp(): Promise<void> {
    await loadOpenCV()
  },

  /** Whether the worker can decode images itself. */
  async canDecode(): Promise<boolean> {
    return typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function'
  },

  async process(req: ProcessRequest): Promise<ProcessResponse> {
    const t0 = performance.now()
    const gray = await decode(req.source)
    const needsCv = req.kind === 'photo' && !req.corners
    const cv = needsCv ? await loadOpenCV().catch((err) => (console.warn('OpenCV unavailable', err), null)) : null
    const toPx = (q: Quad) => q.map((p) => ({ x: p.x * gray.width, y: p.y * gray.height })) as Quad
    const r = runPipeline(
      { gray, kind: req.kind, corners: req.corners ? toPx(req.corners) : undefined, dpi: req.dpi, diagnostics: req.diagnostics },
      cv,
    )
    const png = encodePng1bit(r.clean, r.dpi)
    const thumbnail = req.thumbnail ? thumbnailOf(r.clean) : undefined
    const res: ProcessResponse = {
      png,
      width: r.clean.width,
      height: r.clean.height,
      dpi: r.dpi,
      corners: r.corners ? (r.corners.map((p) => ({ x: p.x / gray.width, y: p.y / gray.height })) as Quad) : null,
      docConfidence: r.docConfidence,
      staffSpace: r.staffSpace,
      lineThickness: r.lineThickness,
      staffConfidence: r.staffConfidence,
      skewDeg: r.skewDeg,
      dewarpMaxPx: r.dewarpMaxPx,
      totalMs: r.totalMs,
      wallMs: Math.round(performance.now() - t0),
      steps: r.steps,
      thumbnail,
    }
    const transfer: Transferable[] = [png.buffer as ArrayBuffer]
    for (const s of r.steps) if (s.image) transfer.push(s.image.data.buffer as ArrayBuffer)
    if (thumbnail) transfer.push(thumbnail.data.buffer as ArrayBuffer)
    return Comlink.transfer(res, transfer)
  },
}

export type PipelineWorkerApi = typeof api

Comlink.expose(api)
