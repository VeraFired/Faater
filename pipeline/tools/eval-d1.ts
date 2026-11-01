/**
 * Evaluate the D1/FTS5 retrieval path against the in-memory retriever.
 *
 * This is the bridge between "the Worker compiles" and "the Worker answers as
 * well as the thing we measured". It loads the generated schema + seed into
 * Node's built-in SQLite (same engine family as D1), adapts it to the D1
 * surface, and runs the pilot set through `worker/src/retrieve.ts`.
 *
 * Usage: node pipeline/tools/eval-d1.ts [set.json]
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { searchD1 } from '../../worker/src/retrieve.ts'
import { openLocalD1 } from './local-d1.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const setPath =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(ROOT, 'eval', 'pilot.json')

type EvalItem = {
  id: string
  lang: 'en' | 'fa'
  category: string
  q: string
  expect: 'answer' | 'refuse'
  expect_refs?: string[]
}
type EvalSet = { items: EvalItem[] }

const set: EvalSet = JSON.parse(await readFile(setPath, 'utf8'))

const { db, lexicon, surahs } = await openLocalD1()

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const now = performance.now()

const rows: Array<{ item: EvalItem; refs: string[]; firstGold: number | null }> = []
for (const item of set.items) {
  const hits = await searchD1(db, lexicon, surahs, item.q, { limit: 50, language: item.lang })
  const refs = hits.map((h) => h.ref)
  const firstGold = item.expect_refs?.length
    ? (() => {
        const idx = refs.findIndex((r) => item.expect_refs!.includes(r))
        return idx >= 0 ? idx + 1 : null
      })()
    : null
  rows.push({ item, refs, firstGold })
}

const gold = rows.filter((r) => r.item.expect === 'answer' && r.item.expect_refs?.length)
const atK = (slice: typeof gold, k: number) => {
  const hit = slice.filter((r) => r.firstGold !== null && r.firstGold <= k).length
  const found = slice.reduce(
    (n, r) => n + r.item.expect_refs!.filter((ref) => r.refs.slice(0, k).includes(ref)).length,
    0,
  )
  const total = slice.reduce((n, r) => n + r.item.expect_refs!.length, 0)
  return { n: slice.length, hit, rate: slice.length ? hit / slice.length : 0, found, total, recall: total ? found / total : 0 }
}

const all5 = atK(gold, 5)
const en5 = atK(gold.filter((r) => r.item.lang === 'en'), 5)
const fa5 = atK(gold.filter((r) => r.item.lang === 'fa'), 5)
const direct5 = atK(gold.filter((r) => r.item.category === 'answerable_direct'), 5)
const para5 = atK(gold.filter((r) => r.item.category === 'answerable_paraphrase'), 5)
const mrr = gold.reduce((s, r) => s + (r.firstGold ? 1 / r.firstGold : 0), 0) / (gold.length || 1)

console.log('D1/FTS5 retrieval — pilot set')
console.log(`| metric | value |`)
console.log(`|---|---:|`)
console.log(`| hit@5 | ${pct(all5.rate)} (${all5.hit}/${all5.n}) |`)
console.log(`| hit@5 EN | ${pct(en5.rate)} (${en5.hit}/${en5.n}) |`)
console.log(`| hit@5 FA | ${pct(fa5.rate)} (${fa5.hit}/${fa5.n}) |`)
console.log(`| gold recall@5 | ${pct(all5.recall)} (${all5.found}/${all5.total}) |`)
console.log(`| direct hit@5 | ${pct(direct5.rate)} (${direct5.hit}/${direct5.n}) |`)
console.log(`| paraphrase hit@5 | ${pct(para5.rate)} (${para5.hit}/${para5.n}) |`)
console.log(`| MRR | ${mrr.toFixed(3)} |`)
console.log(`| query time | ${((performance.now() - now) / set.items.length).toFixed(1)} ms/item |`)

const misses = rows
  .filter((r) => r.item.expect === 'answer' && r.firstGold === null)
  .slice(0, 10)
  .map((r) => `- ${r.item.id} «${r.item.q}» — top: ${r.refs.slice(0, 5).join(', ')}`)
if (misses.length) {
  console.log('\nSample misses (gold not in top 50):')
  for (const m of misses) console.log(m)
}