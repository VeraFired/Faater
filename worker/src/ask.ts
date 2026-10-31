/**
 * The answer path: deterministic, no model, no external provider.
 *
 * G0 (input) -> crisis/tafsir/fiqh branches -> retrieval -> verse cards.
 * Refusal happens when retrieval returns nothing. G2/G3 (a learned retrieval
 * floor and answerability score) are NOT implemented: the pilot measured that
 * score thresholds cannot separate in-domain unanswerable questions (AUC
 * 0.551, chance). Until G1 exists, the product must not be launched publicly;
 * this path is honest about returning verses when it has them and refusing
 * when it has none.
 */

import {
  COPY,
  CRISIS_MARKERS,
  FIQH_MARKERS,
  LIMITS,
  TAFSIR_MARKERS,
  VERSION,
  containsMarker,
  type Lang,
} from './config.ts'
import { parseReference } from '../../pipeline/lib/reference.ts'
import { inScope } from '../../pipeline/lib/scope.ts'
import scopeModel from '../../data/scope-model.json' with { type: 'json' }
import {
  buildSurahRefs,
  searchD1,
  type D1Database,
  type Lexicon,
  type SurahMeta,
} from './retrieve.ts'

export interface AskRequest {
  q: string
  lang?: Lang
}

export interface VerseCard {
  ref: string
  surah: number
  ayah: number
  surah_name: { ar: string; en: string; fa: string }
  arabic: string
  basmala: string | null
  translations: Array<{
    edition: string
    title: string
    version?: string
    publisher?: string
    sourceUrl?: string
    language: Lang
    text: string
    footnotes: Array<{ n: number; text: string }>
  }>
  context: { before: string | null; after: string | null }
  links: { quran_com: string; tanzil: string }
}

export interface AskResponse {
  request_id: string
  lang: Lang
  status: 'answered' | 'answered_with_boundary' | 'refused' | 'clarification'
  reason?: string
  message?: string
  notices: Array<{ type: string; text: string }>
  verses: VerseCard[]
  mode: 'retrieval_only'
  version: string
}

interface Meta {
  lexicon: Lexicon
  surahs: SurahMeta[]
  enEdition: {
    key: string
    title: string
    version?: string
    publisher?: string
    sourceUrl?: string
  }
  faEdition: {
    key: string
    title: string
    version?: string
    publisher?: string
    sourceUrl?: string
  }
}

interface VerseRow {
  ref: string
  surah: number
  ayah: number
  arabic: string
  body: string
  basmala: string | null
  en_text: string
  en_footnotes: string
  fa_text: string
  fa_footnotes: string
}

// One D1 read per isolate, not per request.
let metaCache: Promise<Meta> | null = null
async function loadMeta(db: D1Database): Promise<Meta> {
  if (!metaCache) {
    metaCache = (async () => {
      const rows = await db
        .prepare(
          "SELECT key, value FROM meta WHERE key IN ('lexicon','surahs','en_edition','fa_edition')",
        )
        .bind()
        .all<{ key: string; value: string }>()
      const map = new Map(rows.results.map((r) => [r.key, r.value]))
      const get = (key: string): string => {
        const v = map.get(key)
        if (!v) throw new Error(`missing meta: ${key}`)
        return v
      }
      return {
        lexicon: JSON.parse(get('lexicon')) as Lexicon,
        surahs: JSON.parse(get('surahs')) as SurahMeta[],
        enEdition: JSON.parse(get('en_edition')),
        faEdition: JSON.parse(get('fa_edition')),
      }
    })().catch((err) => {
      metaCache = null
      throw err
    })
  }
  return metaCache
}

const detectLang = (query: string, declared?: Lang): Lang => {
  if (declared === 'en' || declared === 'fa') return declared
  // A question is classified by its dominant script, not by the presence of
  // one foreign character: an English question quoting «الصبر» is still
  // English, while a Persian sentence with an English loanword is still Persian.
  const latin = (query.match(/[A-Za-z]/g) ?? []).length
  const arabicScript = (query.match(/[؀-ۿ]/g) ?? []).length
  return latin > 0 && latin > arabicScript ? 'en' : 'fa'
}

const isControl = (text: string): boolean => /[\u0000-\u0008\u000E-\u001F\u007F]/.test(text)

async function loadVerses(db: D1Database, refs: string[]): Promise<Map<string, VerseRow>> {
  if (!refs.length) return new Map()
  const placeholders = refs.map(() => '?').join(',')
  const rows = await db
    .prepare(
      `SELECT ref, surah, ayah, arabic, body, basmala, en_text, en_footnotes, fa_text, fa_footnotes
       FROM verses WHERE ref IN (${placeholders})`,
    )
    .bind(...refs)
    .all<VerseRow>()
  return new Map(rows.results.map((r) => [r.ref, r]))
}

