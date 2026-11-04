import type { AtrilDB } from './schema'
import type { Page, PdfPageRef, StoredBlob, Work } from '../model/types'

export const newId = () => crypto.randomUUID()

async function toStored(id: string, blob: Blob): Promise<StoredBlob> {
  return { id, bytes: await blob.arrayBuffer(), type: blob.type }
}

export interface WorkMeta {
  title: string
  composer: string
  tags: string[]
}

export interface NewPageInput {
  /** Raster image file for photo pages. */
  image?: Blob
  pdfPage?: PdfPageRef
  width: number
  height: number
  dpi?: number
}

export interface NewWorkInput extends WorkMeta {
  source: Work['source']
  thumbnail: Blob
  pdf?: Blob
  pages: NewPageInput[]
}

export function cleanMeta(meta: WorkMeta): WorkMeta {
  const tags = [...new Set(meta.tags.map((t) => t.trim()).filter(Boolean))]
  return { title: meta.title.trim(), composer: meta.composer.trim(), tags }
}

export async function createWork(db: AtrilDB, input: NewWorkInput): Promise<Work> {
  const now = Date.now()
  const workId = newId()
  const thumbBlobId = newId()
  const pdfBlobId = input.pdf ? newId() : undefined
  const pages: Page[] = input.pages.map((p, index) => ({
    id: newId(),
    workId,
    index,
    originalBlobId: p.image ? newId() : undefined,
    pdfPage: p.pdfPage,
    width: p.width,
    height: p.height,
    dpi: p.dpi,
    auto: null,
    overrides: [],
    confidence: null,
    needsReview: false,
    pipelineVersion: 0,
  }))
  const work: Work = {
    id: workId,
    ...cleanMeta(input),
    source: input.source,
    pageIds: pages.map((p) => p.id),
    createdAt: now,
    updatedAt: now,
    thumbBlobId,
    pdfBlobId,
    view: { mode: 'page', scale: 1, anchor: null },
  }
  // Read all payloads before opening the transaction (IDB transactions auto-commit on await).
  const blobs: StoredBlob[] = [await toStored(thumbBlobId, input.thumbnail)]
  if (pdfBlobId && input.pdf) blobs.push(await toStored(pdfBlobId, input.pdf))
  for (let i = 0; i < pages.length; i++) {
    const img = input.pages[i].image
    const blobId = pages[i].originalBlobId
    if (img && blobId) blobs.push(await toStored(blobId, img))
  }
  await db.transaction('rw', db.works, db.pages, db.blobs, async () => {
    await db.blobs.bulkAdd(blobs)
    await db.pages.bulkAdd(pages)
    await db.works.add(work)
  })
  return work
}

export async function updateWorkMeta(db: AtrilDB, id: string, meta: WorkMeta) {
  await db.works.update(id, { ...cleanMeta(meta), updatedAt: Date.now() })
}

export async function updateWorkView(db: AtrilDB, id: string, view: Work['view']) {
  await db.works.update(id, { view })
}

export async function getPages(db: AtrilDB, workId: string): Promise<Page[]> {
  return (await db.pages.where('workId').equals(workId).toArray()).sort((a, b) => a.index - b.index)
}

export async function getBlob(db: AtrilDB, id: string | undefined): Promise<Blob | undefined> {
  if (!id) return undefined
  const stored = await db.blobs.get(id)
  return stored ? new Blob([stored.bytes], { type: stored.type }) : undefined
}

/** Deletes a work with all its pages and blobs. */
export async function deleteWork(db: AtrilDB, id: string) {
  await db.transaction('rw', db.works, db.pages, db.blobs, async () => {
    const work = await db.works.get(id)
    if (!work) return
    const pages = await db.pages.where('workId').equals(id).toArray()
    const blobIds = [work.thumbBlobId, work.pdfBlobId]
    for (const p of pages) blobIds.push(p.originalBlobId, p.cleanBlobId)
    await db.blobs.bulkDelete(blobIds.filter((b): b is string => !!b))
    await db.pages.bulkDelete(pages.map((p) => p.id))
    await db.works.delete(id)
  })
}

export async function listWorks(db: AtrilDB): Promise<Work[]> {
  return db.works.orderBy('updatedAt').reverse().toArray()
}
