import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AtrilDB } from '../../src/db/schema'
import { createWork, deleteWork, getBlob, getPages, listWorks, updateWorkMeta } from '../../src/db/repo'

let db: AtrilDB
let n = 0
beforeEach(async () => {
  db = new AtrilDB(`test-${n++}`)
  await db.open()
})
afterEach(async () => {
  await db.delete()
})

const blob = (s: string) => new Blob([s])

describe('repo', () => {
  it('creates a photo work with one page and its blobs', async () => {
    const w = await createWork(db, {
      title: '  Sonatina ',
      composer: 'Dvořák',
      tags: ['violín', ' violín', ''],
      source: 'photo',
      thumbnail: blob('t'),
      pages: [{ image: blob('img'), width: 4000, height: 3000 }],
    })
    expect(w.title).toBe('Sonatina')
    expect(w.tags).toEqual(['violín'])
    const pages = await getPages(db, w.id)
    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({ index: 0, width: 4000, height: 3000, auto: null, overrides: [] })
    expect(await (await getBlob(db, pages[0].originalBlobId))!.text()).toBe('img')
    expect(await (await getBlob(db, w.thumbBlobId))!.text()).toBe('t')
  })

  it('creates a multi-page PDF work sharing one PDF blob', async () => {
    const w = await createWork(db, {
      title: 'Op. 16',
      composer: '',
      tags: [],
      source: 'pdf',
      thumbnail: blob('t'),
      pdf: blob('%PDF'),
      pages: [0, 1, 2].map((index) => ({ pdfPage: { index, widthPt: 595, heightPt: 842 }, width: 2479, height: 3508, dpi: 300 })),
    })
    const pages = await getPages(db, w.id)
    expect(pages.map((p) => p.pdfPage?.index)).toEqual([0, 1, 2])
    expect(pages.every((p) => p.originalBlobId === undefined)).toBe(true)
    expect(w.pageIds).toEqual(pages.map((p) => p.id))
    expect(await db.blobs.count()).toBe(2)
  })

  it('updates metadata and orders by last update', async () => {
    const a = await createWork(db, { title: 'A', composer: '', tags: [], source: 'photo', thumbnail: blob(''), pages: [] })
    await new Promise((r) => setTimeout(r, 5))
    await createWork(db, { title: 'B', composer: '', tags: [], source: 'photo', thumbnail: blob(''), pages: [] })
    await new Promise((r) => setTimeout(r, 5))
    await updateWorkMeta(db, a.id, { title: 'A2', composer: 'X', tags: ['t'] })
    const list = await listWorks(db)
    expect(list.map((w) => w.title)).toEqual(['A2', 'B'])
  })

  it('deletes a work with its pages and blobs', async () => {
    const keep = await createWork(db, { title: 'K', composer: '', tags: [], source: 'photo', thumbnail: blob(''), pages: [{ image: blob('k'), width: 1, height: 1 }] })
    const w = await createWork(db, { title: 'D', composer: '', tags: [], source: 'photo', thumbnail: blob(''), pages: [{ image: blob('d'), width: 1, height: 1 }] })
    await deleteWork(db, w.id)
    expect(await db.works.count()).toBe(1)
    expect(await db.pages.count()).toBe(1)
    expect(await db.blobs.count()).toBe(2)
    expect((await listWorks(db))[0].id).toBe(keep.id)
  })
})
