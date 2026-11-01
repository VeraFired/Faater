/**
 * The M0 vertical-slice retriever.
 *
 * One query becomes three field queries (Arabic, English, Persian), each
 * ranked independently with BM25 and fused with RRF. Finglish input is
 * expanded through the curated lexicon first; a direct reference short-circuits
 * retrieval entirely.
 *
 * Every stage here is deterministic and free. No model is involved, so this
 * path works at any traffic level and cannot be taken down by a quota.
 */

import { BASMALA_KEY } from './basmala.ts'
import { buildField, rrf, searchField, tokenize, type FieldIndex, type RankedDoc } from './bm25.ts'
import { resolveFinglish, isLatinScript, type LexiconEntry } from './finglish.ts'
import { normalize, normalizeJoined } from './normalize.ts'
import {
  ENGLISH_MARKERS,
  FRAME_TERMS,
  STOPWORDS_EN,
  STOPWORDS_FA,
  foldEnglish,
} from './stopwords.ts'
import { parseReference, type Reference, type SurahRef } from './reference.ts'
import { arabicVariants, englishVariants, persianVariants } from './stem.ts'
import { arWeightFor, FA_QUERY_AR_WEIGHT } from './query.ts'
import { buildCoveragePlan, coverageOf } from './query-plan.ts'

export interface CorpusVerse {
  ref: string
  surah: number
  ayah: number
  arabic: string
  arabicNorm: string
  bodyNorm: string
  basmala: string | null
}

export interface TranslationVerse {
  segments: Array<{ t: string; v: string }>
  footnotes: Array<{ n: number; text: string }>
  searchText: string
  searchTextJoined: string
}

export interface CorpusSurah {
  index: number
  ayahs: number
  nameAr: string
  nameEn: string
  nameTranslit: string
  nameFa: string
  nameFaAlt: string | null
}

export interface ConceptSynonyms {
  en: string[]
  fa: string[]
  /** ZWNJ-joined Persian forms, for the second fa index key. */
  faJoined: string[]
  ar: string[]
  /** Verses that share a spelling but not the sense; never returned by this concept. */
  excludes?: string[]
}

export interface ConceptEntry extends LexiconEntry {
  /** Search-only synonyms, curated and corpus-verified. Never displayed. */
  synonyms?: ConceptSynonyms
}

export interface RetrieverData {
  verses: CorpusVerse[]
  basmala: { text: string; norm: string; ref: string }
  surahs: CorpusSurah[]
  en: Record<string, TranslationVerse>
  fa: Record<string, TranslationVerse>
  lexicon: {
    concepts: ConceptEntry[]
    names: LexiconEntry[]
    surahAliases: LexiconEntry[]
  }
}

export interface Hit {
  ref: string
  score: number
  /** Which languages produced the hit. Useful for the gates and for debugging. */
  fields: string[]
}

/**
 * Concepts broad enough to appear in ordinary question framing. When the same
 * question also matches a real topic concept, expanding these as well floods
 * the candidate set: "another person insults them" would expand «human» (75
 * verses) alongside «insult». They remain available when they are the only
 * concept matched, so "what does the Quran say about human beings" still works.
 */
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

export interface RetrieverOptions {
  /**
   * Concept expansion is ON by default once the lexicon carries synonyms.
   * The flag exists so the eval can ablate it: an expansion that cannot be
   * measured against its own absence is indistinguishable from noise.
   */
  conceptExpansion?: boolean
  /**
   * RRF weight of a concept list relative to a literal field list.
   *
   * 0.5 means a concept list's rank-1 verse ties a literal list's rank-2
   * verse: the bridge can promote, but one exact user word still outweighs
   * one synonym match. The pilot sweep (2026-11-01) measured 0.1 -> 0.5:
   * hit@5 40.9 -> 47.0, direct 48.0 -> 52.0, paraphrase 18.8 -> 31.3,
   * MRR 0.288 -> 0.381. Above 0.5 the paraphrase gain is not monotonic and
   * direct queries lose their head ranks (prayer 3 -> 7), so 0.5 is the
   * pre-registered compromise rather than a per-query tuning knob.
   */
  conceptWeight?: number
  /**
   * Cross-field query-term coverage rerank (BUG-001). On by default; the flag
   * exists so an ablation can measure what it adds or costs.
   */
  coverageRerank?: boolean
  /**
   * Bounded full-coverage multiplier: score *= 1 + alpha when a document
   * matches every eligible query group. Default 1.0 (2x). Partial coverage
   * gets no boost.
   */
  coverageAlpha?: number
  /**
   * RRF weight of the Arabic literal list for a Persian request whose Persian
   * field covers at least two query groups. Default 0.3; 1 restores the old
   * behaviour.
   */
  faQueryArWeight?: number
}