const parseFootnotes = (json: string): Array<{ n: number; text: string }> => {
  try {
    const parsed = JSON.parse(json) as Array<{ n: number; text: string }>
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function buildCards(
  db: D1Database,
  meta: Meta,
  refs: string[],
): Promise<VerseCard[]> {
  const rows = await loadVerses(db, refs)

  const cards: VerseCard[] = []
  for (const ref of refs) {
    const row = rows.get(ref)
    if (!row) continue
    const surah = meta.surahs.find((s) => s.index === row.surah)
    if (!surah) continue
    cards.push({
      ref: row.ref,
      surah: row.surah,
      ayah: row.ayah,
      surah_name: { ar: surah.nameAr, en: surah.nameEn, fa: surah.nameFa },
      arabic: row.body,
      basmala: row.basmala,
      translations: [
        {
          edition: meta.enEdition.key,
          title: meta.enEdition.title,
          version: meta.enEdition.version,
          publisher: meta.enEdition.publisher,
          sourceUrl: meta.enEdition.sourceUrl,
          language: 'en',
          text: row.en_text,
          footnotes: parseFootnotes(row.en_footnotes),
        },
        {
          edition: meta.faEdition.key,
          title: meta.faEdition.title,
          version: meta.faEdition.version,
          publisher: meta.faEdition.publisher,
          sourceUrl: meta.faEdition.sourceUrl,
          language: 'fa',
          text: row.fa_text,
          footnotes: parseFootnotes(row.fa_footnotes),
        },
      ],
      context: {
        before: row.ayah > 1 ? `${row.surah}:${row.ayah - 1}` : null,
        after: row.ayah < surah.ayahs ? `${row.surah}:${row.ayah + 1}` : null,
      },
      links: {
        quran_com: `https://quran.com/${row.surah}/${row.ayah}`,
        tanzil: `https://tanzil.net/#${row.surah}:${row.ayah}`,
      },
    })
  }
  return cards
}

export async function ask(
  db: D1Database,
  request: AskRequest,
  requestId: string,
): Promise<AskResponse> {
  const query = request.q.trim()
  const lang = detectLang(query, request.lang)
  const copy = COPY[lang]
  const base = {
    request_id: requestId,
    lang,
    notices: [] as Array<{ type: string; text: string }>,
    verses: [] as VerseCard[],
    mode: 'retrieval_only' as const,
    version: VERSION,
  }

  // G0 — input guard. Control characters get their own reason: reporting a
  // 39-character question as "too short" is simply false.
  if (isControl(query)) {
    return { ...base, status: 'clarification', reason: 'control_chars', message: copy.control_chars }
  }
  if (query.length < LIMITS.minChars) {
    return { ...base, status: 'clarification', reason: 'too_short', message: copy.too_short }
  }

  // Safety escalation runs before the length cap: a long crisis message must
  // never be answered with "please shorten it". Fixed referral, no cards.
  if (containsMarker(query, CRISIS_MARKERS)) {
    return { ...base, status: 'refused', reason: 'crisis', message: copy.crisis }
  }
  if (query.length > LIMITS.maxChars) {
    return { ...base, status: 'clarification', reason: 'too_long', message: copy.too_long }
  }

  // Requests for commentary get their own fixed copy. Matching is deliberately
  // narrow: "meaning of life" is a topical question, not a tafsir request.
  if (containsMarker(query, TAFSIR_MARKERS)) {
    return { ...base, status: 'refused', reason: 'tafsir', message: copy.tafsir }
  }
  if (containsMarker(query, ['interpret the', 'interpret this', 'interpret quran', 'interpret the quran', 'تفسیر'])) {
    return { ...base, status: 'refused', reason: 'meaning', message: copy.meaning }
  }

  const meta = await loadMeta(db)
  const fiqh = containsMarker(query, FIQH_MARKERS)

  // A user who names a verse has already chosen the scope. A lexical scope
  // model sees only numerals and will refuse "2:255"; never let it override an
  // explicit reference. Retrieval still resolves it and fiqh notices still run.
  const surahRefs = buildSurahRefs(meta.lexicon, meta.surahs)
  const parsedQuery = parseReference(query, surahRefs)
  if (parsedQuery?.kind === 'invalid') {
    // Never fall through to free-text retrieval after recognising a reference:
    // "verse 2:999" would otherwise return unrelated mercy verses as if they
    // answered the named verse.
    return { ...base, status: 'refused', reason: 'out_of_range', message: copy.out_of_range }
  }
  const explicitReference = parsedQuery !== null

  // G1 — scope. The model is trained offline on lexical features and runs as a
  // dot product; no provider is involved. When it is absent, the path falls
  // back to retrieval-only refusal (weaker, never silently wrong).
  if (!explicitReference && scopeModel.version !== 'placeholder' && !inScope(scopeModel, query)) {
    return fiqh
      ? { ...base, status: 'refused', reason: 'fiqh_no_verse', message: copy.fiqh_no_verse }
      : { ...base, status: 'refused', reason: 'off_topic', message: copy.off_topic }
  }

  const hits = await searchD1(db, meta.lexicon, meta.surahs, query, { limit: LIMITS.maxCards })
  const refs = hits.map((h) => h.ref)

  if (!refs.length) {
    return fiqh
      ? { ...base, status: 'refused', reason: 'fiqh_no_verse', message: copy.fiqh_no_verse }
      : { ...base, status: 'refused', reason: 'no_evidence', message: copy.no_evidence }
  }

  const verses = await buildCards(db, meta, refs)
  if (fiqh) {
    return {
      ...base,
      status: 'answered_with_boundary',
      notices: [{ type: 'fiqh_boundary', text: copy.fiqh_boundary }],
      verses,
    }
  }
  return { ...base, status: 'answered', verses }
}