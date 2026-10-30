/**
 * Basmala segmentation.
 *
 * Tanzil prepends «بِسْمِ اللَّهِ الرَّحْمَـٰنِ الرَّحِيمِ» to verse 1 of every surah
 * except At-Tawbah (9). Verified 2026-10-31: 113 of 114 surahs carry it, and
 * QuranEnc translations do NOT include it — so without splitting, every
 * surah-opening card shows Arabic words the translation does not cover.
 *
 * The verse bytes are never modified. The split is presentational metadata:
 * `basmala` holds the prefix, `body` holds the remainder. For 1:1 the whole
 * verse IS the basmala and `body` is empty — that is a genuine verse, not a
 * prefix, and callers must render it as verse text.
 */

import { normalize } from './normalize.ts'

/** The basmala is exactly four whitespace-separated tokens. */
export const BASMALA_TOKEN_COUNT = 4

/** Canonical key for the basmala, in the shared search alphabet. */
export const BASMALA_KEY = normalize('بِسْمِ اللَّهِ الرَّحْمَـٰنِ الرَّحِيمِ')

export interface BasmalaSplit {
  /** The prefix text, or null when the verse does not begin with a basmala. */
  basmala: string | null
  /** Everything after the prefix. Equals the whole verse when there is none. */
  body: string
  /**
   * True when the entire verse is the basmala (1:1). Such a verse is real
   * scripture and must be displayed and cited, unlike the 112 prefixes.
   */
  isWholeVerse: boolean
}

/**
 * Split a verse into (basmala prefix, body).
 *
 * Detection is on the normalized form but the split is on raw tokens, so the
 * returned strings are byte-identical slices of the input and diacritics are
 * preserved exactly.
 */
export function splitBasmala(arabic: string): BasmalaSplit {
  const tokens = arabic.split(/\s+/).filter(Boolean)
  if (tokens.length < BASMALA_TOKEN_COUNT) {
    return { basmala: null, body: arabic, isWholeVerse: false }
  }
  const prefix = tokens.slice(0, BASMALA_TOKEN_COUNT).join(' ')
  if (normalize(prefix) !== BASMALA_KEY) {
    return { basmala: null, body: arabic, isWholeVerse: false }
  }
  const body = tokens.slice(BASMALA_TOKEN_COUNT).join(' ')
  return { basmala: prefix, body, isWholeVerse: body.length === 0 }
}