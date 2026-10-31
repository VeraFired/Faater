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
import { arabicVariants, englishVariants } from './stem.ts'

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
   * 1.0 lets a concept list outvote a literal match, which is measurably
   * wrong: at weight 1 the pilot's direct hit@5 fell 18 points while
   * paraphrase rose 12.5. The concept layer is a bridge, not a replacement.
   */
  conceptWeight?: number
}

export class Retriever {
  private readonly data: RetrieverData
  private readonly conceptExpansion: boolean
  private readonly conceptWeight: number
  private refs: string[]
  private readonly ar: FieldIndex
  private readonly en: FieldIndex
  private readonly fa: FieldIndex
  private readonly refIndex: Map<string, number>
  private readonly surahRefs: SurahRef[]

  constructor(data: RetrieverData, options: RetrieverOptions = {}) {
    this.data = data
    this.conceptExpansion = options.conceptExpansion ?? true
    this.conceptWeight = options.conceptWeight ?? 0.1
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
    this.fa = buildField('fa', faTexts, arabicVariants)
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
    const enTokens = new Set(tokenize(normalize(foldEnglish(query))))
    // The two Persian keys are separate token streams. Concatenating them
    // would let a two-token trigger match across the split/joined boundary,
    // which is not a phrase that occurs anywhere.
    const faTokenSets = [
      new Set(tokenize(normalize(query))),
      new Set(tokenize(normalizeJoined(query))),
    ]

    const containsAll = (haystack: Set<string>, needle: string[]): boolean =>
      needle.length > 0 && needle.every((t) => haystack.has(t))
    const contains = (haystack: Set<string>[], needle: string[]): boolean =>
      haystack.some((h) => containsAll(h, needle))

    const scored: Array<{ concept: ConceptEntry; specificity: number }> = []
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
      for (const t of enTriggers) {
        const needle = tokenize(normalize(foldEnglish(t)))
        if (needle.length > best && containsAll(enTokens, needle)) best = needle.length
      }
      for (const t of [...faTriggers, ...arTriggers]) {
        const needle = tokenize(normalize(t))
        if (needle.length > best && contains(faTokenSets, needle)) best = needle.length
      }
      if (best > 0) scored.push({ concept, specificity: best })
    }

    return scored
      .sort((a, b) => b.specificity - a.specificity)
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

    if (tokenize(arQ).length) {
      out.push({
        name: 'concept:ar',
        ranked: searchField(this.ar, arQ, {
          limit: 20,
          expand: arabicVariants,
          stopwords: STOPWORDS_FA,
          frameTerms: FRAME_TERMS,
        }),
      })
    }
    if (tokenize(enQ).length) {
      out.push({
        name: 'concept:en',
        ranked: searchField(this.en, enQ, {
          limit: 20,
          expand: englishVariants,
          stopwords: STOPWORDS_EN,
          frameTerms: FRAME_TERMS,
        }),
      })
    }
    if (tokenize(faQ).length) {
      out.push({
        name: 'concept:fa',
        ranked: searchField(this.fa, faQ, {
          limit: 20,
          expand: arabicVariants,
          stopwords: STOPWORDS_FA,
          frameTerms: FRAME_TERMS,
        }),
      })
    }
    return out
  }

  search(query: string, options: { limit?: number } = {}): Hit[] {
    const limit = options.limit ?? 20

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
          expand: arabicVariants,
          stopwords: STOPWORDS_FA,
          frameTerms: FRAME_TERMS,
          // The fa terms carry both ZWNJ variants, so the query string itself
          // appears in no document. Phrase matching must use one real form.
          phrase: normalizeJoined(query),
        }),
      },
    ].filter((l) => l.ranked.length > 0)

    // Concept expansion is a separate set of candidate lists, fused exactly
    // like the literal ones. It is the only path by which an English question
    // can reach a verse whose English translation uses different wording.
    if (this.conceptExpansion) {
      for (const l of this.conceptLists(this.matchConcepts(query))) {
        if (l.ranked.length) lists.push({ ...l, weight: this.conceptWeight })
      }
    }

    if (!lists.length) return []

    const fused = rrf(
      lists.map((l) => l.ranked),
      60,
      lists.map((l) => l.weight),
    )

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