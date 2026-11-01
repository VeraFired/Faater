/**
 * Query-plan and coverage arithmetic.
 *
 * These tests pin the two properties that keep the BUG-001 rerank honest:
 * a Persian ZWNJ word is ONE query group, not two, and a group counts only
 * when it matched some literal candidate. Get either wrong and the multiplier
 * silently rewards the wrong verses.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { buildCoveragePlan, coverageOf } from '../lib/query-plan.ts'
import { arWeightFor } from '../lib/query.ts'

test('a Persian wine-and-gambling query becomes two content groups', () => {
  const plan = buildCoveragePlan('شراب و قمار')
  assert.equal(plan.groups.length, 2)
  assert.deepEqual(
    plan.groups.map((g) => g.variants[0]).sort(),
    ['شراب', 'قمار'].sort(),
  )
})

test('the English question frame is removed, leaving the topics', () => {
  const plan = buildCoveragePlan('What does the Quran say about alcohol and gambling?')
  assert.equal(plan.groups.length, 2)
  assert.ok(plan.groups.some((g) => g.variants.includes('alcohol')))
  assert.ok(plan.groups.some((g) => g.variants.includes('gambling')))
  // "quran" names the corpus, not the topic. If it survived, every verse
  // mentioning the Book would look fully covered.
  assert.ok(!plan.groups.some((g) => g.variants.includes('quran')))
})

test('a ZWNJ word keeps its split and joined forms in one group', () => {
  const plan = buildCoveragePlan('می‌خواهد')
  assert.equal(plan.groups.length, 1, 'split and joined forms must not double the denominator')
  assert.ok(plan.groups[0].variants.includes('خواهد'))
  assert.ok(plan.groups[0].variants.includes('ميخواهد'))
})

test('a Persian question with one content word yields one group', () => {
  const plan = buildCoveragePlan('قرآن درباره صبر چه می‌گوید؟')
  assert.equal(plan.groups.length, 1)
  assert.deepEqual(plan.groups[0].variants, ['صبر'])
})

test('inflection variants of the same word merge into one group', () => {
  const plan = buildCoveragePlan('wine wines')
  assert.equal(plan.groups.length, 1, 'two spellings of one term are not two questions')
  assert.ok(plan.groups[0].variants.includes('wine'))
  assert.ok(plan.groups[0].variants.includes('wines'))
})

test('coverage ignores a group that no literal candidate matched', () => {
  const plan = buildCoveragePlan('alpha beta')
  // Only alpha exists in the candidate set. beta must not become a free
  // denominator slot that makes every document look half-covered.
  const coverage = coverageOf(plan, new Set(['alpha']), new Set(['alpha']))
  assert.equal(coverage.eligible, 1)
  assert.equal(coverage.covered, 1)
  assert.equal(coverage.ratio, 1)
})

test('coverage is the fraction of eligible groups a document matched', () => {
  const plan = buildCoveragePlan('alpha beta')
  const matchedAcross = new Set(['alpha', 'beta'])
  assert.equal(coverageOf(plan, matchedAcross, new Set(['alpha'])).ratio, 0.5)
  assert.equal(coverageOf(plan, matchedAcross, new Set(['beta'])).ratio, 0.5)
  assert.equal(coverageOf(plan, matchedAcross, new Set(['alpha', 'beta'])).ratio, 1)
  assert.equal(coverageOf(plan, matchedAcross, new Set()).ratio, 0)
})

test('the Arabic weight only moves for Persian requests with Persian hits', () => {
  assert.equal(arWeightFor('fa', true, 2), 0.3)
  assert.equal(arWeightFor('fa', false, 2), 1)
  assert.equal(arWeightFor('en', true, 2), 1)
  assert.equal(arWeightFor(undefined, true, 2), 1)
  assert.equal(arWeightFor('fa', true, 2, 0.4), 0.4)
})

test('the Arabic weight stays full unless Persian covers two query groups', () => {
  // «الخمر والميسر» is valid Arabic typed in the Persian UI. The Persian list
  // finds «ميسر» in 2:280 (deferment) and covers one group. Down-weighting
  // Arabic here hides 2:219, whose text says «الخمر».
  assert.equal(arWeightFor('fa', true, 1), 1)
  // A single-term Persian query has no cross-term evidence either. The
  // patience control showed why: its gold 2:153 is Arabic-only and drops out
  // of the top 50 when the Arabic list is down-weighted on one group.
  assert.equal(arWeightFor('fa', true, 0), 1)
})

test('punctuation separates topics the way whitespace does', () => {
  for (const query of ['wine-gambling', 'wine/gambling', 'wine, gambling', 'شراب، قمار']) {
    const plan = buildCoveragePlan(query)
    assert.equal(plan.groups.length, 2, `${query} must not be one coverage group`)
  }
})

test('a ZWNJ plural suffix is not a coverage group of its own', () => {
  const plan = buildCoveragePlan('میوه‌های بهشت')
  assert.equal(plan.groups.length, 2)
  const all = plan.groups.flatMap((g) => g.variants)
  assert.ok(all.includes('ميوه'))
  assert.ok(all.includes('بهشت'))
  assert.ok(!all.includes('هاي'), 'the plural suffix must not count as fruit')
  assert.ok(!all.includes('هشت'), 'the single-letter stem «هشت» is not «بهشت»')
})

test('the Arabic article in a hyphenated transliteration is not a topic', () => {
  const plan = buildCoveragePlan('Al-Quran and patience')
  assert.equal(plan.groups.length, 1)
  assert.deepEqual(plan.groups[0].variants, ['patience'])
})

test('a Persian light verb is not a coverage group', () => {
  // «یاد کردن خدا» is one topic. Counting «کردن» as a second group let
  // coverage boost 12:42, the narrative that literally says «ياد كردن از
  // يوسف», over 13:28, the verse about remembrance of God.
  const plan = buildCoveragePlan('یاد کردن خدا')
  const all = plan.groups.flatMap((g) => g.variants)
  assert.ok(all.includes('ياد'))
  assert.ok(!all.includes('كردن'), 'the light verb must not be a topic group')
})

test('a stopword or frame term cannot re-enter through a variant', () => {
  // "Quran's" normalizes to "quran s"; the joined form expands to
  // {qurans, quran}. Both the singular and the folded possessive are frame
  // terms, so nothing remains.
  const quran = buildCoveragePlan("Quran's")
  assert.equal(quran.groups.length, 0)

  const whats = buildCoveragePlan("what's")
  assert.equal(whats.groups.length, 0)

  const beings = buildCoveragePlan('beings')
  assert.ok(!beings.groups.some((g) => g.variants.includes('being')))
  // "beings" itself is content, not a function word; only its stopword
  // variant is removed.
  assert.ok(beings.groups.some((g) => g.variants.includes('beings')))
})