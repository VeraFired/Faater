/**
 * Weighted Reciprocal Rank Fusion.
 *
 * The concept layer is fused at a tenth of a literal field's weight so it can
 * only promote verses the literal lists missed. That property is arithmetic,
 * not intent, so it is pinned here: a unit test on the fusion weights and a
 * behavioural test that weight 0 is indistinguishable from expansion off.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { rrf, type RankedDoc } from '../lib/bm25.ts'
import { Retriever, type RetrieverData } from '../lib/retrieve.ts'

const doc = (d: number): RankedDoc => ({ doc: d, score: 0 })

test('rrf without weights fuses by rank', () => {
  const fused = rrf([[doc(1), doc(2)], [doc(2), doc(1)]])
  // Both appear at rank 1 and rank 2 once; the tie falls to the lower doc id.
  assert.deepEqual(fused.map((r) => r.doc), [1, 2])
  assert.equal(fused[0].score, fused[1].score)
})

test('rrf weight scales a list without reordering it', () => {
  const low = rrf([[doc(1)], [doc(2)]], 60, [1, 0.1])
  assert.deepEqual(low.map((r) => r.doc), [1, 2], 'a 0.1 list must not outrank a 1.0 list')
  const equal = rrf([[doc(1)], [doc(2)]], 60, [1, 1])
  assert.equal(equal[0].score, equal[1].score, 'equal weights give equal single-rank scores')
})

test('a zero weight contributes nothing at all', () => {
  const fused = rrf([[doc(1)], [doc(2)]], 60, [1, 0])
  assert.deepEqual(fused.map((r) => r.doc), [1])
})

// ---------------------------------------------------------------------------
// Behavioural: the concept list honours the weight
// ---------------------------------------------------------------------------

function bridgeData(): RetrieverData {
  const empty = { segments: [], footnotes: [], searchText: '', searchTextJoined: '' }
  return {
    verses: [
      { ref: '1:1', surah: 1, ayah: 1, arabic: 'صدقه', arabicNorm: 'صدقه', bodyNorm: 'صدقه', basmala: null },
      { ref: '1:2', surah: 1, ayah: 2, arabic: 'الصبر', arabicNorm: 'الصبر', bodyNorm: 'الصبر', basmala: null },
      { ref: '1:3', surah: 1, ayah: 3, arabic: 'شيء', arabicNorm: 'شيء', bodyNorm: 'شيء', basmala: null },
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
}

test('concept weight 0 matches expansion off exactly', () => {
  const data = bridgeData()
  const off = new Retriever(data, { conceptExpansion: false }).search('patience charity', { limit: 20 })
  const zero = new Retriever(data, { conceptExpansion: true, conceptWeight: 0 }).search('patience charity', { limit: 20 })
  assert.deepEqual(
    zero.map((h) => h.ref),
    off.map((h) => h.ref),
    'a zero-weight concept list must not move the ranking',
  )
})

test('the default concept weight still bridges a wording gap', () => {
  // Guards the tuned default: if the weight is set so low it is effectively
  // off, the paraphrase gain measured in the ablation silently disappears.
  const hits = new Retriever(bridgeData(), { conceptExpansion: true }).search('charity')
  const refs = hits.map((h) => h.ref)
  assert.ok(refs.includes('1:1'), `expected the Arabic «صدقه» verse, got ${refs.join(', ')}`)
  assert.ok(refs.includes('1:3'), `expected the "spend wealth" verse, got ${refs.join(', ')}`)
})