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
    // The concept layer is allowed to bridge from «ازدواج» to the translation's
    // «زوج» (53:45 names the two mates, not the noun "marriage"). What must not
    // happen is a hit whose only shared word with the question is «قرآن».
    assert.ok(
      text.includes('ازدواج') || text.includes('زوج') || text.includes('همسر'),
      `${hit.ref} ranked for marriage but its Persian text mentions neither marriage nor a spouse: ${text.slice(0, 80)}`,
    )
  }
})
// ---------------------------------------------------------------------------
// Concept expansion — the cross-lingual bridge
// ---------------------------------------------------------------------------

test('concept synonyms retrieve a verse the query wording never reaches', () => {
  // The literal query "charity" appears in no document here: the English verse
  // says "spend ... wealth" and the Arabic verse says «صدقه». Only the concept
  // list connects them. This is the mechanism the paraphrase eval measures.
  const empty = { segments: [], footnotes: [], searchText: '', searchTextJoined: '' }
  const data: RetrieverData = {
    verses: [
      { ref: '1:1', surah: 1, ayah: 1, arabic: 'صدقه', arabicNorm: 'صدقه', bodyNorm: 'صدقه', basmala: null },
      { ref: '1:2', surah: 1, ayah: 2, arabic: 'الصبر', arabicNorm: 'الصبر', bodyNorm: 'الصبر', basmala: null },
      {
        ref: '1:3', surah: 1, ayah: 3, arabic: 'شيء', arabicNorm: 'شيء', bodyNorm: 'شيء', basmala: null,
      },
    ],
    basmala: { text: 'بسم الله الرحمن الرحيم', norm: 'بسم الله الرحمن الرحيم', ref: '1:0' },
    surahs: [
      { index: 1, ayahs: 3, nameAr: 'الفاتحة', nameEn: 'Al-Fatihah', nameTranslit: 'Al-Faatiha', nameFa: 'فاتحه', nameFaAlt: null },
    ],
    en: {
      '1:1': { ...empty, searchText: 'a book of guidance', searchTextJoined: 'a book of guidance' },
      '1:2': { ...empty, searchText: 'patience and steadfastness', searchTextJoined: 'patience and steadfastness' },
      '1:3': { ...empty, searchText: 'spend their wealth in the way of god', searchTextJoined: 'spend their wealth in the way of god' },
    },
    fa: {},
    lexicon: {
      concepts: [
        {
          id: 'charity', fa: 'صدقه', en: 'charity', keys: ['sadaqe'],
          synonyms: { en: ['spend', 'wealth'], fa: ['صدقه'], faJoined: ['صدقه'], ar: ['صدقه'] },
        },
        { id: 'patience', fa: 'صبر', en: 'patience', keys: ['sabr'] },
      ],
      names: [],
      surahAliases: [],
    },
  }

  const literal = new Retriever(data, { conceptExpansion: false }).search('charity')
  assert.deepEqual(literal, [], 'literal retrieval should find nothing for this wording')

  const expanded = new Retriever(data, { conceptExpansion: true }).search('charity')
  const refs = expanded.map((h) => h.ref)
  assert.ok(refs.includes('1:3'), `expected the "spend wealth" verse, got ${refs.join(', ')}`)
  assert.ok(refs.includes('1:1'), `expected the Arabic «صدقه» verse via the concept bridge, got ${refs.join(', ')}`)
  assert.ok(!refs.includes('1:2'), `patience must not be pulled in, got ${refs.join(', ')}`)
})

test('a concept can exclude a verse that shares its spelling but not its sense', () => {
  // «خُمُر» in 24:31 is "veils", not wine; «ميسرة» in 2:280 is "deferment",
  // not gambling. Concept expansion must not import those false friends.
  const empty = { segments: [], footnotes: [], searchText: '', searchTextJoined: '' }
  const data: RetrieverData = {
    verses: [
      { ref: '1:1', surah: 1, ayah: 1, arabic: 'خمر', arabicNorm: 'خمر', bodyNorm: 'خمر', basmala: null },
      { ref: '1:2', surah: 1, ayah: 2, arabic: 'خمر', arabicNorm: 'خمر', bodyNorm: 'خمر', basmala: null },
      { ref: '1:3', surah: 1, ayah: 3, arabic: 'صبر', arabicNorm: 'صبر', bodyNorm: 'صبر', basmala: null },
      { ref: '1:4', surah: 1, ayah: 4, arabic: 'عدل', arabicNorm: 'عدل', bodyNorm: 'عدل', basmala: null },
    ],
    basmala: { text: 'بسم الله الرحمن الرحيم', norm: 'بسم الله الرحمن الرحيم', ref: '1:0' },
    surahs: [
      { index: 1, ayahs: 4, nameAr: 'الفاتحة', nameEn: 'Al-Fatihah', nameTranslit: 'Al-Faatiha', nameFa: 'فاتحه', nameFaAlt: null },
    ],
    en: {
      '1:1': { ...empty, searchText: 'wine is forbidden', searchTextJoined: 'wine is forbidden' },
      '1:2': { ...empty, searchText: 'wine in the gardens', searchTextJoined: 'wine in the gardens' },
      '1:3': { ...empty, searchText: 'patience and prayer', searchTextJoined: 'patience and prayer' },
      '1:4': { ...empty, searchText: 'justice for the orphan', searchTextJoined: 'justice for the orphan' },
    },
    fa: {},
    lexicon: {
      concepts: [
        {
          id: 'alcohol',
          fa: 'شراب',
          en: 'alcohol',
          keys: ['sharab'],
          synonyms: { en: ['wine'], fa: ['شراب'], faJoined: ['شراب'], ar: ['خمر'], excludes: ['1:2'] },
        },
      ],
      names: [],
      surahAliases: [],
    },
  }

  const hits = new Retriever(data).search('alcohol')
  const refs = hits.map((h) => h.ref)
  assert.ok(refs.includes('1:1'), `expected the prohibition verse, got ${refs.join(', ')}`)
  assert.ok(!refs.includes('1:2'), `the excluded false friend must not appear, got ${refs.join(', ')}`)
})

test('concept expansion reaches the canonical verse for common Persian topics', async () => {
  // Each of these was a "related keyword" miss before the concept layer. They
  // assert top-5 membership on the real corpus, not exact rank: the layer is a
  // bridge, and the literal lists may legitimately lead.
  const retriever = new Retriever(await loadRetrieverData())
  const cases: Array<[string, string]> = [
    ['غیبت', '49:12'], // backbiting
    ['ربا', '3:130'], // usury
    ['همسایه', '4:36'], // neighbours
    ['یاد خدا', '13:28'], // remembrance of God
  ]
  for (const [q, gold] of cases) {
    const refs = retriever.search(q, { limit: 5, language: 'fa' }).map((h) => h.ref)
    assert.ok(refs.includes(gold), `${q} should reach ${gold}, got ${refs.join(', ')}`)
  }
})
