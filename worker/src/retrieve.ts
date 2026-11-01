/**
 * D1-backed retrieval for the Worker.
 *
 * The in-memory retriever cannot ship on Workers Free: building its postings
 * costs ~300 ms of CPU against a 10 ms budget. D1 runs FTS5 in SQLite, so the
 * Worker only pays for the query it actually needs. This module reproduces the
 * in-memory retriever's semantics as closely as FTS5 allows:
 *
 *   - three language fields, each queried separately and fused with RRF;
 *   - the same query-side fold, stopwords, frame-term guard and phrase bonus;
 *   - concept synonym lists fused at weight 0.1 (ADR-019).
 *
 * Differences from `pipeline/lib/retrieve.ts` are deliberate and documented:
 * FTS5's bm25() cannot down-weight an individual term, so frame terms are
 * excluded from the match when content terms exist (the in-memory retriever
 * down-weights them instead of deleting them).
 */

import { BASMALA_KEY } from '../../pipeline/lib/basmala.ts'
import { tokenize } from '../../pipeline/lib/bm25.ts'
import { resolveFinglish, isLatinScript } from '../../pipeline/lib/finglish.ts'
import { normalize, normalizeJoined } from '../../pipeline/lib/normalize.ts'
import { parseReference, type SurahRef } from '../../pipeline/lib/reference.ts'
import { arabicVariants, englishVariants, persianVariants } from '../../pipeline/lib/stem.ts'
import {
  ENGLISH_MARKERS,
  FRAME_TERMS,
  STOPWORDS_EN,
  STOPWORDS_FA,
  foldEnglish,
} from '../../pipeline/lib/stopwords.ts'
import { arWeightFor, FA_QUERY_AR_WEIGHT } from '../../pipeline/lib/query.ts'
import { buildCoveragePlan, coverageOf } from '../../pipeline/lib/query-plan.ts'

// ---------------------------------------------------------------------------
// D1 surface (the subset this module uses)
// ---------------------------------------------------------------------------

export interface D1Prepared {
  bind(...values: unknown[]): D1Prepared
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  first<T = Record<string, unknown>>(): Promise<T | null>
}

export interface D1Database {
  prepare(sql: string): D1Prepared
}

export interface ConceptSynonyms {
  en: string[]
  fa: string[]
  faJoined: string[]
  ar: string[]
  /** Verses that share a spelling but not the sense; never returned by this concept. */
  excludes?: string[]
}

export interface ConceptEntry {
  id: string
  fa: string
  en: string
  keys: string[]
  synonyms?: ConceptSynonyms
}

export interface Lexicon {
  concepts: ConceptEntry[]
  names: ConceptEntry[]
  surahAliases: ConceptEntry[]
}

export interface SurahMeta {
  index: number
  ayahs: number
  nameAr: string
  nameEn: string
  nameTranslit: string
  nameFa: string
  /** Alternate Persian name (e.g. «حمد» for Al-Fatihah), when one exists. */
  nameFaAlt?: string | null
}

/**
 * Every spelling a user might type for a surah, in one place.
 *
 * ask() needs this for out-of-range detection and searchD1 needs it for direct
 * retrieval. Two copies previously drifted: the Worker's lists omitted
 * `nameFaAlt`, so «سوره حمد» silently fell through to free-text search.
 */
export function buildSurahRefs(lexicon: Lexicon, surahMeta: SurahMeta[]): SurahRef[] {
  return surahMeta.map((s) => {
    const alias = lexicon.surahAliases.find((a) => a.id === `surah:${s.index}`)
    return {
      index: s.index,
      ayahs: s.ayahs,
      keys: [
        ...(alias?.keys ?? []),
        alias?.en ?? s.nameEn,
        alias?.fa ?? s.nameFa,
        ...(s.nameFaAlt ? [s.nameFaAlt] : []),
        s.nameAr,
        s.nameTranslit,
      ],
    }
  })
}

export interface Hit {
  ref: string
  score: number
  fields: string[]
}

export interface SearchOptions {
  limit?: number
  conceptExpansion?: boolean
  /**
   * RRF weight of a concept list. 0.5 mirrors the in-memory retriever: a
   * concept rank-1 verse ties a literal rank-2 verse, so the bridge can
   * promote without outvoting an exact user term.
   */
  conceptWeight?: number
  /** Request language, when known. Drives the Arabic-list weight (BUG-001). */
  language?: 'en' | 'fa'
  /** Cross-field query-term coverage rerank. Default on. */
  coverageRerank?: boolean
  /**
   * Bounded full-coverage multiplier: score *= 1 + alpha when a document
   * matches every eligible query group. Default 1.0 (2x). Partial coverage
   * gets no boost.
   */
  coverageAlpha?: number
  /** Arabic literal list weight for a Persian request. Default 0.3. */
  faQueryArWeight?: number
}

