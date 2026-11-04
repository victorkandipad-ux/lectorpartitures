import { useEffect, useState } from 'react'
import { es } from '../app/i18n/es'
import { isDiagnosticsEnabled, setDiagnosticsEnabled } from './settings'

export function SettingsScreen() {
  const [diag, setDiag] = useState(isDiagnosticsEnabled)
  const [storage, setStorage] = useState<{ persisted: boolean; usedMb: string } | null>(null)
  useEffect(() => {
    void (async () => {
      const persisted = (await navigator.storage?.persisted?.()) ?? false
      const est = await navigator.storage?.estimate?.()
      setStorage({ persisted, usedMb: ((est?.usage ?? 0) / 1e6).toFixed(1) })
    })()
  }, [])
  return (
    <main className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => history.back()} aria-label={es.back}>‹</button>
        <h1>{es.settings.title}</h1>
        <span style={{ width: 44 }} />
      </header>
      <section className="sheet">
        <label className="row">
          <span>{es.settings.diagnostics}</span>
          <input
            type="checkbox"
            checked={diag}
            disabled={import.meta.env.DEV}
            onChange={(e) => {
              setDiagnosticsEnabled(e.target.checked)
              setDiag(e.target.checked)
              location.reload()
            }}
          />
        </label>
        <p className="hint">{es.settings.diagnosticsHint}</p>
        {diag && (
          <a className="row" href="#/diag">
            {es.diag.title} ›
          </a>
        )}
      </section>
      {storage && (
        <section className="sheet" style={{ marginTop: 12 }}>
          <div className="row">
            <span>{es.settings.storage}</span>
            <span className="hint">{es.settings.used(storage.usedMb)}</span>
          </div>
          <p className="hint">{storage.persisted ? es.settings.persisted : es.settings.notPersisted}</p>
        </section>
      )}
      <p className="hint" style={{ textAlign: 'center', marginTop: 24 }}>v{__APP_VERSION__}</p>
    </main>
  )
}
