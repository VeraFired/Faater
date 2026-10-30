/**
 * Reference parser tests, including a seeded fuzz pass.
 *
 * The governing rule: a reference that is not certain must not be emitted.
 * A wrong surah silently answers the wrong verse, which is worse than any
 * refusal. Several tests below assert that input resolves to nothing.
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseReference, type Reference, type SurahRef } from '../lib/reference.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const corpus = JSON.parse(await readFile(join(ROOT, 'data', 'build', 'corpus.json'), 'utf8')) as {
  surahs: Array<{
    index: number
    ayahs: number
    nameAr: string
    nameEn: string
    nameTranslit: string
    nameFa: string
    nameFaAlt: string | null
  }>
  verses: Array<{ ref: string }>
}
const lexicon = JSON.parse(await readFile(join(ROOT, 'data', 'build', 'lexicon.json'), 'utf8')) as {
  surahs: Array<{ index: number; finglishKeys: string[] }>
}

const finglishByIndex = new Map(lexicon.surahs.map((s) => [s.index, s.finglishKeys]))

const SURAHS: SurahRef[] = corpus.surahs.map((s) => ({
  index: s.index,
  ayahs: s.ayahs,
  keys: [
    s.nameAr,
    s.nameEn,
    s.nameTranslit,
    s.nameFa,
    ...(s.nameFaAlt ? [s.nameFaAlt] : []),
    ...(finglishByIndex.get(s.index) ?? []),
  ],
}))

function parse(q: string): Reference | null {
  return parseReference(q, SURAHS)
}

// ---------------------------------------------------------------------------
// Numeric references
// ---------------------------------------------------------------------------

test('parses 2:255', () => {
  assert.deepEqual(parse('2:255'), { kind: 'single', surah: 2, ayah: 255, matched: '2:255' })
})

test('parses with spaces around the colon', () => {
  const r = parse('2 : 255')
  assert.equal(r?.kind, 'single')
  assert.equal((r as { surah: number }).surah, 2)
})

test('parses inside a sentence', () => {
  const r = parse('What does 2:255 mean about God?')
  assert.equal(r?.kind, 'single')
  assert.equal((r as { ayah: number }).ayah, 255)
})

test('parses a range 2:255-257', () => {
  assert.deepEqual(parse('2:255-257'), { kind: 'range', surah: 2, start: 255, end: 257, matched: '2:255-257' })
})

test('parses an en-dash range and a full second reference', () => {
  assert.equal(parse('2:255–257')?.kind, 'range')
  const full = parse('2:255–2:257')
  assert.equal(full?.kind, 'range')
  assert.equal((full as { end: number }).end, 257)
})

test('persian and arabic-indic digits work after normalization', () => {
  const fa = parse('۲:۲۵۵')
  assert.equal(fa?.kind, 'single')
  assert.equal((fa as { surah: number }).surah, 2)
  const ar = parse('٢:٢٥٥')
  assert.equal(ar?.kind, 'single')
  assert.equal((ar as { ayah: number }).ayah, 255)
})

test('out-of-range references are rejected, not clamped', () => {
  assert.deepEqual(parse('115:1'), { kind: 'invalid', reason: 'no-such-surah', matched: '115:1' })
  assert.deepEqual(parse('0:1'), { kind: 'invalid', reason: 'no-such-surah', matched: '0:1' })
  assert.equal(parse('2:999')?.kind, 'invalid')
  assert.equal((parse('2:999') as { reason: string }).reason, 'ayah-out-of-range')
  // Al-Baqarah has 286 ayahs; 286 is valid, 287 is not.
  assert.equal(parse('2:286')?.kind, 'single')
  assert.equal(parse('2:287')?.kind, 'invalid')
})

test('a reversed range is rejected', () => {
  assert.deepEqual(parse('2:257-255'), {
    kind: 'invalid',
    reason: 'reversed-range',
    matched: '2:257-255',
  })
})

test('a cross-surah range is rejected', () => {
  const r = parse('2:255-3:5')
  assert.equal(r?.kind, 'invalid')
  assert.equal((r as { reason: string }).reason, 'cross-surah-range')
})

// ---------------------------------------------------------------------------
// Surah names
// ---------------------------------------------------------------------------

test('«سوره بقره» resolves to surah 2', () => {
  const r = parse('سوره بقره')
  assert.equal(r?.kind, 'surah')
  assert.equal((r as { surah: number }).surah, 2)
})

test('«سوره بقره آیه ۲۵۵» resolves to 2:255', () => {
  const r = parse('سوره بقره آیه ۲۵۵')
  assert.equal(r?.kind, 'single')
  assert.equal((r as { surah: number }).surah, 2)
  assert.equal((r as { ayah: number }).ayah, 255)
})

test('«بقره آیه ۲۵۵» works without the word سوره', () => {
  const r = parse('بقره آیه ۲۵۵')
  assert.equal(r?.kind, 'single')
  assert.equal((r as { ayah: number }).ayah, 255)
})

test('Persian alternate names resolve (حمد -> 1, توحید -> 112)', () => {
  assert.equal((parse('سوره حمد') as { surah: number }).surah, 1)
  assert.equal((parse('سوره توحید') as { surah: number }).surah, 112)
})

test('English surah names resolve', () => {
  const r = parse('Surah Al-Baqarah verse 255')
  assert.equal(r?.kind, 'single')
  assert.equal((r as { surah: number }).surah, 2)
  assert.equal((r as { ayah: number }).ayah, 255)

  const short = parse('Al-Baqarah 255')
  assert.equal(short?.kind, 'single')
  assert.equal((short as { surah: number }).surah, 2)
})

test('Finglish surah names resolve', () => {
  assert.equal((parse('sure yasin') as { surah: number }).surah, 36)
  assert.equal((parse('baqara 255') as { surah: number }).surah, 2)
  assert.equal((parse('kahf') as { surah: number }).surah, 18)
})

test('a surah name with a range', () => {
  const r = parse('سوره بقره آیه ۲۵۵-۲۵۷')
  assert.equal(r?.kind, 'range')
  assert.equal((r as { end: number }).end, 257)
})

// ---------------------------------------------------------------------------
// Things that must NOT parse
// ---------------------------------------------------------------------------

test('decimals never become references', () => {
  for (const q of ['2.5', '3.14', '1.2.3', 'the ratio is 2.5', '0.5']) {
    assert.equal(parse(q), null, `"${q}" must not parse as a reference`)
  }
})

test('a bare ayah number is ambiguous and refuses', () => {
  for (const q of ['255', 'آیه ۲۵۵', 'verse 255', 'aya 255']) {
    assert.equal(parse(q), null, `"${q}" must not guess a surah`)
  }
})

test('spelled-out numbers are not supported and do not half-parse', () => {
  // Documented limitation. Returning null is correct; guessing is not.
  for (const q of ['سوره بقره آیه دویست و پنجاه و پنج', 'Surah Al-Baqarah verse two hundred fifty five']) {
    const r = parse(q)
    assert.ok(
      r === null || r.kind === 'surah' || r.kind === 'invalid',
      `"${q}" produced a wrong ayah: ${JSON.stringify(r)}`,
    )
  }
})

test('unrelated text parses to nothing', () => {
  for (const q of ['', '   ', 'what is patience', 'صبر چیست', 'tell me a joke', '2', ':255']) {
    assert.equal(parse(q), null, `"${q}" must not parse`)
  }
})

// ---------------------------------------------------------------------------
// Fuzzing
// ---------------------------------------------------------------------------

/** Deterministic PRNG so a failure is reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

const AYAH_COUNT = new Map(corpus.surahs.map((s) => [s.index, s.ayahs]))

test('fuzz: numeric noise never yields an invalid single/range reference', () => {
  const rand = lcg(20261031)
  const alphabet = '0123456789:-–— .xسآبهٔ'
  for (let i = 0; i < 5000; i++) {
    const len = 1 + Math.floor(rand() * 14)
    let q = ''
    for (let j = 0; j < len; j++) q += alphabet[Math.floor(rand() * alphabet.length)]
    const r = parseReference(q, SURAHS)
    if (!r) continue
    if (r.kind === 'single' || r.kind === 'range') {
      const n = AYAH_COUNT.get(r.surah)
      assert.ok(n !== undefined, `fuzz produced nonexistent surah ${r.surah} from ${JSON.stringify(q)}`)
      if (r.kind === 'single') {
        assert.ok(r.ayah >= 1 && r.ayah <= n, `fuzz produced ${r.surah}:${r.ayah} beyond ${n} from ${JSON.stringify(q)}`)
      } else {
        assert.ok(r.start >= 1 && r.end <= n && r.start <= r.end, `fuzz produced bad range from ${JSON.stringify(q)}`)
      }
    }
    if (r.kind === 'surah') {
      assert.ok(AYAH_COUNT.has(r.surah), `fuzz produced nonexistent surah from ${JSON.stringify(q)}`)
    }
  }
})

test('fuzz: parsing never throws on arbitrary unicode', () => {
  const rand = lcg(7)
  const pool = [
    'سوره', 'آیه', 'بقره', 'الکرسی', 'surah', 'verse', 'baqara', '2', '255', ':', '-', '.',
    '﷽', '۞', '‌', '‍', '﴿', '«', '»', '۔', '؟', 'A', 'é', '\n', '\t', '0',
  ]
  for (let i = 0; i < 3000; i++) {
    const len = 1 + Math.floor(rand() * 10)
    let q = ''
    for (let j = 0; j < len; j++) q += pool[Math.floor(rand() * pool.length)]
    assert.doesNotThrow(() => parseReference(q, SURAHS), `threw on ${JSON.stringify(q)}`)
  }
})

test('fuzz: re-parsing the matched text is idempotent', () => {
  const rand = lcg(99)
  for (let i = 0; i < 2000; i++) {
    const surah = 1 + Math.floor(rand() * 114)
    const max = AYAH_COUNT.get(surah)!
    const ayah = 1 + Math.floor(rand() * max)
    const q = `${surah}:${ayah}`
    const r1 = parse(q)
    assert.equal(r1?.kind, 'single', `failed to parse generated ${q}`)
    const r2 = parse((r1 as { matched: string }).matched)
    assert.deepEqual(r2, r1, `not idempotent at ${q}`)
  }
})

test('every valid verse reference in the corpus round-trips', () => {
  // Not random — exhaustive over all 6,236 verses. Cheap and conclusive.
  assert.equal(corpus.verses.length, 6236)
  for (const v of corpus.verses) {
    const r = parse(v.ref)
    assert.equal(r?.kind, 'single', `failed on ${v.ref}`)
    assert.equal(`${(r as { surah: number }).surah}:${(r as { ayah: number }).ayah}`, v.ref)
  }
})