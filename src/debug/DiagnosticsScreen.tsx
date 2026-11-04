// Pipeline diagnostics (#/diag, #/diag/:pageId): re-runs the pipeline on a page and shows every
// intermediate image with its timing and measurements. Nothing is saved.
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { es } from '../app/i18n/es'
import { db } from '../db/schema'
import { getPages, listWorks } from '../db/repo'
import type { Quad } from '../model/types'
import type { GrayImage } from '../pipeline/image'
import { describeError, processPage } from '../process/processor'
import type { ProcessResponse } from '../workers/pipeline.worker'

function StepImage({ image, quad }: { image: GrayImage; quad?: Quad }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = image.width
    c.height = image.height
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(image.width, image.height)
    for (let i = 0; i < image.data.length; i++) {
      const v = image.data[i]
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    if (quad) {
      ctx.strokeStyle = '#e5484d'
      ctx.lineWidth = Math.max(2, image.width / 300)
      ctx.beginPath()
      quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.closePath()
      ctx.stroke()
    }
    return () => {
      c.width = c.height = 0
    }
  }, [image, quad])
  return <canvas ref={ref} className="diag-image" />
}

function PageDiagnostics({ pageId }: { pageId: string }) {
  const [res, setRes] = useState<ProcessResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState(0)

  useEffect(() => {
    let alive = true
    setRes(null)
    setError(null)
    void (async () => {
      const page = await db.pages.get(pageId)
      if (!page) throw new Error('Page not found')
      const { res } = await processPage(db, page, { diagnostics: true })
      if (alive) setRes(res)
    })().catch((err) => alive && setError(describeError(err)))
    return () => {
      alive = false
    }
  }, [pageId, run])

  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    )
  if (!res)
    return (
      <p role="status">
        <span className="spinner small" /> {es.diag.running}
      </p>
    )
  return (
    <>
      <p className="diag-total">
        {es.diag.total(res.wallMs)} · {res.width}×{res.height} px · {Math.round(res.dpi)} ppp{' '}
        <button className="text-btn" onClick={() => setRun((r) => r + 1)}>
          {es.diag.rerun}
        </button>
      </p>
      <ol className="diag-steps">
        {res.steps.map((s, i) => (
          <li key={i} data-testid="diag-step">
            <h3>
              {es.diag.steps[s.name] ?? s.name} <small>{s.ms} ms</small>
            </h3>
            {s.info && (
              <dl>
                {Object.entries(s.info).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {s.image && <StepImage image={s.image} quad={s.quad} />}
          </li>
        ))}
      </ol>
    </>
  )
}

function PagePicker() {
  const data = useLiveQuery(async () => {
    const works = await listWorks(db)
    return Promise.all(works.map(async (w) => ({ work: w, pages: await getPages(db, w.id) })))
  }, [])
  return (
    <>
      <p>{es.diag.pickPage}</p>
      <ul className="diag-list">
        {data?.map(({ work, pages }) => (
          <li key={work.id}>
            <strong>{work.title || es.library.untitled}</strong>
            {pages.map((p) => (
              <a key={p.id} href={`#/diag/${p.id}`}>
                {es.diag.page(p.index + 1)}
              </a>
            ))}
          </li>
        ))}
      </ul>
    </>
  )
}

export function DiagnosticsScreen({ pageId }: { pageId?: string }) {
  return (
    <main className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => history.back()} aria-label={es.back}>
          ‹
        </button>
        <h1 className="work-title">{es.diag.title}</h1>
        <span style={{ width: 44 }} />
      </header>
      {pageId ? <PageDiagnostics pageId={pageId} /> : <PagePicker />}
    </main>
  )
}
