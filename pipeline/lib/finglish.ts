/**
 * Finglish (Latin-script Persian) key generation and lookup.
 *
 * POLICY — see ADR-015. This is a CURATED ALIAS TABLE, not a transliterator.
 * Turning arbitrary Latin text into Persian produces confident-looking
 * matches that are frequently wrong, and in this product a wrong verse is
 * worse than a refusal. Anything not listed resolves to nothing, and the
 * refusal gate handles it.
 *
 * Two sources of keys:
 *   1. Hand-curated concept aliases in data/lexicon/finglish.json.
 *   2. Mechanically derived surah aliases from Tanzil's `tname` — no hand
 *      transcription of 114 names, and it tracks the corpus if it changes.
 */

/** Collapse the spelling variation that Finglish actually varies on. */
export function finglishKey(input: string): string {
  let s = input.toLowerCase()
  // Every apostrophe variant a user or a transliteration scheme might emit:
  // U+0027, U+2018, U+2019, U+02BB, U+02BC, U+02BE, U+02BF, U+0060.
  s = s.replace(/['`‘’ʻʼʾʿ]/g, '')
  s = s.replace(/[-_]/g, ' ')

  // Persian digraphs map to one Latin letter ("noor" -> "nur", "yaseen" ->
  // "yasin"). Applied to a fixed point, because dropping the apostrophe from
  // "Ma'aarij" leaves a three-vowel run that a single pass would only halve.
  const DIGRAPHS: ReadonlyArray<readonly [string, string]> = [
    ['aa', 'a'], ['ee', 'i'], ['ii', 'i'], ['oo', 'u'], ['uu', 'u'],
  ]
  for (let prev = ''; prev !== s; ) {
    prev = s
    for (const [from, to] of DIGRAPHS) s = s.split(from).join(to)
  }
  s = s.replace(/[^a-z\s]/g, ' ')
  return s.replace(/\s+/g, ' ').trim()
}

/** Arabic definite-article prefixes, including the assimilated forms. */
const ARTICLE = /^(al|at|an|as|ash|ar|az|ad|ath|azh) /

/**
 * Derive lookup keys from a Tanzil transliteration, e.g. "Al-Faatiha".
 * Returns both the article-bearing and bare forms.
 */
export function translitKeys(tname: string): string[] {
  const full = finglishKey(tname)
  const bare = full.replace(ARTICLE, '')
  const out = new Set<string>()
  if (full) out.add(full)
  if (bare) out.add(bare)
  return [...out]
}

export interface LexiconEntry {
  id: string
  fa: string
  en: string
  keys: string[]
}

/**
 * Resolve a Latin-script query to lexicon entries.
 *
 * Matching is strict whole-token containment: every token of an alias must
 * appear in the query. "sabr kon" and "about sabr" both resolve to patience;
 * "sabrina" does not, because tokenisation keeps "sabrina" whole.
 */
export function resolveFinglish(query: string, entries: LexiconEntry[]): LexiconEntry[] {
  const key = finglishKey(query)
  if (!key) return []
  const tokens = new Set(key.split(' '))
  const hits: LexiconEntry[] = []
  for (const entry of entries) {
    for (const alias of entry.keys) {
      const aliasTokens = alias.split(' ').filter(Boolean)
      if (aliasTokens.length === 0) continue
      if (aliasTokens.every((t) => tokens.has(t))) {
        hits.push(entry)
        break
      }
    }
  }
  return hits
}

/** True when the input is Latin-script and therefore a Finglish candidate. */
export function isLatinScript(input: string): boolean {
  return /[A-Za-z]/.test(input) && !/[؀-ۿ]/.test(input)
}