export interface RetrieverSearchOptions {
  limit?: number
  /** Request language, when the caller knows it. Drives the Arabic weight. */
  language?: 'en' | 'fa'
  coverageRerank?: boolean
  coverageAlpha?: number
  faQueryArWeight?: number
  /** Per-query override for ablations; defaults to the retriever's setting. */
  conceptWeight?: number
}

export class Retriever {
  private readonly data: RetrieverData
  private readonly conceptExpansion: boolean
  private readonly conceptWeight: number
  private readonly coverageRerank: boolean
  private readonly coverageAlpha: number
  private readonly faQueryArWeight: number
  private refs: string[]
  private readonly ar: FieldIndex
  private readonly en: FieldIndex
  private readonly fa: FieldIndex
  private readonly refIndex: Map<string, number>
  private readonly surahRefs: SurahRef[]

  constructor(data: RetrieverData, options: RetrieverOptions = {}) {
    this.data = data
    this.conceptExpansion = options.conceptExpansion ?? true
    this.conceptWeight = options.conceptWeight ?? 0.5
    this.coverageRerank = options.coverageRerank ?? true
    this.coverageAlpha = options.coverageAlpha ?? 1
    this.faQueryArWeight = options.faQueryArWeight ?? FA_QUERY_AR_WEIGHT
    // The reference parser needs every spelling of a surah name; the corpus
    // supplies Arabic/English/Persian and the lexicon supplies the derived
    // Finglish aliases.
    const aliasKeys = new Map(data.lexicon.surahAliases.map((a) => [a.id, a.keys]))
    this.surahRefs = data.surahs.map((s) => ({
      index: s.index,
      ayahs: s.ayahs,
      keys: [
        s.nameAr,
        s.nameEn,
        s.nameTranslit,
        s.nameFa,
        ...(s.nameFaAlt ? [s.nameFaAlt] : []),
        ...(aliasKeys.get(`surah:${s.index}`) ?? []),
      ],
    }))
    this.refs = data.verses.map((v) => v.ref)
    this.refIndex = new Map(this.refs.map((ref, i) => [ref, i]))

    // One extra document holds the basmala in all three fields, so a basmala
    // query resolves to 1:1 instead of 113 near-identical surah openings.
    const basmalaIndex = this.refs.length
    this.refs = [...this.refs, data.basmala.ref]
    this.refIndex.set(data.basmala.ref, basmalaIndex)

    const arTexts = [...data.verses.map((v) => v.bodyNorm), data.basmala.norm]
    const enTexts = [
      ...data.verses.map((v) => data.en[v.ref]?.searchText ?? ''),
      normalize(foldEnglish('In the name of Allah, the Entirely Merciful, the Especially Merciful')),
    ]
    const faTexts = [
      ...data.verses.map((v) => {
        const t = data.fa[v.ref]
        // Both ZWNJ variants are indexed so joined and split spellings meet.
        return t ? `${t.searchText} ${t.searchTextJoined}` : ''
      }),
      normalize('به نام الله بخشندۀ مهربان'),
    ]

    // Arabic carries its article, conjunction and prepositions attached to the
    // stem, so «صبر» misses «بالصبر». Light stemming is added alongside the
    // exact token, never instead of it.
    this.ar = buildField('ar', arTexts, arabicVariants)
    this.en = buildField('en', enTexts, englishVariants)
    this.fa = buildField('fa', faTexts, persianVariants)
  }

