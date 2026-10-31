# Evaluation methodology

How to measure whether Faater refuses correctly. Written before the blind set
exists so the set is built to a standard rather than assembled ad hoc.

`pipeline/eval.ts` is the runner. `eval/pilot.json` is a 100-item **pilot** — it
exercises the harness and produces indicative numbers. It is not evidence.

---

## 1. What is being measured

Two different things, and they must not be mixed:

| Question | Metric | Failure if wrong |
|---|---|---|
| When the corpus can answer, does it? | hit@k, MRR | a user gets a refusal for an answerable question |
| When it cannot, does the system refuse? | refusal recall | a user gets verses that do not answer their question |
| When it can, does it ever refuse? | **false-refusal rate** | the product is useless |

Refusal quality is **not** answer accuracy. A system that answers 60% of
questions and refuses the rest correctly is better than one that answers 95% and
fabricates the other 5%.

---

## 2. Power first — before authoring a single item

The number of items is decided by the claim, not by convenience.

With **zero** observed errors, a 95% Clopper–Pearson upper bound is
`1 − (0.025)^(1/n)`:

| Unanswerable items per language | Zero-error upper bound |
|---:|---:|
| 34 | 10.3% |
| 72 | 5.0% |
| 183 | 2.0% |
| 368 | 1.0% |

**Consequence.** If the target is "false-answer rate ≤ 2% at 95% confidence",
you need **183 unanswerable items per language**, and one observed error moves
the bound to roughly 2.6% — i.e. the target is then missed. Size the set to the
claim, or weaken the claim to fit the set. Never quote a point estimate
(`1/75 = 1.3%`) as if it were a bound.

For hit rate, `itemsForUpperBound()` is the wrong tool (that is a binomial
proportion over answered items, not a bound on error); report hit@k with a
Clopper–Pearson interval and stop.

---

## 3. Split design

Three sets, **grouped by topic**, never split by row:

| Set | Share | Purpose |
|---|---:|---|
| train | 50% | fitting G1 and G3 |
| calibration | 25% | choosing thresholds `τ` |
| blind | 25% | the only number ever quoted |

Grouping matters because paraphrases of one question straddle a row-wise split
and leak. Every paraphrase of "what does the Quran say about patience" must land
in the same split. If it does not, the blind set measures memorisation.

The blind set is opened **once**. Re-running after a change means a new blind
set; otherwise it has become a calibration set with extra steps.

---

## 4. Authoring rules

1. **Gold refs come from a source other than the retriever.** Reading the
   retriever's output while writing gold refs produces a set that measures
   agreement with the retriever.
2. **Gold lists are sets of *acceptable* verses, not the one right answer.**
   They are incomplete by nature. Report hit@k as a **lower bound** and say so.
3. **Never author a negative item by perturbing a positive one.** "What colour
   was the Prophet's camel?" works because it is a real question someone might
   ask; "patience in Uzbek" does not test anything.
4. **Category balance follows the risk, not the item count.** In-domain
   unanswerable and lexical traps are the categories that break systems; give
   them weight.
5. **Sensitive verses are a separate path.** 4:34, 9:5 and similar do not belong
   in the plain answer set — they need the sensitivity route from M1.

### Category definitions

| Category | Definition | Expected behaviour |
|---|---|---|
| `answerable_direct` | shares vocabulary with the translation | answer + correct citation |
| `answerable_paraphrase` | **no** lexical overlap with any retrieved verse | answer (this is the false-refusal control) |
| `unanswerable_indomain` | Islamic, not Quranic — fiqh, hadith, sirah, history | refuse with scope copy |
| `ood` | unrelated to the Quran at all | refuse with scope copy |
| `adversarial` | asks for something the corpus does not contain, or tries to change the system's role | refuse; never fabricate a citation |

---

## 5. Adjudication

Two annotators per item, working independently, then a third to resolve
disagreement. Report **inter-annotator agreement** next to every score; a metric
computed on disputed labels is not comparable to one computed on agreed labels.

