/**
 * Statistics tests.
 *
 * Every assertion here is against an independently computable value — a closed
 * form, a textbook table, or an invariant (a 95% interval must contain the
 * point estimate). These numbers will be quoted in the eval report, so they
 * have to be right before anything is measured with them.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  betai,
  clopperPearson,
  itemsForUpperBound,
  lnGamma,
  mean,
  normalQuantile,
  percentile,
  wilson,
} from '../lib/stats.ts'

const close = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b} (tol ${tol})`)

test('lnGamma matches known factorials', () => {
  close(lnGamma(1), 0)
  close(lnGamma(2), 0)
  close(lnGamma(5), Math.log(24))
  close(lnGamma(0.5), Math.log(Math.sqrt(Math.PI)))
})

test('betai matches closed forms', () => {
  // I_x(1,1) = x.
  close(betai(1, 1, 0.37), 0.37)
  // I_x(2,2) = 3x² - 2x³.
  close(betai(2, 2, 0.3), 3 * 0.09 - 2 * 0.027, 1e-10)
  // I_x(a,b) = 1 - I_{1-x}(b,a).
  close(betai(3, 7, 0.42), 1 - betai(7, 3, 0.58), 1e-10)
})

test('normalQuantile matches the standard table', () => {
  close(normalQuantile(0.975), 1.959963984540054, 1e-6)
  close(normalQuantile(0.995), 2.5758293035489004, 1e-6)
  close(normalQuantile(0.5), 0, 1e-9)
})

test('the 75-item sample cannot support a 2% claim', () => {
  // This is the plan's power check, asserted rather than asserted-in-prose.
  const { upper } = clopperPearson(0, 75)
  assert.ok(upper > 0.04, `upper bound was ${upper}; the plan assumed ~4.8%`)
  assert.ok(upper < 0.05, `upper bound was ${upper}; the plan assumed ~4.8%`)
  // Closed form for k = 0: upper = 1 - (alpha/2)^(1/n).
  close(upper, 1 - Math.pow(0.025, 1 / 75), 1e-9)
})

test('itemsForUpperBound returns the sample size the target requires', () => {
  // Zero observed errors, 95% confidence:
  //   2% -> 183, 5% -> 72, 10% -> 36
  assert.equal(itemsForUpperBound(0.02), 183)
  assert.equal(itemsForUpperBound(0.05), 72)
  assert.equal(itemsForUpperBound(0.1), 36)
  // The returned n must actually deliver the bound.
  for (const target of [0.01, 0.02, 0.05, 0.1, 0.2]) {
    const n = itemsForUpperBound(target)
    assert.ok(
      clopperPearson(0, n).upper <= target + 1e-12,
      `n=${n} did not reach ${target}`,
    )
    if (n > 1) {
      assert.ok(
        clopperPearson(0, n - 1).upper > target,
        `n=${n} is not minimal for ${target}`,
      )
    }
  }
})

test('Clopper-Pearson is conservative and brackets the estimate', () => {
  for (const [k, n] of [[0, 20], [1, 20], [10, 20], [19, 20], [20, 20], [3, 75]] as const) {
    const ci = clopperPearson(k, n)
    const p = k / n
    assert.ok(ci.lower <= p + 1e-12, `lower ${ci.lower} > p ${p}`)
    assert.ok(ci.upper >= p - 1e-12, `upper ${ci.upper} < p ${p}`)
    assert.ok(ci.lower >= 0 && ci.upper <= 1)
  }
  // Degenerate ends are handled exactly, not approximated.
  assert.deepEqual(clopperPearson(0, 10).lower, 0)
  assert.deepEqual(clopperPearson(10, 10).upper, 1)
})

test('Wilson is narrower than Clopper-Pearson at the same point', () => {
  const cp = clopperPearson(1, 75)
  const w = wilson(1, 75)
  assert.ok(
    w.upper - w.lower < cp.upper - cp.lower,
    'Wilson should be tighter than the exact interval',
  )
})

test('an interval shrinks as n grows', () => {
  const small = clopperPearson(0, 10)
  const large = clopperPearson(0, 1000)
  assert.ok(large.upper < small.upper / 50)
})

test('mean and percentile behave', () => {
  assert.equal(mean([]), 0)
  assert.equal(mean([1, 2, 3]), 2)
  assert.equal(percentile([3, 1, 2], 0), 1)
  assert.equal(percentile([3, 1, 2], 1), 3)
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5)
})

test('invalid inputs are rejected, not silently coerced', () => {
  assert.throws(() => clopperPearson(5, 0))
  assert.throws(() => clopperPearson(-1, 10))
  assert.throws(() => clopperPearson(11, 10))
  assert.throws(() => itemsForUpperBound(0))
  assert.throws(() => itemsForUpperBound(1))
  assert.throws(() => normalQuantile(0))
})