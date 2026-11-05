// Deterministic degradations that mimic a phone photo of a page, applied to the fixtures.
import { applyHomography, squareToQuad } from '../src/pipeline/geometry'
import { grayImage, resizeArea, sampleBilinear, type GrayImage } from '../src/pipeline/image'
import { rng } from '../tests/support/synth'
import type { Quad } from '../src/model/types'

const PAPER = 235
const TABLE = 70

function rotate(img: GrayImage, deg: number): GrayImage {
  const out = grayImage(img.width, img.height, PAPER)
  const c = Math.cos((deg * Math.PI) / 180)
  const s = Math.sin((deg * Math.PI) / 180)
  const cx = img.width / 2
  const cy = img.height / 2
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const dx = x - cx
      const dy = y - cy
      out.data[y * img.width + x] = sampleBilinear(img, cx + c * dx + s * dy, cy - s * dx + c * dy, PAPER)
    }
  return out
}

/** The page on a dark table, photographed from an angle. */
function perspective(img: GrayImage): GrayImage {
  const w = img.width
  const h = img.height
  const W = Math.round(w * 1.25)
  const H = Math.round(h * 1.2)
  const quad: Quad = [
    { x: w * 0.13, y: h * 0.06 },
    { x: w * 1.14, y: h * 0.09 },
    { x: w * 1.2, y: h * 1.14 },
    { x: w * 0.05, y: h * 1.1 },
  ]
  // Splat a supersampled page grid: the homography goes from page to photo.
  const out = grayImage(W, H, TABLE)
  const M = squareToQuad(quad)
  const n = 2
  for (let y = 0; y < h * n; y++)
    for (let x = 0; x < w * n; x++) {
      const p = applyHomography(M, x / (w * n), y / (h * n))
      const xi = Math.round(p.x)
      const yi = Math.round(p.y)
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) out.data[yi * W + xi] = sampleBilinear(img, x / n, y / n, PAPER)
    }
  return out
}

/** A hand or phone shadow: darkens one corner with a soft edge. */
function shadow(img: GrayImage): GrayImage {
  const out = grayImage(img.width, img.height)
  const r = Math.hypot(img.width, img.height)
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const t = Math.min(1, Math.hypot(x, y) / (0.7 * r))
      const f = 0.4 + 0.6 * t * t * (3 - 2 * t)
      out.data[y * img.width + x] = Math.round(img.data[y * img.width + x] * f)
    }
  return out
}

function noise(img: GrayImage, sigma: number): GrayImage {
  const out = grayImage(img.width, img.height)
  const rand = rng(12345)
  for (let i = 0; i < img.data.length; i++) {
    const n = Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
    out.data[i] = Math.max(0, Math.min(255, Math.round(img.data[i] + sigma * n)))
  }
  return out
}

/** Slight defocus: a 3×3 box filter applied twice. */
function blur(img: GrayImage): GrayImage {
  const pass = (src: Uint8Array) => {
    const dst = new Uint8Array(src.length)
    const { width: w, height: h } = img
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const yy = Math.max(0, Math.min(h - 1, y + dy))
            const xx = Math.max(0, Math.min(w - 1, x + dx))
            s += src[yy * w + xx]
          }
        dst[y * w + x] = Math.round(s / 9)
      }
    return dst
  }
  return { width: img.width, height: img.height, data: pass(pass(img.data)) }
}

/** A page bending away from the camera near the spine. */
function curl(img: GrayImage): GrayImage {
  const out = grayImage(img.width, img.height, PAPER)
  const amp = 0.012 * img.height
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const t = x / img.width
      out.data[y * img.width + x] = sampleBilinear(img, x, y - amp * Math.sin(Math.PI * t) ** 2, PAPER)
    }
  return out
}

export const DEGRADATIONS: Record<string, (img: GrayImage) => GrayImage> = {
  rotate3: (img) => rotate(img, 3),
  perspective,
  shadow,
  noise: (img) => noise(img, 18),
  blur,
  lowres: (img) => resizeArea(img, Math.round(img.width * 0.6), Math.round(img.height * 0.6)),
  curl,
}
