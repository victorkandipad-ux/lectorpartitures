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
  })
}
