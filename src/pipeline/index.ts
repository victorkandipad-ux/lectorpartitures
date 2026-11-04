// Cleaning pipeline orchestrator (pure: runs in the worker and in Node tests).
//
//   analysis (~2000 px) ─ document quad ─ rectify ─ prelim. Sauvola ─ skew ─ staff metrics ─ dewarp
//                                                               └─ background (illumination)
//   full resolution: ONE composite remap (perspective ∘ deskew ∘ dewarp, ÷ background)
//                    → Sauvola (window ∝ staffSpace) → component cleanup → 1-bit page
import { type CV } from './cv'
import { estimateDewarp } from './dewarp'
import { detectDocument } from './document'
import { fullQuad, quadSize, remapComposite, type GeometryChain } from './geometry'
import { binToGrayPreview, grayPreview, resizeArea, type BinImage, type GrayImage } from './image'
import { estimateBackground } from './illumination'
import { staffMetrics, type StaffMetrics } from './runlength'
import { sauvola, threshold } from './sauvola'
import { estimateSkew, rotateBin } from './skew'
import { denoise } from './denoise'
import type { Quad } from '../model/types'

export { PIPELINE_VERSION } from './version'

export const ANALYSIS_SIDE = 2000
export const MAX_OUTPUT_SIDE = 4096
export const MAX_OUTPUT_PIXELS = 16_000_000
/** Typical engraved staff space (rastral 7 mm staff / 4 spaces): used to estimate photo page size. */
export const TYPICAL_STAFF_SPACE_MM = 1.75
export const TARGET_DPI = 300

export type SourceKind = 'photo' | 'pdf-raster' | 'pdf-vector'

export interface PipelineInput {
  gray: GrayImage
  kind: SourceKind
  /** User-corrected page corners in source pixels (skips detection). */
  corners?: Quad
  /** Known resolution of the source (PDF renderings). */
  dpi?: number
  diagnostics?: boolean
}

export interface DiagStep {
  name: string
  ms: number
  info?: Record<string, string | number>
  image?: GrayImage
  /** Quad to draw over `image`, in its pixel coordinates. */
  quad?: Quad
}

export interface PipelineResult {
  clean: BinImage
  dpi: number
  /** Detected page corners in source pixels (null = whole image). */
  corners: Quad | null
  docConfidence: number | null
  staffSpace: number | null
  lineThickness: number | null
  staffConfidence: number
  skewDeg: number
  dewarpMaxPx: number
  totalMs: number
  steps: DiagStep[]
}

const PREVIEW_SIDE = 1000
const odd = (n: number) => (Math.round(n) | 1)

