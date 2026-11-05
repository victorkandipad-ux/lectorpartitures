// Robustness bench: structure vs hand-labelled truth on the fixtures, then on degraded copies of them.
//   npm run bench                 fails if any metric is below bench/baseline.json
//   BENCH_UPDATE=1 npm run bench  rewrites the baseline (only after a justified improvement)
//   ONLY=21 npm run bench         filters by name (no comparison with the baseline)
// Timing is reported but never compared: it depends on the machine.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import type { PageStructure } from '../src/model/types'
import { liveMats } from '../src/pipeline/cv'
import { runPipeline } from '../src/pipeline/index'
import { loadOpenCVNode } from '../tests/support/opencv-node'
import { DEGRADATIONS } from './degrade'
import { FIXTURES_DIR, loadFixture } from './support'

const BASELINE = 'bench/baseline.json'
/** FIXTURES=... (validation set): report only, it has no baseline and nothing gets tuned on it. */
const HOLDOUT = !!process.env.FIXTURES
const REPORT = HOLDOUT ? 'bench/results/report-holdout.txt' : 'bench/results/report.txt'
const UPDATE = process.env.BENCH_UPDATE === '1'
const ONLY = process.env.ONLY
/** A barline "agrees" if it is within this fraction of the system width. */
const POSITION_TOLERANCE = 0.015

interface Truth {
  systems: number[]
  measures?: number[]
}

const equal = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i])
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0)

/** Barline positions per system, normalized to the width of the system. */
function barPositions(s: PageStructure | null): number[][] {
  return (s?.systems ?? []).map((sys) => {
    const x0 = sys.measures[0]?.xStart ?? 0
    const x1 = sys.measures[sys.measures.length - 1]?.xEnd ?? 1
    return sys.measures.slice(0, -1).map((m) => (m.xEnd - x0) / Math.max(1, x1 - x0))
  })
}

class Tally {
  n = 0
  staves = 0
  systems = 0
  measuresN = 0
  measures = 0
  add(t: Truth, s: PageStructure | null) {
    const sys = s?.systems ?? []
    const counts = sys.map((x) => x.staves.length)
    this.n++
    if (sum(counts) === sum(t.systems)) this.staves++
    if (equal(counts, t.systems)) this.systems++
    if (t.measures) {
      // Per system: only comparable when the systems themselves are right.
      this.measuresN += t.measures.length
      if (equal(counts, t.systems)) t.measures.forEach((m, i) => (this.measures += sys[i].measures.length === m ? 1 : 0))
    }
  }
}

test('robustness', async () => {
  mkdirSync('bench/results', { recursive: true })
  const cv = await loadOpenCVNode()
  const truth = JSON.parse(readFileSync(`${FIXTURES_DIR}/truth.json`, 'utf8')) as Record<string, Truth>
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.jpg') && (!ONLY || f.includes(ONLY)))
  const lines: string[] = []

  const clean = new Tally()
  const degraded = new Map(Object.keys(DEGRADATIONS).map((k) => [k, new Tally()]))
  let agreeN = 0
  let agree = 0
  let flaggedWrong = 0
  let wrong = 0
  let flaggedRight = 0
  let ms = 0

  for (const f of files) {
    const name = f.replace('.jpg', '')
    const t = truth[name]
    expect(t, `truth for ${name}`).toBeDefined()
    const gray = loadFixture(f)
    const r = runPipeline({ gray, kind: 'photo' }, cv)
    ms += r.totalMs
    clean.add(t, r.structure)
    const counts = r.structure?.systems.map((s) => s.staves.length) ?? []
    const okSystems = equal(counts, t.systems)
    if (!okSystems) {
      wrong++
      if (r.needsReview) flaggedWrong++
    } else if (r.needsReview) flaggedRight++
    const bars = barPositions(r.structure)
    const row = [
      name.slice(0, 26).padEnd(26),
      okSystems ? 'ok ' : 'BAD',
      `conf ${r.confidence.toFixed(2)}${r.needsReview ? ' REVIEW' : '       '}`,
      `sys ${counts.join(',')} m ${r.structure?.systems.map((s) => s.measures.length).join(',')}`,
    ]
    const issues: string[] = []
    for (const [key, fn] of Object.entries(DEGRADATIONS)) {
      const d = runPipeline({ gray: fn(gray), kind: 'photo' }, cv)
      ms += d.totalMs
      degraded.get(key)!.add(t, d.structure)
      const dCounts = d.structure?.systems.map((s) => s.staves.length) ?? []
      if (!equal(dCounts, t.systems)) issues.push(`${key}:${dCounts.join(',')}`)
      else if (t.measures) {
        const dm = d.structure?.systems.map((x) => x.measures.length) ?? []
        if (!equal(dm, t.measures)) issues.push(`${key}.m:${dm.join(',')}`)
      }
      // Barline stability against the undegraded run.
      const other = barPositions(d.structure)
      if (equal(dCounts, counts)) {
        bars.forEach((list, i) => {
          agreeN += list.length
          for (const b of list) if (other[i].some((o) => Math.abs(o - b) <= POSITION_TOLERANCE)) agree++
        })
      } else agreeN += sum(bars.map((b) => b.length))
    }
    lines.push(row.join(' ') + (issues.length ? `  | ${issues.join(' ')}` : ''))
  }
  expect(liveMats()).toBe(0)

  const round = (v: number) => Math.round(v * 1000) / 1000
  const rate = (a: number, b: number) => round(b ? a / b : 1)
  const metrics: Record<string, number> = {
    'clean.staves': rate(clean.staves, clean.n),
    'clean.systems': rate(clean.systems, clean.n),
    'clean.measures': rate(clean.measures, clean.measuresN),
  }
  const all = [...degraded.values()]
  for (const [k, v] of degraded) metrics[`degraded.${k}.systems`] = rate(v.systems, v.n)
  for (const [k, v] of degraded) metrics[`degraded.${k}.measures`] = rate(v.measures, v.measuresN)
  metrics['degraded.staves'] = rate(sum(all.map((v) => v.staves)), sum(all.map((v) => v.n)))
  metrics['degraded.systems'] = rate(sum(all.map((v) => v.systems)), sum(all.map((v) => v.n)))
  metrics['degraded.measures'] = rate(sum(all.map((v) => v.measures)), sum(all.map((v) => v.measuresN)))
  metrics['degraded.barlineAgreement'] = rate(agree, agreeN)

  const report = [
    ...lines,
    '',
    ...Object.entries(metrics).map(([k, v]) => `${k.padEnd(34)} ${v.toFixed(3)}`),
    `wrong pages flagged for review       ${flaggedWrong}/${wrong}`,
    `right pages flagged for review       ${flaggedRight}/${files.length - wrong}`,
    `pipeline time per page               ${Math.round(ms / (files.length * (1 + Object.keys(DEGRADATIONS).length)))} ms`,
  ].join('\n')
  writeFileSync(REPORT, report)

  if (ONLY || HOLDOUT) return
  if (UPDATE || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, JSON.stringify(metrics, null, 2) + '\n')
    return
  }
  const base = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>
  const worse = Object.entries(base).filter(([k, v]) => (metrics[k] ?? 0) < v)
  expect(worse.map(([k, v]) => `${k}: ${metrics[k]} < baseline ${v}`), `see ${REPORT}`).toEqual([])
})
