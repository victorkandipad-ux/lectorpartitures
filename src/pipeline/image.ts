// Plain image containers used by the pipeline (no DOM, testable in Node).

/** 8-bit grayscale image, row-major. 0 = black, 255 = white. */
export interface GrayImage {
  width: number
  height: number
  data: Uint8Array
}

/** Binary image, one byte per pixel: 1 = ink (black), 0 = paper. */
export interface BinImage {
  width: number
  height: number
  data: Uint8Array
}

export function grayImage(width: number, height: number, fill = 0): GrayImage {
  const data = new Uint8Array(width * height)
  if (fill) data.fill(fill)
  return { width, height, data }
}

/** RGBA (or RGB with stride 3) to luma, BT.601 integer weights. */
export function rgbaToGray(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, channels = 4): GrayImage {
  const out = new Uint8Array(width * height)
  for (let i = 0, j = 0; i < out.length; i++, j += channels) {
    out[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8
  }
  return { width, height, data: out }
}

/** Area-average downscale by an arbitrary factor (scale ≤ 1). */
export function resizeArea(src: GrayImage, dstW: number, dstH: number): GrayImage {
  const { width: sw, height: sh, data } = src
  if (dstW >= sw && dstH >= sh) return resizeBilinear(src, dstW, dstH)
  const out = new Uint8Array(dstW * dstH)
  const fx = sw / dstW
  const fy = sh / dstH
  const acc = new Float64Array(dstW)
  const wsum = new Float64Array(dstW)
  // Precompute horizontal source spans per destination column.
  const x0s = new Int32Array(dstW)
  const x1s = new Int32Array(dstW)
  for (let x = 0; x < dstW; x++) {
    x0s[x] = Math.floor(x * fx)
    x1s[x] = Math.max(x0s[x] + 1, Math.min(sw, Math.floor((x + 1) * fx)))
  }
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * fy)
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.floor((y + 1) * fy)))
    acc.fill(0)
    wsum.fill(0)
    for (let sy = y0; sy < y1; sy++) {
      const row = sy * sw
      for (let x = 0; x < dstW; x++) {
        let s = 0
        const a = x0s[x]
        const b = x1s[x]
        for (let sx = a; sx < b; sx++) s += data[row + sx]
        acc[x] += s
        wsum[x] += b - a
      }
    }
    const o = y * dstW
    for (let x = 0; x < dstW; x++) out[o + x] = Math.round(acc[x] / wsum[x])
  }
  return { width: dstW, height: dstH, data: out }
}

export function resizeBilinear(src: GrayImage, dstW: number, dstH: number): GrayImage {
  const out = new Uint8Array(dstW * dstH)
  const sx = src.width / dstW
  const sy = src.height / dstH
  for (let y = 0; y < dstH; y++) {
    const fy = (y + 0.5) * sy - 0.5
    for (let x = 0; x < dstW; x++) {
      out[y * dstW + x] = sampleBilinear(src, (x + 0.5) * sx - 0.5, fy, 255)
    }
  }
  return { width: dstW, height: dstH, data: out }
}

/** Bilinear sample; returns `outside` for coordinates beyond the image. */
export function sampleBilinear(img: GrayImage, x: number, y: number, outside: number): number {
  const { width: w, height: h, data } = img
  if (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5) return outside
  const cx = x < 0 ? 0 : x > w - 1 ? w - 1 : x
  const cy = y < 0 ? 0 : y > h - 1 ? h - 1 : y
  const x0 = cx | 0
  const y0 = cy | 0
  const x1 = x0 + 1 < w ? x0 + 1 : x0
  const y1 = y0 + 1 < h ? y0 + 1 : y0
  const ax = cx - x0
  const ay = cy - y0
  const r0 = y0 * w
  const r1 = y1 * w
  const top = data[r0 + x0] + (data[r0 + x1] - data[r0 + x0]) * ax
  const bot = data[r1 + x0] + (data[r1 + x1] - data[r1 + x0]) * ax
  return top + (bot - top) * ay
}

/** Nearest-neighbour downscale of a binary image using "any ink" (max) pooling. */
export function binToGrayPreview(bin: BinImage, maxSide: number): GrayImage {
  const scale = Math.min(1, maxSide / Math.max(bin.width, bin.height))
  const w = Math.max(1, Math.round(bin.width * scale))
  const h = Math.max(1, Math.round(bin.height * scale))
  const gray = new Uint8Array(bin.width * bin.height)
  for (let i = 0; i < gray.length; i++) gray[i] = bin.data[i] ? 0 : 255
  return resizeArea({ width: bin.width, height: bin.height, data: gray }, w, h)
}

export function grayPreview(img: GrayImage, maxSide: number): GrayImage {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
  if (scale === 1) return { ...img, data: img.data.slice() }
  return resizeArea(img, Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)))
}

/** Otsu threshold over a 256-bin histogram. */
export function otsu(data: Uint8Array): number {
  const hist = new Float64Array(256)
  for (let i = 0; i < data.length; i++) hist[data[i]]++
  const total = data.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let bestT = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      bestT = t
    }
  }
  return bestT
}
