import { expect, test, type Page } from '@playwright/test'

test('loads the library shell in Spanish', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Biblioteca' })).toBeVisible()
  await expect(page.getByTestId('library-empty')).toContainText('Aún no tienes partituras')
})

test('has iOS install metadata', async ({ page }) => {
  await page.goto('./')
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1)
  expect(await page.locator('link[rel="apple-touch-startup-image"]').count()).toBeGreaterThan(10)
  const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
  expect(viewport).toContain('viewport-fit=cover')
  const manifest = await (await page.request.get('manifest.webmanifest')).json()
  expect(manifest.display).toBe('standalone')
  expect(manifest.scope).toBe('./')
})

test('hash routing navigates without a server round-trip', async ({ page }) => {
  await page.goto('./')
  await page.getByRole('button', { name: 'Ajustes' }).click()
  await expect(page).toHaveURL(/#\/ajustes$/)
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible()
})

async function waitForController(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((r) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => r(), { once: true }),
      )
    }
  })
}

test('service worker controls the page and precaches the shell', async ({ page }) => {
  await page.goto('./')
  await waitForController(page)
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(new URL(req.url).pathname)
    }
    return urls
  })
  expect(cached.some((u) => u.endsWith('/index.html'))).toBe(true)
  expect(cached.some((u) => u.endsWith('/manifest.webmanifest'))).toBe(true)
  const scripts = await page.locator('script[type="module"]').evaluateAll((els) =>
    els.map((e) => new URL((e as HTMLScriptElement).src).pathname),
  )
  for (const s of scripts) expect(cached.some((u) => u.split('?')[0] === s)).toBe(true)
})

// Playwright's WebKit cannot navigate offline through a service worker ("internal error"),
// so the true airplane-mode check runs in the Chromium project only (see playwright.config.ts).
test('@offline reloads with the network disabled', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'offline navigation via SW unsupported in Playwright WebKit')
  await page.goto('./')
  await waitForController(page)
  await context.setOffline(true)
  await page.goto('./#/ajustes')
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeVisible()
})
