/**
 * Stemmer tests.
 *
 * The stemmers ADD variants; they never replace the exact token. These tests
 * pin the cases that were measured failures, so a future "cleanup" cannot
 * quietly reintroduce them.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { arabicStem, arabicVariants, englishVariants, persianVariants } from '../lib/stem.ts'

test('Arabic stemming reaches a prefixed canonical word', () => {
  // «بالصبر» is how 2:153 writes patience; the bare query is «صبر».
  assert.equal(arabicStem('بالصبر'), 'صبر')
  assert.deepEqual(new Set(arabicVariants('بالصبر')), new Set(['بالصبر', 'صبر']))
})

test('Persian plural «گان» maps to the singular', () => {
  // «فرشتگان» (angels) is the plural used in 2:285; the singular is «فرشته».
  assert.ok(persianVariants('فرشتگان').includes('فرشته'))
  // «پرندگان» -> «پرنده»
  assert.ok(persianVariants('پرندگان').includes('پرنده'))
})

test('Persian sound plurals map to the singular', () => {
  assert.ok(persianVariants('همسران').includes('همسر'))
  assert.ok(persianVariants('مومنان').includes('مومن'))
  // Already normalized and ZWNJ-joined, the form the search path builds.
  assert.ok(persianVariants('ميوههاي').includes('ميوه'))
})

test('Persian present-tense prefix is stripped', () => {
  assert.ok(persianVariants('ميگويد').includes('گويد'))
  assert.ok(persianVariants('نميگويد').includes('گويد'))
})

test('Arabic article on a Persian-loanword query is stripped', () => {
  // The Persian translation of 53:24 says «ميسر است»; a user typing the
  // Arabic form «والميسر» must reach it. Without this, 2:280 wins.
  assert.ok(persianVariants('والميسر').includes('ميسر'))
  assert.ok(persianVariants('الخمر').includes('خمر'))
})

test('Persian stemming never eats the first letter of a plain word', () => {
  // The Arabic stemmer turned «بخشش» into «خشش» and «بهشت» into «هشت»;
  // those artifacts put unrelated verses into the Persian list.
  assert.deepEqual(persianVariants('بخشش'), ['بخشش'])
  assert.deepEqual(persianVariants('بهشت'), ['بهشت'])
})

test('«والدین» is parents, not religion', () => {
  // Stripping the Arabic conjunction from «والدین» left «دین» (religion) in
  // the query, so every parents question was answered with religion verses.
  const variants = persianVariants('والدين')
  assert.ok(!variants.includes('دين'), variants.join(','))
  assert.ok(variants.includes('والد'), variants.join(','))

  // The Arabic field runs the same query through its own stemmer, which had
  // the identical collision.
  assert.ok(!arabicVariants('والدين').includes('دين'), arabicVariants('والدين').join(','))
  assert.equal(arabicStem('والميسر'), 'ميسر')
  assert.equal(arabicStem('الخمر'), 'خمر')
})

test('English inflection variants cover the retrieval misses', () => {
  // The corpus says "backbite"; the user says "backbiting".
  assert.ok(englishVariants('backbiting').includes('backbite'))
  // The corpus says "angel"; the user says "angels".
  assert.ok(englishVariants('angels').includes('angel'))
  // "tested" must reach the concept trigger "test".
  assert.ok(englishVariants('tested').includes('test'))
})

test('every stemmer always keeps the exact token', () => {
  for (const token of ['صبر', 'فرشتگان', 'tested', 'شراب']) {
    assert.ok(persianVariants(token).includes(token))
    assert.ok(englishVariants(token).includes(token))
  }
})
