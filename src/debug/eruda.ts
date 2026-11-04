import { isDiagnosticsEnabled } from '../settings/settings'

/** Loads the Eruda in-page console (iPhone Safari cannot be inspected from Windows). */
export async function maybeLoadEruda() {
  if (!isDiagnosticsEnabled()) return
  const { default: eruda } = await import('eruda')
  eruda.init()
}
