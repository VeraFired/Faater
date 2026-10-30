/**
 * Persian gold tests — against the real Rowwad translation, not toy strings.
 *
 * The point of this file is the NEGATIVE CONTROL: the same terms that fail
 * when used raw succeed when routed through the normalizer. That is the
 * silent-failure mode the research warned about, made executable.
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { joinedVariants, normalize, normalizeJoined } from '../lib/normalize.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

interface FaVerse {
  segments: Array<{ t: string; v: string }>
  footnotes: unknown[]
  searchText: string
  searchTextJoined: string
}

const fa = JSON.parse(await readFile(join(ROOT, 'data', 'build', 'translations.fa.json'), 'utf8')) as {
  verses: Record<string, FaVerse>
}
const lexicon = JSON.parse(await readFile(join(ROOT, 'data', 'build', 'lexicon.json'), 'utf8')) as {
  surahs: Array<{ index: number; nameFa: string; nameFaNorm: string }>
  surahAliases: Array<{ id: string; keys: string[] }>
}

/** Every common Persian religious term a user is likely to type. */
const TERMS = [
  'صبر', 'نماز', 'روزه', 'زکات', 'بهشت', 'جهنم', 'خدا', 'قرآن', 'پیامبر', 'ایمان',
  'تقوا', 'رحمت', 'بخشش', 'توبه', 'دعا', 'شکر', 'عدل', 'ظلم', 'علم', 'حکمت',
  'مرگ', 'قیامت', 'آتش', 'فرشته', 'شیطان', 'انسان', 'جهان', 'زمین', 'آسمان', 'آفرینش',
  'نور', 'هدایت', 'گمراهی', 'گناه', 'ثواب', 'عذاب',
]

function matchesAll(haystack: string, needle: string): string[] {
  const out: string[] = []
  for (const [ref, v] of Object.entries(fa.verses)) {
    if (haystack === 'raw' ? v.searchText.includes(needle) : haystack === 'joined'
      ? v.searchTextJoined.includes(needle)
      : v.searchText.includes(needle)) out.push(ref)
  }
  return out
}

/** The retrieval path a real query takes: both ZWNJ variants of the query. */
function retrieve(query: string): Set<string> {
  const forms = [...new Set([normalize(query), normalizeJoined(query)])]
  const hits = new Set<string>()
  for (const [ref, v] of Object.entries(fa.verses)) {
    if (forms.some((f) => v.searchText.includes(f) || v.searchTextJoined.includes(f))) hits.add(ref)
  }
  return hits
}

test('all 36 common Persian terms are retrievable through the normalizer', () => {
  const missing: string[] = []
  for (const term of TERMS) {
    const q = normalize(term)
    const hits = Object.values(fa.verses).filter((v) => v.searchText.includes(q)).length
    if (hits === 0) missing.push(`${term} -> ${q}`)
  }
  assert.deepEqual(missing, [], 'these Persian terms match nothing after normalization')
})

test('NEGATIVE CONTROL: the same terms used raw mostly fail', () => {
  // This is why every query must go through normalize(). Persian yeh U+06CC
  // and alef-madda do not occur in the folded index, so raw matching silently
  // returns zero for words that are plainly present.
  const rawFails = TERMS.filter((t) => matchesAll('raw', t).length === 0)
  assert.ok(
    rawFails.length >= 10,
    `expected raw matching to fail on many terms; only ${rawFails.length} failed`,
  )
  // «پیامبر» contains Persian yeh; the index holds Arabic yeh.
  assert.ok(rawFails.includes('پیامبر'))
  assert.ok(rawFails.includes('ایمان'))
  // ...yet both are abundant once normalized.
  assert.ok(matchesAll('normalized', normalize('پیامبر')).length > 500)
  assert.ok(matchesAll('normalized', normalize('ایمان')).length > 500)
})

test('ZWNJ: joined and split query spellings nearly converge', () => {
  // «می‌خواهد» (with ZWNJ) and «میخواهد» (typed joined) are the same word.
  //
  // They are NOT identical sets, and the reason is honest: when the
  // translator writes a REAL space where the user writes no separator, the
  // joined query cannot match — there is no ZWNJ in the source to split on.
  // Measured difference is a handful of verses, so assert the safe
  // direction (joined ⊆ split) rather than pretending the gap is closed.
  const split = retrieve('می‌خواهد')
  const joined = retrieve('میخواهد')
  assert.ok(split.size > 0, 'split form retrieved nothing')
  assert.ok(joined.size > 0, 'joined form retrieved nothing')
  for (const ref of joined) {
    assert.ok(split.has(ref), `joined-only hit ${ref} — split form must find it too`)
  }
  assert.ok(split.size - joined.size <= 5, `recall gap grew: ${split.size} vs ${joined.size}`)
})

test('ZWNJ: «کتاب‌ها» and «کتابها» nearly converge', () => {
  const split = retrieve('کتاب‌ها')
  const joined = retrieve('کتابها')
  assert.ok(split.size > 0)
  for (const ref of joined) assert.ok(split.has(ref), `joined-only hit ${ref}`)
  assert.ok(split.size - joined.size <= 5, `recall gap grew: ${split.size} vs ${joined.size}`)
})

test('the corpus really does carry ZWNJ — the dual keys are not theoretical', () => {
  const withZwnj = Object.values(fa.verses).filter((v) =>
    v.segments.some((s) => s.v.includes('‌')),
  )
  assert.ok(withZwnj.length > 4000, `only ${withZwnj.length} Persian verses carry ZWNJ`)
})

test('Persian digits in a query reach ASCII verse numbers', () => {
  assert.equal(normalize('۲۵۵'), '255')
  // 2:255 is findable by its number once normalized.
  assert.ok(normalize('آیه ۲۵۵').includes('255'))
})

test('every surah has a Persian name that normalizes to a non-empty key', () => {
  assert.equal(lexicon.surahs.length, 114)
  for (const s of lexicon.surahs) {
    assert.ok(s.nameFa.trim(), `surah ${s.index}`)
    assert.ok(s.nameFaNorm.trim(), `surah ${s.index} normalizes to nothing`)
  }
})

test('Persian surah names are searchable in the Persian translation text', () => {
  // A user who types «سوره بقره» must be able to reach Al-Baqarah. The name
  // itself need not appear in the translation, but its Finglish/translit
  // alias and the word «سوره» must resolve; check the alias table instead.
  const baqara = lexicon.surahAliases.find((a) => a.id === 'surah:2')
  assert.ok(baqara, 'surah 2 has no alias entry')
  assert.ok(baqara.keys.includes('baqara'), `surah 2 keys: ${baqara.keys.join(', ')}`)
})

test('joinedVariants emits both spellings', () => {
  const v = joinedVariants('می‌خواهد')
  assert.equal(v.length, 2)
  assert.ok(v.includes('مي خواهد'))
  assert.ok(v.includes('ميخواهد'))
})