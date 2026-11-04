import Dexie, { type EntityTable } from 'dexie'
import type { Page, StoredBlob, Work } from '../model/types'

export class AtrilDB extends Dexie {
  works!: EntityTable<Work, 'id'>
  pages!: EntityTable<Page, 'id'>
  blobs!: EntityTable<StoredBlob, 'id'>

  constructor(name = 'atril') {
    super(name)
    this.version(1).stores({
      works: '&id, updatedAt',
      pages: '&id, workId',
      blobs: '&id',
    })
  }
}

export const db = new AtrilDB()

/** Ask the browser not to evict our data. iOS may still do so, hence the backup feature. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
