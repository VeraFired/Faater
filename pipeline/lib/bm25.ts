/**
 * BM25 over one field, plus Reciprocal Rank Fusion across fields.
 *
 * This is the M0 vertical slice's retrieval core, not the final index format.
 * It runs in memory and is sized for evaluation; the shipped worker will read
 * a compact KV artefact instead.
 *
 * Why per-field BM25 + RRF rather than one concatenated document: a verse is
 * three texts in three languages. Concatenating them lets a long Persian
 * translation drown a short Arabic one for the same verse, and makes average
 * document length meaningless. Ranking per language and fusing the rankings
 * keeps each language's statistics honest.
 */

export interface Postings {
  docs: Int32Array
  tfs: Uint16Array
}

export interface FieldIndex {
  name: string
  /** term -> postings. */
  terms: Map<string, Postings>
  /** Document length in tokens, indexed by doc id. */
  lengths: Uint32Array
  /** Normalized document text, kept for contiguous-phrase matching. */
  texts: string[]
  avgLength: number
  docCount: number
}

export interface RankedDoc {
  doc: number
  score: number
  /**
   * Informative query terms this document matched.
   *
   * Ranking itself only needs the score, but cross-field coverage needs the
   * term names: a verse matching two query words must be distinguishable from
   * one matching a single word. Optional so synthetic fixtures stay terse.
   */
  matched?: string[]
}

const K1 = 1.2
const B = 0.75

/** Terms are whitespace-separated tokens of an already-normalized string. */
export function tokenize(text: string): string[] {
  if (!text) return []
  return text.split(/\s+/).filter((t) => t.length > 0)
}

/**
 * @param expand Optional per-token expansion (e.g. Arabic light stemming).
 *   Extra terms are added ALONGSIDE the exact token, so an over-eager stem can
 *   add noise but can never lose an exact match.
 */
export function buildField(
  name: string,
  texts: string[],
  expand?: (token: string) => string[],
): FieldIndex {
  const postings = new Map<string, { docs: number[]; tfs: number[] }>()
  const lengths = new Uint32Array(texts.length)
  let total = 0

  for (let doc = 0; doc < texts.length; doc++) {
    const tokens = tokenize(texts[doc])
    lengths[doc] = tokens.length
    total += tokens.length

    // Count term frequency per document in one pass.
    const local = new Map<string, number>()
    for (const t of tokens) {
      for (const v of expand ? expand(t) : [t]) {
        local.set(v, (local.get(v) ?? 0) + 1)
      }
    }

    for (const [term, tf] of local) {
      let entry = postings.get(term)
      if (!entry) {
        entry = { docs: [], tfs: [] }
        postings.set(term, entry)
      }
      entry.docs.push(doc)
      entry.tfs.push(tf)
    }
  }

  const terms = new Map<string, Postings>()
  for (const [term, entry] of postings) {
    terms.set(term, {
      docs: Int32Array.from(entry.docs),
      tfs: Uint16Array.from(entry.tfs),
    })
  }

  return {
    name,
    terms,
    lengths,
    texts,
    avgLength: texts.length ? total / texts.length : 0,
    docCount: texts.length,
  }
}

/** Inverse document frequency, clamped at 0 for terms that carry no signal. */
function idfOf(field: FieldIndex, term: string): number {
  const posting = field.terms.get(term)
  if (!posting) return 0
  const df = posting.docs.length
  return Math.max(0, Math.log(1 + (field.docCount - df + 0.5) / (df + 0.5)))
}

/** BM25 scores for a single term, keyed by doc id. */
function termScores(field: FieldIndex, term: string): Map<number, number> {
  const out = new Map<number, number>()
  const posting = field.terms.get(term)
  if (!posting) return out

  const df = posting.docs.length
  const idf = idfOf(field, term)
  if (idf === 0) return out

  for (let i = 0; i < df; i++) {
    const doc = posting.docs[i]
    const tf = posting.tfs[i]
    const norm = 1 - B + (B * field.lengths[doc]) / (field.avgLength || 1)
    out.set(doc, (idf * (tf * (K1 + 1))) / (tf + K1 * norm))
  }
  return out
}

export interface SearchOptions {
  limit?: number
  /** Per-token index expansion (Arabic light stemming). */
  expand?: (token: string) => string[]
  /** Query-side function words to drop. The index still holds them. */
  stopwords?: ReadonlySet<string>
  /**
   * Terms naming the corpus itself ("quran"). They are DOWN-WEIGHTED, not
   * dropped: "what does the Quran say about patience" needs «quran» gone from
   * the ranking, but "القرآن الكريم" and «قرآن چیست» are questions about the
   * Quran and must still retrieve it. Deleting the term whenever any other
   * token survived made those queries return unrelated verses.
   */
  frameTerms?: ReadonlySet<string>
  /**
   * Text used for the contiguous-phrase bonus. Defaults to the query itself.
   * Persian needs it: its terms come from two ZWNJ variants joined together,
   * a string that appears in no document, so the bonus never fired.
   */
  phrase?: string
  /**
   * Multiply the BM25 score by the fraction of query terms a document matched.
   *
   * On for literal queries: a verse matching every user term should beat one
   * matching a single common word. Off for concept expansions: their terms are
   * ALTERNATIVES ("forgive", "pardon", "overlook"), not a conjunction, so a
   * verse that uses one synonym is fully relevant. Dividing it by the synonym
   * count is what kept the forgiveness verses out of the top 50.
   */
  coverage?: boolean
}

