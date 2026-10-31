# G1 scope classifier — attempt, measurements, and hold

Status: **NOT WIRED. The shipped Worker still bundles a placeholder model and
performs no scope refusal.** The candidate below misses the pre-registered
Quran-recall target on an independent holdout, so wiring it would trade one
failure (answering in-domain unanswerable questions) for another (refusing
valid Quran questions), without meeting the 5% false-refusal budget.

## Why a lexical model at all

The zero-cost rule forbids a request-time embedding call. G1 therefore has to
run inside the Worker as a dot product over a model trained offline. Features
are normalized unigrams and bigrams in English and Persian, including both
ZWNJ forms; inference is a sparse dot product plus sigmoid.

## Data

- 750 generated bilingual questions across five classes (Quran, fiqh, history,
  other Islamic, out-of-domain), from a 15-agent generation workflow.
- Three audit passes applied (124 issues: 116 near-duplicate drops, 4
  relabels, 2 sensitive drops, 2 unfixed notes). The third pass was a
  replacement for a batch that failed to return.
- 11 Persian corrections applied.
- 594 template-controlled questions added: concept-label templates for Quran
  positives, and the same surface frames used as hard negatives for fiqh,
  history and other-Islamic topics. This was necessary because the generator
  produced almost no elliptical Persian questions.
- Final training set: 1,225 items (514 Quran, 201 fiqh, 178 history, 178 other
  Islamic, 154 out-of-domain).

This training set is **AI-generated and AI-audited**, not human-reviewed. It is
committed as `eval/scope-train.json` with its provenance in `_meta`.

## Model and selection rule

Sparse logistic regression, class-balanced, 300 epochs, L2 1e-5, features with
count ≥2 (2,032 features). Trained **without** the out-of-domain class: OOD
questions are refused by empty retrieval, and including them cost the boundary
that matters — Quran versus later Islamic material.

Groups are split 70/15/15 by author topic, so template variants of one concept
never straddle splits. The threshold is chosen on the calibration split to
maximize negative refusal subject to Quran recall ≥ 97%.

## Candidate measurements

| split | Quran recall | negative refusal | AUC |
|---|---:|---:|---:|
| calibration (threshold 0.010) | **98.5%** (n=194) | 51.2% (n=160) | 0.929 |
| test | 95.5% (n=134) | 64.6% (n=178) | 0.903 |
| pilot (external, but used to inspect misses) | 98.5% (n=66) | 55.9% (n=34) | — |

Pilot by category: in-domain unanswerable refusal **66.7%**, OOD 41.7%,
adversarial 50.0% (OOD is expected to be caught by empty retrieval, not G1).

The independent holdout (90 pairs, unaudited draft labels) is the deciding
number:

| language | Quran kept | non-Quran refused |
|---|---:|---:|
| EN | 95.0% (38/40) | — |
| FA | **90.0%** (36/40) | — |
| pooled | **92.5%** (74/80) | 81.0% (81/100) |

Both languages fall below the 97% target. Per-class negative refusal on the
holdout: fiqh 80%, history 100%, other Islamic 95%, OOD 65%.

The previous model variant (before the third audit pass, 1,261 items) scored
97.3% calibration / 96.3% holdout. Cleaning the training data made negative
refusal much stronger (66% → 81%) and Quran recall worse (96.3% → 92.5%). That
inversion is the clearest evidence that a lexical boundary is not stable enough
to ship: small, defensible data changes move the operating point by several
points.

## Decision

**Do not wire G1 yet.** The pilot number is inflated by having inspected pilot
misses while adding templates; the holdout is the honest estimate and it fails.
A gate that refuses 5% of valid Persian Quran questions is worse than the
current known failure, which is documented and visible.

What would change the decision:

1. A larger, independently authored Quran-positive set with ordinary-life
   phrasing (the current generator produces too many questions that name the
   Quran, and too few like «دربارهٔ صبر چه گفته شده؟»).
2. A model that uses semantic features, not just lexical ones. The zero-cost
   rule blocks request-time embeddings, but a build-time quantized model or a
   Worker-compatible static embedding table could be evaluated against the same
   holdout.
3. A G2 answerability gate; the plan always assumed G1 alone would leak.

## Reproduce

```bash
node pipeline/tools/assemble-scope.ts data/build/scope-workflow.json
node pipeline/tools/augment-scope.ts
node pipeline/train-scope.ts eval/scope-train.json --exclude-ood \
  --out data/build/scope-model-candidate.json
node pipeline/tools/eval-scope.ts data/build/scope-model-candidate.json \
  eval/scope-holdout.json
```

The raw generated result (`data/build/scope-workflow.json`) is gitignored; the
committed `eval/scope-train.json` is sufficient to retrain. The deciding
holdout is committed as `eval/scope-holdout.json` (90 pairs, 180 items) so the
refusal is reproducible. **It is burned:** it decided the hold, so it must
never be used for tuning or model selection. A future candidate needs a fresh
holdout.

## Limits

- The holdout (`eval/scope-holdout.json`) is 90 pairs, unaudited by a second
  pass at the time of writing. Its labels and Persian were generated by the
  same model family as the training data.
- The training and holdout distributions both come from AI authors; neither is
  a sample of real users.
- The model is a scope gate, not an answerability gate. It cannot decide
  whether a retrieved verse answers the question (G2/G3 remain unimplemented).
- Finglish input is out of distribution: the model will generally refuse it.