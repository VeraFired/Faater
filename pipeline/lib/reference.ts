/**
 * Reference parser — "2:255", «سوره بقره آیه ۲۵۵», "Surah Al-Baqarah 255".
 *
 * A wrong reference silently answers the wrong verse, which is the worst
 * failure this product can have. So the parser is conservative: when it is
 * not sure, it returns null and the refusal path handles it. It never guesses
 * a surah from a bare number.
 *
 * Deliberately NOT supported (returns null, tested):
 *   - spelled-out numbers («آیه دویست و پنجاه و پنج», "verse two fifty five")
 *   - bare ayah numbers with no surah context ("255")
 *   - decimal input ("2.5"), which must never become 2:5
 */

import { finglishKey } from './finglish.ts'
import { normalize, normalizeStructural } from './normalize.ts'

export interface SurahRef {
  index: number
  ayahs: number
  keys: string[]
}

export type Reference =
  | { kind: 'single'; surah: number; ayah: number; matched: string }
  | { kind: 'range'; surah: number; start: number; end: number; matched: string }
  | { kind: 'surah'; surah: number; matched: string }
  | { kind: 'invalid'; reason: string; matched: string }

const SURAH_MARKERS = new Set(['سوره', 'سور', 'surah', 'sure', 'soore', 'soora'])
/**
 * These are compared AFTER normalize(), which folds آ->ا and ی->ي. So «آیه»,
 * «ایه» and «ايه» all arrive here as 'ايه' — listing the unfolded spellings
 * would silently never match.
 */
const AYAH_MARKERS = new Set(['ايه', 'ayah', 'aya', 'ayat', 'verse', 'verses', 'v'])

/**
 * Build a lookup from every reasonable spelling to a surah number.
 * Cached per array identity: the fuzz suite calls this thousands of times and
 * rebuilding 476 keys each time dominated the test runtime.
 */
const INDEX_CACHE = new WeakMap<SurahRef[], Map<string, number>>()

export function buildSurahIndex(surahs: SurahRef[]): Map<string, number> {
  const cached = INDEX_CACHE.get(surahs)
  if (cached) return cached

  const map = new Map<string, number>()
  for (const s of surahs) {
    for (const key of s.keys) {
      for (const form of [normalize(key), finglishKey(key)]) {
        if (form && !map.has(form)) map.set(form, s.index)
      }
    }
  }
  INDEX_CACHE.set(surahs, map)
  return map
}

function isValidAyah(surahs: SurahRef[], surah: number, ayah: number): boolean {
  const s = surahs.find((x) => x.index === surah)
  return !!s && ayah >= 1 && ayah <= s.ayahs
}

function surahExists(surahs: SurahRef[], surah: number): boolean {
  return surahs.some((x) => x.index === surah)
}

/**
 * English and Finglish spellings of surah names vary on a final "h":
 * Tanzil writes "Al-Baqara", users write "Al-Baqarah"; "Al-Faatiha" vs
 * "Al-Fatihah". Try both rather than hand-listing 114 variants.
 */
function trailingHVariants(candidate: string): string[] {
  if (candidate.length < 3) return [candidate]
  return candidate.endsWith('h')
    ? [candidate, candidate.slice(0, -1)]
    : [candidate, candidate + 'h']
}

/** Find a surah number from up to three consecutive tokens. */
function lookupTokens(
  tokens: string[],
  start: number,
  index: Map<string, number>,
): { surah: number; consumed: number } | null {
  for (let len = 3; len >= 1; len--) {
    const slice = tokens.slice(start, start + len)
    if (slice.length < len) continue
    const candidate = slice.join(' ')
    for (const form of trailingHVariants(candidate)) {
      const byNorm = index.get(form)
      if (byNorm !== undefined) return { surah: byNorm, consumed: len }
    }
  }
  return null
}

/**
 * Parse a reference out of free text.
 *
 * `surahs` supplies valid ranges, so an out-of-range reference is reported as
 * `invalid` (its own refusal copy) rather than silently clamped or dropped.
 */
