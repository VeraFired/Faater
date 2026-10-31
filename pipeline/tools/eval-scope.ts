/**
 * Evaluate a G1 scope model on a labelled holdout.
 *
 * Prints aggregate rates only — never the questions — so an untouched holdout
 * can be scored without the author reading it. Expected input:
 *   { items: [{ class: "quran"|"fiqh"|"history"|"other_islamic"|"ood",
 *               q_en: string, q_fa: string }] }
 *
 * Usage:
 *   node pipeline/tools/eval-scope.ts data/build/scope-model.json eval/scope-holdout.json
 */

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { scopeScore, type ScopeModel } from '../lib/scope.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const modelPath = args[0] ? resolve(args[0]) : resolve(ROOT, 'data', 'scope-model.json')
const setPath = args[1] ? resolve(args[1]) : resolve(ROOT, 'eval', 'scope-holdout.json')

const model = JSON.parse(await readFile(modelPath, 'utf8')) as ScopeModel
const set = JSON.parse(await readFile(setPath, 'utf8')) as {
  items: Array<{ class: string; q_en: string; q_fa: string }>
}
const CLASSES = ['quran', 'fiqh', 'history', 'other_islamic', 'ood']
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

for (const lang of ['en', 'fa'] as const) {
  const key = lang === 'en' ? 'q_en' : 'q_fa'
  const rows = set.items.map((it) => ({ cls: it.class, p: scopeScore(model, it[key]) }))
  const quran = rows.filter((r) => r.cls === 'quran')
  const kept = quran.filter((r) => r.p >= model.threshold).length
  console.log(
    `${lang}: Quran kept ${kept}/${quran.length} (${pct(kept / Math.max(1, quran.length))})`,
  )
  for (const cls of CLASSES.filter((c) => c !== 'quran')) {
    const slice = rows.filter((r) => r.cls === cls)
    const refused = slice.filter((r) => r.p < model.threshold).length
    console.log(
      `  ${cls.padEnd(14)} refused ${refused}/${slice.length} (${pct(refused / Math.max(1, slice.length))})`,
    )
  }
}

const all = set.items.flatMap((it) => [
  { cls: it.class, p: scopeScore(model, it.q_en) },
  { cls: it.class, p: scopeScore(model, it.q_fa) },
])
const q = all.filter((r) => r.cls === 'quran')
const kept = q.filter((r) => r.p >= model.threshold).length
const neg = all.filter((r) => r.cls !== 'quran')
const refused = neg.filter((r) => r.p < model.threshold).length
console.log(`pooled: Quran ${kept}/${q.length} (${pct(kept / Math.max(1, q.length))}), ` +
  `non-Quran refused ${refused}/${neg.length} (${pct(refused / Math.max(1, neg.length))})`)