  /** Expand a query into per-field query strings. */
  private fieldQueries(query: string): { ar: string; en: string; fa: string } {
    const base = normalize(query)
    const joined = normalizeJoined(query)
    // The English index is apostrophe-folded at build time ("Qur'an" -> quran),
    // so the English query must be folded the same way or the two never meet.
    const out = { ar: base, en: normalize(foldEnglish(query)), fa: `${base} ${joined}` }

    if (!isLatinScript(query)) return out

    // Finglish is a query LANGUAGE, not a set of words sprinkled into English.
    // Without this guard, the English sentence "what does the Quran say about
    // patience" had "quran" resolved as a Finglish key, injecting Persian
    // «قرآن» into the Arabic field; ar and fa then agreed on short verses
    // containing «القرآن» and outvoted the English list in RRF. One English
    // function word is enough to settle the language question.
    if (tokenize(out.en).some((t) => ENGLISH_MARKERS.has(t))) return out

    // Finglish: add the Persian and English forms of every resolved concept.
    const all = [
      ...this.data.lexicon.concepts,
      ...this.data.lexicon.names,
      ...this.data.lexicon.surahAliases,
    ]
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

  /** Parse a direct reference out of the query, if there is one. */
  reference(query: string): Reference | null {
    return parseReference(query, this.surahRefs)
  }

  /**
   * Concepts whose label or synonym appears in the question.
   *
   * This is the bridge lexical retrieval cannot build on its own: "charity"
   * and the translation's «spend their wealth» share no token, but both are
   * search terms of the charity concept. Matching is whole-token (or a
   * contiguous phrase), never substring — "sabrina" is not "sabr".
   *
   * At most `maxConcepts` are returned, longest trigger first: expanding with
   * every vaguely-mentioned concept turns the query into noise.
   */
  private matchConcepts(query: string, maxConcepts = 2): ConceptEntry[] {
    // Trigger matching uses the same inflection expansion as retrieval. A
    // user asking about "tested" people must reach the `trial` concept whose
    // trigger is "test"; exact-token matching missed it.
    const enTokens = new Set(
      tokenize(normalize(foldEnglish(query))).flatMap((t) => englishVariants(t)),
    )
    // The two Persian keys are separate token streams. Concatenating them
    // would let a two-token trigger match across the split/joined boundary,
    // which is not a phrase that occurs anywhere.
    const faTokenSets = [
      new Set(tokenize(normalize(query)).flatMap((t) => persianVariants(t))),
      new Set(tokenize(normalizeJoined(query)).flatMap((t) => persianVariants(t))),
    ]

    const containsAll = (haystack: Set<string>, needle: string[]): boolean =>
      needle.length > 0 && needle.every((t) => haystack.has(t))
    const contains = (haystack: Set<string>[], needle: string[]): boolean =>
      haystack.some((h) => containsAll(h, needle))

    // "Quran" names the corpus, it is not a topic. Expanding the quran concept
    // from a question like "what does the Quran say about modesty" floods the
    // candidate set with verses that merely mention the Book, and when literal
    // retrieval finds nothing those verses win by default. A trigger made only
    // of frame terms is therefore skipped whenever the question has content.
    const allQueryTokens = [...enTokens, ...faTokenSets.flatMap((s) => [...s])]
    const hasContent = allQueryTokens.some((t) => !FRAME_TERMS.has(t))
    const isFrameTrigger = (needle: string[]) =>
      hasContent && needle.length > 0 && needle.every((t) => FRAME_TERMS.has(t))

    const scored: Array<{ concept: ConceptEntry; specificity: number; rarity: number }> = []
    // A trigger that occurs in a handful of verses is a better topic signal
    // than one that occurs in hundreds. Without this, «انسان» and «مردم»
    // outranked «توهین» purely because their concept entries are earlier in
    // the lexicon, and the insult query expanded to 75 human verses.
    const rarityOf = (field: FieldIndex, needle: string[]): number => {
      let worst = 0
      for (const t of needle) {
        const posting = field.terms.get(t)
        if (!posting) return Number.POSITIVE_INFINITY
        worst = Math.max(worst, posting.docs.length)
      }
      return worst
    }
    for (const concept of this.data.lexicon.concepts) {
      const syn = concept.synonyms
      // English triggers are matched against the folded English query; Persian
      // and Arabic triggers against the same tokens the script fields use.
      // A label like "heaven(s)" must not demand the token "s": the gloss is
      // display-shaped, the trigger is search-shaped.
      const label = (t: string) => t.replace(/\([^)]*\)/g, ' ')
      const enTriggers = [label(concept.en), ...(syn?.en ?? [])]
      const faTriggers = [label(concept.fa), ...(syn?.fa ?? [])]
      const arTriggers = [...(syn?.ar ?? [])]

      let best = 0
      let rarity = Number.POSITIVE_INFINITY
      for (const t of enTriggers) {
        const needle = tokenize(normalize(foldEnglish(t)))
        if (!isFrameTrigger(needle) && needle.length > best && containsAll(enTokens, needle)) {
          best = needle.length
          rarity = rarityOf(this.en, needle)
        }
      }
      for (const t of faTriggers) {
        const needle = tokenize(normalize(t))
        if (!isFrameTrigger(needle) && needle.length > best && contains(faTokenSets, needle)) {
          best = needle.length
          rarity = rarityOf(this.fa, needle)
        }
      }
      for (const t of arTriggers) {
        const needle = tokenize(normalize(t))
        if (!isFrameTrigger(needle) && needle.length > best && contains(faTokenSets, needle)) {
          best = needle.length
          rarity = rarityOf(this.ar, needle)
        }
      }
      if (best > 0) scored.push({ concept, specificity: best, rarity })
    }

    // Prefer a real topic over a question-frame concept. The generic entries
    // remain the fallback when nothing else matched.
    const specific = scored.filter((s) => !GENERIC_CONCEPTS.has(s.concept.id))
    return (specific.length ? specific : scored)
      .sort((a, b) => b.specificity - a.specificity || a.rarity - b.rarity)
      .slice(0, maxConcepts)
      .map((s) => s.concept)
  }

