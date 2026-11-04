import { create } from 'zustand'

interface AppState {
  offlineReady: boolean
  applyUpdate: (() => void) | null
  setOfflineReady: (v: boolean) => void
  setUpdate: (fn: () => void) => void
}

export const useAppStore = create<AppState>((set) => ({
  offlineReady: false,
  applyUpdate: null,
  setOfflineReady: (offlineReady) => set({ offlineReady }),
  setUpdate: (applyUpdate) => set({ applyUpdate }),
}))
