import { describe, expect, it } from 'vitest'
import type { BinImage } from '../../src/pipeline/image'
import { detectStaves } from '../../src/pipeline/staves'
import { estimatePageSkew } from '../../src/pipeline/skew'
import { detectStructure } from '../../src/pipeline/structure'
import { rng } from '../support/synth'

// Hand-built binary pages: the ground truth is what gets drawn.
class Page implements BinImage {
  data: Uint8Array
  constructor(
    public width: number,
    public height: number,
  ) {
    this.data = new Uint8Array(width * height)
  }
  rect(x0: number, y0: number, x1: number, y1: number) {
    for (let y = Math.max(0, Math.round(y0)); y <= Math.min(this.height - 1, Math.round(y1)); y++)
      for (let x = Math.max(0, Math.round(x0)); x <= Math.min(this.width - 1, Math.round(x1)); x++) this.data[y * this.width + x] = 1
  }
  /** 5 lines from `top`; `dy(x)` bends them. */
  staff(top: number, ss: number, lt: number, x0: number, x1: number, dy: (x: number) => number = () => 0) {
    for (let l = 0; l < 5; l++)
      for (let x = x0; x <= x1; x++) {
        const y = top + l * ss + dy(x)
        this.rect(x, y, x, y + lt - 1)
      }
  }
  note(cx: number, cy: number, ss: number) {
    for (let y = -ss / 2; y <= ss / 2; y++)
      for (let x = -0.65 * ss; x <= 0.65 * ss; x++)
        if ((x / (0.65 * ss)) ** 2 + (y / (0.5 * ss)) ** 2 <= 1) this.rect(cx + x, cy + y, cx + x, cy + y)
  }
  /** Note with a stem that crosses the whole staff: the classic barline look-alike. */
  stemNote(cx: number, staffTop: number, ss: number, lt: number) {
    const cy = staffTop + 4 * ss
    this.note(cx, cy, ss)
    this.rect(cx + 0.55 * ss, staffTop - 1, cx + 0.55 * ss + lt - 1, cy)
  }
}

const barsOf = (r: ReturnType<typeof detectStructure>, sys = 0) => r.structure.systems[sys].measures.map((m) => m.xEnd)

describe('staff detection', () => {
  it.each([
    { ss: 10, lt: 2 },
    { ss: 20, lt: 3 },
    { ss: 34, lt: 5 },
  ])('finds line positions at every scale (ss $ss)', ({ ss, lt }) => {
    const w = 120 * ss
    const page = new Page(w, 60 * ss)
    const tops = [5 * ss, 20 * ss, 40 * ss]
    for (const t of tops) page.staff(t, ss, lt, 4 * ss, w - 4 * ss)
    const tracks = detectStaves(page, ss, lt)
    expect(tracks).toHaveLength(3)
    tracks.forEach((t, i) => {
      for (let l = 0; l < 5; l++) expect(Math.abs(t.lineYs[l] - (tops[i] + l * ss + (lt - 1) / 2))).toBeLessThan(1)
      expect(Math.abs(t.xStart - 4 * ss)).toBeLessThan(ss)
      expect(Math.abs(t.xEnd - (w - 4 * ss))).toBeLessThan(ss)
      expect(t.confidence).toBeGreaterThan(0.8)
    })
  })

  it('follows residual curvature larger than a staff space', () => {
    const ss = 16
    const w = 1600
    const page = new Page(w, 400)
    const dy = (x: number) => 30 * Math.sin((Math.PI * x) / w)
    page.staff(100, ss, 3, 60, w - 60, dy)
    const [t] = detectStaves(page, ss, 3)
    expect(t).toBeDefined()
    // The polyline follows the bend; the stored lineYs are its median.
    const mid = t.points[Math.floor(t.points.length / 2)]
    const end = t.points[0]
    expect(mid.ys[0] - end.ys[0]).toBeGreaterThan(15)
  })

  it('keeps a staff that does not span the page', () => {
    const ss = 16
    const page = new Page(1600, 400)
    page.staff(100, ss, 3, 800, 1500)
    const [t] = detectStaves(page, ss, 3)
    expect(Math.abs(t.xStart - 800)).toBeLessThan(ss)
  })

  it('ignores rows of text, hatching and dither', () => {
    const ss = 16
    const page = new Page(1600, 900)
    page.staff(60, ss, 3, 60, 1540)
    // Text-like rows: broken dashes at staff-like spacing.
    for (let row = 0; row < 5; row++) for (let x = 60; x < 1000; x += 22) page.rect(x, 300 + row * ss, x + 7, 302 + row * ss)
    // Dither: random specks.
    const rand = rng(7)
    for (let y = 550; y < 880; y++) for (let x = 0; x < 1600; x++) if (rand() < 0.3) page.rect(x, y, x, y)
    expect(detectStaves(page, ss, 3)).toHaveLength(1)
  })

  it('finds nothing on a blank page', () => {
    expect(detectStructure(new Page(800, 1000), 16, 3).structure.systems).toEqual([])
  })
})