// ---------------------------------------------------------------------------
// FTS field search
// ---------------------------------------------------------------------------

interface Field {
  /** FTS column filter expression, e.g. `ar` or `{fa faj}`. */
  match: string
  /** SQL expression for the expanded index text (coverage). */
  idx: string
  /** SQL expression for the raw normalized text (phrase bonus). */
  raw: string
  expand: (t: string) => string[]
  stopwords: ReadonlySet<string>
  /** Query text used for the phrase bonus; defaults to the field query. */
  phrase?: string
}

const FIELDS = {
  ar: {
    match: 'ar',
    idx: 'v.ar_idx',
    raw: 'v.body_norm',
    expand: arabicVariants,
    stopwords: STOPWORDS_FA,
  },
  en: {
    match: 'en',
    idx: 'v.en_idx',
    raw: 'v.en_search',
    expand: englishVariants,
    stopwords: STOPWORDS_EN,
  },
  fa: {
    match: '{fa faj}',
    idx: "v.fa_idx || ' ' || v.faj_idx",
    raw: "v.fa_search || ' ' || v.fa_search_joined",
    expand: persianVariants,
    stopwords: STOPWORDS_FA,
  },
} satisfies Record<string, Field>

type FieldName = keyof typeof FIELDS

/** Same list as pipeline/lib/retrieve.ts. Concept expansion only. */
const GENERIC_CONCEPTS: ReadonlySet<string> = new Set([
  'god',
  'quran',
  'human',
  'people',
  'man',
  'woman',
  'earth',
  'sky',
  'life',
  'book',
  'verse',
  'surah',
  'revelation',
  'prophet',
  'prophets',
  'religion',
])

const quoteFts = (t: string): string => `"${t.replace(/"/g, '""')}"`

interface Ranked {
  ref: string
  score: number
  /** Informative query terms this verse matched; used by coverage. */
  matched: string[]
}

async function searchField(
  db: D1Database,
  name: FieldName,
  query: string,
  limit = 100,
  phraseOverride?: string,
  coverageEnabled = true,
): Promise<Ranked[]> {
  const field = FIELDS[name]
  const words = tokenize(query).filter((t) => !field.stopwords.has(t))
  const terms = [...new Set(words.flatMap((t) => field.expand(t)))]
  if (!terms.length) return []

  // Frame terms name the corpus itself. They cannot discriminate, and a field
  // that matched only them must not answer a question with content words.
  const isFrame = (t: string) => FRAME_TERMS.has(t)
  const content = terms.filter((t) => !isFrame(t))
  if (terms.some((t) => !isFrame(t)) && !content.length) return []

  // A frame term's stem must not be mistaken for content. «قرآن» expands to
  // «قرا», which is not in FRAME_TERMS; without this set a Persian question
  // whose content word is absent from the Arabic index still returns verses
  // that merely mention the Book. Rows must match at least one term derived
  // from a non-frame source word.
  const sourceContent = new Set<string>()
  const hasContentWord = words.some((t) => !isFrame(t))
  if (hasContentWord) {
    for (const word of words) {
      if (isFrame(word)) continue
      for (const v of field.expand(word)) sourceContent.add(v)
    }
  }

  const matchTerms = content.length ? content : terms
  const coverageTerms = content.length ? content : terms
  const match = `${field.match} : (${matchTerms.map(quoteFts).join(' OR ')})`

  const rows = await db
    .prepare(
      `SELECT verses_fts.ref AS ref, bm25(verses_fts) AS rank,
              ${field.idx} AS idx, ${field.raw} AS raw
       FROM verses_fts JOIN verses v ON v.ref = verses_fts.ref
       WHERE verses_fts MATCH ?
       ORDER BY rank
       LIMIT ?`,
    )
    .bind(match, limit)
    .all<{ ref: string; rank: number; idx: string; raw: string }>()

  // A row that matched only a frame-derived term is not evidence about the
  // user's topic. This mirrors the in-memory `sourceContent` guard.
  const candidates = hasContentWord
    ? rows.results.filter((row) => {
        const tokens = new Set(row.idx.split(/\s+/).filter(Boolean))
        for (const term of sourceContent) if (tokens.has(term)) return true
        return false
      })
    : rows.results
  if (!candidates.length) return []

  const phraseSource = phraseOverride ?? query
  const phraseWords = tokenize(phraseSource)
  const phrase = phraseWords.length > 1 ? phraseWords.join(' ') : ''

  // Only terms that exist somewhere in this field's candidate rows can be
  // covered. The in-memory `searchField` computes coverage over `present`
  // terms (the ones the field index actually contains); using every expanded
  // query term here would divide by variants that cannot match anything, so
  // the same query could rank differently on D1 than in memory.
  const observed = new Set<string>()
  for (const row of candidates) {
    for (const token of row.idx.split(/\s+/)) {
      if (token) observed.add(token)
    }
  }
  const effectiveCoverageTerms = coverageTerms.filter((t) => observed.has(t))

  return candidates
    .map((row) => {
      const tokens = new Set(row.idx.split(/\s+/).filter(Boolean))
      const matched = effectiveCoverageTerms.filter((t) => tokens.has(t))
      const coverage = effectiveCoverageTerms.length
        ? matched.length / effectiveCoverageTerms.length
        : 0
      // Concept terms are alternatives, not a conjunction; literal terms are
      // not. See the same switch in pipeline/lib/bm25.ts.
      const coverageFactor = coverageEnabled ? coverage : 1
      const bonus = phrase && row.raw.includes(phrase) ? 2 : 1
      return { ref: row.ref, score: -row.rank * coverageFactor * bonus, matched }
    })
    // FTS5 returns raw bm25 order. Coverage and the phrase bonus are part of
    // our score, so sort by that score before RRF consumes list positions —
    // otherwise those adjustments have no effect on the ranking at all.
    .sort((a, b) => b.score - a.score)
}

