import { LibraryScreen } from '../library/LibraryScreen'
import { SettingsScreen } from '../settings/SettingsScreen'
import { es } from './i18n/es'
import { matchRoute, useHashPath } from './router'
import { useAppStore } from './store'

function Routes({ path }: { path: string }) {
  if (matchRoute('/', path)) return <LibraryScreen />
  if (matchRoute('/ajustes', path)) return <SettingsScreen />
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