describe('systems', () => {
  const ss = 16
  const lt = 3
  const w = 1600

  /** Grand staves; `connected` draws the left line and full-height barlines. */
  function grand(tops: [number, number][], connected: boolean, xs = [500, 900, 1300, 1540]) {
    const h = tops[tops.length - 1][1] + 12 * ss
    const page = new Page(w, h)
    for (const [a, b] of tops) {
      page.staff(a, ss, lt, 60, 1540)
      page.staff(b, ss, lt, 60, 1540)
      if (connected) page.rect(60, a, 60 + lt, b + 4 * ss)
      for (const x of xs) {
        if (connected) page.rect(x, a, x + lt, b + 4 * ss)
        else {
          page.rect(x, a, x + lt, a + 4 * ss + lt)
          page.rect(x, b, x + lt, b + 4 * ss + lt)
        }
      }
      page.note(250, a + 2 * ss, ss)
    }
    return page
  }

  it('joins staves through the left line and the barlines', () => {
    const r = detectStructure(grand([[100, 240], [500, 640]], true), ss, lt)
    expect(r.structure.systems.map((s) => s.staves.length)).toEqual([2, 2])
    expect(r.structure.systems[0].id).not.toBe(r.structure.systems[1].id)
    expect(r.needsReview).toBe(false)
    for (const x of [500, 900, 1300]) expect(barsOf(r).some((b) => Math.abs(b - x) <= ss)).toBe(true)
  })

  it('joins voice over piano from aligned barlines alone', () => {
    const r = detectStructure(grand([[100, 240]], false), ss, lt)
    expect(r.structure.systems.map((s) => s.staves.length)).toEqual([2])
  })

  it('keeps independent staves apart when their barlines differ', () => {
    const page = new Page(w, 800)
    page.staff(100, ss, lt, 60, 1540)
    page.staff(400, ss, lt, 60, 1540)
    for (const x of [300, 700, 1100, 1540]) page.rect(x, 100, x + lt, 100 + 4 * ss + lt)
    for (const x of [500, 950, 1400, 1540]) page.rect(x, 400, x + lt, 400 + 4 * ss + lt)
    page.note(200, 130, ss)
    page.note(200, 430, ss)
    const r = detectStructure(page, ss, lt)
    expect(r.structure.systems.map((s) => s.staves.length)).toEqual([1, 1])
  })

  it('a margin rule does not join two systems when the page layout says otherwise', () => {
    const page = grand([[100, 240], [500, 640], [900, 1040], [1300, 1440]], false)
    // Rule through the left margin, joining the second and third systems only.
    page.rect(30, 500, 34, 1040 + 4 * ss)
    const r = detectStructure(page, ss, lt)
    expect(r.structure.systems.map((s) => s.staves.length)).toEqual([2, 2, 2, 2])
  })

  it('a page-edge line does not join anything', () => {
    const page = grand([[100, 240], [500, 640]], false)
    page.rect(w - 6, 0, w - 4, page.height - 1)
    const r = detectStructure(page, ss, lt)
    expect(r.structure.systems.map((s) => s.staves.length)).toEqual([2, 2])
  })

  it('drops an unused ruled staff but keeps one with a clef', () => {
    const page = new Page(w, 900)
    page.staff(100, ss, lt, 60, 1540) // blank
    page.staff(400, ss, lt, 60, 1540)
    page.rect(90, 390, 130, 400 + 5 * ss) // clef-sized blot
    page.staff(700, ss, lt, 60, 1540)
    page.rect(90, 690, 130, 700 + 5 * ss)
    const r = detectStructure(page, ss, lt)
    expect(r.structure.systems.map((s) => s.staves[0].lineYs[0] > 300)).toEqual([true, true])
  })

  it('boxes contain their staves, do not overlap and stay inside the page', () => {
    const page = grand([[100, 240], [500, 640]], true)
    const r = detectStructure(page, ss, lt)
    const [a, b] = r.structure.systems
    expect(a.bbox.y).toBeLessThanOrEqual(a.staves[0].lineYs[0])
    expect(a.bbox.y + a.bbox.h).toBeGreaterThanOrEqual(a.staves[1].lineYs[4])
    expect(a.bbox.y + a.bbox.h).toBeLessThanOrEqual(b.bbox.y + 1)
    expect(b.bbox.y + b.bbox.h).toBeLessThanOrEqual(page.height)
    expect(a.bbox.x).toBeGreaterThanOrEqual(0)
    expect(a.bbox.x + a.bbox.w).toBeLessThanOrEqual(w)
  })
})

