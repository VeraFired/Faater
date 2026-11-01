/**
 * Cross-field query-term coverage.
 *
 * A verse can match the query in several languages at once. 2:219 matches both
 * «شراب» and «قمار» in the Persian translation; a Paradise verse matches only
 * «شراب». Before this module, RRF saw one list position per field and could not
 * tell those apart, so a verse present in Arabic + Persian + a concept list
 * outranked the verse that covered the WHOLE question.
 *
 * The plan groups the user's term with its index variants (ZWNJ forms, light
 * stems), then coverage counts how many query groups a fused candidate matched
 * across the literal fields. Only groups that matched at least one candidate
 * are eligible, so a dead or common term cannot inflate the denominator.
 *
 * The rerank rewards FULL coverage only: a verse matching every eligible query
 * group. Partial coverage is exactly what a generic-word coincidence looks
 * like — «درباره نحوه سخن گفتن با مردم راهنمایی وجود دارد؟» shares «مردم»,
 * «وجود» and «دارد» with 2:219, and an earlier partial-coverage multiplier
 * lifted that unrelated verse to rank 1. Requiring every eligible group makes
 * the bonus mean "this verse contains the whole question", which is the
 * property RRF cannot see.
 *
 * Scope is deliberately narrow: coverage is a tie-break among candidates that
 * literal retrieval already found. It never creates a candidate, never counts
 * concept or (later) subject lists, and is a no-op for a one-term question.
 */

import { tokenize } from './bm25.ts'
import { normalize, normalizeJoined } from './normalize.ts'
import { arabicStem, arabicVariants, englishVariants } from './stem.ts'
import {
  FRAME_TERMS,
  STOPWORDS_EN,
  STOPWORDS_FA,
  foldEnglish,
} from './stopwords.ts'

export interface QueryGroup {
  /** Every index term that means the same query word. */
  variants: string[]
}

export interface CoveragePlan {
  groups: QueryGroup[]
}

const isStop = (token: string): boolean =>
  STOPWORDS_EN.has(token) || STOPWORDS_FA.has(token) || FRAME_TERMS.has(token)

/**
 * Tokens that are grammatical glue, not topics, but are not in the global
 * stopword sets because those sets serve the search fields too.
 *
 * «هاي» is the Persian plural suffix split out of a ZWNJ word: «میوه‌های» is
 * one query word, and its root «میوه» is the topic; «هاي» is not. «al» is the
 * Arabic article left behind when a hyphenated transliteration such as
 * "Al-Quran" is split. Counting either as an independent group lets a verse
 * that matches the fragment look as if it covered the whole word.
 *
 * Persian light verbs are the same kind of glue. «یاد کردن» is one topic
 * ("remembrance") whose verb is not evidence: without this, coverage boosted
 * 12:42 — the narrative that literally contains «ياد كردن از يوسف» — over
 * 13:28, the verse about remembrance of God. The forms are normalized (Arabic
 * kaf/yeh), because normalize() runs before this set is consulted.
 */
const COVERAGE_FRAGMENTS: ReadonlySet<string> = new Set([
  'al',
  'ها',
  'هاي',
  'كردن',
  'كرد',
  'كن',
  'كند',
  'كنم',
  'كنيد',
  'كنند',
  'ميكنم',
  'ميكنيد',
  'ميكنند',
])

const hasLatin = (token: string): boolean => /[a-z]/.test(token)

/**
 * Variants that may participate in coverage.
 *
 * `arabicVariants` is deliberately broad because it feeds exact search: a
 * single-letter prefix strip turns «بهشت» into «هشت» ("eight") and «بنده» into
 * «نده». That is tolerable as an extra index term, but not as evidence that a
 * document covered «بهشت». Keep the exact form, and only allow the stem when
 * it is not merely the token with its first letter removed (or when the token
 * is long enough that such a strip is unlikely to be lexical).
 */
const coverageVariantsOf = (token: string): string[] => {
  const stem = hasLatin(token) ? undefined : arabicStem(token)
  return variantsOf(token).filter((v) => {
    if (isStop(v) || COVERAGE_FRAGMENTS.has(v)) return false
    if (
      stem !== undefined &&
      v === stem &&
      v !== token &&
      token.length < 6 &&
      token.slice(1) === v
    ) {
      return false
    }
    return true
  })
}

