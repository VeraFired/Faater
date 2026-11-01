/**
 * Fusion ablation for BUG-001 (A: language-aware Arabic weight, D: coverage).
 *
 * The acceptance rule is fixed before looking at the numbers:
 *   - overall hit@5 must not fall
 *   - direct hit@5 may fall by at most 2 points
 *   - paraphrase hit@5 may fall by at most 2 points
 *
 * The pilot is the development set. Never point this at the blind set or the
 * scope holdout; they are frozen and burned respectively.
 *
 * Usage: node pipeline/tools/ablate-fusion.ts [set.json] [--sweep]
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Retriever, type RetrieverOptions } from '../lib/retrieve.ts'
import { loadData, runEval, type EvalSet } from '../eval.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const setPath =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(ROOT, 'eval', 'pilot.json')
const set: EvalSet = JSON.parse(await readFile(setPath, 'utf8'))
const data = await loadData()

interface Metrics {
  hit5: { hit: number; n: number }
  direct: { hit: number; n: number }
  paraphrase: { hit: number; n: number }
  en: { hit: number; n: number }
  fa: { hit: number; n: number }
  mrr: number
}

const measure = (options: RetrieverOptions): Metrics => {
  const ev = runEval(set.items, new Retriever(data, options), 5, 0.05)
  const gold = ev.results.filter((r) => r.expect === 'answer' && r.expect_refs?.length)
  const at = (slice: typeof gold, k = 5) => ({
    hit: slice.filter((r) => r.firstGoldRank !== null && r.firstGoldRank <= k).length,
    n: slice.length,
  })
  const mrr = (slice: typeof gold) =>
    slice.reduce((sum, r) => sum + (r.firstGoldRank ? 1 / r.firstGoldRank : 0), 0) /
    (slice.length || 1)
  const direct = gold.filter((r) => r.category === 'answerable_direct')
  const paraphrase = gold.filter((r) => r.category === 'answerable_paraphrase')

  return {
    hit5: at(gold),
    direct: at(direct),
    paraphrase: at(paraphrase),
    en: at(gold.filter((r) => r.lang === 'en')),
    fa: at(gold.filter((r) => r.lang === 'fa')),
    mrr: mrr(gold),
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const rate = (m: { hit: number; n: number }) => (m.n ? m.hit / m.n : 0)
const cell = (m: { hit: number; n: number }) => `${pct(rate(m))} (${m.hit}/${m.n})`
const delta = (a: number, b: number) => `${b >= a ? '+' : ''}${((b - a) * 100).toFixed(1)} pt`

const literalOnly = measure({ conceptExpansion: false, coverageRerank: false, faQueryArWeight: 1 })
const baseline = measure({ conceptExpansion: true, coverageRerank: false, faQueryArWeight: 1 })
const coverageOnly = measure({ conceptExpansion: true, coverageRerank: true, faQueryArWeight: 1 })
const languageOnly = measure({ conceptExpansion: true, coverageRerank: false, faQueryArWeight: 0.3 })
const shipped = measure({ conceptExpansion: true, coverageRerank: true, faQueryArWeight: 0.3 })

const sweepWeight = (weight: number) =>
  measure({ conceptExpansion: true, coverageRerank: true, faQueryArWeight: weight })
const sweepAlpha = (alpha: number) =>
  measure({ conceptExpansion: true, coverageRerank: true, coverageAlpha: alpha, faQueryArWeight: 0.3 })

if (process.argv.includes('--sweep')) {
  console.log('Arabic literal weight sweep — coverage ON, Persian requests only\n')
  console.log('| ar weight | hit@5 | direct | paraphrase | EN hit@5 | FA hit@5 | MRR |')
  console.log('|---:|---:|---:|---:|---:|---:|---:|')
  for (const w of [0, 0.15, 0.3, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 1]) {
    const m = sweepWeight(w)
    console.log(
      `| ${w} | ${cell(m.hit5)} | ${cell(m.direct)} | ${cell(m.paraphrase)} | ${cell(m.en)} | ${cell(m.fa)} | ${m.mrr.toFixed(3)} |`,
    )
  }

  console.log('\nCoverage multiplier sweep — ar weight 0.3\n')
  console.log('| alpha | hit@5 | direct | paraphrase | EN hit@5 | FA hit@5 | MRR |')
  console.log('|---:|---:|---:|---:|---:|---:|---:|')
  for (const alpha of [0, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
    const m = sweepAlpha(alpha)
    console.log(
      `| ${alpha} | ${cell(m.hit5)} | ${cell(m.direct)} | ${cell(m.paraphrase)} | ${cell(m.en)} | ${cell(m.fa)} | ${m.mrr.toFixed(3)} |`,
    )
  }
  process.exit(0)
}

console.log('BUG-001 fusion ablation — pilot set, one code path, flags only\n')
console.log('| variant | hit@5 | direct | paraphrase | EN hit@5 | FA hit@5 | MRR |')
console.log('|---|---:|---:|---:|---:|---:|---:|')
for (const [name, m] of [
  ['literal only', literalOnly],
  ['concept only (v0.1.0)', baseline],
  ['+ coverage (D)', coverageOnly],
  ['+ language weight (A)', languageOnly],
  ['+ A + D (candidate)', shipped],
] as const) {
  console.log(
    `| ${name} | ${cell(m.hit5)} | ${cell(m.direct)} | ${cell(m.paraphrase)} | ${cell(m.en)} | ${cell(m.fa)} | ${m.mrr.toFixed(3)} |`,
  )
}

const hitHolds = rate(shipped.hit5) >= rate(baseline.hit5)
const directHolds = rate(shipped.direct) >= rate(baseline.direct) - 0.02
const paraphraseHolds = rate(shipped.paraphrase) >= rate(baseline.paraphrase) - 0.02

console.log('')
console.log(`overall hit@5 does not fall: ${hitHolds ? 'PASS' : 'FAIL'} (${delta(rate(baseline.hit5), rate(shipped.hit5))})`)
console.log(`direct hit@5 within 2 pt: ${directHolds ? 'PASS' : 'FAIL'} (${delta(rate(baseline.direct), rate(shipped.direct))})`)
console.log(`paraphrase hit@5 within 2 pt: ${paraphraseHolds ? 'PASS' : 'FAIL'} (${delta(rate(baseline.paraphrase), rate(shipped.paraphrase))})`)
console.log(`ACCEPTANCE: ${hitHolds && directHolds && paraphraseHolds ? 'PASS' : 'FAIL'}`)
process.exitCode = hitHolds && directHolds && paraphraseHolds ? 0 : 1