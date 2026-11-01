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

// ---------------------------------------------------------------------------
// BUG-001 — Persian «شراب و قمار» must reach 2:219
// ---------------------------------------------------------------------------

const rankOf = (hits: Array<{ ref: string }>, ref: string): number | null => {
  const i = hits.findIndex((h) => h.ref === ref)
  return i >= 0 ? i + 1 : null
}

test('a Persian wine-and-gambling question surfaces the prohibition cluster', () => {
  const hits = retriever.search('شراب و قمار', { limit: 50, language: 'fa' })
  const top5 = refsOf(hits.slice(0, 5))
  for (const ref of ['2:219', '5:90', '5:91']) {
    assert.ok(top5.includes(ref), `${ref} missing from top 5: ${top5.join(', ')}`)
  }
})

test('the false friends of wine and gambling stay out of the top 5', () => {
  // 24:31 is «خُمُر» (veils), not wine; 2:280 is «ميسرة» (deferment), not
  // gambling. A naive Persian-to-Arabic dictionary imports both.
  const hits = retriever.search('شراب و قمار', { limit: 50, language: 'fa' })
  const top5 = refsOf(hits.slice(0, 5))
  for (const ref of ['24:31', '2:280']) {
    assert.ok(!top5.includes(ref), `${ref} is a false friend and must not rank: ${top5.join(', ')}`)
  }
})

test('a Persian request never ranks 2:219 below an English request', () => {
  // D alone already lifts 2:219 to rank 3 for both request languages, so this
  // no longer isolates A. It still guards the direction: the Arabic weight must
  // never push the target verse down for the language it is meant to help.
  const fa = retriever.search('شراب و قمار', { limit: 50, language: 'fa' })
  const en = retriever.search('شراب و قمار', { limit: 50, language: 'en' })
  const faRank = rankOf(fa, '2:219')
  const enRank = rankOf(en, '2:219')
  assert.ok(faRank !== null && enRank !== null)
  assert.ok(
    faRank <= enRank,
    `Persian request ranked 2:219 lower; fa rank ${faRank}, en rank ${enRank}`,
  )
})

test('an Arabic-script question in the Persian UI keeps full Arabic weight', () => {
  // The Persian list finds «ميسر» in 2:280 (deferment) and covers one group;
  // down-weighting Arabic on that evidence hides 2:219, whose text says
  // «الخمر». The weight must not fire until Persian covers two query groups.
  const hits = retriever.search('الخمر والميسر', { limit: 50, language: 'fa' })
  assert.ok(refsOf(hits.slice(0, 5)).includes('2:219'), refsOf(hits.slice(0, 5)).join(', '))
})

test('the Arabic weight is a no-op for a single-term Persian query', () => {
  const fa = retriever.search('شراب', { limit: 50, language: 'fa' })
  const en = retriever.search('شراب', { limit: 50, language: 'en' })
  assert.deepEqual(refsOf(fa), refsOf(en))
})

test('full coverage is required before the coverage bonus applies', () => {
  // The question shares «مردم», «وجود» and «دارد» with 2:219 — partial overlap
  // that an earlier multiplier turned into rank 1. No document answers the
  // whole question, so D must be a no-op and leave BM25's order intact.
  const on = retriever.search('درباره نحوه سخن گفتن با مردم راهنمایی وجود دارد؟', {
    limit: 50,
    language: 'fa',
  })
  const off = retriever.search('درباره نحوه سخن گفتن با مردم راهنمایی وجود دارد؟', {
    limit: 50,
    language: 'fa',
    coverageRerank: false,
  })
  assert.deepEqual(refsOf(on), refsOf(off))
})

test('coverage rerank is a no-op for a one-word question', () => {
  const on = retriever.search('What does the Quran say about fasting?', {
    limit: 50,
    language: 'en',
  })
  const off = retriever.search('What does the Quran say about fasting?', {
    limit: 50,
    language: 'en',
    coverageRerank: false,
  })
  assert.deepEqual(refsOf(on), refsOf(off))
})

test('the single-word wine query is a known v0.2.0 miss, not a v0.1.1 gate', () => {
  // A one-term query has no cross-field coverage to compare, so D cannot help
  // and A does not apply to English. The reviewed subject layer is the fix.
  // When v0.2.0 lands, this test is expected to change deliberately.
  const hits = retriever.search('What does the Quran say about wine?', {
    limit: 5,
    language: 'en',
  })
  assert.ok(!refsOf(hits).includes('2:219'), refsOf(hits).join(', '))
})