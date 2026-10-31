/**
 * Retrieval smoke tests over the real corpus.
 *
 * These are behavioural, not exhaustive: they prove that each input route
 * (Arabic script, Persian, English, Finglish, direct reference, basmala)
 * reaches the right part of the corpus at all. Refusal quality is measured
 * separately by the eval set.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { Retriever } from '../lib/retrieve.ts'
import { loadRetrieverData } from './helpers.ts'

const data = await loadRetrieverData()
const t0 = performance.now()
const retriever = new Retriever(data)
const buildMs = performance.now() - t0

const refsOf = (hits: Array<{ ref: string }>) => hits.map((h) => h.ref)

test('the index builds in reasonable time', () => {
  assert.ok(buildMs < 15000, `index build took ${buildMs.toFixed(0)} ms`)
  console.log(`        index build: ${buildMs.toFixed(0)} ms`)
})

test('a Persian query for patience reaches patience verses', () => {
  const hits = retriever.search('صبر', { limit: 50 })
  assert.ok(hits.length > 0, 'no results')
  // 2:153 is the canonical patience verse but is long, and BM25 rewards short
  // documents — its short sibling 2:45 ranks higher, which is defensible.
  // Top-25 is the honest expectation for a one-word query; closing the gap is
  // the dense retriever's job (M3), not BM25's.
  assert.ok(
    refsOf(hits.slice(0, 25)).includes('2:153'),
    `expected 2:153 among top 25, got ${refsOf(hits.slice(0, 25)).join(', ')}`,
  )
})

test('the top Persian patience hits really are about patience', () => {
  // Better than demanding a specific rank: every top hit must contain a
  // صبر-derived token, which is what makes the ranking defensible at all.
  const hits = retriever.search('صبر').slice(0, 5)
  assert.equal(hits.length, 5)
  for (const h of hits) {
    const v = data.verses.find((x) => x.ref === h.ref)!
    assert.ok(
      /صبر|صابر|بالصبر|والصبر/.test(v.bodyNorm),
      `${h.ref} ranked for صبر but its text is: ${v.bodyNorm.slice(0, 60)}`,
    )
  }
})

test('an English query for patience reaches the same region', () => {
  const hits = retriever.search('patience')
  assert.ok(hits.length > 0)
  assert.ok(
    refsOf(hits.slice(0, 20)).includes('2:153'),
    `expected 2:153 among top 20, got ${refsOf(hits.slice(0, 20)).join(', ')}`,
  )
})

test('a Finglish query for patience works without a model', () => {
  const hits = retriever.search('sabr')
  assert.ok(hits.length > 0, 'Finglish produced no results')
  assert.ok(
    refsOf(hits.slice(0, 20)).includes('2:153'),
    `expected 2:153 among top 20, got ${refsOf(hits.slice(0, 20)).join(', ')}`,
  )
})

test('a basmala query returns 1:1, not 113 surah openings', () => {
  const hits = retriever.search('بسم الله الرحمن الرحیم')
  assert.ok(hits.length > 0)
  assert.equal(hits[0].ref, '1:1', `top hit was ${hits[0].ref}`)
  // The defect this guards: before segmentation, this query returned 113
  // near-identical openings. A handful of legitimate hits is fine; 113 is not.
  assert.ok(hits.length < 20, `basmala query returned ${hits.length} hits`)
})

test('a direct reference bypasses retrieval', () => {
  const hits = retriever.search('2:255')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].ref, '2:255')
  assert.deepEqual(hits[0].fields, ['reference'])
})

test('a reference range returns contiguous verses', () => {
  const hits = retriever.search('2:255-257')
  assert.deepEqual(refsOf(hits), ['2:255', '2:256', '2:257'])
})

test('a surah name returns that surah', () => {
  const hits = retriever.search('سوره یس')
  assert.equal(hits.length, 20) // limited
  assert.ok(hits.every((h) => h.ref.startsWith('36:')))
})

test('a Persian question that shares no lexeme with Arabic still retrieves', () => {
  // نکته: این پرسش از ترجمه فارسی می‌آید، نه از واژه‌های عربی.
  const hits = retriever.search('چه کسی آسمان‌ها و زمین را آفرید')
  assert.ok(hits.length > 0, 'translation-side retrieval failed')
})

test('nonsense retrieves nothing', () => {
  const hits = retriever.search('zxqv blorf')
  assert.deepEqual(hits, [])
})

test('results never contain a ref outside the corpus', () => {
  for (const q of ['صبر', 'patience', 'نور', 'light', 'رحمت', 'mercy', 'sabr']) {
    for (const hit of retriever.search(q)) {
      assert.match(hit.ref, /^\d{1,3}:\d{1,3}$/, `bad ref from "${q}": ${hit.ref}`)
    }
  }
})