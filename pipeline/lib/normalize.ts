/**
 * Text normalization for the trilingual search index.
 *
 * There is exactly ONE canonical search alphabet: Arabic base letters.
 * Persian yeh/kaf and every hamza/alef variant fold into it, so a Persian
 * query and the Arabic corpus share one key space. Display text is never
 * touched by this module — it operates on search keys only.
 *
 * See .claude/RND.md §5 for the rules and the sources behind them.
 */

/** Marks and invisibles that carry no lexical weight for matching. */
const STRIP = /[ؐ-ًؚ-ٰٟۖ-ۭـ​-‏­﻿]/g

/**
 * One-way fold into the canonical search alphabet.
 *
 * Note the direction: Persian yeh U+06CC and kaf U+06A9 fold DOWN to Arabic
 * yeh U+064A and kaf U+0643. Without this, a Persian query for «کتاب» never
 * matches the Arabic index, which was one of the named failure modes.
 */
const FOLD: Readonly<Record<string, string>> = {
  // alef family
  'أ': 'ا', // أ -> ا
  'إ': 'ا', // إ -> ا
  'آ': 'ا', // آ -> ا
  'ٱ': 'ا', // ٱ -> ا
  // hamza carriers
  'ؤ': 'ء', // ؤ -> ء
  'ئ': 'ء', // ئ -> ء
  // letter-shape folds
  'ة': 'ه', // ة -> ه
  'ى': 'ي', // ى -> ي
  // Persian -> Arabic canonical
  'ی': 'ي', // ی -> ي
  'ک': 'ك', // ک -> ك
}

const DIGIT_MAP: Readonly<Record<string, string>> = {
  // Persian digits U+06F0-U+06F9
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  // Arabic-Indic digits U+0660-U+0669
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
}

export type Script = 'ar' | 'fa' | 'en' | 'unknown'

/**
 * Script detection, deliberately conservative.
 *
 * Persian-specific letters (پ چ ژ گ ک ی) are the only reliable signal, and a
 * short Arabic-script query can be either language — «صبر» is both. Callers
 * should treat 'ar' as "Persian or Arabic, unknown" rather than as a fact.
 */
export function detectScript(input: string): Script {
  if (/[پچژگکی]/.test(input)) return 'fa'
  if (/[؀-ۿݐ-ݿ]/.test(input)) return 'ar'
  if (/[A-Za-z]/.test(input)) return 'en'
  return 'unknown'
}

/**
 * Normalize to a canonical search key.
 *
 * ZWNJ becomes a separator here. For Persian, callers that index or query
 * must ALSO emit a joined variant — «می‌خواهم» and «میخواهم» are the same word
 * to a user but different tokens to a tokenizer. See joinedVariants().
 */
export function normalize(input: string): string {
  let out = input.normalize('NFC')
  // ZWNJ / ZWJ as separators before stripping other invisibles
  out = out.replace(/[‌‍]/g, ' ')
  out = out.replace(STRIP, '')
  out = out.replace(/[۰-۹٠-٩]/g, (d) => DIGIT_MAP[d] ?? d)

  // fold per code point (a translate table would also work; explicit keeps it readable)
  let folded = ''
  for (const ch of out) folded += FOLD[ch] ?? ch

  // keep letters, digits and spaces; everything else is punctuation
  folded = folded.replace(/[^\p{L}\p{N}\s]/gu, ' ')
  folded = folded.replace(/\s+/g, ' ').trim()
  return folded.toLowerCase()
}

/**
 * Normalize with ZWNJ REMOVED rather than treated as a separator.
 *
 * `normalize()` turns «می‌خواهد» into "مي خواهد"; a user who types the joined
 * «میخواهد» produces "ميخواهد" and the two never meet. Indexing this second
 * key alongside the first makes every ZWNJ variant converge. Both sides must
 * emit both forms — see joinedVariants().
 */
export function normalizeJoined(input: string): string {
  return normalize(input.normalize('NFC').replace(/[‌‍]/g, ''))
}

/**
 * Normalize for REFERENCE parsing, not search.
 *
 * Unlike normalize(), this preserves structural punctuation — `:`, `-`, dashes
 * and `.` — because `2:255` is a reference and `2 255` is two numbers. Folding
 * letters and digits still happens, so «۲:۲۵۵» and "2:255" converge.
 *
 * The preserved characters are exactly the ones a reference is made of; every
 * other symbol becomes a space as usual.
 */
export function normalizeStructural(input: string): string {
  let out = input.normalize('NFC')
  out = out.replace(/[‌‍]/g, ' ')
  out = out.replace(STRIP, '')
  out = out.replace(/[۰-۹٠-٩]/g, (d) => DIGIT_MAP[d] ?? d)

  let folded = ''
  for (const ch of out) folded += FOLD[ch] ?? ch

  folded = folded.replace(/[^\p{L}\p{N}\s:\-–—.]/gu, ' ')
  folded = folded.replace(/\s+/g, ' ').trim()
  return folded.toLowerCase()
}

/**
 * Persian words written with and without ZWNJ are the same word to a user.
 * Indexing both forms doubles recall on Persian verbs and plurals at trivial
 * cost (a few thousand extra tokens).
 */
export function joinedVariants(input: string): string[] {
  // Strip the invisibles that are always noise, but KEEP ZWNJ/ZWJ here —
  // they are the thing being varied. Stripping them first would collapse the
  // two forms into one and silently defeat the whole function.
  const base = input
    .normalize('NFC')
    .replace(/[​‎‏­﻿⁠]/g, '') // U+200B, U+200E, U+200F, U+00AD, U+FEFF, U+2060
  const joined = base.replace(/[‌‍]/g, '') // drop ZWNJ / ZWJ
  const separated = base.replace(/[‌‍]/g, ' ') // ZWNJ / ZWJ -> space
  const out = new Set([normalize(base)])
  out.add(normalize(joined))
  out.add(normalize(separated))
  return [...out].filter(Boolean)
}

/**
 * Strip every diacritic and annotation sign without folding letter shapes.
 * Used for display-adjacent comparisons (e.g. basmala detection) where a
 * letter-shape fold would be over-eager.
 */
export function stripMarks(input: string): string {
  return input.normalize('NFC').replace(STRIP, '').replace(/\s+/g, ' ').trim()
}