/** Weight applied to a frame term's BM25 contribution. */
const FRAME_WEIGHT = 0.2

/**
 * Rank documents for a query in one field.
 * Returns only documents that matched at least one term.
 */
export function searchField(
  field: FieldIndex,
  query: string,
  options: SearchOptions = {},
): RankedDoc[] {
  const { limit = 100, expand, stopwords, frameTerms, phrase: phraseSource, coverage = true } =
    options

  const words = tokenize(query).filter((t) => !stopwords?.has(t))
  const terms = [...new Set(words.flatMap((t) => (expand ? expand(t) : [t])))]
  if (!terms.length) return []

  // Coverage is computed over INFORMATIVE terms only — those present in the
  // index and occurring in fewer than half the documents. A term above that
  // boundary has idf <= 0 under BM25's sign convention, contributes nothing to
  // the score, and counting it would penalise documents for ignoring a
  // function word. "the" appears in 3,958 of 6,236 English verses; treating it
  // as informative made every short verse look well-covered.
  const present = terms.filter((t) => {
    const p = field.terms.get(t)
    return !!p && p.docs.length < field.docCount / 2
  })
  if (!present.length) return []

  const isFrame = (t: string) => !!frameTerms?.has(t)
  const coverageTerms = present.filter((t) => !isFrame(t))

  // A frame term's stem must not be mistaken for content. «قرآن» expands to
  // «قران» and «قرا»; the stem is not in FRAME_TERMS, so a field that contains
  // only frame-derived terms would otherwise look as if it matched the user's
  // topic. Keep frame terms out of the coverage denominator exactly as before,
  // but reject the field when NONE of its present terms came from a non-frame
  // source word. The patience question still keeps its Arabic evidence; the
  // «فقرا» question no longer drowns in generic "Quran" verses.
  const sourceContent = new Set<string>()
  for (const word of words) {
    if (isFrame(word)) continue
    for (const v of expand ? expand(word) : [word]) sourceContent.add(v)
  }
  const hasContentWord = words.some((t) => !isFrame(t))
  if (hasContentWord && !present.some((t) => sourceContent.has(t))) return []

  // A query that HAS content words must not be answered by a list made only of
  // frame-term matches. «قرآن درباره ازدواج» contains no Arabic content term at
  // all, so before this guard the ar field matched only «قرآن» and returned
  // 4:82, 2:185, 7:204 — verses that mention the Quran and nothing the user
  // asked about. Those plausible-looking hits then outvoted the Persian list in
  // RRF. A bare frame query ("القرآن") is still allowed: there the frame term
  // IS the content.
  if (hasContentWord && !coverageTerms.length) return []

  // If the query is ONLY a frame term ("Quran"), it still has to count towards
  // coverage, or every document would score zero.
  const coverageSet = coverageTerms.length ? coverageTerms : present

  const scores = new Map<number, number>()
  const matched = new Map<number, string[]>()
  for (const term of present) {
    const w = isFrame(term) ? FRAME_WEIGHT : 1
    const counts = coverageTerms.length ? !isFrame(term) : true
    for (const [doc, score] of termScores(field, term)) {
      scores.set(doc, (scores.get(doc) ?? 0) + w * score)
      if (counts) {
        const terms = matched.get(doc)
        if (terms) terms.push(term)
        else matched.set(doc, [term])
      }
    }
  }

  // Contiguous-phrase bonus. When the user types a known phrase — the basmala
  // is the canonical case — a document containing it word-for-word should beat
  // a shorter document that merely shares one rare word. Without this, «الرحمن»
  // alone (55:1) outranked the basmala itself.
  const phraseText = phraseSource ?? query
  const phrase = tokenize(phraseText).length > 1 ? tokenize(phraseText).join(' ') : ''

  return [...scores.entries()]
    // A candidate that matched only a frame-derived term is not evidence
    // about the user's topic. This keeps «فقرا» from returning generic
    // "Quran" verses while retaining the real Arabic patience evidence.
    .filter(([doc]) => {
      if (!hasContentWord) return true
      return (matched.get(doc) ?? []).some((t) => sourceContent.has(t))
    })
    .map(([doc, score]) => {
      // Pure BM25 has no coverage term, so for a multi-word query a one-word
      // verse matching one word can outrank a document matching every word.
      // Concept lists opt out: their terms are alternatives, not a conjunction.
      const terms = matched.get(doc) ?? []
      const coverageFactor = coverage ? terms.length / coverageSet.length : 1
      const bonus = phrase && field.texts[doc]?.includes(phrase) ? 2 : 1
      return { doc, score: score * coverageFactor * bonus, matched: terms }
    })
    .sort((a, b) => b.score - a.score || a.doc - b.doc)
    .slice(0, limit)
}

/**
 * Reciprocal Rank Fusion. `k` damps the influence of head ranks; 60 is the
 * value from the original RRF paper and the one our plan records.
 */
export function rrf(lists: RankedDoc[][], k = 60, weights?: number[]): RankedDoc[] {
  const fused = new Map<number, number>()
  for (let i = 0; i < lists.length; i++) {
    const weight = weights?.[i] ?? 1
    if (!weight) continue
    for (let rank = 0; rank < lists[i].length; rank++) {
      const doc = lists[i][rank].doc
      fused.set(doc, (fused.get(doc) ?? 0) + weight / (k + rank + 1))
    }
  }
  return [...fused.entries()]
    .map(([doc, score]) => ({ doc, score }))
    .sort((a, b) => b.score - a.score || a.doc - b.doc)
}