/**
 * Scope features shared by training and inference.
 *
 * The model must run inside the Worker with no provider call, so features are
 * lexical: normalized unigrams and bigrams. That is enough to learn domain
 * vocabulary ("rak'ah", "caliph", "hadith", "tafsir") — which is exactly the
 * signal a scope gate needs, and exactly the signal that cannot be derived
 * from a retrieval score (ADR-017).
 */

import { tokenize } from './bm25.ts'
import { normalize, normalizeJoined } from './normalize.ts'
import { foldEnglish } from './stopwords.ts'

export interface ScopeModel {
  version: string
  threshold: number
  bias: number
  /** Feature name -> index into weights. */
  index: Record<string, number>
  weights: number[]
  meta: {
    trainedAt: string
    examples: number
    positives: number
    features: number
    calibration: Record<string, number>
    test: Record<string, number>
    pilot: Record<string, number>
  }
}

const add = (map: Map<string, number>, key: string): void => {
  map.set(key, (map.get(key) ?? 0) + 1)
}

/** Both Persian ZWNJ keys are used, matching the retrieval fields. */
export function scopeFeatures(text: string): Map<string, number> {
  const features = new Map<string, number>()
  const streams = [normalize(foldEnglish(text)), normalizeJoined(text)]
  const seenBigrams = new Set<string>()

  for (const stream of streams) {
    const tokens = tokenize(stream)
    for (let i = 0; i < tokens.length; i++) {
      add(features, `u:${tokens[i]}`)
      if (i + 1 < tokens.length) {
        const bigram = `b:${tokens[i]} ${tokens[i + 1]}`
        // The two streams mostly repeat; count a bigram once per query.
        if (!seenBigrams.has(bigram)) {
          seenBigrams.add(bigram)
          add(features, bigram)
        }
      }
    }
  }
  return features
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

/** P(query is in Quran scope). Unknown features are ignored by design. */
export function scopeScore(model: ScopeModel, text: string): number {
  let z = model.bias
  for (const [feature, count] of scopeFeatures(text)) {
    const i = model.index[feature]
    if (i === undefined) continue
    z += model.weights[i] * count
  }
  return sigmoid(z)
}

export const inScope = (model: ScopeModel, text: string): boolean =>
  scopeScore(model, text) >= model.threshold