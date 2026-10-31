/**
 * Mechanical validation of the frozen blind set. Runs no retrieval.
 *
 * Retrieval metrics on this set are single-shot and only meaningful after the
 * scholar review; this tool checks the instrument, not the system.
 *
 * Usage: node pipeline/tools/validate-blind.ts [eval/blind.json]
 */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const setPath =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(ROOT, 'eval', 'blind.json')

type Item = {
  id: string
  pair_id: string
  lang: 'en' | 'fa'
  category: string
  q: string
  expect: 'answer' | 'refuse'
  expect_refs?: string[]
}
type Set = {
  _meta: { freeze_sha256?: string; counts?: Record<string, number> }
  items: Item[]
}

const set = JSON.parse(await readFile(setPath, 'utf8')) as Set
const corpus = JSON.parse(
  await readFile(join(ROOT, 'data', 'build', 'corpus.json'), 'utf8'),
) as { verses: Array<{ ref: string }> }
const refs = new Set(corpus.verses.map((v) => v.ref))

const errors: string[] = []
const warnings: string[] = []

const byId = new Map<string, Item>()
for (const it of set.items) {
  if (byId.has(it.id)) errors.push(`duplicate id: ${it.id}`)
  byId.set(it.id, it)
}

const pairs = new Map<string, Item[]>()
for (const it of set.items) {
  const list = pairs.get(it.pair_id) ?? []
  list.push(it)
  pairs.set(it.pair_id, list)
}

for (const [pairId, items] of pairs) {
  const en = items.filter((i) => i.lang === 'en')
  const fa = items.filter((i) => i.lang === 'fa')
  if (en.length !== 1 || fa.length !== 1) {
    errors.push(`pair ${pairId}: expected exactly one EN and one FA, got ${en.length}/${fa.length}`)
  }
  const expect = new Set(items.map((i) => i.expect))
  if (expect.size !== 1) errors.push(`pair ${pairId}: EN and FA disagree on expect`)
  const cats = new Set(items.map((i) => i.category))
  if (cats.size !== 1) errors.push(`pair ${pairId}: EN and FA disagree on category`)
}

for (const it of set.items) {
  if (!it.q.trim()) errors.push(`${it.id}: empty question`)
  if (it.lang === 'fa' && !/[؀-ۿ]/.test(it.q)) {
    errors.push(`${it.id}: FA item has no Persian script`)
  }
  if (it.expect === 'answer') {
    if (!it.expect_refs?.length) errors.push(`${it.id}: answerable item has no gold refs`)
    for (const ref of it.expect_refs ?? []) {
      if (!refs.has(ref)) errors.push(`${it.id}: gold ref not in corpus: ${ref}`)
    }
  } else if (it.expect_refs?.length) {
    errors.push(`${it.id}: should-refuse item has gold refs`)
  }
}

const categoryCounts: Record<string, number> = {}
for (const it of set.items) {
  categoryCounts[it.category] = (categoryCounts[it.category] ?? 0) + 1
  if (it.lang === 'en') {
    // Count unique pairs per category once, below.
  }
}
const pairCounts: Record<string, number> = {}
for (const items of pairs.values()) {
  const cat = items[0]?.category ?? 'unknown'
  pairCounts[cat] = (pairCounts[cat] ?? 0) + 1
}

const EXPECTED_PAIRS: Record<string, number> = {
  answerable_direct: 25,
  answerable_paraphrase: 8,
  unanswerable_indomain: 9,
  ood: 6,
  adversarial: 2,
}
for (const [cat, n] of Object.entries(EXPECTED_PAIRS)) {
  if ((pairCounts[cat] ?? 0) !== n) {
    errors.push(`category ${cat}: expected ${n} pairs, got ${pairCounts[cat] ?? 0}`)
  }
}
for (const cat of Object.keys(pairCounts)) {
  if (!(cat in EXPECTED_PAIRS)) errors.push(`unexpected category: ${cat}`)
}
if (pairs.size !== 50) errors.push(`expected 50 pairs, got ${pairs.size}`)

if (set._meta.freeze_sha256) {
  const hash = createHash('sha256').update(JSON.stringify(set.items)).digest('hex')
  if (hash !== set._meta.freeze_sha256) {
    errors.push(`freeze hash mismatch: file has ${hash}, meta says ${set._meta.freeze_sha256}`)
  }
} else {
  warnings.push('no freeze_sha256 in _meta — set is not frozen')
}

console.log(`items ${set.items.length}, pairs ${pairs.size}`)
console.log('pairs by category:', pairCounts)
console.log(`freeze ${set._meta.freeze_sha256 ? 'verified' : 'MISSING'}`)
for (const w of warnings) console.log(`WARN ${w}`)
for (const e of errors) console.log(`ERROR ${e}`)
console.log(errors.length ? `INVALID: ${errors.length} error(s)` : 'VALID')
process.exitCode = errors.length ? 1 : 0