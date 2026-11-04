// Clean PDF export: every page is a 1-bit DeviceGray image XObject whose data is the IDAT stream of
// the stored PNG (Flate + PNG predictor 15), so nothing is decoded or recompressed. pdf-lib's
// embedPng() would expand the image to 8-bit RGB. Page size = original PDF page, or the photo's
// estimated physical size.
import { PDFDocument, concatTransformationMatrix, drawObject, popGraphicsState, pushGraphicsState } from 'pdf-lib'
import { readPng } from './png1bit'

export interface ExportPage {
  png: Uint8Array
  widthPt: number
  heightPt: number
}

export async function buildCleanPdf(pages: ExportPage[], meta: { title: string; composer: string }): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(meta.title)
  if (meta.composer) doc.setAuthor(meta.composer)
  doc.setCreator('Atril')
  doc.setProducer('Atril')
  for (const p of pages) {
    const png = readPng(p.png)
    if (png.bitDepth !== 1 || png.colorType !== 0) throw new Error('Expected a 1-bit grayscale PNG')
    const stream = doc.context.stream(png.idat, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: png.width,
      Height: png.height,
      ColorSpace: 'DeviceGray',
      BitsPerComponent: 1,
      Filter: 'FlateDecode',
      DecodeParms: { Predictor: 15, Colors: 1, BitsPerComponent: 1, Columns: png.width },
    })
    const ref = doc.context.register(stream)
    const page = doc.addPage([p.widthPt, p.heightPt])
    const name = page.node.newXObject('Im', ref)
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(p.widthPt, 0, 0, p.heightPt, 0, 0),
      drawObject(name),
      popGraphicsState(),
    )
  }
  return doc.save({ useObjectStreams: true })
}


/** Page size in points for a stored page (PDF: original size; photo: from the clean page resolution). */
export function pageSizePt(page: {
  pdfPage?: { widthPt: number; heightPt: number }
  cleanWidth?: number
  cleanHeight?: number
  cleanDpi?: number
}): { widthPt: number; heightPt: number } {
  if (page.pdfPage) return { widthPt: page.pdfPage.widthPt, heightPt: page.pdfPage.heightPt }
  const dpi = page.cleanDpi || 300
  return { widthPt: ((page.cleanWidth ?? 0) / dpi) * 72, heightPt: ((page.cleanHeight ?? 0) / dpi) * 72 }
}

export function pdfFileName(title: string): string {
  const base = title.normalize('NFC').replace(/[\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'partitura'
  return `${base}.pdf`
}
