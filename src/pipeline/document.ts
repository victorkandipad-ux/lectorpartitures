// Page (document) detection in photos: largest convex quadrilateral among edge contours (Canny) and
// bright-region contours (Otsu), validated by checking that the inside of every edge is brighter
// than the outside (paper on a darker surface). Rejects the outline of the printed area itself.
import { withMats, type CV } from './cv'
import type { GrayImage } from './image'
import type { Point, Quad } from '../model/types'

export interface DocumentResult {
  /** Corners in the input image's coordinates (TL, TR, BR, BL). */
  quad: Quad
  /** 0–1: fraction of edges with a clear paper/background contrast. */
  confidence: number
  method: 'edges' | 'brightness'
}

const DETECT_SIDE = 800

export function orderCorners(pts: Point[]): Quad {
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y))
  const byDiff = [...pts].sort((a, b) => a.x - a.y - (b.x - b.y))
  return [bySum[0], byDiff[3], bySum[3], byDiff[0]]
}

function quadArea(q: Quad): number {
  let s = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

function isConvex(q: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const c = q[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    const s = Math.sign(cross)
    if (s === 0) return false
    if (sign && s !== sign) return false
    sign = s
  }
  return true
}

function mean(img: GrayImage, x: number, y: number): number {
  const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)))
  const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)))
  return img.data[yi * img.width + xi]
}

/** Edge contrast check. Returns the number of edges that look like paper borders, or -1 if the quad is the frame. */
function edgeContrast(img: GrayImage, q: Quad): { good: number; onBorder: number } {
  const { width: w, height: h } = img
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4
  const off = Math.max(3, 0.015 * Math.hypot(w, h))
  const margin = 0.015 * Math.max(w, h)
  let good = 0
  let onBorder = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const near = (p: Point) => p.x < margin || p.y < margin || p.x > w - 1 - margin || p.y > h - 1 - margin
    if (near(a) && near(b) && (Math.abs(a.x - b.x) < margin * 2 || Math.abs(a.y - b.y) < margin * 2)) {
      onBorder++
      good++
      continue
    }
    // Normal pointing inwards.
    let nx = -(b.y - a.y)
    let ny = b.x - a.x
    const len = Math.hypot(nx, ny) || 1
    nx /= len
    ny /= len
    const mx = (a.x + b.x) / 2
    const my = (a.y + b.y) / 2
    if ((cx - mx) * nx + (cy - my) * ny < 0) {
      nx = -nx
      ny = -ny
    }
    let inside = 0
    let outside = 0
    const N = 24
    for (let k = 1; k < N; k++) {
      const t = k / N
      const px = a.x + (b.x - a.x) * t
      const py = a.y + (b.y - a.y) * t
      inside += mean(img, px + nx * off, py + ny * off)
      outside += mean(img, px - nx * off, py - ny * off)
    }
    if ((inside - outside) / (N - 1) > 18) good++
  }
  return { good, onBorder }
}

export function detectDocument(cv: CV, src: GrayImage): DocumentResult | null {
  const scale = Math.min(1, DETECT_SIDE / Math.max(src.width, src.height))
  return withMats((track) => {
    const full = track(new cv.Mat(src.height, src.width, cv.CV_8UC1))
    full.data.set(src.data)
    const small = track(new cv.Mat())
    const w = Math.max(1, Math.round(src.width * scale))
    const h = Math.max(1, Math.round(src.height * scale))
    cv.resize(full, small, new cv.Size(w, h), 0, 0, cv.INTER_AREA)
    const blur = track(new cv.Mat())
    cv.GaussianBlur(small, blur, new cv.Size(5, 5), 0)
    const blurImg: GrayImage = { width: w, height: h, data: new Uint8Array(blur.data) }

    const sorted = Uint8Array.from(blurImg.data).sort()
    const med = sorted[sorted.length >> 1]
    const edges = track(new cv.Mat())
    cv.Canny(blur, edges, Math.max(10, 0.66 * med * 0.5), Math.min(255, 1.33 * med * 0.5))
    const kernel = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)))
    cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 2)

    const bright = track(new cv.Mat())
    cv.threshold(blur, bright, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU)
    const k9 = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)))
    cv.morphologyEx(bright, bright, cv.MORPH_CLOSE, k9)

    const imgArea = w * h
    let best: DocumentResult | null = null
    let bestArea = 0
    for (const [mask, method] of [
      [edges, 'edges'],
      [bright, 'brightness'],
    ] as const) {
      const contours = track(new cv.MatVector())
      const hierarchy = track(new cv.Mat())
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
      for (let i = 0; i < contours.size(); i++) {
        const c = track(contours.get(i))
        if (cv.contourArea(c) < 0.2 * imgArea) continue
        const hull = track(new cv.Mat())
        cv.convexHull(c, hull, false, true)
        const peri = cv.arcLength(hull, true)
        let quad: Quad | null = null
        for (const eps of [0.02, 0.03, 0.05, 0.08]) {
          const approx = track(new cv.Mat())
          cv.approxPolyDP(hull, approx, eps * peri, true)
          if (approx.rows === 4) {
            const pts: Point[] = []
            for (let j = 0; j < 4; j++) pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] })
            quad = orderCorners(pts)
            break
          }
        }
        if (!quad || !isConvex(quad)) continue
        const area = quadArea(quad)
        if (area < 0.2 * imgArea || area <= bestArea) continue
        const { good, onBorder } = edgeContrast(blurImg, quad)
        if (onBorder === 4 || good < 3) continue
        bestArea = area
        best = {
          quad: quad.map((p) => ({ x: p.x / scale, y: p.y / scale })) as Quad,
          confidence: good / 4,
          method,
        }
      }
    }
    return best
  })
}