  /**
   * Rank lists built from a concept's synonym sets, one per script field.
   *
   * Kept as SEPARATE lists rather than appended to the query string: appended
   * synonyms would count towards coverage, so a verse matching two of eight
   * synonyms would look badly covered and sink below a verse matching one
   * literal token. Fusing them through RRF keeps both signals intact.
   */
  private conceptLists(concepts: ConceptEntry[]): Array<{ name: string; ranked: RankedDoc[] }> {
    if (!concepts.length) return []
    const out: Array<{ name: string; ranked: RankedDoc[] }> = []

    const arQ = concepts.flatMap((c) => c.synonyms?.ar ?? []).join(' ')
    const enQ = concepts.flatMap((c) => [c.en, ...(c.synonyms?.en ?? [])]).join(' ')
    const faQ = concepts
      .flatMap((c) => [c.fa, ...(c.synonyms?.fa ?? []), ...(c.synonyms?.faJoined ?? [])])
      .join(' ')
    const excluded = new Set(concepts.flatMap((c) => c.synonyms?.excludes ?? []))
    const allow = (ranked: RankedDoc[]) =>
      excluded.size ? ranked.filter((r) => !excluded.has(this.refs[r.doc] ?? '')) : ranked

    if (tokenize(arQ).length) {
      out.push({
        name: 'concept:ar',
        ranked: allow(
          searchField(this.ar, arQ, {
            limit: 20,
            expand: arabicVariants,
            stopwords: STOPWORDS_FA,
            frameTerms: FRAME_TERMS,
            coverage: false,
          }),
        ),
      })
    }
    if (tokenize(enQ).length) {
      out.push({
        name: 'concept:en',
        ranked: allow(
          searchField(this.en, enQ, {
            limit: 20,
            expand: englishVariants,
            stopwords: STOPWORDS_EN,
            frameTerms: FRAME_TERMS,
            coverage: false,
          }),
        ),
      })
    }
    if (tokenize(faQ).length) {
      out.push({
        name: 'concept:fa',
        ranked: allow(
          searchField(this.fa, faQ, {
            limit: 20,
            expand: persianVariants,
            stopwords: STOPWORDS_FA,
            frameTerms: FRAME_TERMS,
            coverage: false,
          }),
        ),
      })
    }
    return out
  }