An LLM judge may pre-label but must not be the only judge. If one is used,
report its agreement with humans on a stratified sample — published judges for
this task have been measured near κ = 0.51, which is not good enough to stand
alone.

---

## 6. Metrics

Per language, never pooled into a single number that hides a weak language:

- **hit@{1,3,5,10,20,50}** and **MRR** over a fixed candidate depth
- **refusal recall** on the should-refuse categories
- **false-refusal rate** on the answerable categories, with the 5% budget
- **selective risk** — error rate at the coverage the system actually chooses
- **p95 latency** and **neurons per answer**

Every proportion carries a 95% interval. A difference is only a difference if
the intervals do not overlap.

---

## 7. Calibration

Sweep a single threshold `τ` on the calibration set and choose

```
τ* = argmin (c_fn · FN + c_fp · FP)
     subject to  UCB95(false-refusal) ≤ 5%
            and  LCB95(refusal recall) ≥ 90%
```

Selection is on the **Clopper-Pearson bounds, never the point estimate**. With 66
answerable items, even zero observed false refusals gives a 95% upper bound of
5.4% — above a 5% budget — so the harness reports *no certified operating point*
and labels the point-estimate optimum as illustrative. That is the correct
output for a pilot; a certified threshold requires 72 answerable items per
language with zero errors.

The **direction of every signal is fixed before the sweep** — more retrieval
evidence means the corpus can presumably answer. Fitting the direction to the
data produces thresholds that invert under noise and cannot be defended.

Recalibrate and re-version `{analyzer, index, gate_model, thresholds}` together
on any change to the retriever, the translation, or the normalization. A
threshold is meaningless without the exact index it was fitted against.

---

## 8. What the M0 pilot already established

Run `npm run eval` to reproduce. Current findings, which constrain the design:

- **No score-shape retrieval feature separates refusal at a usable level.**
  The strongest is `fieldCount` at AUC 0.661, followed by `nHits` 0.652,
  `top5sum` 0.633, `top3mean` 0.610 and `top` 0.608. None reaches the 0.700
  minimum worth building a gate on.
- **In-domain unanswerable questions remain close to chance (AUC 0.580).**
  They retrieve nearly as much evidence as answerable questions because they
  are dense with Quranic vocabulary. At the illustrative 3.0% false-refusal
  point, the same signal catches 33.3% of out-of-domain questions (4/12) but
  0.0% of in-domain unanswerable ones (0/18).
- Therefore **G1 is a classifier on the question**, and no retrieval threshold
  can substitute for it. See ADR-017.

> **Correction 2026-10-31.** An earlier revision reported in-domain AUC 0.337
> ("worse than chance"). That was an artifact of the Arabic field answering
> Persian questions with verses that only mentioned «قرآن»; after the frame-only
> fix the honest value was 0.551. The v0.1.0 report measures 0.580. The
> conclusion stands on the cleaner claim.

**SUPERSEDED 2026-10-31 — earlier values.** The pre-release run reported
`nHits` 0.645 as the only signal above 0.60, in-domain unanswerable 0.551, and
out-of-domain 0.846. Those numbers came from an earlier index; they are retained
for history only. Use `eval/report.json` from the tagged commit.

Anything that contradicts these findings must come from a set large enough to
detect the contradiction. The pilot is not.

---

## 9. Ablating the concept layer

Concept expansion is a hypothesis: that synonym lists let a user's vocabulary
meet a translator's. It must be measured against its own absence, on the same
set, with the same code:

```bash
npm run eval -- --no-concepts   # literal retrieval + RRF only
npm run eval                    # + concept lists fused by RRF
```

Acceptance rule, fixed before looking at the result:

- **paraphrase hit@5 must rise** — that is the only reason the layer exists;
  its baseline is 0.0% (0/16);
- **direct hit@5 must not fall by more than 2 percentage points** — expansion
  that buys paraphrase recall with literal precision is a bad trade;
