import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { setupServiceWorker } from './app/sw'
import { maybeLoadEruda } from './debug/eruda'
import { requestPersistentStorage } from './db/schema'
import { kickQueue } from './process/processor'
import './app/styles.css'

// iOS ignores user-scalable=no: block native page pinch-zoom; the viewer implements its own.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
}

void maybeLoadEruda()
setupServiceWorker()
void requestPersistentStorage()
// Process pages left pending (new imports interrupted, or a newer pipeline version).
void kickQueue()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
