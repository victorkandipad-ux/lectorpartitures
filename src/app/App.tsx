import { DiagnosticsScreen } from '../debug/DiagnosticsScreen'
import { LibraryScreen } from '../library/LibraryScreen'
import { SettingsScreen } from '../settings/SettingsScreen'
import { WorkScreen } from '../work/WorkScreen'
import { es } from './i18n/es'
import { matchRoute, useHashPath } from './router'
import { useAppStore } from './store'

function Routes({ path }: { path: string }) {
  if (matchRoute('/', path)) return <LibraryScreen />
  if (matchRoute('/ajustes', path)) return <SettingsScreen />
  if (matchRoute('/diag', path)) return <DiagnosticsScreen />
  const diag = matchRoute('/diag/:pageId', path)
  if (diag) return <DiagnosticsScreen key={diag.pageId} pageId={diag.pageId} />
  const work = matchRoute('/obra/:id', path)
  if (work) return <WorkScreen key={work.id} id={work.id} />
  return (
    <main className="screen">
      <p>{es.notFound}</p>
      <a href="#/">{es.back}</a>
    </main>
  )
}

export function App() {
  const path = useHashPath()
  const applyUpdate = useAppStore((s) => s.applyUpdate)
  return (
    <>
      <Routes path={path} />
      {applyUpdate && (
        <div className="toast" role="status">
          {es.offline.updated}
          <button onClick={applyUpdate}>{es.offline.reload}</button>
        </div>
      )}
    </>
  )
}
