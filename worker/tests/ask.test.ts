/**
 * Answer-path tests. These are contract tests: status, fixed copy, and card
 * shape are what the product promises, so they are asserted against the real
 * seed, not stubs.
 */

import { strict as assert } from 'node:assert'
import { before, test } from 'node:test'

import { ask } from '../src/ask.ts'
import type { D1Database } from '../src/retrieve.ts'
import { d1Adapter, loadSchemaAndSeed, openDatabase } from './helpers.ts'

let db: D1Database

before(async () => {
  const sqlite = openDatabase()
  await loadSchemaAndSeed(sqlite)
  db = d1Adapter(sqlite)
})

test('an answerable question returns verse cards with Arabic and both translations', async () => {
  const res = await ask(db, { q: 'What does the Quran say about patience?' }, 't1')
  assert.equal(res.status, 'answered')
  assert.ok(res.verses.length > 0, 'no verse cards')
  const card = res.verses[0]
  assert.match(card.ref, /^\d+:\d+$/)
  assert.ok(card.arabic.length > 0, 'Arabic is empty')
  assert.equal(card.translations.length, 2)
  assert.ok(card.translations.every((t) => t.text.length > 0))
  assert.equal(card.links.quran_com, `https://quran.com/${card.surah}/${card.ayah}`)
  assert.equal(res.mode, 'retrieval_only')
})

test('patience retrieves a verse that actually mentions patience', async () => {
  const res = await ask(db, { q: 'What does the Quran say about patience?' }, 't2')
  const refs = res.verses.map((v) => v.ref)
  assert.ok(
    refs.includes('2:153'),
    `2:153 (the canonical patience verse) missing; got ${refs.join(', ')}`,
  )
})

test('an off-topic question is refused with the fixed no-evidence copy', async () => {
  const res = await ask(db, { q: 'Tell me a joke.' }, 't3')
  assert.equal(res.status, 'refused')
  assert.equal(res.reason, 'no_evidence')
  assert.match(res.message ?? '', /could not find a Quranic verse/)
  assert.deepEqual(res.verses, [])
})

test('an empty or one-character question is a clarification, not a refusal', async () => {
  const res = await ask(db, { q: 'a' }, 't4')
  assert.equal(res.status, 'clarification')
  assert.equal(res.reason, 'too_short')
})

test('a request for a ruling returns verses plus the fixed mufti boundary', async () => {
  const res = await ask(db, { q: 'Is it permissible to eat pork?' }, 't5')
  assert.equal(res.status, 'answered_with_boundary')
  assert.ok(res.verses.length > 0)
  assert.equal(res.notices[0]?.type, 'fiqh_boundary')
  assert.match(res.notices[0]?.text ?? '', /qualified mufti/)
})

test('a crisis message gets the referral, never verse cards', async () => {
  const res = await ask(db, { q: 'I want to kill myself' }, 't6')
  assert.equal(res.status, 'refused')
  assert.equal(res.reason, 'crisis')
  assert.deepEqual(res.verses, [])
  assert.match(res.message ?? '', /crisis|emergency/)
})

test('a direct reference returns exactly that verse', async () => {
  const res = await ask(db, { q: '2:255' }, 't7')
  assert.equal(res.status, 'answered')
  assert.deepEqual(
    res.verses.map((v) => v.ref),
    ['2:255'],
  )
})

test('Persian is answered from the Persian field and keeps Persian copy', async () => {
  const res = await ask(db, { q: 'قرآن درباره صبر چه می‌گوید؟' }, 't8')
  assert.equal(res.lang, 'fa')
  assert.equal(res.status, 'answered')
  assert.ok(res.verses.length > 0)
  const fa = res.verses[0].translations.find((t) => t.language === 'fa')
  assert.ok(fa && fa.text.length > 0, 'Persian translation missing')
})

test('an English question is not answered in Persian', async () => {
  const res = await ask(db, { q: 'What does the Quran say about mercy?' }, 't9')
  assert.equal(res.lang, 'en')
  assert.equal(res.status, 'answered')
})

test('the basmala query resolves to 1:1, not to 113 surah openings', async () => {
  const res = await ask(db, { q: 'بسم الله الرحمن الرحيم' }, 't10')
  assert.equal(res.status, 'answered')
  assert.deepEqual(
    res.verses.map((v) => v.ref),
    ['1:1'],
  )
})