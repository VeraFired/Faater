/**
 * Topical verse finder for eval authoring.
 *
 * The translation files are single-line JSON, so `grep` returns the whole file.
 * This tool searches an edition (or the Arabic body) for one or more terms and
 * prints the matching verses with their text, best matches first. It is an
 * authoring aid for gold reference lists: the author reads the verse, not the
 * retriever's ranking.
 *
 * Usage:
 *   node pipeline/tools/find.ts <ar|en|fa> <term> [<term> ...] [--limit N] [--refs]
 *
 * Matches are ranked by the number of distinct terms present, then by verse
 * order. `--refs` prints refs only (for piping); `--limit` defaults to 40.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalize, normalizeJoined } from '../lib/normalize.ts'
import { foldEnglish } from '../lib/stopwords.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const args = process.argv.slice(2)
const lang = args[0]
const refsOnly = args.includes('--refs')
const limitIdx = args.indexOf('--limit')
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 40 : 40
const terms = args.slice(1).filter((a, i) => {
  if (a === '--refs') return false
  if (a === '--limit') return false
  return !(limitIdx >= 0 && i === limitIdx) // value after --limit
})

if (!['ar', 'en', 'fa'].includes(lang) || terms.length === 0) {
  console.error('usage: node pipeline/tools/find.ts <ar|en|fa> <term> [<term> ...] [--limit N] [--refs]')
  process.exit(2)
}

type Edition = {
  verses: Record<string, { searchText: string; searchTextJoined: string; segments: Array<{ v: string }> }>
}
type Corpus = { verses: Array<{ ref: string; bodyNorm: string; arabicNorm: string }> }

const corpus = JSON.parse(
  await readFile(join(ROOT, 'data', 'build', 'corpus.json'), 'utf8'),
) as Corpus

let edition: Edition | null = null
if (lang !== 'ar') {
  edition = JSON.parse(
    await readFile(join(ROOT, 'data', 'build', `translations.${lang}.json`), 'utf8'),
  ) as Edition
}

const keysFor = (term: string): string[] =>
  lang === 'ar'
    ? [normalize(term)]
    : lang === 'en'
      ? [foldEnglish(term).toLowerCase()]
      : [...new Set([normalize(term), normalizeJoined(term)])]

const keySets = terms.map(keysFor)

const scored: Array<{ ref: string; text: string; count: number }> = []
for (const v of corpus.verses) {
  let count = 0
  let text = ''
  if (lang === 'ar') {
    text = v.bodyNorm
    for (const ks of keySets) if (ks.some((k) => v.bodyNorm.includes(k))) count++
  } else {
    const t = edition!.verses[v.ref]
    if (!t) continue
    text = (t.segments ?? []).map((s) => s.v).join(' ')
    for (const ks of keySets) {
      if (ks.some((k) => t.searchText.includes(k) || t.searchTextJoined.includes(k))) count++
    }
  }
  if (count > 0) scored.push({ ref: v.ref, text, count })
}

scored.sort((a, b) => b.count - a.count || a.ref.localeCompare(b.ref, 'en', { numeric: true }))
console.log(`# ${scored.length} verses match any of: ${terms.join(', ')}`)
for (const hit of scored.slice(0, limit)) {
  if (refsOnly) console.log(hit.ref)
  else console.log(`${hit.ref}  ${hit.text.slice(0, 320)}`)
}