export function runPipeline(input: PipelineInput, cv: CV | null): PipelineResult {
  const t0 = performance.now()
  let last = t0
  const steps: DiagStep[] = []
  const diag = !!input.diagnostics
  const step = (name: string, info?: DiagStep['info'], image?: () => GrayImage, quad?: Quad) => {
    const now = performance.now()
    steps.push({ name, ms: Math.round(now - last), info, image: diag && image ? image() : undefined, quad })
    last = performance.now()
  }
  const { gray } = input

  if (input.kind === 'pdf-vector') {
    // Clean digital rendering: no geometry, no illumination, no aggressive cleanup.
    const bin = threshold(gray, 160)
    step('threshold', undefined, () => binToGrayPreview(bin, PREVIEW_SIDE))
    const m = staffMetrics(bin)
    step('staffMetrics', metricsInfo(m))
    return {
      clean: bin,
      dpi: input.dpi ?? TARGET_DPI,
      corners: null,
      docConfidence: null,
      staffSpace: m?.staffSpace ?? null,
      lineThickness: m?.lineThickness ?? null,
      staffConfidence: m?.confidence ?? 0,
      skewDeg: 0,
      dewarpMaxPx: 0,
      totalMs: Math.round(performance.now() - t0),
      steps,
    }
  }

  // 1. Analysis image.
  const a = Math.min(1, ANALYSIS_SIDE / Math.max(gray.width, gray.height))
  const A = a < 1 ? resizeArea(gray, Math.round(gray.width * a), Math.round(gray.height * a)) : gray
  step('analysis', { width: A.width, height: A.height, scale: a.toFixed(3) }, () => grayPreview(A, PREVIEW_SIDE))

  // 2. Page corners.
  let quad: Quad = fullQuad(gray.width, gray.height)
  let detected: Quad | null = null
  let docConfidence: number | null = null
  if (input.corners) {
    quad = input.corners
  } else if (input.kind === 'photo' && cv) {
    const doc = detectDocument(cv, A)
    if (doc) {
      detected = doc.quad.map((p) => ({ x: p.x / a, y: p.y / a })) as Quad
      quad = detected
      docConfidence = doc.confidence
    }
  }
  const pScale = Math.min(1, PREVIEW_SIDE / Math.max(A.width, A.height))
  step(
    'document',
    { found: detected ? 'auto' : input.corners ? 'manual' : 'none', confidence: docConfidence ?? '-' },
    () => grayPreview(A, PREVIEW_SIDE),
    quad.map((p) => ({ x: p.x * a * pScale, y: p.y * a * pScale })) as Quad,
  )

  // 3. Rectified reference frame at analysis resolution.
  const nat = quadSize(quad)
  const refScale = Math.min(1, ANALYSIS_SIDE / Math.max(nat.width, nat.height))
  const refW = Math.max(16, Math.round(nat.width * refScale))
  const refH = Math.max(16, Math.round(nat.height * refScale))
  const chain: GeometryChain = { quad, refW, refH, angleDeg: 0, dewarp: null }
  const ref = remapComposite(A, chain, refW, refH, { srcScale: a })
  step('rectified', { width: refW, height: refH }, () => grayPreview(ref, PREVIEW_SIDE))

  // 4. Preliminary binarization (bootstrap: window relative to the page, staff space unknown yet).
  const binRef = sauvola(ref, { window: odd(Math.max(15, Math.min(refW, refH) / 40)), k: 0.2 })
  step('prelimBinarization', undefined, () => binToGrayPreview(binRef, PREVIEW_SIDE))

  // 5. Skew from staff lines.
  const skew = estimateSkew(binRef)
  chain.angleDeg = skew.sharpness > 1.2 ? skew.angleDeg : 0
  const binK = chain.angleDeg ? rotateBin(binRef, chain.angleDeg) : binRef
  step('skew', { degrees: chain.angleDeg, sharpness: skew.sharpness.toFixed(2) }, () => binToGrayPreview(binK, PREVIEW_SIDE))

  // 6. Staff metrics → every later threshold is relative to them.
  let m = staffMetrics(binK)
  if (m && (m.confidence < 0.08 || m.staffSpace < 4)) m = null
  step('staffMetrics', metricsInfo(m))

  // 7. Curvature.
  chain.dewarp = m ? estimateDewarp(binK, m.staffSpace, m.lineThickness) : null
  step('dewarp', { maxShift: chain.dewarp ? chain.dewarp.maxAbs.toFixed(1) : 0 })

  // 8. Illumination background (in the reference frame).
  const bg = estimateBackground(ref, m ? m.staffSpace : Math.max(refW, refH) / 170)
  step('background', { cell: bg.cell }, () => ({
    width: bg.gw,
    height: bg.gh,
    data: Uint8Array.from(bg.grid, (v) => Math.round(v)),
  }))

  // 9. Output size and resolution.
  let outW: number
  let dpi: number
  if (input.dpi) {
    outW = Math.round(nat.width)
    dpi = input.dpi
  } else if (m) {
    const widthMm = (refW / m.staffSpace) * TYPICAL_STAFF_SPACE_MM
    outW = Math.min((widthMm / 25.4) * TARGET_DPI, nat.width * 2)
    dpi = outW / (widthMm / 25.4)
  } else {
    outW = nat.width
    dpi = outW / (210 / 25.4) // assume an A4-wide page
  }
  let outH = (outW * refH) / refW
  const cap = Math.min(1, MAX_OUTPUT_SIDE / Math.max(outW, outH), Math.sqrt(MAX_OUTPUT_PIXELS / (outW * outH)))
  outW = Math.max(16, Math.round(outW * cap))
  outH = Math.max(16, Math.round(outH * cap))
  dpi *= cap

  // 10. Full-resolution composite remap (pre-downscale the source when it is much larger).
  const ratio = nat.width / outW
  let src = gray
  let srcScale = 1
  if (ratio > 1.6) {
    srcScale = 1.25 / ratio
    src = resizeArea(gray, Math.round(gray.width * srcScale), Math.round(gray.height * srcScale))
  }
  const norm = remapComposite(src, chain, outW, outH, { background: bg, srcScale })
  step('remap', { width: outW, height: outH, dpi: Math.round(dpi) }, () => grayPreview(norm, PREVIEW_SIDE))

  // 11. Binarization with a window that covers the largest solid symbols (noteheads, beams).
  const ssOut = m ? (m.staffSpace * outW) / refW : outW / 120
  const bin = sauvola(norm, { window: odd(Math.max(15, 4 * ssOut)), k: 0.15, darkFloor: 80, lightCeil: 215 })
  step('sauvola', { window: odd(Math.max(15, 4 * ssOut)) }, () => binToGrayPreview(bin, PREVIEW_SIDE))

  // 12. Cleanup with metrics measured on the final image.
  const mOut = staffMetrics(bin) ?? m
  const ss = mOut && m ? mOut.staffSpace : ssOut
  const lt = mOut && m ? mOut.lineThickness : Math.max(1, ssOut / 8)
  const stats = denoise(bin, ss, lt)
  step('cleanup', { components: stats.components, specks: stats.specks, borderBlobs: stats.borderBlobs, edgeLines: stats.edgeLines }, () =>
    binToGrayPreview(bin, PREVIEW_SIDE),
  )

  return {
    clean: bin,
    dpi,
    corners: detected,
    docConfidence,
    staffSpace: m ? ss : null,
    lineThickness: m ? lt : null,
    staffConfidence: m?.confidence ?? 0,
    skewDeg: chain.angleDeg,
    dewarpMaxPx: chain.dewarp ? (chain.dewarp.maxAbs * outW) / refW : 0,
    totalMs: Math.round(performance.now() - t0),
    steps,
  }
}

function metricsInfo(m: StaffMetrics | null): DiagStep['info'] {
  return m
    ? {
        staffSpace: m.staffSpace.toFixed(2),
        lineThickness: m.lineThickness.toFixed(2),
        confidence: m.confidence.toFixed(2),
      }
    : { staffSpace: 'none' }
}
