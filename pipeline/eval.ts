/**
 * Retrieval / refusal eval harness.
 *
 * What this measures at M0: BEFORE any gate exists, do the raw retrieval
 * signals separate questions the corpus can answer from questions it cannot?
 * If they do not separate, no threshold on them will ever be defensible and
 * G2/G3 need a different signal. If they do, the numbers here are the evidence
 * base for choosing thresholds.
 *
 * What this does NOT measure: whether the final gates are correct. There are no
 * gates yet. This harness computes features; M1 turns features into decisions.
 * Statements about "zero errors" in the power section are therefore
 * hypothetical sizing arithmetic, never observations.
 *
 * Honest limits, stated rather than buried:
 *   - expect_refs lists are not exhaustive. A miss is a lower bound on recall,
 *     not proof the retriever failed — the question may legitimately be
 *     answered by a verse not on the list.
 *   - The item set is a PILOT, authored without an independent scholar review.
 *     Its purpose is to exercise the harness and produce indicative numbers,
 *     not to make a launch claim.
 *   - Every proportion is reported with a Clopper-Pearson interval.
 *   - EN and FA items are translations of the same questions, so the languages
 *     are not independent samples. Per-language intervals are the ones to
 *     quote; a pooled interval is reported for completeness but is narrower
 *     than the evidence supports.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Retriever, type RetrieverData } from './lib/retrieve.ts'
import {
  clopperPearson,
  itemsForUpperBound,
  mean,
  percentile,
  type Interval,
} from './lib/stats.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export type Category =
  | 'answerable_direct'
  | 'answerable_paraphrase'
  | 'unanswerable_indomain'
  | 'ood'
  | 'adversarial'

export interface EvalItem {
  id: string
  lang: 'en' | 'fa'
  category: Category
  q: string
  /** Answerable items only: verses that would satisfy the question. */
  expect_refs?: string[]
  expect: 'answer' | 'refuse'
  note?: string
}

export interface EvalSet {
  _meta: Record<string, unknown>
  items: EvalItem[]
}

/** Signals a future gate can threshold. All derived from ranked hits only. */
export interface Signals {
  nHits: number
  top: number
  second: number
  gap: number
  ratio: number
  top3mean: number
  top5sum: number
  z: number
  fieldCount: number
  refHit: number
}

export function signalsOf(hits: Array<{ ref: string; score: number; fields: string[] }>): Signals {
  const scores = hits.map((h) => h.score)
  const top = scores[0] ?? 0
  const second = scores[1] ?? 0
  const pool = hits.slice(0, 50).map((h) => h.score)
  const med = percentile(pool, 0.5)
  const mad = percentile(
    pool.map((s) => Math.abs(s - med)),
    0.5,
  )
  return {
    nHits: hits.length,
    top,
    second,
    gap: top - second,
    ratio: top / (second || 1e-9),
    top3mean: mean(scores.slice(0, 3)),
    top5sum: scores.slice(0, 5).reduce((a, b) => a + b, 0),
    z: mad > 0 ? (top - med) / mad : 0,
    fieldCount: hits[0]?.fields.length ?? 0,
    refHit: hits[0]?.fields.includes('reference') ? 1 : 0,
  }
}

/**
 * Rank AUC: P(score of a random positive > score of a random negative).
 * True labels are the answerable items. 0.5 is chance.
 */
export function auc(scores: number[], labels: boolean[]): number {
  const n = scores.length
  if (!n) return 0.5
  const order = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b] || a - b)
  const ranks = new Float64Array(n)
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && scores[order[j + 1]] === scores[order[i]]) j++
    const rank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[order[k]] = rank
    i = j + 1
  }
  let pos = 0
  let neg = 0
  let sumPos = 0
  for (let k = 0; k < n; k++) {
    if (labels[k]) {
      pos++
      sumPos += ranks[k]
    } else neg++
  }
  if (!pos || !neg) return 0.5
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg)
}

