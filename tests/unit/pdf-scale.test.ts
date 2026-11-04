import { describe, expect, it } from 'vitest'
import { clampScale, MAX_RENDER_PIXELS, MAX_RENDER_SIDE } from '../../src/import/pdf'

describe('clampScale', () => {
  it('keeps renders under the iOS canvas limits', () => {
    for (const [w, h, s] of [[595, 842, 10], [2000, 300, 5], [612, 792, 1]]) {
      const k = clampScale(w, h, s)
      expect(w * k).toBeLessThanOrEqual(MAX_RENDER_SIDE + 1e-6)
      expect(h * k).toBeLessThanOrEqual(MAX_RENDER_SIDE + 1e-6)
      expect(w * k * h * k).toBeLessThanOrEqual(MAX_RENDER_PIXELS + 1)
    }
    expect(clampScale(612, 792, 1)).toBe(1)
  })
})
