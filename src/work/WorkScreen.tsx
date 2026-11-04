// Temporary work view (phases 2–3): vertical list of the clean pages (or the originals).
// Replaced by the virtualized 3-mode viewer in phase 6.
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { es } from '../app/i18n/es'
import { useBlobUrl } from '../app/hooks'
import { db } from '../db/schema'
import { getBlob, getPages } from '../db/repo'
import { openPdf, renderPdfPage, type PdfHandle } from '../import/pdf'
import { ExportDialog } from '../export/ExportDialog'
import type { Page } from '../model/types'
import { PIPELINE_VERSION } from '../pipeline/version'
import { isDiagnosticsEnabled } from '../settings/settings'

function CleanPage({ page }: { page: Page }) {
  const url = useBlobUrl(page.cleanBlobId)
  return (
    <div
      className="page-frame"
      style={{ aspectRatio: `${page.cleanWidth} / ${page.cleanHeight}` }}
      data-testid="page"
      data-clean="true"
    >
      {url && <img src={url} alt="" draggable={false} />}
    </div>
  )
}

function PhotoPage({ page }: { page: Page }) {
  const url = useBlobUrl(page.originalBlobId)
  return (
    <div className="page-frame" style={{ aspectRatio: `${page.width} / ${page.height}` }} data-testid="page">
      {url && <img src={url} alt="" draggable={false} />}
    </div>
  )
}

function PdfPage({ page, doc }: { page: Page; doc: PDFDocumentProxy | null }) {
  const holder = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = holder.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '100% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const el = holder.current
    if (!el || !doc || !visible || !page.pdfPage) return
    let cancelled = false
    const target = el.clientWidth * Math.min(window.devicePixelRatio || 1, 3)
    void renderPdfPage(doc, page.pdfPage.index, target).then((canvas) => {
      if (cancelled) {
        canvas.width = canvas.height = 0
        return
      }
      el.replaceChildren(canvas)
    })
    return () => {
      cancelled = true
      // Free off-screen pages: iOS has a tight canvas memory budget.
      for (const c of el.querySelectorAll('canvas')) c.width = c.height = 0
      el.replaceChildren()
    }
  }, [doc, visible, page.pdfPage])

  return (
    <div
      ref={holder}
      className="page-frame"
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
      data-testid="page"
      aria-label={es.work.loadingPage}
    />
  )
}

export function WorkScreen({ id }: { id: string }) {
  // null = not found, undefined = still loading
  const work = useLiveQuery(async () => (await db.works.get(id)) ?? null, [id])
  const pages = useLiveQuery(() => getPages(db, id), [id])
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [exporting, setExporting] = useState(false)
  const diagnostics = isDiagnosticsEnabled()

  useEffect(() => {
    if (!work?.pdfBlobId) return
    let h: PdfHandle | null = null
    let alive = true
    void (async () => {
      const blob = await getBlob(db, work.pdfBlobId)
      if (!blob || !alive) return
      h = await openPdf(await blob.arrayBuffer())
      if (alive) setDoc(h.doc)
      else void h.close()
    })()
    return () => {
      alive = false
      void h?.close()
      setDoc(null)
    }
  }, [work?.pdfBlobId])

  if (work === null) {
    return (
      <main className="screen">
        <p>{es.work.notFound}</p>
        <a href="#/">{es.back}</a>
      </main>
    )
  }

  return (
    <main className="screen work-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => history.back()} aria-label={es.back}>
          ‹
        </button>
        <h1 className="work-title">{work?.title || es.library.untitled}</h1>
        <button className="text-btn" onClick={() => setExporting(true)} disabled={!work}>
          {es.work.export}
        </button>
      </header>
      <div className="segmented" role="group">
        <button aria-pressed={!showOriginal} onClick={() => setShowOriginal(false)}>
          {es.work.showClean}
        </button>
        <button aria-pressed={showOriginal} onClick={() => setShowOriginal(true)}>
          {es.work.showOriginal}
        </button>
      </div>
      <div className="pages">
        {pages?.map((p) => (
          <section key={p.id} className="page-item">
            {!showOriginal && p.cleanBlobId ? (
              <CleanPage page={p} />
            ) : p.pdfPage ? (
              <PdfPage page={p} doc={doc} />
            ) : (
              <PhotoPage page={p} />
            )}
            {(p.pipelineVersion < PIPELINE_VERSION || p.pipelineError || diagnostics) && (
              <p className="page-note">
                {p.pipelineVersion < PIPELINE_VERSION && es.processing.pending}
                {p.pipelineError && <span className="error-text">{es.processing.failed}</span>}
                {diagnostics && <a href={`#/diag/${p.id}`}>{es.work.diagnostics}</a>}
              </p>
            )}
          </section>
        ))}
      </div>
      {exporting && work && <ExportDialog work={work} onClose={() => setExporting(false)} />}
    </main>
  )
}