/**
 * Split the raw question into word-like units. Whitespace alone is not enough:
 * "wine/gambling" and "wine-gambling" are two topics, and treating them as one
 * unit makes coverage a no-op (its group count is one). ZWNJ is deliberately
 * NOT in this class: a Persian ZWNJ word is one word whose split and joined
 * forms must stay together.
 */
const RAW_SEPARATORS = /[\s/\\|,;،؛:.!?؟…\-–—_()\[\]{}"“”«»&+]+/u

const variantsOf = (token: string): string[] =>
  /[a-z]/.test(token) ? englishVariants(token) : arabicVariants(token)

/**
 * Build query groups from the raw question.
 *
 * The raw question is split on word separators BEFORE normalization because a
 * ZWNJ word is one word to the user but two tokens after normalize(). Its split
 * and joined forms must land in the SAME group; putting them in separate groups
 * would double the denominator and make it impossible for any document to be
 * fully covered. Punctuation separates topics for the same reason: "wine
 * gambling" and "wine-gambling" are one query with two groups.
 *
 * Groups that share an index variant are merged: «fasting fast» and
 * «wine wines» describe one term, not two.
 */
export function buildCoveragePlan(query: string): CoveragePlan {
  const rawGroups: Set<string>[] = []

  for (const raw of query.split(RAW_SEPARATORS)) {
    if (!raw) continue
    // Every normalization form the field queries can contain. foldEnglish is a
    // no-op for Arabic script, but including it keeps this in step with the
    // English field query.
    const forms = new Set([
      normalize(raw),
      normalizeJoined(raw),
      normalize(foldEnglish(raw)),
    ])
    const variants = new Set<string>()
    for (const form of forms) {
      for (const token of tokenize(form)) {
        if (isStop(token)) continue
        // A lexical variant can be a stopword or frame term even when its
        // source token is not: "Quran's" expands to "quran", "beings" expands
        // to "being". Filter AFTER expansion, or the frame term re-enters the
        // coverage denominator through the back door. coverageVariantsOf also
        // removes the generic fragments and short prefix stems that would
        // otherwise let a coincidental suffix count as the whole word.
        for (const v of coverageVariantsOf(token)) variants.add(v)
      }
    }
    if (variants.size) rawGroups.push(variants)
  }

  return { groups: mergeOverlapping(rawGroups).map((variants) => ({ variants })) }
}

/**
 * Union groups whose variant sets intersect.
 *
 * A one-pass merge is not enough: merging A with B can make the result
 * intersect C, which was already checked. Union-find over variant ownership
 * converges in one pass without rescanning.
 */
function mergeOverlapping(groups: Set<string>[]): string[][] {
  const parent = groups.map((_, i) => i)
  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root]
    while (parent[i] !== root) {
      const next = parent[i]
      parent[i] = root
      i = next
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  const owner = new Map<string, number>()
  for (let i = 0; i < groups.length; i++) {
    for (const variant of groups[i]) {
      const previous = owner.get(variant)
      if (previous === undefined) owner.set(variant, i)
      else union(i, previous)
    }
  }

  const merged = new Map<number, Set<string>>()
  for (let i = 0; i < groups.length; i++) {
    const root = find(i)
    const target = merged.get(root) ?? new Set<string>()
    for (const variant of groups[i]) target.add(variant)
    merged.set(root, target)
  }
  return [...merged.values()].map((set) => [...set])
}

export interface Coverage {
  /** Query groups that matched at least one literal candidate. */
  eligible: number
  /** Of those, groups this document matched. */
  covered: number
  /** covered / eligible; 0 when nothing is eligible. */
  ratio: number
}

const EMPTY = new Set<string>()

/**
 * Coverage of one document.
 *
 * `matchedAcrossCandidates` is the union over every literal list; it decides
 * which query groups are eligible at all. `matchedByDoc` is this document's own
 * matched terms. A group that is ineligible globally cannot be covered here,
 * so `covered <= eligible` by construction.
 */
export function coverageOf(
  plan: CoveragePlan,
  matchedAcrossCandidates: ReadonlySet<string>,
  matchedByDoc: ReadonlySet<string> = EMPTY,
): Coverage {
  let eligible = 0
  let covered = 0
  for (const group of plan.groups) {
    if (!group.variants.some((v) => matchedAcrossCandidates.has(v))) continue
    eligible++
    if (group.variants.some((v) => matchedByDoc.has(v))) covered++
  }
  return { eligible, covered, ratio: eligible ? covered / eligible : 0 }
}