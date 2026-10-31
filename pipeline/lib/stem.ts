/**
 * Conservative Arabic light stemming.
 *
 * Without this, a user searching «صبر» does not match «بالصبر» — the index
 * compares whole whitespace tokens, and Arabic attaches its prepositions,
 * conjunction and article directly to the stem. That single fact cost us
 * 2:153 (the canonical patience verse) on a «صبر» query.
 *
 * The stemmer is applied by ADDING a stem term alongside the exact token, not
 * by replacing it. Over-stemming therefore costs index space and a little
 * noise, never a lost exact match.
 *
 * It is deliberately shallow. «صابر» (active participle) still will not match
 * «صبر»; that needs root extraction or morphology data, and the Quranic Arabic
 * Corpus is GPL with a "no changes" clause — a poor fit. The gap is recorded
 * in CHALLENGES rather than papered over.
 */

/** Longest first, so «بال» wins over «ب». */
const PREFIXES = [
  'وال', 'فال', 'بال', 'كال', 'ولل', 'فلل',
  'ال', 'و', 'ف', 'ب', 'ك', 'ل', 'س',
  'ول', 'فل', 'بل',
]

const SUFFIXES = [
  'ها', 'هم', 'هن', 'كم', 'كن', 'نا',
  'ون', 'ين', 'ات', 'ان', 'وا',
  'ه', 'ي', 'ة',
]

/** Minimum stem length worth keeping. Shorter than this stops being a word. */
const MIN_STEM = 3

/**
 * Strip at most one prefix (longest match) and one suffix.
 *
 * Accepts an already-normalized token (diacritics gone, alef/yeh/teh-marbuta
 * folded), so the output is directly comparable to other normalized tokens.
 */
export function arabicStem(token: string): string {
  let stem = token
  let changed = false

  for (const p of PREFIXES) {
    if (stem.length - p.length >= MIN_STEM && stem.startsWith(p)) {
      stem = stem.slice(p.length)
      changed = true
      break
    }
  }

  for (const s of SUFFIXES) {
    if (stem.length - s.length >= MIN_STEM && stem.endsWith(s)) {
      stem = stem.slice(0, -s.length)
      changed = true
      break
    }
  }

  return changed ? stem : token
}

/**
 * Index terms for one Arabic token: the exact form plus its stem.
 * The caller dedupes, so a token that is already its own stem adds nothing.
 */
export function arabicVariants(token: string): string[] {
  const stem = arabicStem(token)
  return stem === token ? [token] : [token, stem]
}

/**
 * English inflection variants, added ALONGSIDE the exact token.
 *
 * The English translations are morphologically richer than the queries people
 * type: the corpus says "backbite", the user says "backbiting"; the corpus says
 * "angel", the user says "angels". Whole-token matching misses all of it.
 *
 * This is inflection stripping, not a Porter stemmer, and it deliberately emits
 * several candidates rather than guessing one. "backbiting" yields {backbiting,
 * backbit, backbite}; the index contains "backbite", so the third candidate
 * catches it. Extra candidates cost index space and a little noise — they can
 * never lose the exact match, because the exact token is always included.
 */
export function englishVariants(token: string): string[] {
  if (!/^[a-z]{4,}$/.test(token)) return [token]
  const out = new Set<string>([token])
  const add = (s: string) => {
    if (s.length >= 3) out.add(s)
  }

  if (token.endsWith('ies') && token.length > 4) {
    add(token.slice(0, -3) + 'y')
  } else if (token.endsWith('es') && token.length > 3) {
    add(token.slice(0, -2))
    add(token.slice(0, -1))
  } else if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    add(token.slice(0, -1))
  }

  for (const suffix of ['ing', 'ed']) {
    if (!token.endsWith(suffix)) continue
    const base = token.slice(0, -suffix.length)
    if (base.length < 3) continue
    add(base)
    add(base + 'e')
    // "running" -> "runn" -> "run"
    if (/([bdfglmnprt])\1$/.test(base)) add(base.slice(0, -1))
  }

  return [...out]
}