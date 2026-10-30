/**
 * Basmala segmentation tests.
 *
 * These assert against the TRANSLATION EXTENT, not against clean-text
 * agreement — both Tanzil files carry the same fused basmala, so a cross-check
 * between them is structurally blind to this defect. That was the important
 * lesson from M0 step 1.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { BASMALA_KEY, splitBasmala } from '../lib/basmala.ts'
import { normalize } from '../lib/normalize.ts'
import { loadCorpus } from './helpers.ts'

const corpus = await loadCorpus()
const byRef = new Map(corpus.verses.map((v) => [v.ref, v]))

test('1:1 is a whole-verse basmala with no body', () => {
  const v = byRef.get('1:1')
  assert.ok(v, '1:1 missing')
  assert.ok(v.basmala, '1:1 should carry the basmala')
  assert.equal(v.basmalaIsWholeVerse, true)
  assert.equal(v.body, '')
  // The whole verse must be the basmala — not a truncated prefix.
  assert.equal(normalize(v.arabic), BASMALA_KEY)
})

test('2:1 splits — basmala separate, Alef-Lam-Meem as the body', () => {
  const v = byRef.get('2:1')
  assert.ok(v, '2:1 missing')
  assert.equal(normalize(v.basmala ?? ''), BASMALA_KEY)
  assert.equal(normalize(v.body), normalize('الم'))
  assert.equal(v.basmalaIsWholeVerse, false)
  // Lossless: rejoining the split reproduces the source text exactly.
  assert.equal(`${v.basmala} ${v.body}`, v.arabic)
})

test('112:1 splits with a multi-word body', () => {
  const v = byRef.get('112:1')
  assert.ok(v, '112:1 missing')
  assert.equal(normalize(v.basmala ?? ''), BASMALA_KEY)
  assert.equal(normalize(v.body), normalize('قُلْ هُوَ اللَّهُ أَحَدٌ'))
})

test('9:1 has no basmala at all', () => {
  const v = byRef.get('9:1')
  assert.ok(v, '9:1 missing')
  assert.equal(v.basmala, null)
  assert.equal(v.body, v.arabic)
  assert.equal(v.basmalaIsWholeVerse, false)
})

test('exactly 113 verses carry a basmala: 112 prefixes + 1 whole verse', () => {
  const withB = corpus.verses.filter((v) => v.basmala !== null)
  const prefixes = withB.filter((v) => !v.basmalaIsWholeVerse)
  assert.equal(withB.length, 113)
  assert.equal(prefixes.length, 112)
  // Every prefix sits on ayah 1 of its surah; none leaks into a middle verse.
  assert.deepEqual([...new Set(prefixes.map((v) => v.ayah))], [1])
  // Surahs 2–114 except At-Tawbah. Surah 1 is absent *because* its basmala is
  // the whole verse, not a prefix — that distinction is the point of the split.
  assert.deepEqual(
    [...new Set(prefixes.map((v) => v.surah))].sort((a, b) => a - b),
    Array.from({ length: 113 }, (_, i) => i + 2).filter((s) => s !== 9),
  )
})

test('the basmala pseudo-document exists exactly once, pointing at 1:1', () => {
  assert.ok(corpus.basmalaDocument, 'no basmala pseudo-document')
  assert.equal(corpus.basmalaDocument.ref, '1:1')
  assert.equal(corpus.basmalaDocument.norm, BASMALA_KEY)
  assert.equal(typeof corpus.basmalaDocument.id, 'string')
})

test('no verse INDEXABLE body begins with the basmala — it is indexed once', () => {
  // This is the test that guards the defect. If FTS uses bodyNorm and the
  // split is correct, a basmala query can only reach the single pseudo-document
  // (plus 27:30, which genuinely quotes it mid-verse). Before segmentation the
  // query returned 113 near-identical surah openings.
  const openings = corpus.verses.filter((v) => v.bodyNorm.startsWith(BASMALA_KEY))
  assert.deepEqual(
    openings.map((v) => v.ref),
    [],
    `basmala still fused into ${openings.length} verse bodies`,
  )
  assert.equal(corpus.basmalaDocument.norm, BASMALA_KEY)
})

test('bodyNorm carries the real verse content, not just the basmala', () => {
  assert.equal(byRef.get('2:1')!.bodyNorm, normalize('الم'))
  assert.equal(byRef.get('112:1')!.bodyNorm, normalize('قل هو الله أحد'))
  // 1:1 is fully represented by the pseudo-document, so its own row is empty.
  assert.equal(byRef.get('1:1')!.bodyNorm, '')
})

test('a mid-verse basmala is not a prefix (27:30)', () => {
  // 27:30 quotes the basmala inside the verse. It must not be split off.
  const v = byRef.get('27:30')
  assert.ok(v, '27:30 missing')
  assert.equal(v.basmala, null)
  assert.equal(v.body, v.arabic)
})

test('splitBasmala is lossless on every verse in the corpus', () => {
  for (const v of corpus.verses) {
    const rejoined = v.basmalaIsWholeVerse ? v.basmala : v.basmala ? `${v.basmala} ${v.body}` : v.body
    assert.equal(rejoined, v.arabic, `lossy split at ${v.ref}`)
  }
})

test('a short verse shorter than the basmala is handled', () => {
  const r = splitBasmala('الم')
  assert.equal(r.basmala, null)
  assert.equal(r.body, 'الم')
  assert.equal(r.isWholeVerse, false)
})

test('an empty string does not throw', () => {
  const r = splitBasmala('')
  assert.equal(r.basmala, null)
  assert.equal(r.body, '')
  assert.equal(r.isWholeVerse, false)
})