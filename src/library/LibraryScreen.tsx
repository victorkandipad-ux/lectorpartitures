import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type ChangeEvent } from 'react'
import { es } from '../app/i18n/es'
import { navigate } from '../app/router'
import { db } from '../db/schema'
import { deleteWork, listWorks, updateWorkMeta, type WorkMeta } from '../db/repo'
import { ImageDecodeError } from '../import/images'
import { importPdf, importPhoto, isPdf, type ImportKind } from '../import/importer'
import type { Work } from '../model/types'
import { ExportDialog } from '../export/ExportDialog'
import { kickQueue, warmUpPipeline } from '../process/processor'
import { MetadataDialog } from './MetadataDialog'
import { searchWorks, titleFromFilename } from './search'
import { WorkCard } from './WorkCard'

/** Readable error text for the Eruda console (minified errors are otherwise opaque). */
function describeError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err)
}

interface PendingImport {
  kind: ImportKind
  file: File
}

export function LibraryScreen() {
  const works = useLiveQuery(() => listWorks(db), [])
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [editing, setEditing] = useState<Work | null>(null)
  const [exporting, setExporting] = useState<Work | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visible = useMemo(() => searchWorks(works ?? [], query), [works, query])

  const onFile = (kind: ImportKind) => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again
    if (!file) return
    setPending({ kind, file })
    // Photos need OpenCV: load it while the user types the title.
    if (!isPdf(file)) warmUpPipeline()
  }

  const runImport = async (meta: WorkMeta) => {
    if (!pending) return
    const { file } = pending
    setPending(null)
    setBusy(true)
    setError(null)
    try {
      if (isPdf(file)) await importPdf(file, meta)
      else await importPhoto(file, meta)
      void kickQueue()
    } catch (err) {
      console.error('import failed:', describeError(err))
      setError(
        err instanceof ImageDecodeError ? es.import.errorImage : isPdf(file) ? es.import.errorPdf : es.import.errorGeneric,
      )
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (w: Work) => {
    if (!window.confirm(es.work.confirmDelete(w.title || es.library.untitled))) return
    await deleteWork(db, w.id)
  }

  return (
    <main className="screen">
      <header className="topbar">
        <h1>{es.library.title}</h1>
        <button className="icon-btn" aria-label={es.settings.title} onClick={() => navigate('/ajustes')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </header>

      {/*
        Each button is a <label> wrapping its file input: the OS opens the picker natively on tap.
        Calling .click() on a display:none input is silently ignored by some iOS versions.
      */}
      <div className="import-bar">
        <label className={`import-btn${busy ? ' disabled' : ''}`}>
          {es.import.camera}
          {/* Native camera: full resolution and autofocus. */}
          <input data-testid="input-camera" className="visually-hidden" type="file" accept="image/*" capture="environment" disabled={busy} onChange={onFile('camera')} />
        </label>
        <label className={`import-btn${busy ? ' disabled' : ''}`}>
          {es.import.gallery}
          <input data-testid="input-gallery" className="visually-hidden" type="file" accept="image/*" disabled={busy} onChange={onFile('gallery')} />
        </label>
        <label className={`import-btn${busy ? ' disabled' : ''}`}>
          {es.import.pdf}
          <input data-testid="input-pdf" className="visually-hidden" type="file" accept="application/pdf,.pdf" disabled={busy} onChange={onFile('pdf')} />
        </label>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {works && works.length > 0 && (
        <input
          className="search"
          type="search"
          placeholder={es.library.search}
          aria-label={es.library.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {works && works.length === 0 && (
        <div className="empty" data-testid="library-empty">
          <strong>{es.library.empty}</strong>
          {es.library.emptyHint}
        </div>
      )}
      {works && works.length > 0 && visible.length === 0 && <p className="empty">{es.library.noResults}</p>}

      <ul className="grid">
        {visible.map((w) => (
          <WorkCard key={w.id} work={w} onEditMeta={setEditing} onDelete={onDelete} onExport={setExporting} />
        ))}
      </ul>

      {pending && (
        <MetadataDialog
          heading={es.meta.newTitle}
          initial={{ title: titleFromFilename(pending.file.name), composer: '', tags: [] }}
          onSave={runImport}
          onCancel={() => setPending(null)}
        />
      )}
      {editing && (
        <MetadataDialog
          heading={es.meta.editTitle}
          initial={editing}
          onSave={async (meta) => {
            await updateWorkMeta(db, editing.id, meta)
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
        />
      )}
      {exporting && <ExportDialog work={exporting} onClose={() => setExporting(null)} />}
      {busy && (
        <div className="backdrop busy" role="status" aria-live="polite">
          <div className="spinner" />
          <span>{es.import.importing}</span>
        </div>
      )}
    </main>
  )
}
