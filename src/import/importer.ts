import { db } from '../db/schema'
import { createWork, type WorkMeta } from '../db/repo'
import type { Work } from '../model/types'
import { readImageFile } from './images'
import { inspectPdf } from './pdf'

export type ImportKind = 'camera' | 'gallery' | 'pdf'

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

/** A photo creates a single-page work. */
export async function importPhoto(file: File, meta: WorkMeta): Promise<Work> {
  const { width, height, thumbnail } = await readImageFile(file)
  return createWork(db, {
    ...meta,
    source: 'photo',
    thumbnail,
    pages: [{ image: file, width, height }],
  })
}

/** A PDF creates one page per PDF page; the file is stored once and rendered on demand. */
export async function importPdf(file: File, meta: WorkMeta): Promise<Work> {
  const data = await file.arrayBuffer()
  const info = await inspectPdf(data)
  return createWork(db, {
    ...meta,
    source: 'pdf',
    thumbnail: info.thumbnail,
    pdf: new Blob([data], { type: 'application/pdf' }),
    pages: info.pages.map((p) => ({
      pdfPage: { index: p.index, widthPt: p.widthPt, heightPt: p.heightPt },
      width: p.width,
      height: p.height,
      dpi: p.dpi,
    })),
  })
}
