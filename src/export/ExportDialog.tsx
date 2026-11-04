import { useEffect, useState } from 'react'
import { es } from '../app/i18n/es'
import { db } from '../db/schema'
import type { Work } from '../model/types'
import { exportWorkPdf, NotProcessedError } from './exportWork'

type State = { kind: 'building' } | { kind: 'ready'; file: File; url: string } | { kind: 'error'; message: string }

/**
 * Two steps on purpose: iOS only allows navigator.share() inside a fresh user gesture, and building
 * the PDF takes time. So we build first, then the user taps «Compartir».
 */
export function ExportDialog({ work, onClose }: { work: Work; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: 'building' })

  useEffect(() => {
    let alive = true
    let url: string | null = null
    exportWorkPdf(db, work).then(
      (file) => {
        url = URL.createObjectURL(file)
        if (alive) setState({ kind: 'ready', file, url })
      },
      (err) => {
        console.error('export failed:', err)
        if (alive) setState({ kind: 'error', message: err instanceof NotProcessedError ? es.exportPdf.notProcessed : es.exportPdf.error })
      },
    )
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [work])

  const canShare = state.kind === 'ready' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [state.file] })

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label={es.exportPdf.title} onClick={(e) => e.stopPropagation()}>
        <h2>{es.exportPdf.title}</h2>
        {state.kind === 'building' && (
          <p role="status" className="export-status">
            <span className="spinner small" /> {es.exportPdf.building}
          </p>
        )}
        {state.kind === 'error' && (
          <p className="error" role="alert">
            {state.message}
          </p>
        )}
        {state.kind === 'ready' && <p role="status">{es.exportPdf.ready(work.pageIds.length, Math.ceil(state.file.size / 1024))}</p>}
        <div className="dialog-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>
            {es.close}
          </button>
          {state.kind === 'ready' && (
            <a className="primary-btn" href={state.url} download={state.file.name}>
              {es.exportPdf.download}
            </a>
          )}
          {canShare && state.kind === 'ready' && (
            <button
              type="button"
              className="primary-btn"
              onClick={() => void navigator.share({ files: [state.file], title: work.title }).catch(() => {})}
            >
              {es.exportPdf.share}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