- every added term must be corpus-verified (`pipeline/tools/df.ts`): a term with
  df=0 is dead, and a term in more than half the verses cannot discriminate.

The layer ships **unreviewed** and is labelled as such in `lexicon.json`. It is
search vocabulary, never display text, so a wrong term costs recall — it can
never put a wrong word in front of a user.

### Measured result (2026-10-31, pilot — provisional)

The v0.1.0 release code measures the layer against its own absence:

| metric | literal only | + concept | delta |
|---|---:|---:|---:|
| hit@5 | 28.8% | 28.8% | +0.0 pt |
| gold recall@5 | 13.7% | 14.2% | +0.5 pt |
| direct hit@5 | 36.0% | 34.0% | -2.0 pt |
| paraphrase hit@5 | 6.3% | 12.5% | +6.3 pt |
| MRR | 0.214 | 0.215 | +0.2 pt |

The acceptance rule passes: paraphrase **6.3% → 12.5%**, direct **36.0% →
34.0%** (exactly the allowed 2.0-point fall), gold recall@5 +0.5 pt, MRR +0.2 pt.

`rrf()` takes per-list weights. Concept lists fuse at **0.1**; the literal
`ar` / `en` / `fa` lists stay at 1.0. At 0.1, a concept list's rank-1
contribution is `0.1/61 ≈ 0.0016` against a literal list's `1/61 ≈ 0.0164`, so a
concept can only promote verses literal retrieval missed or ranked low.

Current sweep (`npm run ablate -- --sweep`):

| weight | hit@5 | direct hit@5 | paraphrase hit@5 | MRR |
|---:|---:|---:|---:|---:|
| 0.1 | 28.8% | 34.0% | 12.5% | 0.215 |
| 0.15 | 28.8% | 34.0% | 12.5% | 0.212 |
| 0.2 | 25.8% | 30.0% | 12.5% | 0.206 |
| 0.25 | 24.2% | 28.0% | 12.5% | 0.202 |
| 0.3 | 22.7% | 26.0% | 12.5% | 0.201 |
| 0.4 | 24.2% | 26.0% | 18.8% | 0.206 |
| 0.5 | 24.2% | 26.0% | 18.8% | 0.204 |
| 0.7 | 22.7% | 24.0% | 18.8% | 0.213 |
| 1.0 | 25.8% | 28.0% | 18.8% | 0.221 |
| 0 (off) | 28.8% | 36.0% | 6.3% | 0.214 |

**Earlier experiment (superseded).** Fusing the concept lists at the **same
weight as a literal field** failed the rule: paraphrase rose to 12.5% but direct
hit@5 fell 36.0% → 18.0%. That is why `rrf()` takes per-list weights.

**SUPERSEDED 2026-10-31 — earlier index.** The table below is retained for
history; it came from code before the ۀ fold and the verbatim segment join. Its
absolute values are not comparable to the current tables above.

| weight | hit@5 | direct hit@5 | paraphrase hit@5 | MRR |
|---:|---:|---:|---:|---:|
| 0.05–0.15 | 28.8% | 36.0% | 6.3% | 0.212–0.228 |
| 0.3 | 25.8% | 32.0% | 6.3% | 0.178 |
| 1.0 | 16.7% | 18.0% | 12.5% | 0.146 |
| 0 (off) | 27.3% | 36.0% | 0.0% | 0.199 |

Two cautions are part of the result, not footnotes:

1. **The weight was selected on the same pilot it is measured on.** One
   paraphrase item is 6.3 points. Report the direction, never the effect size,
   until the blind set confirms it.
2. **0.1 is not the argmax of hit@5** (0.1, 0.15 and "off" tie at 28.8%), so it
   is chosen for its mechanism (an order of magnitude below a literal field),
   not because it maximised the sweep. If a future edit moves the plateau,
   choose again by mechanism and record it.

```bash
npm run ablate -- --sweep   # weight sweep, same set, same code
```