describe('measures', () => {
  const ss = 20
  const lt = 3
  const w = 2000
  const top = 100

  function solo(paint: (p: Page) => void) {
    const page = new Page(w, 400)
    page.staff(top, ss, lt, 80, 1900)
    paint(page)
    return detectStructure(page, ss, lt).structure.systems[0].measures
  }
  const bar = (p: Page, x: number, width = lt) => p.rect(x, top, x + width - 1, top + 4 * ss + lt - 1)

  it('measures tile the system, left to right', () => {
    const ms = solo((p) => [500, 900, 1400, 1900].forEach((x) => bar(p, x)))
    expect(ms).toHaveLength(4)
    expect(ms[0].xStart).toBeLessThan(100)
    ms.forEach((m, i) => {
      expect(m.xEnd).toBeGreaterThan(m.xStart)
      if (i > 0) expect(m.xStart).toBe(ms[i - 1].xEnd)
    })
    expect(new Set(ms.map((m) => m.id)).size).toBe(4)
  })

  it('stems with a notehead are not barlines', () => {
    const ms = solo((p) => {
      ;[500, 1000, 1900].forEach((x) => bar(p, x))
      ;[300, 700, 800, 1300, 1500].forEach((x) => p.stemNote(x, top, ss, lt))
    })
    expect(ms.map((m) => Math.round(m.xEnd / 100))).toEqual([5, 10, 19])
  })

  it('a note right above a barline that stops at the staff does not disqualify it', () => {
    const ms = solo((p) => {
      ;[500, 1000, 1900].forEach((x) => bar(p, x))
      p.note(1000, top - 1.2 * ss, ss)
    })
    expect(ms.map((m) => Math.round(m.xEnd / 100))).toEqual([5, 10, 19])
  })

  it('a thick barline in the middle of a system counts', () => {
    const ms = solo((p) => {
      ;[500, 1400, 1900].forEach((x) => bar(p, x))
      bar(p, 950, Math.round(1.2 * ss))
    })
    expect(ms.map((m) => Math.round(m.xEnd / 100))).toEqual([5, 10, 14, 19])
  })

  it('a start repeat right after the clef and key adds no measure', () => {
    const ms = solo((p) => {
      const x = 80 + 8 * ss // past the shortest first measure, within the widest header
      bar(p, x, 2 * lt)
      bar(p, x + 2 * lt + 3)
      const dotX = x + 2 * lt + 3 + lt + 0.5 * ss
      p.note(dotX, top + 1.5 * ss + lt / 2, 0.45 * ss)
      p.note(dotX, top + 2.5 * ss + lt / 2, 0.45 * ss)
      ;[800, 1900].forEach((x) => bar(p, x))
    })
    expect(ms.map((m) => Math.round(m.xEnd / 100))).toEqual([8, 19])
  })

  it('barlines slanted across a many-staff system still line up', () => {
    const tops = [40, 200, 360, 520, 680, 840]
    const page = new Page(w, 1000)
    const bottom = tops[tops.length - 1] + 4 * ss + lt - 1
    page.rect(76, tops[0], 76 + lt, bottom)
    for (const t of tops) {
      page.staff(t, ss, lt, 80, 1900)
      // The whole system leans: about 2 degrees, several staff spaces from top to bottom.
      for (const x of [600, 1100, 1600]) {
        const dx = (t - tops[0]) * 0.035
        page.rect(x + dx, t, x + dx + lt - 1, t + 4 * ss + lt - 1)
      }
    }
    const systems = detectStructure(page, ss, lt).structure.systems
    expect(systems).toHaveLength(1)
    expect(systems[0].measures).toHaveLength(4)
  })

  it('a stem-like stroke overshooting the staff is not a barline', () => {
    const ms = solo((p) => {
      ;[500, 1900].forEach((x) => bar(p, x))
      p.rect(1100, top - 3 * ss, 1100 + lt, top + 4 * ss)
    })
    expect(ms).toHaveLength(2)
  })

  it('a clef or time signature does not open a measure', () => {
    const ms = solo((p) => {
      p.rect(130, top, 150, top + 4 * ss) // solid block right after the start
      ;[800, 1900].forEach((x) => bar(p, x))
    })
    expect(ms.map((m) => Math.round(m.xEnd / 100))).toEqual([8, 19])
  })

  it('classifies double and final barlines', () => {
    const ms = solo((p) => {
      bar(p, 700)
      bar(p, 710) // double
      bar(p, 1300)
      bar(p, 1880)
      bar(p, 1892, 9) // thin + thick
    })
    expect(ms.map((m) => m.barline)).toEqual(['double', 'single', 'final'])
  })

  it('classifies repeat barlines by the side of the dots', () => {
    const dots = (p: Page, x: number) => {
      p.note(x, top + 1.5 * ss, 0.5 * ss)
      p.note(x, top + 2.5 * ss, 0.5 * ss)
    }
    const ms = solo((p) => {
      bar(p, 700)
      dots(p, 700 - 0.6 * ss)
      bar(p, 1300)
      dots(p, 1300 + lt + 0.6 * ss)
      bar(p, 1900)
    })
    expect(ms.map((m) => m.barline)).toEqual(['repeat-l', 'repeat-r', 'single'])
  })

  it('a system without barlines is one doubtful measure', () => {
    const page = new Page(w, 400)
    page.staff(top, ss, lt, 80, 1900)
    const r = detectStructure(page, ss, lt)
    // Blank staff: dropped. With music, one measure and a request for review.
    expect(r.structure.systems).toEqual([])
    page.rect(120, top, 160, top + 4 * ss)
    const q = detectStructure(page, ss, lt)
    expect(q.structure.systems[0].measures).toHaveLength(1)
    expect(q.needsReview).toBe(true)
  })

  it('tolerates slightly slanted, hand-drawn barlines', () => {
    const ms = solo((p) => {
      for (const x of [600, 1200]) for (let y = 0; y <= 4 * ss; y++) p.rect(x + y * 0.04, top + y, x + y * 0.04 + lt - 1, top + y)
      bar(p, 1900)
    })
    expect(ms.map((m) => Math.round(m.xEnd / 100))).toEqual([6, 12, 19])
  })
})

describe('page skew', () => {
  const ss = 20
  const lt = 3
  const tops = [100, 300, 500, 700, 900]

  it('a symmetric curl is not a rotation', () => {
    const page = new Page(2000, 1200)
    for (const t of tops) page.staff(t, ss, lt, 60, 1940, (x) => 30 * Math.sin((Math.PI * x) / 2000) ** 2)
    expect(Math.abs(estimatePageSkew(page).angleDeg)).toBeLessThan(0.5)
  })

  it('a rotated page keeps its angle', () => {
    const page = new Page(2000, 1200)
    for (const t of tops) page.staff(t, ss, lt, 60, 1940, (x) => (x - 1000) * Math.tan((1.5 * Math.PI) / 180))
    expect(estimatePageSkew(page).angleDeg).toBeCloseTo(1.5, 0)
  })
})
