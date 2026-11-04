// Per-device UI preferences (non-critical; storage may be unavailable).
const KEY = 'atril.diagnostics'

export function isDiagnosticsEnabled(): boolean {
  if (import.meta.env.DEV) return true
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setDiagnosticsEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
