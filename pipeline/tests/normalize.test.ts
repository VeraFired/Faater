/**
 * Normalization gold tests — regression guards, not decoration.
 *
 * Every case here broke a real design at some point in the research. See
 * .claude/RND.md §5. If one of these fails, search is wrong for a whole
 * language, not for an edge case.
 */

import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  detectScript,
  joinedVariants,
  normalize,
  normalizeJoined,
  normalizeStructural,
  stripMarks,
} from '../lib/normalize.ts'

test('tatweel is stripped — the corpus spelling of الرحمن must be findable', () => {
  // The corpus stores الرحمن with tatweel inside the word. A plain search for
  // «الرحمن» returns ZERO hits unless U+0640 is stripped. This was a live bug.
  const stored = 'الرَّحْمَـٰنِ'
  assert.equal(normalize(stored), 'الرحمن')
  assert.equal(normalize('الرحمن'), 'الرحمن')
})

test('superscript alef (U+0670) is stripped', () => {
  assert.equal(normalize('الرَّحْمَٰن'), normalize('الرحمن'))
})

test('waqf and sajdah marks (U+06D6–U+06ED) are stripped', () => {
  assert.equal(normalize('۞ إِنَّ اللَّهَ ۖ غَفُورٌ ۗ رَّحِيمٌ ۚ'), normalize('ان الله غفور رحيم'))
})

test('alef variants fold to bare alef', () => {
  assert.equal(normalize('أ'), normalize('ا'))
  assert.equal(normalize('إ'), normalize('ا'))
  assert.equal(normalize('آ'), normalize('ا'))
  assert.equal(normalize('ٱ'), normalize('ا'))
})

test('teh marbuta folds to heh, alef maqsura to yeh', () => {
  assert.equal(normalize('رحمة'), normalize('رحمه'))
  assert.equal(normalize('هدى'), normalize('هدي'))
})

test('Persian heh with hamza above folds to heh in references', () => {
  assert.equal(normalize('آیۀ ۲۵۵'), normalize('آیه ۲۵۵'))
  assert.equal(normalize('سورۀ بقره'), normalize('سوره بقره'))
})

test('Persian yeh and kaf bridge to Arabic — the named silent-failure mode', () => {
  // Persian keyboards emit U+06CC / U+06A9; the Arabic index holds U+064A / U+0643.
  // Without the bridge, «کتاب» never matches the Arabic text.
  assert.equal(normalize('کتاب'), normalize('كتاب'))
  assert.equal(normalize('مکه'), normalize('مكه'))
  assert.equal(normalize('زکات'), normalize('زكات'))
})

test('ZWNJ: split form normalizes to a space-separated key', () => {
  assert.equal(normalize('می‌خواهم'), 'مي خواهم')
})

test('ZWNJ: joined form is also emitted as a variant', () => {
  // «می‌خواهم» and «میخواهم» are the same word to a user.
  const variants = joinedVariants('می‌خواهم')
  assert.ok(variants.includes('مي خواهم'), 'missing split form')
  assert.ok(variants.includes('ميخواهم'), 'missing joined form')
})

test('ZWNJ: کتاب‌ها emits both forms', () => {
  const variants = joinedVariants('کتاب‌ها')
  assert.ok(variants.includes('كتاب ها'))
  assert.ok(variants.includes('كتابها'))
})

test('Persian digits map to ASCII', () => {
  assert.equal(normalize('۲۵۵'), '255')
})

test('Arabic-Indic digits map to ASCII', () => {
  assert.equal(normalize('٢٥٥'), '255')
})

test('the basmala normalizes identically across its shadda spellings', () => {
  const a = normalize('بِسْمِ اللَّهِ الرَّحْمَـٰنِ الرَّحِيمِ')
  const b = normalize('بسم الله الرحمن الرحيم')
  assert.equal(a, b)
  assert.equal(a, 'بسم الله الرحمن الرحيم')
})

test('Latin text lowercases and drops punctuation (RAW fold only)', () => {
  // This pins normalize()'s own contract, not the English search key. Raw
  // normalize() turns the apostrophe into a SPACE, so this key can never meet a
  // user typing "quran"; the English search path applies foldEnglish() first
  // (see search-quality.test.ts). Keeping the raw behaviour visible here is
  // deliberate — it is the defect that made English recall 3%.
  assert.equal(normalize('What does the Qur’an say about Patience?!'), 'what does the qur an say about patience')
})

test('script detection separates Persian-specific letters from Arabic', () => {
  assert.equal(detectScript('چگونه صبر کنم'), 'fa') // چ
  assert.equal(detectScript('کتاب'), 'fa') // ک
  assert.equal(detectScript('كِتَاب'), 'ar') // Arabic kaf — genuinely ambiguous with Arabic
  assert.equal(detectScript('what is patience'), 'en')
  assert.equal(detectScript('123'), 'unknown')
})

test('stripMarks removes diacritics but preserves letter shapes', () => {
  // Deliberately NOT folded: أ stays أ. Used for display-adjacent comparison.
  assert.equal(stripMarks('أَلْحَمْدُ'), 'ألحمد')
  assert.notEqual(stripMarks('أ'), stripMarks('ا'))
})

test('normalizeStructural keeps reference punctuation that normalize destroys', () => {
  // The reason this function exists: a plain search normalization turns
  // "2:255" into "2 255", which is two numbers, not a verse.
  assert.equal(normalize('2:255'), '2 255')
  assert.equal(normalizeStructural('2:255'), '2:255')
  assert.equal(normalizeStructural('2:255-257'), '2:255-257')
  assert.equal(normalizeStructural('2:255–257'), '2:255–257')
  // ...while still folding letters and digits.
  assert.equal(normalizeStructural('۲:۲۵۵'), '2:255')
  assert.equal(normalizeStructural('سوره بقره'), 'سوره بقره')
  assert.equal(normalizeStructural('آیه'), 'ايه')
})

test('normalizeStructural preserves decimals as one token', () => {
  // "2.5" must survive as a token so the reference parser can REJECT it,
  // rather than seeing "2" and "5" and inventing a verse.
  assert.equal(normalizeStructural('2.5'), '2.5')
})

test('normalizeJoined removes ZWNJ instead of separating it', () => {
  assert.equal(normalize('می‌خواهد'), 'مي خواهد')
  assert.equal(normalizeJoined('می‌خواهد'), 'ميخواهد')
  assert.equal(normalizeJoined('میخواهد'), 'ميخواهد')
  // Both spellings converge to the joined key.
  assert.equal(normalizeJoined('می‌خواهد'), normalizeJoined('میخواهد'))
})

test('normalization is idempotent', () => {
  for (const s of ['الرَّحْمَـٰنِ', 'می‌خواهم', 'What is Patience?', '۲۵۵']) {
    const once = normalize(s)
    assert.equal(normalize(once), once, `not idempotent: ${s}`)
  }
})