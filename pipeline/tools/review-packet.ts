/**
 * Scholar review packet for the blind evaluation set.
 *
 * The reviewer must see the actual verse text for every gold reference, in all
 * three editions, with the question — not a ref number they have to look up.
 * Output is Markdown, one section per question, with an explicit verdict line.
 *
 * Usage:
 *   node pipeline/tools/review-packet.ts [eval/blind.json] [--out docs/blind-review.md]
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const setPath = args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'eval', 'blind.json')
const outIdx = args.indexOf('--out')
const outPath = outIdx >= 0 ? args[outIdx + 1] : join(ROOT, 'docs', 'blind-review.md')

type Item = {
  id: string
  pair_id?: string
  lang: 'en' | 'fa'
  category: string
  q: string
  expect: 'answer' | 'refuse'
  expect_refs?: string[]
}
type Set = { _meta: Record<string, unknown>; items: Item[] }

const set = JSON.parse(await readFile(setPath, 'utf8')) as Set
const corpus = JSON.parse(
  await readFile(join(ROOT, 'data', 'build', 'corpus.json'), 'utf8'),
) as {
  verses: Array<{ ref: string; body: string; basmala: string | null }>
  surahs: Array<{ index: number; nameEn: string; nameAr: string; nameFa: string }>
}
const en = JSON.parse(
  await readFile(join(ROOT, 'data', 'build', 'translations.en.json'), 'utf8'),
) as { verses: Record<string, { segments: Array<{ v: string }> }> }
const fa = JSON.parse(
  await readFile(join(ROOT, 'data', 'build', 'translations.fa.json'), 'utf8'),
) as { verses: Record<string, { segments: Array<{ v: string }> }> }

const byRef = new Map(corpus.verses.map((v) => [v.ref, v]))
const text = (edition: typeof en, ref: string) =>
  (edition.verses[ref]?.segments ?? []).map((s) => s.v).join(' ').trim()

// The set is bilingual pairs; print each unique question once, then both
// language rows, so the reviewer sees the pair rather than 100 disconnected rows.
const byQuestion = new Map<string, Item[]>()
for (const it of set.items) {
  const key = it.pair_id ?? (it.lang === 'en' ? it.q : `fa:${it.q}`)
  const list = byQuestion.get(key) ?? []
  list.push(it)
  byQuestion.set(key, list)
}

const lines: string[] = []
lines.push('# Blind evaluation set — scholar review packet', '')
lines.push(`Set: ${String(set._meta.name ?? 'unnamed')}`)
lines.push(`Status: ${String(set._meta.status ?? 'unknown')}`)
lines.push(`Items: ${set.items.length} (${byQuestion.size} unique question pairs)`)
lines.push('')
lines.push('For each question, read the verse text and mark one:')
lines.push('')
lines.push('- `[ ] APPROVE` — the gold refs answer the question, the translation is faithful')
lines.push('- `[ ] FLAG` — a ref is wrong, the question is not answerable from the Quran, or the pair differs in meaning')
lines.push('')
lines.push('Arabic text © Tanzil.net (CC BY 3.0); translations © QuranEnc.com;')
lines.push('this packet is for review, not distribution.')
lines.push('')
lines.push('---', '')

let n = 0
for (const [, pair] of byQuestion) {
  n++
  const enItem = pair.find((p) => p.lang === 'en')
  const faItem = pair.find((p) => p.lang === 'fa')
  const refs = enItem?.expect_refs ?? faItem?.expect_refs ?? []
  lines.push(`## ${n}. ${enItem?.q ?? faItem?.q}`)
  lines.push('')
  lines.push(`- id: \`${enItem?.id ?? faItem?.id}\``)
  lines.push(`- category: \`${enItem?.category ?? faItem?.category}\``)
  if (faItem) lines.push(`- Persian: ${faItem.q}`)
  lines.push('')
  if (refs.length === 0) {
    lines.push('**Should refuse.** No gold verse exists by design. Confirm the Quran does not answer it.')
  } else {
    for (const ref of refs) {
      const v = byRef.get(ref)
      const surah = v ? corpus.surahs.find((s) => s.index === Number(ref.split(':')[0])) : null
      lines.push(`### ${ref} — ${surah?.nameEn ?? ''} (${surah?.nameAr ?? ''})`)
      if (!v) {
        lines.push('**REF NOT FOUND IN CORPUS — blocker.**', '')
        continue
      }
      if (v.basmala) lines.push(`*Basmala:* ${v.basmala}`, '')
      lines.push(`*Arabic:* ${v.body}`, '')
      lines.push(`*EN:* ${text(en, ref)}`, '')
      lines.push(`*FA:* ${text(fa, ref)}`, '')
    }
  }
  lines.push('- [ ] APPROVE')
  lines.push('- [ ] FLAG — reason:')
  lines.push('')
  lines.push('---', '')
}

await writeFile(outPath, lines.join('\n'), 'utf8')
console.log(`[review-packet] wrote ${outPath} (${byQuestion.size} pairs, ${set.items.length} items)`)