// Builds the clean PDF of a work from the stored pages (pdf-lib is loaded on demand).
import type { AtrilDB } from '../db/schema'
import { getPages } from '../db/repo'
import type { Work } from '../model/types'

export class NotProcessedError extends Error {}

export async function exportWorkPdf(db: AtrilDB, work: Work): Promise<File> {
  const pages = await getPages(db, work.id)
  const { buildCleanPdf, pageSizePt, pdfFileName } = await import('./pdf')
  const items = []
  for (const p of pages) {
    const stored = p.cleanBlobId ? await db.blobs.get(p.cleanBlobId) : undefined
    if (!stored) throw new NotProcessedError(p.id)
    items.push({ png: new Uint8Array(stored.bytes), ...pageSizePt(p) })
  }
  const bytes = await buildCleanPdf(items, { title: work.title, composer: work.composer })
  return new File([bytes as Uint8Array<ArrayBuffer>], pdfFileName(work.title), { type: 'application/pdf' })
}
