// Image decoding helpers (main thread). Heavy processing happens in the pipeline worker (phase 3).

export class ImageDecodeError extends Error {}

export const THUMB_WIDTH = 360

type Drawable = CanvasImageSource & { width: number; height: number }

function createCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export async function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type = 'image/jpeg',
  quality = 0.8,
): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality),
  )
}

/** Downscaled JPEG preview for the library grid. */
export async function makeThumbnail(src: Drawable, maxWidth = THUMB_WIDTH): Promise<Blob> {
  const scale = Math.min(1, maxWidth / src.width)
  const w = Math.max(1, Math.round(src.width * scale))
  const h = Math.max(1, Math.round(src.height * scale))
  const canvas = createCanvas(w, h)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('2D context unavailable')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  return canvasToBlob(canvas)
}

/**
 * Decodes a camera/gallery file honoring EXIF orientation. Safari decodes HEIC natively;
 * other desktop browsers may not, which surfaces as ImageDecodeError.
 */
export async function readImageFile(file: Blob): Promise<{ width: number; height: number; thumbnail: Blob }> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ImageDecodeError('decode failed')
  }
  try {
    return { width: bmp.width, height: bmp.height, thumbnail: await makeThumbnail(bmp) }
  } finally {
    bmp.close()
  }
}
