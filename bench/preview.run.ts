// Writes cleaned fixtures to bench/results/preview for visual inspection:
//   npx vitest run -c vitest.bench.config.ts preview      (ONLY=21 to filter by name)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import jpeg from 'jpeg-js'
import { expect, test } from 'vitest'
import { encodePng1bit } from '../src/export/png1bit'
import { liveMats } from '../src/pipeline/cv'
import { rgbaToGray } from '../src/pipeline/image'
import { runPipeline } from '../src/pipeline/index'
import { loadOpenCVNode } from '../tests/support/opencv-node'

const DIR = 'bench/fixtures/real'
const OUT = 'bench/results/preview'

test('preview', async () => {
  mkdirSync(OUT, { recursive: true })
  const cv = await loadOpenCVNode()
  const only = process.env.ONLY
  const log: string[] = []
  for (const f of readdirSync(DIR).filter((f) => f.endsWith('.jpg') && (!only || f.includes(only)))) {
    const d = jpeg.decode(readFileSync(`${DIR}/${f}`), { useTArray: true, maxMemoryUsageInMB: 1024 })
    const gray = rgbaToGray(d.data, d.width, d.height)
    const r = runPipeline({ gray, kind: 'photo' }, cv)
    writeFileSync(`${OUT}/${f.replace('.jpg', '.png')}`, encodePng1bit(r.clean, r.dpi))
    log.push(
      [
        f.slice(0, 30).padEnd(30),
        `${r.clean.width}x${r.clean.height}`.padEnd(10),
        `dpi ${r.dpi.toFixed(0)} ss ${r.staffSpace?.toFixed(1)} lt ${r.lineThickness?.toFixed(1)} c ${r.staffConfidence.toFixed(2)}`,
        `skew ${r.skewDeg} dew ${r.dewarpMaxPx.toFixed(1)} doc ${r.corners ? r.docConfidence : '-'} ${r.totalMs}ms`,
        r.steps.map((s) => `${s.name}:${s.ms}`).join(' '),
      ].join(' '),
    )
  }
  writeFileSync(`${OUT}/log.txt`, log.join('\n'))
  expect(liveMats()).toBe(0)
})