export function parseReference(raw: string, surahs: SurahRef[]): Reference | null {
  // Two views of the same query:
  //   structural — keeps `:`, `-`, `.` so `2:255` survives as a reference
  //   words      — punctuation becomes space, for surah-name token matching
  const structural = normalizeStructural(raw)
  const norm = normalize(raw)
  if (!structural && !norm) return null
  const index = buildSurahIndex(surahs)

  // ---- 1. Explicit numeric reference: 2:255, 2:255-257, 2:255–2:257 -------
  // Lookbehind/lookahead keep "12:3" out of "12:30" and stop "2.5" entirely.
  // A sentence-final period is allowed ("Show me 2:255."), but a period
  // followed by a digit is not ("2:255.5" must never become a reference).
  const numeric =
    /(?<![\d.:])(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[-–—]\s*(?:(\d{1,3})\s*:\s*)?(\d{1,3}))?(?![\d:]|\.\d)/g
  for (const m of structural.matchAll(numeric)) {
    const surah = Number(m[1])
    const start = Number(m[2])
    const endSurah = m[3] ? Number(m[3]) : null
    const end = m[4] ? Number(m[4]) : null
    const matched = m[0].trim()

    if (end !== null) {
      if (endSurah !== null && endSurah !== surah) {
        return { kind: 'invalid', reason: 'cross-surah-range', matched }
      }
      if (end < start) return { kind: 'invalid', reason: 'reversed-range', matched }
      if (!surahExists(surahs, surah)) return { kind: 'invalid', reason: 'no-such-surah', matched }
      if (!isValidAyah(surahs, surah, start) || !isValidAyah(surahs, surah, end)) {
        return { kind: 'invalid', reason: 'ayah-out-of-range', matched }
      }
      return { kind: 'range', surah, start, end, matched }
    }

    if (!surahExists(surahs, surah)) return { kind: 'invalid', reason: 'no-such-surah', matched }
    if (!isValidAyah(surahs, surah, start)) {
      return { kind: 'invalid', reason: 'ayah-out-of-range', matched }
    }
    return { kind: 'single', surah, ayah: start, matched }
  }

  // ---- 2. «سوره بقره آیه ۲۵۵» / "Surah Al-Baqarah verse 255" --------------
  const tokens = norm.split(' ')
  // The ayah number and its dash live in the STRUCTURAL view: normalize()
  // turns «۲۵۵-۲۵۷» into "255 257" and the range would be lost.
  const structuralTokens = structural.split(' ')
  const ayahRange = readAyahAfterMarker(structuralTokens)

  for (let i = 0; i < tokens.length; i++) {
    const isSurahMarker = SURAH_MARKERS.has(tokens[i])
    const isAyahMarker = AYAH_MARKERS.has(tokens[i])
    if (!isSurahMarker && !isAyahMarker) continue

    // «سوره بقره ...» — the name follows the marker.
    if (isSurahMarker) {
      const found = lookupTokens(tokens, i + 1, index)
      if (found) {
        const matched = tokens.slice(i).join(' ')
        if (ayahRange === null) return { kind: 'surah', surah: found.surah, matched }
        return validateSurahAyah(surahs, found.surah, ayahRange.start, ayahRange.end, matched)
      }
      continue
    }

    // «آیه ۲۵۵» with a surah named earlier: «بقره آیه ۲۵۵»
    if (isAyahMarker && ayahRange !== null) {
      for (let back = 1; back <= 3 && i - back >= 0; back++) {
        const found = lookupTokens(tokens, i - back, index)
        if (found && i - back + found.consumed <= i) {
          return validateSurahAyah(
            surahs,
            found.surah,
            ayahRange.start,
            ayahRange.end,
            tokens.slice(0, i + 2).join(' '),
          )
        }
      }
    }
  }

  // ---- 3. "Al-Baqarah 255" — name immediately followed by a number --------
  for (let i = 0; i < tokens.length; i++) {
    const found = lookupTokens(tokens, i, index)
    if (!found) continue
    const after = tokens[i + found.consumed]
    const num = readNumber(after)
    if (num === null) continue
    return validateSurahAyah(surahs, found.surah, num, null, tokens.slice(i, i + found.consumed + 1).join(' '))
  }

  // ---- 4. A bare surah name — "Al-Kahf", "yasin", «سوره بقره» ------------
  // A query that is nothing but a surah name is asking about that surah.
  // A surah name appearing inside a longer question without "سوره" is not:
  // "why is the cow in Baqarah?" must fall through to retrieval.
  const withoutMarkers = tokens.filter((t) => !SURAH_MARKERS.has(t)).join(' ').trim()
  const bare = index.get(withoutMarkers)
  if (bare !== undefined) {
    return { kind: 'surah', surah: bare, matched: raw.trim() }
  }

  return null
}

function readNumber(token: string | undefined): number | null {
  if (!token) return null
  // Digits only — normalize() already folded Persian and Arabic-Indic digits.
  // A token like "255." or "2.5" is not a clean number and must not parse.
  if (!/^\d{1,3}$/.test(token)) return null
  return Number(token)
}

/**
 * Read the ayah (or range) following the first ayah marker.
 * Expects STRUCTURAL tokens, where "255-257" is still one token.
 */
function readAyahAfterMarker(tokens: string[]): { start: number; end: number | null } | null {
  for (let i = 0; i < tokens.length; i++) {
    if (!AYAH_MARKERS.has(tokens[i])) continue
    // Allow one sentence-final period ("verse 255.") but not a decimal
    // ("255.5"): the digits after the period make the token invalid.
    const m = /^(\d{1,3})(?:[-–—](\d{1,3}))?\.?$/.exec(tokens[i + 1] ?? '')
    if (!m) return null
    return { start: Number(m[1]), end: m[2] ? Number(m[2]) : null }
  }
  return null
}

function validateSurahAyah(
  surahs: SurahRef[],
  surah: number,
  start: number,
  end: number | null,
  matched: string,
): Reference {
  if (!surahExists(surahs, surah)) return { kind: 'invalid', reason: 'no-such-surah', matched }
  if (!isValidAyah(surahs, surah, start)) {
    return { kind: 'invalid', reason: 'ayah-out-of-range', matched }
  }
  if (end !== null) {
    if (end < start) return { kind: 'invalid', reason: 'reversed-range', matched }
    if (!isValidAyah(surahs, surah, end)) {
      return { kind: 'invalid', reason: 'ayah-out-of-range', matched }
    }
    return { kind: 'range', surah, start, end, matched }
  }
  return { kind: 'single', surah, ayah: start, matched }
}