  search(query: string, options: RetrieverSearchOptions = {}): Hit[] {
    const limit = options.limit ?? 20
    const coverageRerank = options.coverageRerank ?? this.coverageRerank
    const coverageAlpha = options.coverageAlpha ?? this.coverageAlpha
    const faQueryArWeight = options.faQueryArWeight ?? this.faQueryArWeight
    const conceptWeight = options.conceptWeight ?? this.conceptWeight

    // The basmala is a fixed string, not a fuzzy query. RRF otherwise favours
    // a verse that weakly matches several languages over the one document that
    // matches the phrase perfectly in Arabic — 55:1 («الرحمن») outranked 1:1.
    // Treating it as a phrase lookup is correct and deterministic.
    if (normalize(query) === BASMALA_KEY) {
      return [{ ref: this.data.basmala.ref, score: 1, fields: ['phrase'] }]
    }

    const ref = this.reference(query)

    // A direct reference bypasses retrieval: the user named the verse.
    if (ref && (ref.kind === 'single' || ref.kind === 'range')) {
      const out: Hit[] = []
      if (ref.kind === 'single') {
        out.push({ ref: `${ref.surah}:${ref.ayah}`, score: 1, fields: ['reference'] })
      } else {
        for (let a = ref.start; a <= ref.end; a++) {
          out.push({ ref: `${ref.surah}:${a}`, score: 1, fields: ['reference'] })
        }
      }
      return out.filter((h) => this.refIndex.has(h.ref)).slice(0, limit)
    }

    if (ref && ref.kind === 'surah') {
      const out: Hit[] = []
      for (const v of this.data.verses) {
        if (v.surah === ref.surah) out.push({ ref: v.ref, score: 1, fields: ['reference'] })
      }
      return out.slice(0, limit)
    }

    const q = this.fieldQueries(query)
    if (!tokenize(q.ar).length) return []

    const lists: Array<{ name: string; ranked: RankedDoc[]; weight: number }> = [
      {
        name: 'ar',
        weight: 1,
        ranked: searchField(this.ar, q.ar, {
          limit: 100,
          expand: arabicVariants,
          // Persian function words must be removed here too. A Persian query
          // and Arabic scripture share one script, and words like «آنها» →
          // «انها» are also Arabic tokens. Without this, the all-stopword
          // query «آنها را به ما بگو» returned five Arabic verses instead of
          // refusing.
          stopwords: STOPWORDS_FA,
          frameTerms: FRAME_TERMS,
        }),
      },
      {
        name: 'en',
        weight: 1,
        ranked: searchField(this.en, q.en, {
          limit: 100,
          expand: englishVariants,
          stopwords: STOPWORDS_EN,
          frameTerms: FRAME_TERMS,
        }),
      },
      {
        name: 'fa',
        weight: 1,
        ranked: searchField(this.fa, q.fa, {
          limit: 100,
          expand: persianVariants,
          stopwords: STOPWORDS_FA,
          frameTerms: FRAME_TERMS,
          // The fa terms carry both ZWNJ variants, so the query string itself
          // appears in no document. Phrase matching must use one real form.
          phrase: normalizeJoined(query),
        }),
      },
    ].filter((l) => l.ranked.length > 0)

    // Coverage is computed over the literal lists only. Concept lists are a
    // bridge, not evidence that the verse covers the user's words.
    const literal = [...lists]
    const plan = buildCoveragePlan(query)
    const matchedAcrossCandidates = new Set<string>()
    const matchedByDoc = new Map<number, Set<string>>()
    // Term coverage of the Persian list alone. The Arabic weight gate needs to
    // know whether the Persian field can answer the question's topic structure,
    // not merely whether it returned any candidate.
    const faMatched = new Set<string>()

    for (const list of literal) {
      for (const ranked of list.ranked) {
        if (!ranked.matched?.length) continue
        let docTerms = matchedByDoc.get(ranked.doc)
        if (!docTerms) {
          docTerms = new Set<string>()
          matchedByDoc.set(ranked.doc, docTerms)
        }
        for (const term of ranked.matched) {
          docTerms.add(term)
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

    // BUG-001: on a Persian request, the Arabic literal list is a fallback.
    // The raw Persian tokens are also valid Arabic, and «شراب» in Arabic names
    // Paradise wine rather than the prohibition verse's «الخمر». Only the
    // request language can tell these apart; the query itself cannot. The
    // weight is swept in `ablate-fusion.ts`; 0.3 is the pre-registered fallback
    // weight. The gate requires the Persian list to cover at least two query
    // groups so an Arabic-script question typed in the Persian UI keeps full
    // Arabic weight.
    const faLiteral = lists.find((l) => l.name === 'fa')
    const arLiteral = lists.find((l) => l.name === 'ar')
    if (arLiteral) {
      arLiteral.weight = arWeightFor(
        options.language,
        !!faLiteral?.ranked.length,
        faCoveredGroups,
        faQueryArWeight,
      )
    }

    // Concept expansion is a separate set of candidate lists, fused exactly
    // like the literal ones. It is the only path by which an English question
    // can reach a verse whose English translation uses different wording.
    if (this.conceptExpansion) {
      for (const l of this.conceptLists(this.matchConcepts(query))) {
        if (l.ranked.length) lists.push({ ...l, weight: conceptWeight })
      }
    }

    if (!lists.length) return []

    const fused = rrf(
      lists.map((l) => l.ranked),
      60,
      lists.map((l) => l.weight),
    )

    // BUG-001: reward a verse that covers the WHOLE question across the literal
    // fields. 2:219 matches both «شراب» and «قمار» in the Persian translation;
    // a Paradise verse matches only «شراب», yet RRF used to see one list
    // position each. Partial overlap is not enough: common question words
    // («مردم», «وجود», «دارد») otherwise lift an unrelated verse to rank 1.
    // The boost is multiplicative and bounded, applies only to documents
    // literal retrieval already found, and is skipped unless at least two query
    // groups actually matched somewhere — a one-term query has nothing to cover.
    if (coverageRerank && eligible >= 2) {
      for (const hit of fused) {
        const docTerms = matchedByDoc.get(hit.doc)
        if (!docTerms) continue
        const coverage = coverageOf(plan, matchedAcrossCandidates, docTerms)
        if (coverage.eligible >= 2 && coverage.covered === coverage.eligible) {
          hit.score *= 1 + coverageAlpha
        }
      }
      fused.sort((a, b) => b.score - a.score || a.doc - b.doc)
    }

    // Record which fields contributed, so a Persian question answered from the
    // English index is visible rather than silent.
    const byDoc = new Map<number, string[]>()
    for (const list of lists) {
      for (const { doc } of list.ranked) {
        const names = byDoc.get(doc) ?? []
        names.push(list.name)
        byDoc.set(doc, names)
      }
    }

    // The basmala pseudo-document and verse 1:1 are the same verse, so they can
    // both surface. Dedupe by ref, keeping the stronger score.
    const best = new Map<string, Hit>()
    for (const { doc, score } of fused) {
      const ref = this.refs[doc]
      if (!ref) continue
      const existing = best.get(ref)
      if (!existing || score > existing.score) {
        best.set(ref, { ref, score, fields: byDoc.get(doc) ?? [] })
      }
    }
    return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit)
  }
}