// ---------------------------------------------------------------------------
// Query building (mirrors pipeline/lib/retrieve.ts fieldQueries)
// ---------------------------------------------------------------------------

export interface QueryParts {
  ar: string
  en: string
  fa: string
}

export function fieldQueries(query: string, lexicon: Lexicon): QueryParts {
  const base = normalize(query)
  const joined = normalizeJoined(query)
  const out = { ar: base, en: normalize(foldEnglish(query)), fa: `${base} ${joined}` }

  if (!isLatinScript(query)) return out
  if (tokenize(out.en).some((t) => ENGLISH_MARKERS.has(t))) return out

  const all = [...lexicon.concepts, ...lexicon.names, ...lexicon.surahAliases]
  const hits = resolveFinglish(query, all)
  if (!hits.length) return out
  const faTerms = hits.map((h) => normalize(h.fa)).filter(Boolean)
  const enTerms = hits.map((h) => normalize(h.en)).filter(Boolean)
  return {
    ar: `${out.ar} ${faTerms.join(' ')}`.trim(),
    en: `${out.en} ${enTerms.join(' ')}`.trim(),
    fa: `${out.fa} ${faTerms.join(' ')}`.trim(),
  }
}

function matchConcepts(query: string, lexicon: Lexicon, maxConcepts = 2): ConceptEntry[] {
  // Same inflection expansion as the in-memory trigger matcher: "tested"
  // must reach the `trial` concept whose trigger is "test".
  const enTokens = new Set(
    tokenize(normalize(foldEnglish(query))).flatMap((t) => englishVariants(t)),
  )
  const faTokenSets = [
    new Set(tokenize(normalize(query)).flatMap((t) => persianVariants(t))),
    new Set(tokenize(normalizeJoined(query)).flatMap((t) => persianVariants(t))),
  ]
  const containsAll = (haystack: Set<string>, needle: string[]): boolean =>
    needle.length > 0 && needle.every((t) => haystack.has(t))
  const contains = (haystack: Set<string>[], needle: string[]): boolean =>
    haystack.some((h) => containsAll(h, needle))

  // "Quran" names the corpus, not a topic. Expanding the quran concept from an
  // ordinary question floods the candidates with verses that mention the Book.
  const allQueryTokens = [...enTokens, ...faTokenSets.flatMap((s) => [...s])]
  const hasContent = allQueryTokens.some((t) => !FRAME_TERMS.has(t))
  const isFrameTrigger = (needle: string[]) =>
    hasContent && needle.length > 0 && needle.every((t) => FRAME_TERMS.has(t))

  const scored: Array<{ concept: ConceptEntry; specificity: number }> = []
  for (const concept of lexicon.concepts) {
    const syn = concept.synonyms
    const label = (t: string) => t.replace(/\([^)]*\)/g, ' ')
    const enTriggers = [label(concept.en), ...(syn?.en ?? [])]
    const faTriggers = [label(concept.fa), ...(syn?.fa ?? [])]
    const arTriggers = [...(syn?.ar ?? [])]

    let best = 0
    for (const t of enTriggers) {
      const needle = tokenize(normalize(foldEnglish(t)))
      if (!isFrameTrigger(needle) && needle.length > best && containsAll(enTokens, needle)) {
        best = needle.length
      }
    }
    for (const t of [...faTriggers, ...arTriggers]) {
      const needle = tokenize(normalize(t))
      if (!isFrameTrigger(needle) && needle.length > best && contains(faTokenSets, needle)) {
        best = needle.length
      }
    }
    if (best > 0) scored.push({ concept, specificity: best })
  }

  // Prefer a real topic over a question-frame concept; see the in-memory
  // retriever for the same rule. D1 has no df oracle here, so the only signal
  // is the generic list; that is enough to keep «human» from outvoting «insult».
  const specific = scored.filter((s) => !GENERIC_CONCEPTS.has(s.concept.id))
  return (specific.length ? specific : scored)
    .sort((a, b) => b.specificity - a.specificity)
    .slice(0, maxConcepts)
    .map((s) => s.concept)
}

