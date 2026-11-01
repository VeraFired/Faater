/**
 * D1 retrieval contract tests for BUG-001.
 *
 * The Worker path is the one users hit. These assert membership, not exact
 * order: the in-memory and FTS5 implementations differ at the margins, and a
 * brittle rank assertion would fail for reasons that are not defects.
 */

import { strict as assert } from 'node:assert'
import { before, test } from 'node:test'

import { searchD1, type D1Database, type Lexicon, type SurahMeta } from '../src/retrieve.ts'
import { d1Adapter, loadMeta, loadSchemaAndSeed, openDatabase } from './helpers.ts'

let db: D1Database
let lexicon: Lexicon
let surahs: SurahMeta[]

before(async () => {
  const sqlite = openDatabase()
  await loadSchemaAndSeed(sqlite)
  db = d1Adapter(sqlite)
  const meta = await loadMeta(sqlite)
  lexicon = meta.lexicon
  surahs = meta.surahs
})

const refsOf = (hits: Array<{ ref: string }>) => hits.map((h) => h.ref)

test('a Persian wine-and-gambling question surfaces 2:219 in the top 5', async () => {
  const hits = await searchD1(db, lexicon, surahs, 'شراب و قمار', {
    limit: 50,
    language: 'fa',
  })
  const top5 = refsOf(hits.slice(0, 5))
  for (const ref of ['2:219', '5:90', '5:91']) {
    assert.ok(top5.includes(ref), `${ref} missing from top 5: ${top5.join(', ')}`)
  }
})

test('the D1 path does not import the wine/veil and gambling/deferment false friends', async () => {
  const hits = await searchD1(db, lexicon, surahs, 'شراب و قمار', {
    limit: 50,
    language: 'fa',
  })
  const top5 = refsOf(hits.slice(0, 5))
  for (const ref of ['24:31', '2:280']) {
    assert.ok(!top5.includes(ref), `${ref} ranked in the top 5: ${top5.join(', ')}`)
  }
})

test('the English alcohol-and-gambling question still reaches 2:219', async () => {
  const hits = await searchD1(
    db,
    lexicon,
    surahs,
    'What does the Quran say about alcohol and gambling?',
    { limit: 5, language: 'en' },
  )
  assert.ok(refsOf(hits).includes('2:219'), refsOf(hits).join(', '))
})

test('a Persian request never ranks 2:219 below an English request', async () => {
  // Coverage (D) alone lifts 2:219 to rank 3 in both request languages, so this
  // is a direction guard, not an isolation of A: the Arabic weight must never
  // push the target verse down for the language it exists to help.
  const fa = await searchD1(db, lexicon, surahs, 'شراب و قمار', {
    limit: 50,
    language: 'fa',
  })
  const en = await searchD1(db, lexicon, surahs, 'شراب و قمار', {
    limit: 50,
    language: 'en',
  })
  const faRank = fa.findIndex((h) => h.ref === '2:219')
  const enRank = en.findIndex((h) => h.ref === '2:219')
  assert.ok(faRank >= 0 && enRank >= 0)
  assert.ok(
    faRank <= enRank,
    `Persian request ranked 2:219 lower; fa rank ${faRank + 1}, en rank ${enRank + 1}`,
  )
})

test('an Arabic-script question in the Persian UI still reaches 2:219', async () => {
  // The Persian list covers only «ميسر» here, so the Arabic list must keep
  // full weight; otherwise 2:219 (which says «الخمر») falls out of the top 5.
  const hits = await searchD1(db, lexicon, surahs, 'الخمر والميسر', {
    limit: 5,
    language: 'fa',
  })
  assert.ok(refsOf(hits).includes('2:219'), refsOf(hits).join(', '))
})

test('coverage rerank is a no-op for a one-word question in D1 too', async () => {
  const on = await searchD1(
    db,
    lexicon,
    surahs,
    'What does the Quran say about fasting?',
    { limit: 50, language: 'en', coverageRerank: true },
  )
  const off = await searchD1(
    db,
    lexicon,
    surahs,
    'What does the Quran say about fasting?',
    { limit: 50, language: 'en', coverageRerank: false },
  )
  assert.deepEqual(refsOf(on), refsOf(off))
})

test('the D1 patience control still finds 2:153', async () => {
  const hits = await searchD1(
    db,
    lexicon,
    surahs,
    'What does the Quran say about patience?',
    { limit: 5, language: 'en' },
  )
  assert.ok(refsOf(hits).includes('2:153'), refsOf(hits).join(', '))
})