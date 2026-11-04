import { expect, test, type Page } from '@playwright/test'
import { PDFDocument, rgb } from 'pdf-lib'
import { readFileSync } from 'node:fs'

const JPG = 'bench/fixtures/real/01_dvorak_sonatina_op100_tema.jpg'

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([595, 842])
    for (let s = 0; s < 6; s++) {
      for (let l = 0; l < 5; l++) {
        const y = 760 - s * 120 - l * 8
        page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: rgb(0, 0, 0) })
      }
    }
    page.drawText(`Pagina ${p + 1}`, { x: 50, y: 800, size: 18 })
  }
  return Buffer.from(await doc.save())
}

async function importFile(page: Page, testId: string, file: { name: string; mimeType: string; buffer: Buffer }, meta: { title?: string; composer?: string; tags?: string }) {
  await page.getByTestId(testId).setInputFiles(file)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  if (meta.title !== undefined) await dialog.getByLabel(/Título/).fill(meta.title)
  if (meta.composer !== undefined) await dialog.getByLabel(/Compositor/).fill(meta.composer)
  if (meta.tags !== undefined) await dialog.getByLabel(/Etiquetas/).fill(meta.tags)
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByRole('status')).toHaveCount(0, { timeout: 20_000 })
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Biblioteca' })).toBeVisible()
})

test('imports a photo from the gallery and opens it', async ({ page }) => {
  await importFile(page, 'input-gallery', { name: 'dvorak.jpg', mimeType: 'image/jpeg', buffer: readFileSync(JPG) }, { title: 'Sonatina', composer: 'Dvořák', tags: 'violín, tema' })
  const card = page.getByTestId('work-card')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('Sonatina')
  await expect(card).toContainText('Dvořák')
  await expect(card).toContainText('1 página')
  await expect(card.locator('img')).toHaveJSProperty('complete', true)

  await card.getByRole('button', { name: /Abrir: Sonatina/ }).click()
  await expect(page).toHaveURL(/#\/obra\//)
  await page.getByRole('button', { name: 'Original' }).click()
  const img = page.getByTestId('page').locator('img')
  await expect(img).toBeVisible()
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1920)

  // Persisted across reloads (IndexedDB).
  await page.goto('./')
  await expect(page.getByTestId('work-card')).toHaveCount(1)
})

test('imports a 2-page PDF and renders both pages', async ({ page }) => {
  await importFile(page, 'input-pdf', { name: 'estudio.pdf', mimeType: 'application/pdf', buffer: await makePdf(2) }, {})
  const card = page.getByTestId('work-card')
  await expect(card).toContainText('estudio') // title defaults to the file name
  await expect(card).toContainText('2 páginas')
  await card.getByRole('button', { name: /Abrir/ }).click()
  await page.getByRole('button', { name: 'Original' }).click()
  const pages = page.getByTestId('page')
  await expect(pages).toHaveCount(2)
  await expect(pages.nth(0).locator('canvas')).toBeVisible({ timeout: 15_000 })
  await pages.nth(1).scrollIntoViewIfNeeded()
  await expect(pages.nth(1).locator('canvas')).toBeVisible({ timeout: 15_000 })
  // A4 aspect ratio preserved.
  const box = (await pages.nth(0).boundingBox())!
  expect(box.height / box.width).toBeCloseTo(842 / 595, 1)
})

test('searches, edits metadata and deletes', async ({ page }) => {
  const jpg = readFileSync(JPG)
  await importFile(page, 'input-gallery', { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpg }, { title: 'Rinaldo', composer: 'Händel', tags: 'ópera' })
  await importFile(page, 'input-gallery', { name: 'b.jpg', mimeType: 'image/jpeg', buffer: jpg }, { title: 'Fuga', composer: 'Bach' })
  await expect(page.getByTestId('work-card')).toHaveCount(2)

  const search = page.getByRole('searchbox')
  await search.fill('handel opera')
  await expect(page.getByTestId('work-card')).toHaveCount(1)
  await expect(page.getByTestId('work-card')).toContainText('Rinaldo')
  await search.fill('')

  await page.getByRole('button', { name: 'Acciones: Fuga' }).click()
  await page.getByRole('menuitem', { name: 'Editar datos' }).click()
  await page.getByRole('dialog').getByLabel(/Título/).fill('Fuga en La bemol')
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByText('Fuga en La bemol')).toBeVisible()

  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Acciones: Rinaldo' }).click()
  await page.getByRole('menuitem', { name: 'Borrar' }).click()
  await expect(page.getByTestId('work-card')).toHaveCount(1)
  await expect(page.getByTestId('work-card')).toContainText('Fuga en La bemol')
})

test('shows a clear error for an unreadable image', async ({ page }) => {
  await importFile(page, 'input-gallery', { name: 'foto.heic', mimeType: 'image/heic', buffer: Buffer.from('not an image') }, {})
  await expect(page.getByRole('alert')).toContainText('No se ha podido leer la imagen')
  await expect(page.getByTestId('work-card')).toHaveCount(0)
})

test('tapping each import button opens the native file picker', async ({ page }) => {
  for (const [name, accept, capture] of [
    ['Cámara', 'image/*', 'environment'],
    ['Galería', 'image/*', null],
    ['PDF', 'application/pdf,.pdf', null],
  ] as const) {
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 5000 })
    await page.getByText(name, { exact: true }).tap()
    const chooser = await chooserPromise
    expect(await chooser.element().getAttribute('accept')).toBe(accept)
    expect(await chooser.element().getAttribute('capture')).toBe(capture)
  }
})
