/**
 * Search-quality regression tests.
 *
 * Each group here pins a defect that was found by measurement, not by
 * inspection. They are behavioural where the defect was behavioural (a query
 * returning the wrong verses) and unit-level where the defect was in a pure
 * function (a fold that produced the wrong key).
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Retriever, type RetrieverData } from '../lib/retrieve.ts'
import { englishVariants } from '../lib/stem.ts'
import { ENGLISH_MARKERS, STOPWORDS_EN, STOPWORDS_FA, foldEnglish } from '../lib/stopwords.ts'
import { loadRetrieverData } from './helpers.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---------------------------------------------------------------------------
// foldEnglish — the English search key
// ---------------------------------------------------------------------------

test('foldEnglish folds apostrophes so "Qur\'an" and "quran" meet', () => {
  // foldEnglish preserves case; normalize() lowercases afterwards. The search
  // path composes them, so compare the folded form case-insensitively here.
  const key = (s: string) => foldEnglish(s).toLowerCase()
  assert.equal(key("Qur'an"), 'quran')
  assert.equal(key('Qur’an'), 'quran') // U+2019
  assert.equal(key('Qurʼan'), 'quran') // U+02BC
  assert.equal(key('quran'), 'quran')
})

test('foldEnglish strips transliteration diacritics, not just apostrophes', () => {
  // The Sahih International edition writes «qurān» with U+0101 and «ṣalāh»
  // with dots below. Before this fold the search key was "qurān" and no user
  // typing "quran" could ever match it, even after the apostrophe fix.
  assert.equal(foldEnglish('qurān'), 'quran')
  assert.equal(foldEnglish('ṣalāh'), 'salah')
  assert.equal(foldEnglish('ḥajj'), 'hajj')
  assert.equal(foldEnglish('ʿĪsā'), 'Isa')
})

test('foldEnglish leaves ordinary English untouched', () => {
  assert.equal(foldEnglish('patience'), 'patience')
  assert.equal(foldEnglish('Day of Judgment'), 'Day of Judgment')
})

// ---------------------------------------------------------------------------
// Stopwords — query-side only, and derived through the normalizer
// ---------------------------------------------------------------------------

test('Persian stopwords match the form the tokenizer actually produces', () => {
  // FA_RAW is written in Persian orthography; derive() normalizes it.
  assert.ok(STOPWORDS_FA.has('درباره'), 'درباره must be a stopword')
  assert.ok(STOPWORDS_FA.has('مي'), 'می must be a stopword')
  assert.ok(STOPWORDS_FA.has('گويد'), 'گوید must be a stopword')
  assert.ok(STOPWORDS_FA.has('كه'), 'که must be a stopword')
})

test('the stopword derivation never smuggles in a content word', () => {
  // «میتوان» splits to «مي» + «توان»; «توان» means "power/ability" and must
  // NOT become a stopword. The split parts that are genuine function words are
  // listed in FA_RAW explicitly.
  assert.equal(STOPWORDS_FA.has('توان'), false, 'توان is a content word')
  assert.equal(STOPWORDS_FA.has('صبر'), false, 'صبر is the topic, not a function word')
})

test('English stopwords carry the question frame but not the topic', () => {
  assert.ok(STOPWORDS_EN.has('the'))
  assert.ok(STOPWORDS_EN.has('say'))
  assert.equal(STOPWORDS_EN.has('patience'), false)
})

// ---------------------------------------------------------------------------
// englishVariants — inflection, added alongside the exact token
// ---------------------------------------------------------------------------

test('englishVariants reaches the singular of a plural query', () => {
  assert.ok(englishVariants('angels').includes('angel'))
  assert.ok(englishVariants('trials').includes('trial'))
  assert.ok(englishVariants('stories').includes('story'))
})

test('englishVariants reaches the base form of -ing / -ed', () => {
  const backbiting = englishVariants('backbiting')
  assert.ok(backbiting.includes('backbite'), backbiting.join(','))
  const running = englishVariants('running')
  assert.ok(running.includes('run'), running.join(','))
  const created = englishVariants('created')
  assert.ok(created.includes('create'), created.join(','))
})

test('englishVariants never drops the exact token', () => {
  for (const token of ['angels', 'backbiting', 'running', 'created', 'patience']) {
    assert.ok(englishVariants(token).includes(token), token)
  }
  // Short tokens are left alone: stemming "as" or "is" invents words.
  assert.deepEqual(englishVariants('as'), ['as'])
  assert.deepEqual(englishVariants('man'), ['man'])
})

// ---------------------------------------------------------------------------
// Language identification — the guard that stops English being read as Finglish
// ---------------------------------------------------------------------------

function stubRetriever(): Retriever {
  // Two documents: one Arabic verse that mentions the Quran, one English
  // translation that is about patience. The Arabic verse's English translation
  // deliberately does NOT contain "quran", so the only way it can be retrieved
  // by an English question is the Finglish expander injecting «قران».
  const empty = { segments: [], footnotes: [], searchText: '', searchTextJoined: '' }
  const data: RetrieverData = {
    verses: [
      {
        ref: '1:1',
        surah: 1,
        ayah: 1,
        arabic: 'القران',
        arabicNorm: 'القران',
        bodyNorm: 'القران',
        basmala: null,
      },
      {
        ref: '1:2',
        surah: 1,
        ayah: 2,
        arabic: 'الصبر',
        arabicNorm: 'الصبر',
        bodyNorm: 'الصبر',
        basmala: null,
      },
    ],
    basmala: { text: 'بسم الله الرحمن الرحيم', norm: 'بسم الله الرحمن الرحيم', ref: '1:0' },
    surahs: [
      {
        index: 1,
        ayahs: 2,
        nameAr: 'الفاتحة',
        nameEn: 'Al-Fatihah',
        nameTranslit: 'Al-Faatiha',
        nameFa: 'فاتحه',
        nameFaAlt: null,
      },
    ],
    en: {
      '1:1': { ...empty, searchText: 'a book of guidance', searchTextJoined: 'a book of guidance' },
      '1:2': {
        ...empty,
        searchText: 'patience and steadfastness',
        searchTextJoined: 'patience and steadfastness',
      },
    },
    fa: {},
    lexicon: {
      concepts: [
        { id: 'patience', fa: 'صبر', en: 'patience', keys: ['sabr'] },
        { id: 'quran', fa: 'قران', en: 'quran', keys: ['quran'] },
      ],
      names: [],
      surahAliases: [],
    },
  }
  return new Retriever(data)
}

test('an English sentence is never expanded as Finglish', () => {
  // "quran" is a valid Finglish key. Without the ENGLISH_MARKERS guard, the
  // English question "what does the Quran say about patience" resolved it and
  // injected «قران» into the Arabic field, which then outvoted the English
  // list. The Arabic-only verse must not appear.
  const hits = stubRetriever().search('what does the Quran say about patience')
  assert.ok(hits.length > 0, 'the English list should still retrieve')
  assert.deepEqual(
    hits.map((h) => h.ref),
    ['1:2'],
    `English query leaked into the Finglish path: ${hits.map((h) => h.ref).join(', ')}`,
  )
})

test('a bare Finglish word still resolves', () => {
  const hits = stubRetriever().search('sabr')
  assert.ok(hits.length > 0, 'Finglish produced no results')
  assert.equal(hits[0].ref, '1:2')
})

test('the English-marker set contains the words that identify a sentence', () => {
  for (const w of ['the', 'what', 'does', 'about', 'is']) {
    assert.ok(ENGLISH_MARKERS.has(w), w)
  }
  assert.equal(ENGLISH_MARKERS.has('sabr'), false)
})

// ---------------------------------------------------------------------------
// Frame terms — down-weighted, and never the whole story
// ---------------------------------------------------------------------------

test('a query with content words is not answered by frame-term hits alone', async () => {
  // «قرآن درباره ازدواج چه می‌گوید» has no Arabic content term at all, so the
  // Arabic field used to match only «قرآن» and return 4:82, 2:185, 7:204 —
  // verses that mention the Quran and nothing the user asked about. Those hits
  // outvoted the Persian list in RRF.
  const retriever = new Retriever(await loadRetrieverData())
  const hits = retriever.search('قرآن درباره ازدواج چه می‌گوید', { limit: 20 })
  assert.ok(hits.length > 0, 'the Persian field should still answer')
  const fa = JSON.parse(
    await readFile(join(ROOT, 'data', 'build', 'translations.fa.json'), 'utf8'),
  ) as { verses: Record<string, { searchText: string }> }
  for (const hit of hits) {
    const text = fa.verses[hit.ref]?.searchText ?? ''
    assert.ok(
      text.includes('ازدواج'),
      `${hit.ref} ranked for marriage but its Persian text does not mention it: ${text.slice(0, 80)}`,
    )
  }
})