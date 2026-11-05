// Writes cleaned fixtures to bench/results/preview and structure overlays for visual inspection:
//   npx vitest run -c vitest.bench.config.ts preview      (ONLY=21 to filter by name)
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { encodePng1bit } from '../src/export/png1bit'
import { liveMats } from '../src/pipeline/cv'
import { runPipeline } from '../src/pipeline/index'
import { loadOpenCVNode } from '../tests/support/opencv-node'
import { FIXTURES_DIR, loadFixture, structureOverlay } from './support'

const OUT = 'bench/results/preview'

test('preview', async () => {
  mkdirSync(OUT, { recursive: true })
  const cv = await loadOpenCVNode()
  const only = process.env.ONLY
  const log: string[] = []
  for (const f of readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.jpg') && (!only || f.includes(only)))) {
    const r = runPipeline({ gray: loadFixture(f), kind: 'photo' }, cv)
    writeFileSync(`${OUT}/${f.replace('.jpg', '.png')}`, encodePng1bit(r.clean, r.dpi))
    writeFileSync(`${OUT}/${f.replace('.jpg', '.overlay.jpg')}`, structureOverlay(r.clean, r.structure))
    const systems = r.structure?.systems ?? []
    log.push(
      [
        f.slice(0, 30).padEnd(30),
        `${r.clean.width}x${r.clean.height}`.padEnd(10),
        `dpi ${r.dpi.toFixed(0)} ss ${r.staffSpace?.toFixed(1)} lt ${r.lineThickness?.toFixed(1)} c ${r.staffConfidence.toFixed(2)}`,
        `skew ${r.skewDeg} dew ${r.dewarpMaxPx.toFixed(1)} doc ${r.corners ? r.docConfidence : '-'} ${r.totalMs}ms`,
        `struct ${systems.map((s) => `${s.staves.length}:${s.measures.length}`).join(' ')} conf ${r.confidence.toFixed(2)}${r.needsReview ? ' REVIEW' : ''}`,
        r.steps.map((s) => `${s.name}:${s.ms}`).join(' '),
      ].join(' '),
    )
  }
  writeFileSync(`${OUT}/log.txt`, log.join('\n'))
  expect(liveMats()).toBe(0)
})
