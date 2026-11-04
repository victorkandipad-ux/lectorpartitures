import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { es } from '../app/i18n/es'
import { useBlobUrl } from '../app/hooks'
import { navigate } from '../app/router'
import { db } from '../db/schema'
import type { Work } from '../model/types'
import { PIPELINE_VERSION } from '../pipeline/version'

interface Props {
  work: Work
  onEditMeta: (w: Work) => void
  onDelete: (w: Work) => void
  onExport: (w: Work) => void
}

/** Pending / failed page counts of a work (live). */
function useWorkStatus(workId: string) {
  return useLiveQuery(async () => {
    const pages = await db.pages.where('workId').equals(workId).toArray()
    return {
      pending: pages.filter((p) => p.pipelineVersion < PIPELINE_VERSION).length,
      failed: pages.filter((p) => p.pipelineError).length,
    }
  }, [workId])
}

export function WorkCard({ work, onEditMeta, onDelete, onExport }: Props) {
  const status = useWorkStatus(work.id)
  const thumb = useBlobUrl(work.thumbBlobId)
  const [menu, setMenu] = useState(false)
  const title = work.title || es.library.untitled
  const open = () => navigate(`/obra/${work.id}`)

  return (
    <li className="card" data-testid="work-card">
      <button className="card-main" onClick={open} aria-label={`${es.work.open}: ${title}`}>
        <div className="card-thumb">{thumb && <img src={thumb} alt="" draggable={false} />}</div>
        <div className="card-text">
          <strong className="card-title">{title}</strong>
          <span className="card-sub">{work.composer || es.library.unknownComposer}</span>
          <span className="card-sub">{es.library.pages(work.pageIds.length)}</span>
          {status && status.pending > 0 && (
            <span className="card-status" data-testid="card-processing">
              {es.processing.pending}
            </span>
          )}
          {status && status.pending === 0 && status.failed > 0 && <span className="card-status error-text">{es.processing.failed}</span>}
          {work.tags.length > 0 && (
            <span className="tags">
              {work.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </span>
          )}
        </div>
      </button>
      <button
        className="icon-btn card-more"
        aria-label={`${es.work.actions}: ${title}`}
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
      >
        ⋯
      </button>
      {menu && (
        <div className="backdrop" onClick={() => setMenu(false)}>
          <div className="action-sheet" role="menu" onClick={(e) => e.stopPropagation()}>
            <p className="action-sheet-title">{title}</p>
            <button role="menuitem" onClick={open}>
              {es.work.open}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenu(false)
                onEditMeta(work)
              }}
            >
              {es.work.editMeta}
            </button>
            <button role="menuitem" disabled title={es.work.soon}>
              {es.work.editDetection}
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenu(false)
                onExport(work)
              }}
            >
              {es.work.export}
            </button>
            <button
              role="menuitem"
              className="danger"
              onClick={() => {
                setMenu(false)
                onDelete(work)
              }}
            >
              {es.work.delete}
            </button>
            <button className="cancel" onClick={() => setMenu(false)}>
              {es.meta.cancel}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
