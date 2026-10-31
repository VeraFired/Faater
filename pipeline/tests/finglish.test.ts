/**
 * Finglish policy tests — see ADR-015.
 *
 * The policy is "curated aliases only, never a general transliterator". The
 * most important assertions here are the NEGATIVE ones: plausible-looking
 * Latin strings must NOT resolve to a verse. In this product a wrong verse is
 * worse than a refusal.
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  finglishKey,
  isLatinScript,
  resolveFinglish,
  translitKeys,
  type LexiconEntry,
} from '../lib/finglish.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const lexicon = JSON.parse(await readFile(join(ROOT, 'data', 'build', 'lexicon.json'), 'utf8')) as {
  concepts: LexiconEntry[]
  names: LexiconEntry[]
  surahAliases: LexiconEntry[]
}

const ALL: LexiconEntry[] = [...lexicon.concepts, ...lexicon.names, ...lexicon.surahAliases]

test('finglishKey collapses the spellings Finglish actually varies on', () => {
  assert.equal(finglishKey('sabr'), 'sabr')
  assert.equal(finglishKey('Sabr'), 'sabr')
  assert.equal(finglishKey('rahmaan'), 'rahman') // aa -> a
  assert.equal(finglishKey('yaseen'), 'yasin') // ee -> i
  assert.equal(finglishKey('nooh'), 'nuh') // oo -> u
  assert.equal(finglishKey("mu'minoon"), 'muminun') // apostrophe dropped, oo -> u
  assert.equal(finglishKey('al-Baqara'), 'al baqara')
  assert.equal(finglishKey('  sabr   kon  '), 'sabr kon')
})

test('translitKeys produces both the article and bare forms', () => {
  assert.deepEqual(translitKeys('Al-Faatiha').sort(), ['al fatiha', 'fatiha'])
  assert.deepEqual(translitKeys('Yaseen'), ['yasin'])
  assert.ok(translitKeys('An-Naas').includes('nas'))
  assert.ok(translitKeys('Al-Muʼminoon').includes('muminun'))
})

test('curated concepts resolve', () => {
  const cases: Array<[string, string]> = [
    ['sabr', 'patience'],
    ['namaz', 'prayer'],
    ['rooze', 'fasting'],
    ['quran', 'quran'],
    ['khoda', 'god'],
    ['behesht', 'paradise'],
    ['jahannam', 'hell'],
    ['tohid', 'monotheism'],
    ['musa', 'musa'],
    ['moosa', 'musa'],
  ]
  for (const [query, id] of cases) {
    const hits = resolveFinglish(query, ALL).map((h) => h.id)
    assert.ok(hits.includes(id), `"${query}" did not resolve to ${id}; got ${hits.join(', ') || '(none)'}`)
  }
})

test('a phrase works — "sabr kon" and "about sabr" both resolve', () => {
  assert.ok(resolveFinglish('sabr kon', ALL).some((h) => h.id === 'patience'))
  assert.ok(resolveFinglish('about sabr', ALL).some((h) => h.id === 'patience'))
})

test('surah aliases resolve to a surah reference', () => {
  const yasin = resolveFinglish('yasin', ALL).map((h) => h.id)
  assert.ok(yasin.includes('surah:36'), `yasin -> ${yasin.join(', ') || '(none)'}`)

  const baqara = resolveFinglish('baqara', ALL).map((h) => h.id)
  assert.ok(baqara.includes('surah:2'))

  const nas = resolveFinglish('nas', ALL).map((h) => h.id)
  assert.ok(nas.includes('surah:114'))
})

test('NEGATIVE: unknown Latin input resolves to nothing', () => {
  // These are the strings a general transliterator would confidently mangle.
  for (const unknown of ['blorf', 'xyzzy', 'hello world', 'the quick brown fox', 'zxqv']) {
    assert.deepEqual(resolveFinglish(unknown, ALL), [], `"${unknown}" should not resolve`)
  }
})

test('NEGATIVE: near-misses do not match — no substring fuzz', () => {
  // "sabrina" contains "sabr" but is not the word "sabr".
  assert.deepEqual(resolveFinglish('sabrina', ALL), [])
  assert.deepEqual(resolveFinglish('quranic', ALL), [])
  // Token matching, not substring matching.
  assert.ok(resolveFinglish('sabr', ALL).length > 0)
})

test('NEGATIVE: English sentences do not spray matches (lexicon alone)', () => {
  // SCOPE: this measures resolveFinglish() in isolation. The guard that stops
  // an English SENTENCE reaching the expander at all lives in Retriever
  // (ENGLISH_MARKERS) and is tested behaviourally in search-quality.test.ts —
  // a lexicon test cannot see it.
  const hits = resolveFinglish('what is the meaning of life', ALL)
  // "life" is a curated concept, so exactly one match is acceptable here —
  // the scope gate, not the lexicon, decides whether the query is Quranic.
  assert.ok(hits.length <= 1, `sentence produced ${hits.length} matches: ${hits.map((h) => h.id).join(', ')}`)
})

test('isLatinScript separates Latin input from Arabic-script input', () => {
  assert.equal(isLatinScript('sabr kon'), true)
  assert.equal(isLatinScript('صبر'), false)
  assert.equal(isLatinScript('sabr صبر'), false)
  assert.equal(isLatinScript('123'), false)
})

test('every lexicon key is already canonical after the build', () => {
  for (const entry of ALL) {
    for (const key of entry.keys) {
      assert.equal(finglishKey(key), key, `${entry.id} has a non-canonical key "${key}"`)
    }
  }
})