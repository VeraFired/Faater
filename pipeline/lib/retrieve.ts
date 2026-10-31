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

export interface RetrieverData {
  verses: CorpusVerse[]
  basmala: { text: string; norm: string; ref: string }
  surahs: CorpusSurah[]
  en: Record<string, TranslationVerse>
  fa: Record<string, TranslationVerse>
  lexicon: {
    concepts: LexiconEntry[]
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

export class Retriever {
  private readonly data: RetrieverData
  private refs: string[]
  private readonly ar: FieldIndex
  private readonly en: FieldIndex
  private readonly fa: FieldIndex
  private readonly refIndex: Map<string, number>
  private readonly surahRefs: SurahRef[]

  constructor(data: RetrieverData) {
    this.data = data
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

    const lists: Array<{ name: string; ranked: RankedDoc[] }> = [
      {
        name: 'ar',
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
        ranked: searchField(this.en, q.en, {
          limit: 100,
          expand: englishVariants,
          stopwords: STOPWORDS_EN,
          frameTerms: FRAME_TERMS,
        }),
      },
      {
        name: 'fa',
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

    if (!lists.length) return []

    const fused = rrf(lists.map((l) => l.ranked))

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