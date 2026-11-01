/**
 * Concept-layer ablation.
 *
 * Runs the same eval set with concept expansion on and off and applies the
 * acceptance rule fixed in docs/eval-methodology.md §9 BEFORE the numbers are
 * looked at:
 *
 *   - paraphrase hit@5 must rise (baseline 0.0%)
 *   - direct hit@5 must not fall by more than 2 points
 *
 * Usage: node pipeline/tools/ablate.ts [set.json] [--sweep]
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Retriever } from '../lib/retrieve.ts'
import { loadData, runEval, type EvalSet } from '../eval.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const setPath =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(ROOT, 'eval', 'pilot.json')
const set: EvalSet = JSON.parse(await readFile(setPath, 'utf8'))
const data = await loadData()

const measure = (conceptExpansion: boolean, conceptWeight = 0.5) => {
  // This tool isolates the concept layer. The v0.1.1 defaults (coverage rerank
  // and the Persian Arabic weight) are deliberately pinned off in both arms;
  // leaving them on made the "literal only" arm already include both changes,
  // so the concept-layer acceptance rule could no longer measure its own
  // contribution. `ablate-fusion.ts` measures A and D separately.
  const ev = runEval(
    set.items,
    new Retriever(data, {
      conceptExpansion,
      conceptWeight,
      coverageRerank: false,
      faQueryArWeight: 1,
    }),
    5,
    0.05,
  )
  const at = (curve: typeof ev.curves.all) => curve.find((c) => c.k === 5)!
  const all = at(ev.curves.all)
  const direct = at(ev.curves.direct)
  const paraphrase = at(ev.curves.paraphrase)
  return {
    hit5: all.rate,
    recall5: all.recall,
    direct: direct.rate,
    paraphrase: paraphrase.rate,
    mrr: ev.mrr,
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const delta = (a: number, b: number) => `${b >= a ? '+' : ''}${((b - a) * 100).toFixed(1)} pt`

if (process.argv.includes('--sweep')) {
  console.log('Concept-list RRF weight sweep (1.0 = equal to a literal field list)\n')
  console.log('| weight | hit@5 | direct hit@5 | paraphrase hit@5 | MRR |')
  console.log('|---:|---:|---:|---:|---:|')
  for (const w of [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.7, 1]) {
    const m = measure(true, w)
    console.log(`| ${w} | ${pct(m.hit5)} | ${pct(m.direct)} | ${pct(m.paraphrase)} | ${m.mrr.toFixed(3)} |`)
  }
  const base = measure(false)
  console.log(`| 0 (off) | ${pct(base.hit5)} | ${pct(base.direct)} | ${pct(base.paraphrase)} | ${base.mrr.toFixed(3)} |`)
  process.exit(0)
}

const off = measure(false)
const on = measure(true)

console.log('Concept-layer ablation — same set, same code, one flag\n')
console.log('| metric | literal only | + concept | delta |')
console.log('|---|---:|---:|---:|')
console.log(`| hit@5 | ${pct(off.hit5)} | ${pct(on.hit5)} | ${delta(off.hit5, on.hit5)} |`)
console.log(`| gold recall@5 | ${pct(off.recall5)} | ${pct(on.recall5)} | ${delta(off.recall5, on.recall5)} |`)
console.log(`| direct hit@5 | ${pct(off.direct)} | ${pct(on.direct)} | ${delta(off.direct, on.direct)} |`)
console.log(`| paraphrase hit@5 | ${pct(off.paraphrase)} | ${pct(on.paraphrase)} | ${delta(off.paraphrase, on.paraphrase)} |`)
console.log(`| MRR | ${off.mrr.toFixed(3)} | ${on.mrr.toFixed(3)} | ${delta(off.mrr, on.mrr)} |`)

const paraphraseRises = on.paraphrase > off.paraphrase
const directHolds = on.direct >= off.direct - 0.02
console.log('')
console.log(`paraphrase hit@5 rises: ${paraphraseRises ? 'PASS' : 'FAIL'}`)
console.log(`direct hit@5 holds within 2 pt: ${directHolds ? 'PASS' : 'FAIL'}`)
console.log(`ACCEPTANCE: ${paraphraseRises && directHolds ? 'PASS' : 'FAIL'}`)
process.exitCode = paraphraseRises && directHolds ? 0 : 1