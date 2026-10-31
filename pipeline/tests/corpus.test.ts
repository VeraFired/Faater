/**
 * Corpus integrity tests.
 *
 * The byte hash is checked by the build. These test the structural promises
 * that hash equality cannot express.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { loadCorpus } from './helpers.ts'

const corpus = await loadCorpus()

test('6,236 verses across 114 surahs', () => {
  assert.equal(corpus.verses.length, 6236)
  assert.equal(corpus.surahs.length, 114)
})

test('verse counts per surah match the metadata', () => {
  for (const s of corpus.surahs) {
    const actual = corpus.verses.filter((v) => v.surah === s.index).length
    assert.equal(actual, s.ayahs, `surah ${s.index}`)
  }
})

test('refs are unique and ordered', () => {
  const refs = corpus.verses.map((v) => v.ref)
  assert.equal(new Set(refs).size, refs.length)
  assert.equal(refs[0], '1:1')
  assert.equal(refs[refs.length - 1], '114:6')
})

test('known anchoring verses are present and intact', () => {
  const byRef = new Map(corpus.verses.map((v) => [v.ref, v]))
  for (const ref of ['1:1', '2:255', '2:286', '9:1', '27:30', '112:1', '114:6']) {
    assert.ok(byRef.get(ref), `missing ${ref}`)
  }
  // Ayat al-Kursi — spot check that the text is not truncated.
  // Compared on the normalized key, not the raw string: the source spells
  // «إِلَـٰهَ» with a tatweel, so a literal diacritic-sensitive match is brittle
  // in a way that says nothing about whether the text is intact.
  const kursi = byRef.get('2:255')!
  assert.ok(
    kursi.arabicNorm.startsWith('الله لا اله الا هو الحي القيوم'),
    `2:255 does not open as expected: ${kursi.arabicNorm.slice(0, 60)}`,
  )
  assert.ok(kursi.arabicNorm.includes('وسع كرسيه السماوات والارض'))
})

test('every verse has a non-empty normalized search key', () => {
  for (const v of corpus.verses) {
    assert.ok(v.arabicNorm.length > 0, `empty norm at ${v.ref}`)
    if (v.basmalaIsWholeVerse) {
      // 1:1 has no body: its whole text is carried by the basmala document, and
      // duplicating it into the per-verse keys would re-create the 113x
      // document-frequency inflation the pseudo-document exists to avoid.
      assert.equal(v.bodyNorm, '', 'whole-verse basmala must have an empty bodyNorm')
      assert.equal(v.arabicVariants.length, 0, 'whole-verse basmala must not carry body variants')
      assert.ok(corpus.basmalaDocument.variants.length > 0, 'basmala document needs variants')
    } else {
      assert.ok(v.bodyNorm.length > 0, `empty bodyNorm at ${v.ref}`)
      assert.ok(v.arabicVariants.length > 0, `no variants at ${v.ref}`)
    }
  }
})

test('the basmala is never re-embedded in a surah-opening search key', () => {
  // The variants field is derived from `body`, not `arabic`. When it was
  // derived from `arabic`, all 112 surah openings carried the basmala in
  // their Persian-tolerant search key — the same defect bodyNorm avoids,
  // hiding in a second field.
  const openings = corpus.verses.filter((v) => v.basmala && !v.basmalaIsWholeVerse)
  assert.equal(openings.length, 112)
  for (const v of openings) {
    for (const key of v.arabicVariants) {
      assert.ok(!key.includes('بسم'), `basmala leaked into variants at ${v.ref}`)
    }
  }
})

test('search keys never leak into display text', () => {
  // arabic must equal the source row exactly; arabicNorm is a separate field.
  for (const v of corpus.verses) {
    if (v.basmalaIsWholeVerse) {
      assert.equal(v.arabic, v.basmala)
    } else if (v.basmala) {
      assert.equal(`${v.basmala} ${v.body}`, v.arabic)
    } else {
      assert.equal(v.body, v.arabic)
    }
  }
})

test('every surah has a hand-authored Persian name, and none collide', () => {
  // Tanzil ships no Persian names. Shipping an English name in a Persian UI is
  // not an option, so the gap is closed deliberately in
  // data/lexicon/surahs.fa.json. These names are UNREVIEWED until a native
  // speaker signs off — see the `_review` field in that file.
  assert.equal(corpus.surahs.length, 114)
  for (const s of corpus.surahs) {
    assert.ok(s.nameFa && s.nameFa.trim(), `surah ${s.index} has no Persian name`)
  }
  const names = corpus.surahs.map((s) => s.nameFa)
  assert.equal(new Set(names).size, names.length, 'duplicate Persian surah names')
})

test('Persian surah names carry a known set of alternate names', () => {
  const byIndex = new Map(corpus.surahs.map((s) => [s.index, s]))
  assert.equal(byIndex.get(1)!.nameFaAlt, 'حمد')
  assert.equal(byIndex.get(112)!.nameFaAlt, 'توحید')
  assert.equal(byIndex.get(2)!.nameFaAlt, null)
})