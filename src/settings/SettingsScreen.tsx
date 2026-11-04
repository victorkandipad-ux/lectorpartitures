import { useState } from 'react'
import { es } from '../app/i18n/es'
import { isDiagnosticsEnabled, setDiagnosticsEnabled } from './settings'

export function SettingsScreen() {
  const [diag, setDiag] = useState(isDiagnosticsEnabled)
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
      </section>
      <p className="hint" style={{ textAlign: 'center', marginTop: 24 }}>v{__APP_VERSION__}</p>
    </main>
  )
}
