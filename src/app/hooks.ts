import { useEffect, useState } from 'react'
import { db } from '../db/schema'
import { getBlob } from '../db/repo'

/** Object URL for a stored blob; revoked on change/unmount. */
export function useBlobUrl(blobId: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    let alive = true
    let created: string | undefined
    void getBlob(db, blobId).then((blob) => {
      if (!alive || !blob) return
      created = URL.createObjectURL(blob)
      setUrl(created)
    })
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
      setUrl(undefined)
    }
  }, [blobId])
  return url
}
