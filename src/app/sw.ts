import { registerSW } from 'virtual:pwa-register'
import { useAppStore } from './store'

export function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  const update = registerSW({
    immediate: true,
    onOfflineReady() {
      useAppStore.getState().setOfflineReady(true)
    },
    onNeedRefresh() {
      useAppStore.getState().setUpdate(() => update(true))
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      // Installed iOS PWAs are rarely reloaded; check for a new version whenever the app is shown.
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => {})
      }
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      setInterval(check, 60 * 60 * 1000)
    },
  })
}
