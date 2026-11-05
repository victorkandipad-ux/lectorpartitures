import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { PDFDocument, rgb } from 'pdf-lib'

const JPG = 'bench/fixtures/real/01_dvorak_sonatina_op100_tema.jpg'

async function importFile(page: Page, testId: string, file: { name: string; mimeType: string; buffer: Buffer }, title: string) {
  await page.getByTestId(testId).setInputFiles(file)
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Título/).fill(title)
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByTestId('work-card')).toContainText(title)
}

async function vectorPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  for (let s = 0; s < 6; s++)
    for (let l = 0; l < 5; l++) {
      const y = 760 - s * 120 - l * 8
      page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.8, color: rgb(0, 0, 0) })
    }
  return Buffer.from(await doc.save())
}

test.beforeEach(async ({ page }) => {
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'Biblioteca' })).toBeVisible()
})

test('a photo is cleaned in the background and exported as a 1-bit PDF', async ({ page }) => {
  test.setTimeout(90_000)
  await importFile(page, 'input-gallery', { name: 'dvorak.jpg', mimeType: 'image/jpeg', buffer: readFileSync(JPG) }, 'Sonatina')
  // OpenCV (13 MB) is loaded and the page processed in the worker.
  await expect(page.getByTestId('card-processing')).toHaveCount(0, { timeout: 60_000 })

  await page.getByRole('button', { name: /Abrir: Sonatina/ }).click()
  const clean = page.locator('[data-testid="page"][data-clean="true"] img')
  await expect(clean).toBeVisible()
  await expect(clean).toHaveJSProperty('complete', true)
  // The clean page is upscaled to ≈300 dpi (the source is 1920 px wide).
  expect(await clean.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(1920)

  await page.getByRole('button', { name: 'Exportar PDF' }).click()
  const dialog = page.getByRole('dialog', { name: 'Exportar PDF' })
  await expect(dialog).toContainText('PDF en blanco y negro listo')
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByRole('link', { name: 'Descargar' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Sonatina.pdf')
  const bytes = readFileSync((await download.path())!)
  const pdf = bytes.toString('latin1')
  expect(pdf.startsWith('%PDF-')).toBe(true)
  const doc = await PDFDocument.load(bytes)
  expect(doc.getPageCount()).toBe(1)
  // Pure black and white: the only image is 1 bit per pixel, gray.
  expect(pdf).toMatch(/\/BitsPerComponent 1/)
  expect(pdf).toMatch(/\/ColorSpace \/DeviceGray/)
  expect(pdf).not.toMatch(/\/BitsPerComponent 8/)
})

test('vector PDF pages are processed without OpenCV', async ({ page }) => {
  await importFile(page, 'input-pdf', { name: 'v.pdf', mimeType: 'application/pdf', buffer: await vectorPdf() }, 'Vectorial')
  await expect(page.getByTestId('card-processing')).toHaveCount(0, { timeout: 30_000 })
  await page.getByRole('button', { name: /Abrir: Vectorial/ }).click()
  await expect(page.locator('[data-testid="page"][data-clean="true"] img')).toBeVisible()
  // Original page size is kept (A4 at 300 dpi).
  const w = await page.locator('[data-clean="true"] img').evaluate((el: HTMLImageElement) => el.naturalWidth)
  expect(Math.abs(w - 2479)).toBeLessThan(4)
})

test('diagnostics panel shows every pipeline step', async ({ page }) => {
  test.setTimeout(90_000)
  await page.evaluate(() => localStorage.setItem('atril.diagnostics', '1'))
  await page.reload()
  await importFile(page, 'input-gallery', { name: 'dvorak.jpg', mimeType: 'image/jpeg', buffer: readFileSync(JPG) }, 'Diag')
  await expect(page.getByTestId('card-processing')).toHaveCount(0, { timeout: 60_000 })
  await page.getByRole('button', { name: /Abrir: Diag/ }).click()
  // The Dvořák theme is one system of three staves and eight measures.
  await expect(page.getByTestId('structure-summary')).toHaveText('1 sistema · 8 compases')
  await page.getByRole('link', { name: 'Diagnóstico' }).click()
  await expect(page.getByTestId('diag-step')).toHaveCount(12, { timeout: 30_000 })
  await expect(page.getByText('Estructura (pentagramas, sistemas y compases)')).toBeVisible()
  await expect(page.getByText('Binarizado Sauvola')).toBeVisible()
  await expect(page.locator('.diag-image').first()).toBeVisible()
})
