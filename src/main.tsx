import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { setupServiceWorker } from './app/sw'
import { maybeLoadEruda } from './debug/eruda'
import './app/styles.css'

// iOS ignores user-scalable=no: block native page pinch-zoom; the viewer implements its own.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
}

void maybeLoadEruda()
setupServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
