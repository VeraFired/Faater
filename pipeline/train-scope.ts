/**
 * Train the G1 scope classifier offline.
 *
 * Binary logistic regression over lexical unigrams/bigrams. No dependency, no
 * provider call: inference is a dot product in the Worker. The model is tuned
 * for the property ADR-017 requires — high recall on Quran-scope questions —
 * and the threshold is chosen on a calibration split under that constraint,
 * never on the test split.
 *
 * Usage:
 *   node pipeline/train-scope.ts [eval/scope-train.json] [--epochs 300] [--lr 0.2]
 *
 * Output: data/scope-model.json (committed, because the Worker imports it).
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { scopeFeatures, scopeScore, type ScopeModel } from './lib/scope.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dataPath = args.find((a) => !a.startsWith('--')) ?? join(ROOT, 'eval', 'scope-train.json')
const outIdx = args.indexOf('--out')
const outPath = outIdx >= 0 && args[outIdx + 1] ? resolve(args[outIdx + 1]) : join(ROOT, 'data', 'scope-model.json')
const argOf = (name: string, fallback: number): number => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) || fallback : fallback
}
const EPOCHS = argOf('--epochs', 300)
const LR = argOf('--lr', 0.2)
const excludeOod = args.includes('--exclude-ood')
const L2 = 1e-5
const MIN_COUNT = 2
const MAX_FEATURES = 25_000

type Item = { class: string; topic: string; q_en: string; q_fa: string }
type Data = { _meta?: Record<string, unknown>; items: Item[] }

const data = JSON.parse(await readFile(dataPath, 'utf8')) as Data
const CLASSES = ['quran', 'fiqh', 'history', 'other_islamic', 'ood']
// OOD questions are refused by empty retrieval anyway; including them teaches
// the model to separate "everyday" from "Quranic" at the cost of the boundary
// that matters — Quran vs later Islamic material. The product gate trains
// without them and uses retrieval for off-topic questions.
const trainingItems = excludeOod ? data.items.filter((i) => i.class !== 'ood') : data.items

// ---------------------------------------------------------------------------
// Seeded shuffle and group split
// ---------------------------------------------------------------------------

const mulberry32 = (seed: number) => (): number => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const rng = mulberry32(20261031)
const shuffle = <T>(xs: T[]): T[] => {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Group by author topic. Augmented templates share one topic per concept, so
// their paraphrase variants stay in the same split. Original questions are
// grouped by the generator's topic label; audit-dropped near-duplicates are
// removed before training.
const groups = new Map<string, Item[]>()
for (const it of trainingItems) {
  const key = `${it.class}|${it.topic.toLowerCase().trim()}`
  const list = groups.get(key) ?? []
  list.push(it)
  groups.set(key, list)
}

const groupKeys = shuffle([...groups.keys()])
const nTrain = Math.floor(groupKeys.length * 0.7)
const nCal = Math.floor(groupKeys.length * 0.85)
const trainItems = groupKeys.slice(0, nTrain).flatMap((k) => groups.get(k)!)
const calItems = groupKeys.slice(nTrain, nCal).flatMap((k) => groups.get(k)!)
const testItems = groupKeys.slice(nCal).flatMap((k) => groups.get(k)!)

// ---------------------------------------------------------------------------
// Examples and vocabulary
// ---------------------------------------------------------------------------

interface Example {
  p: Array<[number, number]>
  y: 0 | 1
  lang: 'en' | 'fa'
  cls: string
}

const makeTexts = (it: Item): Array<{ text: string; lang: 'en' | 'fa' }> => [
  { text: it.q_en, lang: 'en' },
  { text: it.q_fa, lang: 'fa' },
]

const countFeatures = (items: Item[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const it of items) {
    for (const { text } of makeTexts(it)) {
      for (const feature of scopeFeatures(text).keys()) {
        counts.set(feature, (counts.get(feature) ?? 0) + 1)
      }
    }
  }
  return counts
}

const counts = countFeatures(trainItems)
const vocab = [...counts.entries()]
  .filter(([, c]) => c >= MIN_COUNT)
  .sort((a, b) => b[1] - a[1])
  .slice(0, MAX_FEATURES)
  .map(([f]) => f)
const index: Record<string, number> = {}
vocab.forEach((f, i) => {
  index[f] = i
})

const toExamples = (items: Item[]): Example[] =>
  items.flatMap((it) =>
    makeTexts(it).map(({ text, lang }) => {
      const feats = scopeFeatures(text)
      const p: Array<[number, number]> = []
      for (const [f, c] of feats) {
        const i = index[f]
        if (i !== undefined) p.push([i, c])
      }
      return { p, y: it.class === 'quran' ? 1 : 0, lang, cls: it.class }
    }),
  )

const train = toExamples(trainItems)
const cal = toExamples(calItems)
const test = toExamples(testItems)

// ---------------------------------------------------------------------------
// Logistic regression (sparse SGD)
// ---------------------------------------------------------------------------

const weights = new Float64Array(vocab.length)
let bias = 0

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))
const dot = (p: Array<[number, number]>): number => {
  let z = bias
  for (const [i, c] of p) z += weights[i] * c
  return z
}

const nPos = train.filter((e) => e.y === 1).length
const nGroups = groups.size
const nNeg = train.length - nPos
const wPos = train.length / (2 * nPos)
const wNeg = train.length / (2 * nNeg)

let order = shuffle(train.map((_, i) => i))
for (let epoch = 0; epoch < EPOCHS; epoch++) {
  for (const idx of order) {
    const e = train[idx]
    const p = sigmoid(dot(e.p))
    const grad = (p - e.y) * (e.y === 1 ? wPos : wNeg)
    for (const [i, c] of e.p) {
      weights[i] -= LR * (grad * c + L2 * weights[i])
    }
    bias -= LR * grad
  }
  // Re-shuffle each epoch; a fixed order can oscillate on a small set.
  order = shuffle(order)
}

const predict = (e: Example): number => {
  const z = bias + e.p.reduce((s, [i, c]) => s + weights[i] * c, 0)
  return sigmoid(z)
}

// ---------------------------------------------------------------------------
// Metrics and threshold selection
// ---------------------------------------------------------------------------

const auc = (scores: number[], labels: boolean[]): number => {
  const pairs = scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => a.s - b.s)
  let pos = 0
  let neg = 0
  for (const p of pairs) p.y ? pos++ : neg++
  if (!pos || !neg) return 0.5
  let rank = 0
  let sumPosRanks = 0
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].y) sumPosRanks += i + 1
  }
  rank = sumPosRanks
  return (rank - (pos * (pos + 1)) / 2) / (pos * neg)
}

const evalAt = (examples: Example[], threshold: number) => {
  const quran = examples.filter((e) => e.y === 1)
  const negative = examples.filter((e) => e.y === 0)
  const quranKept = quran.filter((e) => predict(e) >= threshold).length
  const refused = negative.filter((e) => predict(e) < threshold).length
  const perClass: Record<string, number> = {}
  for (const cls of CLASSES.filter((c) => c !== 'quran')) {
    const slice = negative.filter((e) => e.cls === cls)
    perClass[cls] = slice.length ? slice.filter((e) => predict(e) < threshold).length / slice.length : 0
  }
  return {
    quranRecall: quran.length ? quranKept / quran.length : 0,
    quranN: quran.length,
    negativeRefusal: negative.length ? refused / negative.length : 0,
    negativeN: negative.length,
    perClass,
    auc: auc(examples.map((e) => predict(e)), examples.map((e) => e.y === 1)),
  }
}

const candidates = [
  ...Array.from({ length: 20 }, (_, i) => (i + 1) / 2000),
  ...Array.from({ length: 180 }, (_, i) => (i + 11) / 200),
]
let best: { threshold: number; metrics: ReturnType<typeof evalAt> } | null = null
for (const t of candidates) {
  const m = evalAt(cal, t)
  if (m.quranRecall < 0.97) continue
  if (!best || m.negativeRefusal > best.metrics.negativeRefusal) best = { threshold: t, metrics: m }
}
if (!best) {
  // No point meets the constraint. Pick the threshold with the highest
  // Quran recall, then the highest negative refusal at that recall.
  let bestRecall = -1
  for (const t of candidates) {
    const m = evalAt(cal, t)
    if (m.quranRecall > bestRecall + 1e-9) {
      bestRecall = m.quranRecall
      best = { threshold: t, metrics: m }
    } else if (Math.abs(m.quranRecall - bestRecall) < 1e-9 && best && m.negativeRefusal > best.metrics.negativeRefusal) {
      best = { threshold: t, metrics: m }
    }
  }
}

const threshold = best!.threshold
const calMetrics = evalAt(cal, threshold)
const testMetrics = evalAt(test, threshold)

// ---------------------------------------------------------------------------
// External check: the pilot set (authored before this model existed)
// ---------------------------------------------------------------------------

type PilotItem = { lang: 'en' | 'fa'; category: string; q: string; expect: 'answer' | 'refuse' }
type Pilot = { items: PilotItem[] }
const pilot = JSON.parse(await readFile(join(ROOT, 'eval', 'pilot.json'), 'utf8')) as Pilot
const inferenceModel = {
  version: 'tmp',
  threshold,
  bias,
  index,
  weights: [...weights],
  meta: {} as never,
}
const pilotPred = pilot.items.map((it) => ({
  item: it,
  p: scopeScore(inferenceModel, it.q),
}))
const pilotAnswerable = pilotPred.filter((r) => r.item.expect === 'answer')
const pilotRefuse = pilotPred.filter((r) => r.item.expect === 'refuse')
const pilotMetrics = {
  quranRecall: pilotAnswerable.length
    ? pilotAnswerable.filter((r) => r.p >= threshold).length / pilotAnswerable.length
    : 0,
  quranN: pilotAnswerable.length,
  refusalRecall: pilotRefuse.length
    ? pilotRefuse.filter((r) => r.p < threshold).length / pilotRefuse.length
    : 0,
  refusalN: pilotRefuse.length,
  byCategory: Object.fromEntries(
    ['ood', 'unanswerable_indomain', 'adversarial'].map((cat) => {
      const slice = pilotRefuse.filter((r) => r.item.category === cat)
      return [cat, slice.length ? slice.filter((r) => r.p < threshold).length / slice.length : 0]
    }),
  ),
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const model: ScopeModel = {
  version: 'g1-lex-0.1.0',
  threshold,
  bias,
  index,
  weights: [...weights],
  meta: {
    trainedAt: new Date().toISOString(),
    examples: train.length,
    excludeOod,
    positives: nPos,
    features: vocab.length,
    calibration: {
      quranRecall: calMetrics.quranRecall,
      quranN: calMetrics.quranN,
      negativeRefusal: calMetrics.negativeRefusal,
      negativeN: calMetrics.negativeN,
      auc: calMetrics.auc,
    },
    test: {
      quranRecall: testMetrics.quranRecall,
      quranN: testMetrics.quranN,
      negativeRefusal: testMetrics.negativeRefusal,
      negativeN: testMetrics.negativeN,
      auc: testMetrics.auc,
      ...Object.fromEntries(
        Object.entries(testMetrics.perClass).map(([k, v]) => [`refuse_${k}`, v]),
      ),
    },
    pilot: pilotMetrics,
  },
}

await writeFile(outPath, JSON.stringify(model), 'utf8')

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
console.log('Scope model (G1 lexical)')
console.log(`  items        ${data.items.length} in ${nGroups} split groups (${nPos} positive examples)`)
console.log(`  features     ${vocab.length}`)
console.log(`  threshold    ${threshold.toFixed(3)}`)
console.log(`  calibration  Quran recall ${pct(calMetrics.quranRecall)} (n=${calMetrics.quranN}), ` +
  `negative refusal ${pct(calMetrics.negativeRefusal)} (n=${calMetrics.negativeN}), AUC ${calMetrics.auc.toFixed(3)}`)
console.log(`  test         Quran recall ${pct(testMetrics.quranRecall)} (n=${testMetrics.quranN}), ` +
  `negative refusal ${pct(testMetrics.negativeRefusal)} (n=${testMetrics.negativeN}), AUC ${testMetrics.auc.toFixed(3)}`)
console.log(`  per-class refusal (test): ${Object.entries(testMetrics.perClass).map(([k, v]) => `${k} ${pct(v)}`).join(', ')}`)
console.log(`  pilot        Quran recall ${pct(pilotMetrics.quranRecall)} (n=${pilotMetrics.quranN}), ` +
  `refusal recall ${pct(pilotMetrics.refusalRecall)} (n=${pilotMetrics.refusalN})`)
console.log(`  pilot OOD ${pct(pilotMetrics.byCategory.ood)}, in-domain ${pct(pilotMetrics.byCategory.unanswerable_indomain)}, ` +
  `adversarial ${pct(pilotMetrics.byCategory.adversarial)}`)
console.log(`  wrote ${outPath}`)