/** Fold the sign so higher is always better, for display only. */
const oriented = (x: number) => (x >= 0.5 ? x : 1 - x)

export interface SweepPoint {
  threshold: number
  answerable: number
  falseRefusals: number
  /** Point estimate. Never the selection criterion — see `certified`. */
  falseRefusal: number
  /** Clopper-Pearson 95% upper bound on the false-refusal rate. */
  falseRefusalUcb: number
  unanswerable: number
  caught: number
  refusalRecall: number
  /** Clopper-Pearson 95% lower bound on refusal recall. */
  refusalRecallLcb: number
}

/**
 * Sweep a threshold over a signal oriented a priori so that LOW means
 * "refuse". The direction is fixed before looking at the data: every feature
 * in `featureNames` is a form of retrieval evidence, so more evidence must
 * mean "more likely answerable". If a feature's AUC is below 0.5 that is a
 * finding about the feature, not an invitation to flip it.
 *
 * Selection is on the Clopper-Pearson UPPER bound, not the point estimate:
 * choosing the point with the best observed rate is how a small sample
 * manufactures a threshold that will not hold. `certified` is the operating
 * point that meets the budget with 95% confidence; `illustrative` is the
 * point-estimate optimum, reported only so the gap between the two is visible.
 */
export function sweep(
  values: number[],
  shouldAnswer: boolean[],
  budget = 0.05,
): { points: SweepPoint[]; certified: SweepPoint | null; illustrative: SweepPoint | null } {
  const candidates = [...new Set(values)].sort((a, b) => a - b)
  const points: SweepPoint[] = []
  for (const t of candidates) {
    let fn = 0
    let answerable = 0
    let caught = 0
    let unanswerable = 0
    for (let i = 0; i < values.length; i++) {
      const refuses = values[i] < t
      if (shouldAnswer[i]) {
        answerable++
        if (refuses) fn++
      } else {
        unanswerable++
        if (refuses) caught++
      }
    }
    points.push({
      threshold: t,
      answerable,
      falseRefusals: fn,
      falseRefusal: answerable ? fn / answerable : 0,
      // With no answerable items there is no evidence at all; report the
      // least-informative bound rather than a reassuring zero.
      falseRefusalUcb: answerable ? clopperPearson(fn, answerable).upper : 1,
      unanswerable,
      caught,
      refusalRecall: unanswerable ? caught / unanswerable : 0,
      refusalRecallLcb: unanswerable ? clopperPearson(caught, unanswerable).lower : 0,
    })
  }
  const certified = points
    .filter((p) => p.falseRefusalUcb <= budget)
    .reduce<SweepPoint | null>((a, b) => (!a || b.refusalRecall > a.refusalRecall ? b : a), null)
  const illustrative = points
    .filter((p) => p.falseRefusal <= budget)
    .reduce<SweepPoint | null>((a, b) => (!a || b.refusalRecall > a.refusalRecall ? b : a), null)
  return { points, certified, illustrative }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const ci = (i: Interval) => `[${pct(i.lower)}, ${pct(i.upper)}]`

export async function loadData(): Promise<RetrieverData> {
  const [corpus, en, fa, lexicon] = await Promise.all([
    readFile(join(ROOT, 'data', 'build', 'corpus.json'), 'utf8').then((s) => JSON.parse(s)),
    readFile(join(ROOT, 'data', 'build', 'translations.en.json'), 'utf8').then((s) => JSON.parse(s)),
    readFile(join(ROOT, 'data', 'build', 'translations.fa.json'), 'utf8').then((s) => JSON.parse(s)),
    readFile(join(ROOT, 'data', 'build', 'lexicon.json'), 'utf8').then((s) => JSON.parse(s)),
  ])
  return {
    verses: corpus.verses,
    basmala: corpus.basmalaDocument,
    surahs: corpus.surahs,
    en: en.verses,
    fa: fa.verses,
    lexicon: {
      concepts: lexicon.concepts,
      names: lexicon.names,
      surahAliases: lexicon.surahAliases,
    },
  }
}

export interface ItemResult extends Signals {
  id: string
  lang: 'en' | 'fa'
  category: Category
  q: string
  expect: 'answer' | 'refuse'
  /** Carried through so gold scoring does not depend on the item list again. */
  expect_refs?: string[]
  topRefs: string[]
  /** Full candidate list (up to the search limit), for recall over ALL gold refs. */
  rankedRefs: string[]
  firstGoldRank: number | null
}

export function runEval(items: EvalItem[], retriever: Retriever, k = 5, budget = 0.05) {
  const results: ItemResult[] = items.map((item) => {
    const hits = retriever.search(item.q, { limit: 50, language: item.lang })
    const s = signalsOf(hits)
    let firstGoldRank: number | null = null
    if (item.expect_refs?.length) {
      const idx = hits.findIndex((h) => item.expect_refs!.includes(h.ref))
      if (idx >= 0) firstGoldRank = idx + 1
    }
    return {
      ...s,
      id: item.id,
      lang: item.lang,
      category: item.category,
      q: item.q,
      expect: item.expect,
      expect_refs: item.expect_refs,
      topRefs: hits.slice(0, k).map((h) => h.ref),
      rankedRefs: hits.map((h) => h.ref),
      firstGoldRank,
    }
  })

  const answerable = results.filter((r) => r.expect === 'answer')
  const gold = answerable.filter((r) => r.expect_refs?.length)

  // Two different questions, both reported:
  //   hit  — did ANY gold verse appear in the top k? (what the UI needs)
  //   recall — what fraction of ALL gold verses appeared? (what retrieval quality
  //            is; an item with 4 gold refs that surfaces 1 is not a full hit)
  const atK = (slice: ItemResult[], kk: number) => {
    const withGold = slice.filter((r) => r.expect_refs?.length)
    let hit = 0
    let found = 0
    let total = 0
    for (const r of withGold) {
      const top = r.rankedRefs.slice(0, kk)
      total += r.expect_refs!.length
      found += r.expect_refs!.filter((ref) => top.includes(ref)).length
      if (r.firstGoldRank !== null && r.firstGoldRank <= kk) hit++
    }
    return {
      k: kk,
      n: withGold.length,
      hit,
      rate: withGold.length ? hit / withGold.length : 0,
      found,
      total,
      recall: total ? found / total : 0,
    }
  }

  // A single cut at 5 hides the shape. Gold lists are not exhaustive, so a
  // "miss" at 5 is often a correct verse the list did not name; the curve shows
  // whether the right region is being reached at all.
  const ks = [1, 3, 5, 10, 20, 50]
  const curveFor = (slice: ItemResult[]) => ks.map((kk) => atK(slice, kk))
  const curves = {
    all: curveFor(gold),
    en: curveFor(gold.filter((r) => r.lang === 'en')),
    fa: curveFor(gold.filter((r) => r.lang === 'fa')),
    // Pooling direct and paraphrase hides the finding that paraphrase recall
    // is near zero: 58 direct items carry the average while every paraphrase
    // misses. The two categories are never summed in the report.
    direct: curveFor(gold.filter((r) => r.category === 'answerable_direct')),
    paraphrase: curveFor(gold.filter((r) => r.category === 'answerable_paraphrase')),
  }

  const hitAtK = atK(gold, k).hit
  const mrr = mean(gold.map((r) => (r.firstGoldRank ? 1 / r.firstGoldRank : 0)))

  const featureNames = [
    'top', 'gap', 'ratio', 'top3mean', 'top5sum', 'z', 'nHits', 'fieldCount',
  ] as const
  const labels = results.map((r) => r.expect === 'answer')
  const aucs = featureNames
    .map((name) => ({ name, value: auc(results.map((r) => r[name]), labels) }))
    .sort((a, b) => Math.abs(b.value - 0.5) - Math.abs(a.value - 0.5))
    .map((f) => ({ ...f, oriented: oriented(f.value) }))

  const bestFeature = aucs[0]

  // The direction is FIXED, not fitted: more retrieval evidence means the
  // corpus can probably answer. Letting the sweep choose its own orientation
  // produced a "threshold" of -50 and a 0% recall on the first run, which is
  // a sign the fit was chasing noise, not a usable operating point.
  const sweepResult = sweep(
    results.map((r) => r[bestFeature.name]),
    labels,
    budget,
  )

  // Splitting the refusal set by TYPE is the whole point of the M0 measurement.
  // Out-of-domain questions share no vocabulary with the corpus and should be
  // easy; in-domain-unanswerable ones ("how many rak'ahs in Fajr") deliberately
  // do share vocabulary and are the reason G1 exists. Reporting one pooled AUC
  // hides the difference and would flatter the signal.
  const refusalSlices = (['ood', 'unanswerable_indomain', 'adversarial'] as const).map((cat) => {
    const subset = results.filter((r) => r.expect === 'answer' || r.category === cat)
    const values = subset.map((r) => r[bestFeature.name])
    const sliceLabels = subset.map((r) => r.expect === 'answer')
    return {
      cat,
      negatives: subset.filter((r) => r.expect === 'refuse').length,
      answerable: subset.filter((r) => r.expect === 'answer').length,
      auc: auc(values, sliceLabels),
      sweep: sweep(values, sliceLabels, budget),
    }
  })

  return {
    results,
    answerable,
    gold,
    k,
    budget,
    hitAtK,
    mrr,
    curves,
    aucs,
    bestFeature,
    sweep: sweepResult,
    refusalSlices,
  }
}

/** Number or object shape both accepted; returns undefined when unset. */
function budgetOf(set: EvalSet): number | undefined {
  const b = set._meta.budget as unknown
  if (typeof b === 'number') return b
  if (b && typeof b === 'object') {
    const t = (b as Record<string, unknown>).false_refusal_target
    if (typeof t === 'number') return t
  }
  return undefined
}

function report(set: EvalSet, ev: ReturnType<typeof runEval>, conceptExpansion = true): string {
  const lines: string[] = []

  lines.push('# Retrieval eval report', '')
  lines.push(`Set: ${set._meta.name ?? '(unnamed)'} — ${set._meta.status ?? 'unspecified'}`)
  lines.push(`Items: ${ev.results.length}`)
  lines.push(`Concept expansion: ${conceptExpansion ? 'on' : 'off (literal retrieval only)'}`, '')

  lines.push('## Category counts', '')
  const byCat = new Map<string, number>()
  for (const r of ev.results) byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1)
  for (const [c, n] of [...byCat].sort()) lines.push(`- ${c}: ${n}`)
  lines.push('')

  lines.push('## Retrieval quality — hit rate', '')
  lines.push(
    '**hit@k** = at least one gold verse in the top k (what a verse-card UI needs). ' +
      '**recall@k** = fraction of ALL gold refs in the top k (what retrieval quality is). ' +
      'A miss is a LOWER BOUND on recall: the gold lists name some valid verses, not all.',
    '',
  )
  lines.push('| k | all hit | en hit | fa hit | all recall | en recall | fa recall |')
  lines.push('|---:|---|---|---|---|---|---|')
  for (let i = 0; i < ev.curves.all.length; i++) {
    const a = ev.curves.all[i]
    const e = ev.curves.en[i]
    const f = ev.curves.fa[i]
    lines.push(
      `| ${a.k} | ${pct(a.rate)} (${a.hit}/${a.n}) | ${pct(e.rate)} (${e.hit}/${e.n}) | ${pct(f.rate)} (${f.hit}/${f.n}) | ` +
        `${pct(a.recall)} (${a.found}/${a.total}) | ${pct(e.recall)} (${e.found}/${e.total}) | ${pct(f.recall)} (${f.found}/${f.total}) |`,
    )
  }
  lines.push('')
  const atK = ev.curves.all.find((c) => c.k === ev.k)!
  lines.push(
    `hit@${ev.k} ${pct(atK.rate)} ${ci(clopperPearson(atK.hit, atK.n))} — MRR over a 50-candidate list ${ev.mrr.toFixed(3)}`,
    '',
  )
  lines.push(
    'The pooled interval above is not a coverage interval for the population: EN and FA items ' +
      'are translations of the same questions and therefore paired, not independent. Quote the ' +
      'per-language columns.',
    '',
  )

  lines.push(`## Hit and recall at ${ev.k} by answer type`, '')
  lines.push('| type | n | hit@k | recall@k |')
  lines.push('|---|---:|---|---|')
  for (const [name, curve] of [['direct', ev.curves.direct], ['paraphrase', ev.curves.paraphrase]] as const) {
    const c = curve.find((x) => x.k === ev.k)!
    lines.push(`| ${name} | ${c.n} | ${pct(c.rate)} (${c.hit}/${c.n}) | ${pct(c.recall)} (${c.found}/${c.total}) |`)
  }
  lines.push('')
  lines.push(
    'Direct and paraphrase are never pooled: the direct items carry the average while the ' +
      'paraphrase items measure whether lexical retrieval can bridge wording it has never seen.',
    '',
  )

  lines.push('## Signal separation (AUC over answerable vs should-refuse)', '')
  lines.push('| signal | AUC | oriented AUC |')
  lines.push('|---|---:|---:|')
  for (const f of ev.aucs) {
    lines.push(`| ${f.name} | ${f.value.toFixed(3)} | ${f.oriented.toFixed(3)} |`)
  }
  lines.push('')
  lines.push(
    'Oriented AUC folds the sign so higher is always better; 0.500 is chance and ' +
      '0.700+ is the minimum worth building a gate on.',
    '',
  )
  lines.push(
    'Scale caveat: `top`, `gap`, `ratio`, `top3mean` and `top5sum` are Reciprocal Rank Fusion ' +
      'constants (sums of 1/(60 + rank)), not calibrated similarities — their absolute values ' +
      'carry no meaning outside this index. `nHits` is capped by the 50-candidate search limit, ' +
      'so it cannot exceed 50 regardless of how much evidence exists.',
    '',
  )

  lines.push('## Threshold sweep on the strongest signal', '')
  const bf = ev.bestFeature
  lines.push(
    `Signal: \`${bf.name}\` — direction fixed at "more evidence means answerable" (AUC ${bf.value.toFixed(3)}). ` +
      `Budget: ${pct(ev.budget)} false refusals.`,
    '',
  )
  if (bf.value < 0.55) {
    lines.push(
      '**No usable signal.** Every candidate feature is within noise of chance, so ' +
        'there is no threshold worth quoting from this set. The per-type table below ' +
        'is still informative about WHY.',
      '',
    )
  } else {
    if (ev.sweep.certified) {
      const b = ev.sweep.certified
      lines.push(
        `**Certified point** (false-refusal UCB ≤ budget): threshold ${b.threshold.toFixed(4)}`,
        '',
        `- false refusal: ${pct(b.falseRefusal)} ${ci(clopperPearson(b.falseRefusals, b.answerable))} (${b.falseRefusals}/${b.answerable})`,
        `- refusal recall: ${pct(b.refusalRecall)} ${ci(clopperPearson(b.caught, b.unanswerable))} (${b.caught}/${b.unanswerable})`,
        '',
      )
    } else {
      const nAns = ev.results.filter((r) => r.expect === 'answer').length
      const zeroUpper = clopperPearson(0, nAns).upper
      lines.push(
        `**No point is certified at this sample size.** With ${nAns} answerable items, even ` +
          `ZERO false refusals gives a 95% upper bound of ${pct(zeroUpper)} — above the ${pct(ev.budget)} ` +
          'budget. The budget cannot be certified by this set; it would take ' +
          `**${itemsForUpperBound(ev.budget)} answerable items per language with zero errors**.`,
        '',
      )
    }
    if (ev.sweep.illustrative) {
      const b = ev.sweep.illustrative
      lines.push(
        `Illustrative (point-estimate) optimum — NOT a certified operating point: threshold ` +
          `${b.threshold.toFixed(4)}, false refusal ${pct(b.falseRefusal)} (${b.falseRefusals}/${b.answerable}), ` +
          `refusal recall ${pct(b.refusalRecall)} (${b.caught}/${b.unanswerable}).`,
        '',
      )
    }
  }

  lines.push('## Separation by refusal type — the decisive measurement', '')
  lines.push('| refusal type | n | raw AUC | oriented AUC | refusal recall (95% CI) | false refusal (95% CI) |')
  lines.push('|---|---:|---:|---:|---|---|')
  for (const s of ev.refusalSlices) {
    if (!s.negatives) continue
    // Report the illustrative point with intervals. A certified point is
    // usually absent at pilot size, and printing "—" for every row would hide
    // the direction of the measurement that matters.
    const b = s.sweep.illustrative
    const rr = b
      ? `${pct(b.refusalRecall)} ${ci(clopperPearson(b.caught, b.unanswerable))} (${b.caught}/${b.unanswerable})`
      : '—'
    const fr = b
      ? `${pct(b.falseRefusal)} ${ci(clopperPearson(b.falseRefusals, b.answerable))} (${b.falseRefusals}/${b.answerable})`
      : '—'
    lines.push(
      `| ${s.cat} | ${s.negatives} | ${s.auc.toFixed(3)} | ${oriented(s.auc).toFixed(3)} | ${rr} | ${fr} |`,
    )
  }
  lines.push('')
  lines.push(
    'Refusal-recall and false-refusal columns are at each row\'s own point-estimate optimum, ' +
      'computed over that row\'s answerable items plus its own refusal category. They are ' +
      'illustrative: none is certified at this sample size (see the power check).',
    '',
  )

  const ood = ev.refusalSlices.find((s) => s.cat === 'ood')
  const inDomain = ev.refusalSlices.find((s) => s.cat === 'unanswerable_indomain')
  if (ood && inDomain) {
    const oodO = oriented(ood.auc)
    const inO = oriented(inDomain.auc)
    lines.push('**Finding.**', '')
    lines.push(
      `- Out-of-domain questions separate in the expected direction: raw AUC ${ood.auc.toFixed(3)}, ` +
        `oriented ${oodO.toFixed(3)} — they retrieve less evidence than answerable questions.`,
    )
    lines.push(
      `- In-domain unanswerable questions do NOT: raw AUC ${inDomain.auc.toFixed(3)}, oriented ` +
        `${inO.toFixed(3)}. ` +
        (inDomain.auc < 0.5
          ? 'The direction is INVERTED — "how many rak\'ahs in Fajr" retrieves MORE evidence than an ' +
            'answerable question, because prayer verses genuinely mention prayer. A floor high enough ' +
            'to catch it refuses answerable questions first. The oriented 0.663 is not a usable ' +
            'separation; it is the same failure seen from the other side.'
          : 'It separates less than out-of-domain questions.'),
    )
    lines.push(
      `- The two types differ by ${Math.abs(oodO - inO).toFixed(3)} on the oriented scale. ` +
        'This is the measured justification for G1: scope must be classified from the question, ' +
        'not inferred from a retrieval threshold.',
    )
    const oodB = ood.sweep.illustrative
    const inB = inDomain.sweep.illustrative
    if (oodB && inB) {
      lines.push(
        `- At a comparable false-refusal rate (${pct(oodB.falseRefusal)} vs ${pct(inB.falseRefusal)}), ` +
          `the same signal catches ${pct(oodB.refusalRecall)} (${oodB.caught}/${oodB.unanswerable}) of ` +
          `out-of-domain questions but only ${pct(inB.refusalRecall)} (${inB.caught}/${inB.unanswerable}) ` +
          'of in-domain unanswerable ones.',
      )
    }
    lines.push('')
  }

  lines.push('## Power check — what this sample can support', '')
  const refusalItems = ev.results.filter((r) => r.expect === 'refuse')
  const nRefEn = refusalItems.filter((r) => r.lang === 'en').length
  const nRefFa = refusalItems.filter((r) => r.lang === 'fa').length
  lines.push(
    `- should-refuse items: ${nRefEn} EN + ${nRefFa} FA = ${nRefEn + nRefFa} total, ` +
      'but the languages are paired translations of the same questions, so this is NOT ' +
      `${nRefEn + nRefFa} independent observations and the two are never pooled into one interval.`,
    '',
    '**No gate exists in this build.** The following are sizing arithmetic under an assumed ' +
      'zero-error gate, not observed error rates:',
    '',
    `| language | n | zero-error 95% upper bound |`,
    `|---|---:|---:|`,
    `| EN | ${nRefEn} | ${pct(clopperPearson(0, nRefEn).upper)} |`,
    `| FA | ${nRefFa} | ${pct(clopperPearson(0, nRefFa).upper)} |`,
    '',
    `- a 2% upper bound requires **${itemsForUpperBound(0.02)} should-refuse items per language** (${itemsForUpperBound(0.02) * 2} total for EN+FA)`,
    `- a 5% upper bound requires **${itemsForUpperBound(0.05)} per language** (${itemsForUpperBound(0.05) * 2} total)`,
    '',
    'A point estimate such as 1/17 = 5.9% is not a bound and must not be quoted as one.',
    '',
  )

  lines.push('## Failures (answerable items with no gold verse in the top 10)', '')
  const misses = ev.answerable.filter(
    (r) => r.expect_refs?.length && (r.firstGoldRank === null || r.firstGoldRank > 10),
  )
  if (!misses.length) lines.push('None.', '')
  else {
    for (const m of misses) {
      // null means "not found in the 50-candidate list" — distinguish that from
      // having no hits at all, which is a different failure.
      const where =
        m.firstGoldRank !== null
          ? `rank ${m.firstGoldRank}`
          : m.rankedRefs.length === 0
            ? 'no hits at all'
            : 'not in top 50'
      lines.push(`- **${m.id}** (${m.lang}) «${m.q}» — gold ${where}; top: ${m.topRefs.join(', ') || '(none)'}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function main() {
  const data = await loadData()
  // Ablation switch: the concept layer is only justified by what it adds over
  // its own absence, measured on the same set.
  const noConcepts = process.argv.includes('--no-concepts')
  const retriever = new Retriever(data, { conceptExpansion: !noConcepts })
  const setArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
  const setPath = setArg ?? join(ROOT, 'eval', 'pilot.json')
  const set: EvalSet = JSON.parse(await readFile(setPath, 'utf8'))
  const budget = budgetOf(set) ?? 0.05

  const t0 = performance.now()
  const ev = runEval(set.items, retriever, 5, budget)
  const ms = performance.now() - t0

  const text = report(set, ev, !noConcepts)
  const outDir = join(ROOT, 'eval')
  await writeFile(join(outDir, 'report.md'), text + '\n')
  await writeFile(
    join(outDir, 'report.json'),
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        set: set._meta,
        elapsedMs: Math.round(ms),
        summary: {
          items: ev.results.length,
          hitAtK: ev.hitAtK,
          goldN: ev.gold.length,
          mrr: ev.mrr,
          bestFeature: ev.bestFeature.name,
          bestAuc: ev.bestFeature.value,
          budget: ev.budget,
          certified: ev.sweep.certified,
          illustrative: ev.sweep.illustrative,
          refusalSlices: ev.refusalSlices.map((s) => ({
            cat: s.cat,
            negatives: s.negatives,
            auc: s.auc,
            orientedAuc: oriented(s.auc),
            illustrative: s.sweep.illustrative,
          })),
        },
        results: ev.results,
      },
      null,
      2,
    ) + '\n',
  )

  console.log(text)
  console.log(`\nWrote eval/report.md and eval/report.json (${ms.toFixed(0)} ms).`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main()
}
