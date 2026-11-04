// Core data model. Geometry of a processed page is in pixels of the rectified page image.

export type ViewMode = 'page' | 'systems' | 'measures'

export interface ReadingAnchor {
  pageId: string
  /** Normalized 0–1 coordinates within the page. */
  x: number
  y: number
}

export interface WorkViewState {
  mode: ViewMode
  scale: number
  anchor: ReadingAnchor | null
}

export interface Work {
  id: string
  title: string
  composer: string
  tags: string[]
  source: 'photo' | 'pdf'
  pageIds: string[]
  createdAt: number
  updatedAt: number
  thumbBlobId: string
  /** Shared PDF file (for PDF works). */
  pdfBlobId?: string
  view: WorkViewState
}

export interface Point {
  x: number
  y: number
}
/** Corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point]
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type BarlineType = 'single' | 'double' | 'final' | 'repeat-l' | 'repeat-r' | 'repeat-lr'

/** Placeholder for future OMR output (notes, rests, clefs...). */
export interface MusicSymbol {
  kind: string
  bbox: Rect
  confidence: number
  data?: Record<string, unknown>
}

export interface Measure {
  id: string
  xStart: number
  xEnd: number
  barline: BarlineType
  confidence: number
  symbols?: MusicSymbol[]
}

export interface Staff {
  /** 5 entries, top to bottom. */
  lineYs: number[]
  confidence: number
}

export interface System {
  id: string
  bbox: Rect
  confidence: number
  staves: Staff[]
  measures: Measure[]
}

export interface PageStructure {
  staffSpace: number
  lineThickness: number
  systems: System[]
}

/** User edits, stored separately from automatic results (applied in phase 5). */
export type EditOp = { op: string; [k: string]: unknown }

export interface PdfPageRef {
  /** 0-based page index inside the work's PDF. */
  index: number
  widthPt: number
  heightPt: number
}

export interface Page {
  id: string
  workId: string
  index: number
  /** Photo pages: original image file. PDF pages: undefined (rendered from work.pdfBlobId). */
  originalBlobId?: string
  pdfPage?: PdfPageRef
  isVector?: boolean
  corners?: Quad
  /** Size of the source raster (photo) or of the nominal 300 dpi rendering (PDF). */
  width: number
  height: number
  dpi?: number
  cleanBlobId?: string
  auto: PageStructure | null
  overrides: EditOp[]
  confidence: number | null
  needsReview: boolean
  pipelineVersion: number
}

/**
 * Binary payload. Stored as ArrayBuffer rather than Blob: WebKit (Safari private mode, some iOS
 * versions, Playwright WebKit) fails with "Error preparing Blob/File data to be stored".
 */
export interface StoredBlob {
  id: string
  bytes: ArrayBuffer
  type: string
}
