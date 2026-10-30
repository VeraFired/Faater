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
    assert.ok(v.arabicVariants.length > 0, `no variants at ${v.ref}`)
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

test('Persian surah names are explicitly unset, not silently missing', () => {
  // Tanzil ships no Persian names. null records the gap so M0 step 4 can close
  // it deliberately instead of shipping an English name in a Persian UI.
  for (const s of corpus.surahs) {
    assert.equal(s.nameFa, null, `surah ${s.index} unexpectedly has a Persian name`)
  }
})