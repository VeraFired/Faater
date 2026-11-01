/**
 * Query-language policy shared by both retrieval implementations.
 *
 * A Persian question is run through three field queries: Persian, English and
 * Arabic. The Persian and Arabic fields share one script, so the raw Persian
 * tokens also match Arabic verses — and «شراب» in Arabic is the wine of
 * Paradise (6:70, 37:45, 56:18), while the prohibition verse 2:219 uses
 * «الخمر». Those Paradise verses enter the Arabic list at full weight and RRF
 * rewards their extra list membership.
 *
 * The request language is the only reliable signal: «شراب و قمار» is valid
 * Arabic script too, so script detection cannot decide. When the request is
 * Persian and the Persian field covers the question's terms, the Arabic literal
 * list is a fallback, not a peer. If the Persian field is empty — or covers
 * only one of several query terms — Arabic keeps full weight so a Persian
 * question can still reach an Arabic-only match.
 *
 * This is not translation: the query is unchanged. Only one RRF weight moves.
 */

/**
 * RRF weight for the Arabic literal list on a Persian request.
 *
 * A fallback, not a peer: 0.3 is below half of a literal list's 1.0, which is
 * the relationship the original plan registered before any measurement. The
 * v0.1.1 sweep (2026-10-31) is flat on hit@5/direct/paraphrase from 0 through
 * 0.45; MRR at 0.3 is 0.228 against 0.218 at 0.6. The earlier 0.6 value was an
 * artifact of the ungated weight: it had to stay high enough not to push the
 * single-term patience question's gold verse out of the candidate list. The
 * two-group gate removes that collateral, so the pre-registered value stands.
 */
export const FA_QUERY_AR_WEIGHT = 0.3

/**
 * Minimum number of query groups the Persian literal list must cover before
 * the Arabic list is down-weighted for an ambiguous Arabic-script query.
 *
 * The original gate — "the Persian list has any candidate" — is too weak for
 * an Arabic-script query entered in the Persian UI. «الخمر والميسر» is valid
 * Arabic; the Persian list finds «ميسر» in 2:280 (deferment) and a couple of
 * neighbours, so it "has results" while covering one of the two query terms.
 * Down-weighting Arabic then hides 2:219, whose Arabic text uses «الخمر».
 * Requiring two covered groups means the Persian field can answer the
 * question's topic structure before Arabic becomes a fallback. Single-term
 * queries never fire the weight (there is no cross-term signal to trust), and
 * two-term queries where Persian covers only one keep Arabic at full weight.
 * A one-term Persian question can lose its only Arabic-only gold verse when
 * the Persian translation uses a synonym; the patience control caught exactly
 * that, so the structural gate stays.
 */
export const FA_QUERY_AR_MIN_GROUPS = 2

export function arWeightFor(
  language: 'en' | 'fa' | undefined,
  faHasResults: boolean,
  faCoveredGroups: number,
  faQueryArWeight: number = FA_QUERY_AR_WEIGHT,
): number {
  return language === 'fa' &&
    faHasResults &&
    faCoveredGroups >= FA_QUERY_AR_MIN_GROUPS
    ? faQueryArWeight
    : 1
}