function conceptQueries(concepts: ConceptEntry[]): QueryParts {
  return {
    ar: concepts.flatMap((c) => c.synonyms?.ar ?? []).join(' '),
    en: concepts.flatMap((c) => [c.en, ...(c.synonyms?.en ?? [])]).join(' '),
    fa: concepts
      .flatMap((c) => [c.fa, ...(c.synonyms?.fa ?? []), ...(c.synonyms?.faJoined ?? [])])
      .join(' '),
  }
}

// ---------------------------------------------------------------------------
// Weighted RRF over refs
// ---------------------------------------------------------------------------

interface NamedList {
  name: string
  ranked: Ranked[]
  weight: number
}

function fuse(lists: NamedList[], k = 60): Hit[] {
  const scores = new Map<string, number>()
  const fields = new Map<string, string[]>()
  for (const list of lists) {
    if (!list.weight) continue
    for (let rank = 0; rank < list.ranked.length; rank++) {
      const ref = list.ranked[rank].ref
      scores.set(ref, (scores.get(ref) ?? 0) + list.weight / (k + rank + 1))
      const names = fields.get(ref) ?? []
      names.push(list.name)
      fields.set(ref, names)
    }
  }
  return [...scores.entries()]
    .map(([ref, score]) => ({ ref, score, fields: fields.get(ref) ?? [] }))
    .sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref, 'en', { numeric: true }))
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchD1(
  db: D1Database,
  lexicon: Lexicon,
  surahMeta: SurahMeta[],
  rawQuery: string,
  options: SearchOptions = {},
): Promise<Hit[]> {
  const limit = options.limit ?? 20
  const conceptExpansion = options.conceptExpansion ?? true
  const conceptWeight = options.conceptWeight ?? 0.5
  const coverageRerank = options.coverageRerank ?? true
  const coverageAlpha = options.coverageAlpha ?? 1
  const faQueryArWeight = options.faQueryArWeight ?? FA_QUERY_AR_WEIGHT

  if (normalize(rawQuery) === BASMALA_KEY) {
    return [{ ref: '1:1', score: 1, fields: ['phrase'] }]
  }

  // Direct reference: the user named the verse, so retrieval is bypassed.
  const surahRefs = buildSurahRefs(lexicon, surahMeta)
  const ref = parseReference(rawQuery, surahRefs)
  if (ref?.kind === 'single') {
    const rows = await db
      .prepare('SELECT ref FROM verses WHERE ref = ?')
      .bind(`${ref.surah}:${ref.ayah}`)
      .all<{ ref: string }>()
    return rows.results.map((r) => ({ ref: r.ref, score: 1, fields: ['reference'] }))
  }
  if (ref?.kind === 'range') {
    // D1 caps a query at 100 bound parameters. Binding one placeholder per
    // ayah broke full-surah ranges ("2:1-286"); a BETWEEN query has four.
    const rows = await db
      .prepare(
        'SELECT ref FROM verses WHERE surah = ? AND ayah BETWEEN ? AND ? ORDER BY ayah LIMIT ?',
      )
      .bind(ref.surah, ref.start, ref.end, limit)
      .all<{ ref: string }>()
    return rows.results.map((r) => ({ ref: r.ref, score: 1, fields: ['reference'] }))
  }
  if (ref && ref.kind === 'surah') {
    const rows = await db
      .prepare('SELECT ref FROM verses WHERE surah = ? ORDER BY ayah LIMIT ?')
      .bind(ref.surah, limit)
      .all<{ ref: string }>()
    return rows.results.map((r) => ({ ref: r.ref, score: 1, fields: ['reference'] }))
  }

  const q = fieldQueries(rawQuery, lexicon)
  if (!tokenize(q.ar).length) return []

  const literal: NamedList[] = []
  for (const name of ['ar', 'en', 'fa'] as const) {
    const phrase = name === 'fa' ? normalizeJoined(rawQuery) : undefined
    const ranked = await searchField(db, name, q[name], 100, phrase)
    if (ranked.length) literal.push({ name, ranked, weight: 1 })
  }

  const lists: NamedList[] = [...literal]
  const plan = buildCoveragePlan(rawQuery)
  const matchedAcrossCandidates = new Set<string>()
  const matchedByRef = new Map<string, Set<string>>()
  // Term coverage of the Persian list alone, for the Arabic weight gate.
  const faMatched = new Set<string>()

  for (const list of literal) {
    for (const ranked of list.ranked) {
      if (!ranked.matched.length) continue
      let refTerms = matchedByRef.get(ranked.ref)
      if (!refTerms) {
        refTerms = new Set<string>()
        matchedByRef.set(ranked.ref, refTerms)
      }
      for (const term of ranked.matched) {
        refTerms.add(term)
        matchedAcrossCandidates.add(term)
        if (list.name === 'fa') faMatched.add(term)
      }
    }
  }

  const eligible = plan.groups.filter((g) =>
    g.variants.some((v) => matchedAcrossCandidates.has(v)),
  ).length
  const faCoveredGroups = plan.groups.filter((g) =>
    g.variants.some((v) => faMatched.has(v)),
  ).length

  // BUG-001: a Persian request also searches the Arabic field with the same
  // raw tokens. «شراب» in Arabic names Paradise wine; 2:219 uses «الخمر».
  // When the Persian field covers the question's terms, the Arabic literal list
  // is a fallback rather than a peer. The weight is swept in ablate-fusion.ts.
  const faLiteral = literal.find((l) => l.name === 'fa')
  const arLiteral = literal.find((l) => l.name === 'ar')
  if (arLiteral) {
    arLiteral.weight = arWeightFor(
      options.language,
      !!faLiteral?.ranked.length,
      faCoveredGroups,
      faQueryArWeight,
    )
  }
  if (conceptExpansion) {
    const concepts = matchConcepts(rawQuery, lexicon)
    if (concepts.length) {
      const cq = conceptQueries(concepts)
      const excluded = new Set(concepts.flatMap((c) => c.synonyms?.excludes ?? []))
      for (const name of ['ar', 'en', 'fa'] as const) {
        if (!tokenize(cq[name]).length) continue
        const ranked = (
          await searchField(db, name, cq[name], 20, undefined, false)
        ).filter((h) => !excluded.has(h.ref))
        if (ranked.length) lists.push({ name: `concept:${name}`, ranked, weight: conceptWeight })
      }
    }
  }

  if (!lists.length) return []

  const hits = fuse(lists)

  // BUG-001: reward a verse that covers the WHOLE question across the literal
  // fields. 2:219 matches both «شراب» and «قمار» in the Persian translation;
  // a Paradise verse matches only «شراب». Partial overlap is not enough:
  // common question words would otherwise lift an unrelated verse. The boost
  // is bounded, applies only to candidates literal retrieval already found, and
  // never counts concept lists. It is a no-op unless at least two query groups
  // matched.
  if (coverageRerank && eligible >= 2) {
    for (const hit of hits) {
      const refTerms = matchedByRef.get(hit.ref)
      if (!refTerms) continue
      const coverage = coverageOf(plan, matchedAcrossCandidates, refTerms)
      if (coverage.eligible >= 2 && coverage.covered === coverage.eligible) {
        hit.score *= 1 + coverageAlpha
      }
    }
    hits.sort(
      (a, b) =>
        b.score - a.score || a.ref.localeCompare(b.ref, 'en', { numeric: true }),
    )
  }

  return hits.slice(0, limit)
}
