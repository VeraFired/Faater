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

  // «والدين» is "parents", not «و + الدين»: the conjunction analysis is right
  // for «والميسر» and wrong for this word family, and the stem it produced
  // («دين», religion) flooded parents queries with religion verses.
  const lexicalWaw = token.startsWith('والد')

  // Longest prefix first, and stop at the first MATCHING prefix. Falling
  // through to the bare «و» is how «والدين» kept producing «دين» even when
  // the conjunction form was rejected.
  for (const p of PREFIXES) {
    if (!stem.startsWith(p)) continue
    const remainder = stem.slice(p.length)
    if (!lexicalWaw && remainder.length >= MIN_STEM) {
      stem = remainder
      changed = true
    }
    break
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
 * Persian light stemming for the Persian field.
 *
 * The Arabic stemmer was doing double duty here and it mangles Persian:
 * «فقرا» loses its first letter as an Arabic prefix and becomes «قرا»;
 * «بخشش» becomes «خشش»; «بهشت» becomes «هشت». Those artifacts put
 * unrelated verses into the Persian list. The rules below are limited to
 * Persian noun plurals and the «می» verb prefix; they ADD variants, so an
 * exact match can never be lost.
 *
 * Persian plurals attach after a ZWNJ or directly («فرشتگان», «همسران»).
 * The joined query form already exists; this makes its stem meet the
 * singular in the index.
 */
export function persianVariants(token: string): string[] {
  if (!/[پچژگکی]/.test(token) && !/[؀-ۿ]/.test(token)) return [token]
  const out = new Set<string>([token])
  const add = (s: string) => {
    if (s.length >= 2) out.add(s)
  }

  // «فرشتگان» -> «فرشته» / «فرشتگ»; «پرندگان» -> «پرنده».
  if (token.endsWith('گان') && token.length >= 4) {
    const base = token.slice(0, -3)
    add(base + 'ه')
    add(base)
  }

  // «میوه‌های» joins to «ميوههاي»; the plural suffix is not the word.
  if (token.endsWith('هاي') && token.length >= 5) {
    add(token.slice(0, -3))
  } else if (token.endsWith('ها') && token.length >= 4) {
    add(token.slice(0, -2))
  }

  // Sound plurals. Length floors keep «زمان» from becoming «زم» while
  // allowing «همسران» -> «همسر» and «مومنان» -> «مومن».
  for (const suffix of ['ان', 'ات', 'ين', 'ون']) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 4) {
      add(token.slice(0, -suffix.length))
    }
  }

  // «راستگويي» -> «راستگو»; the doubled yeh is the abstract-noun suffix.
  if (token.endsWith('گويي') && token.length >= 5) {
    add(token.slice(0, -2))
  }

  // Joined present-tense verbs: «ميگويد» -> «گويد». Only the two productive
  // prefixes; a bare «ب» would eat the first letter of «بخشش» again.
  for (const prefix of ['نمي', 'مي']) {
    if (token.startsWith(prefix) && token.length - prefix.length >= 3) {
      add(token.slice(prefix.length))
      break
    }
  }

  // Arabic loanwords keep their article/conjunction glued on. The Persian
  // translation of 53:24 says «ميسر است», so an Arabic-script query
  // «والميسر» has to reach «ميسر»; without this the Persian list misses and
  // 2:280 (ميسرة, "deferment") wins by default. Only multi-letter prefixes:
  // stripping bare «ب» is what turned «بخشش» into «خشش».
  //
  // The conjunction forms need a four-letter remainder. «والدین» (parents) is
  // an ordinary Persian word, not «و + الدین»: stripping the «وال» there left
  // «دین» (religion) in the query and answered every parents question with
  // religion verses. The bare article «ال» is unambiguous enough to keep a
  // three-letter remainder, which «الخمر» → «خمر» needs.
  for (const prefix of ['وال', 'بال', 'كال', 'فال', 'ال']) {
    const remainder = token.slice(prefix.length)
    const floor = prefix === 'ال' ? 3 : 4
    if (token.startsWith(prefix) && remainder.length >= floor) {
      add(remainder)
      break
    }
  }

  return [...out]
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