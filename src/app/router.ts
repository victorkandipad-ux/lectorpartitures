import { useSyncExternalStore } from 'react'

// Minimal hash router: avoids 404s on GitHub Pages (no server rewrites).
function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function currentPath(): string {
  const raw = window.location.hash.replace(/^#/, '')
  return raw === '' ? '/' : raw
}

export function useHashPath(): string {
  return useSyncExternalStore(subscribe, currentPath, () => '/')
}

export function navigate(path: string) {
  window.location.hash = path
}

/** Matches '/obra/:id' style patterns. Returns params or null. */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean)
  const s = path.split('?')[0].split('/').filter(Boolean)
  if (p.length !== s.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i])
    else if (p[i] !== s[i]) return null
  }
  return params
}
