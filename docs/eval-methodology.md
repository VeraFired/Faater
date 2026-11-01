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

## 8. What the pilot already established

Run `npm run eval` to reproduce. Current findings (v0.1.1 branch, keyword layer,
2026-11-01), which constrain the design:

- **No score-shape retrieval feature separates refusal well enough to gate on.**
  The strongest is `top` at AUC 0.817, followed by `top3mean` 0.815,
  `fieldCount` 0.808 and `top5sum` 0.805; then `z` 0.684, `nHits` 0.608, `gap`
  0.591, `ratio` 0.559. Four signals now clear the 0.700 bar, but on a pilot
  with 34 should-refuse items, no blind confirmation, and no certified
  operating point — and they are RRF constants, not calibrated similarities
  (see the scale caveat in `eval/report.md`).
- **In-domain unanswerable questions still separate far less than out-of-domain
  ones (AUC 0.744 vs 0.933).** They retrieve nearly as much evidence as
  answerable questions because they are dense with Quranic vocabulary. At the
  illustrative 4.5% false-refusal point (3/66), the same signal catches 83.3%
  (10/12) of out-of-domain questions but 38.9% (7/18) of in-domain unanswerable
  ones; adversarial items sit at 0.799 and 25.0% (1/4). Overall refusal recall
  at that point is 52.9% (18/34).
- Therefore **G1 is a classifier on the question**, and no retrieval threshold
  can substitute for it. See ADR-017.

The higher AUCs are partly a side effect of better answering as well as better
separation: the same keyword layer raised answerable hit@5 from 28.8% to 48.5%,
which moves the answerable distribution. A gate fitted on this pilot is still
uncertifiable (see §7), and in-domain unanswerable remains the hard category.

> **Correction 2026-10-31.** An earlier revision reported in-domain AUC 0.337
> ("worse than chance"). That was an artifact of the Arabic field answering
> Persian questions with verses that only mentioned «قرآن»; after the frame-only
> fix the honest value was 0.551. The v0.1.0 report measured 0.580 and the
> pre-keyword-layer v0.1.1 report 0.654. The conclusion stands on the cleaner
> claim: in-domain unanswerable separates far worse than out-of-domain, and no
> threshold is certified.

**SUPERSEDED 2026-11-01 — pre-keyword-layer v0.1.1 values.** That report had
`top5sum` 0.712 as the strongest signal, `top3mean` 0.688, `top` 0.667,
`fieldCount` 0.663 and `nHits` 0.652; in-domain unanswerable 0.654; at the
illustrative 3.0% false-refusal point, 50.0% OOD recall (6/12) and 0.0%
in-domain (0/18). Those numbers came before the concept-weight, stemming and
exclusion changes and are retained for history only.

**SUPERSEDED 2026-10-31 — v0.1.0 values.** `fieldCount` 0.661 as the strongest
signal, `nHits` 0.652, `top5sum` 0.633, `top3mean` 0.610, `top` 0.608;
in-domain unanswerable 0.580; 33.3% OOD recall (4/12) and 0.0% in-domain
(0/18) at the illustrative 3.0% point. The pre-release `nHits` 0.645 /
in-domain 0.551 / OOD 0.846 row belongs to an earlier index and is also
historical.

Anything that contradicts these findings must come from a set large enough to
detect the contradiction. The pilot is not.

---

## 9. Ablating the concept layer

Concept expansion is a hypothesis: that synonym lists let a user's vocabulary
meet a translator's. It must be measured against its own absence, on the same
set, with the same code:

```bash
npm run ablate                  # controlled A/D-off vs concept-on comparison
npm run eval -- --no-concepts   # reports with concept lists off; A/D stay at defaults
```

`ablate.ts` pins the v0.1.1 fusion defaults (`coverageRerank: false`,
`faQueryArWeight: 1`) in **both** arms, because the concept-layer rule must
measure only the concept layer. `npm run eval -- --no-concepts` only disables
concept expansion; the coverage bonus and the gated Arabic weight remain on, so
it is not the same experiment.

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

### Measured result (2026-11-01, pilot — provisional)

The current tool measures the layer against its own absence on the v0.1.1
branch, with the fusion changes pinned off in both arms:

| metric | literal only | + concept | delta |
|---|---:|---:|---:|
| hit@5 | 28.8% | 45.5% | +16.7 pt |
| gold recall@5 | 13.7% | 22.6% | +8.9 pt |
| direct hit@5 | 36.0% | 48.0% | +12.0 pt |
| paraphrase hit@5 | 6.3% | 37.5% | +31.3 pt |
| MRR | 0.217 | 0.365 | +14.8 pt |

The acceptance rule passes on both counts: paraphrase **6.3% → 37.5%**, direct
**36.0% → 48.0%** (a rise, not a fall), gold recall@5 +8.9 pt, MRR +14.8 pt.
That is a much stronger effect than the v0.1.0 layer measured, and it is not
only a weight change: concept lists stopped being divided by the fraction of
synonyms matched, trigger matching became stem-aware, generic concepts were
demoted, and false-friend verses were excluded. §10 records the A/D ablation
separately.

`rrf()` takes per-list weights. Concept lists now fuse at **0.5**; the literal
`ar` / `en` / `fa` lists stay at 1.0. At 0.5 a concept list's rank-1
contribution is `0.5/61 ≈ 0.0082` against a literal list's `1/61 ≈ 0.0164`, so
a concept rank-1 ties a literal rank-2: it can promote a bridge but cannot
outvote an exact user term. The ADR-019 mechanism note governs the choice; the
sweep below is a plateau, not an argmax.

v0.1.1-configuration sweep (`npm run ablate -- --sweep`):

| weight | hit@5 | direct hit@5 | paraphrase hit@5 | MRR |
|---:|---:|---:|---:|---:|
| 0.1 | 39.4% | 48.0% | 12.5% | 0.274 |
| 0.15 | 37.9% | 46.0% | 12.5% | 0.288 |
| 0.2 | 36.4% | 44.0% | 12.5% | 0.297 |
| 0.25 | 37.9% | 44.0% | 18.8% | 0.307 |
| 0.3 | 36.4% | 42.0% | 18.8% | 0.307 |
| 0.4 | 40.9% | 44.0% | 31.3% | 0.352 |
| **0.5** | **45.5%** | **48.0%** | **37.5%** | **0.365** |
| 0.7 | 48.5% | 48.0% | 50.0% | 0.387 |
| 1.0 | 47.0% | 52.0% | 31.3% | 0.387 |
| 0 (off) | 28.8% | 36.0% | 6.3% | 0.217 |

0.7 and 1.0 score higher on MRR and 0.7 on hit@5, but the plateau is not
smooth and the higher points cost direct head ranks on specific topics (prayer
3 → 7). 0.5 is chosen for its mechanism — a concept rank-1 tying a literal
rank-2 — and it is the point where paraphrase gain is large without displacing
exact-term head ranks. With 16 paraphrase items, one item is 6.3 points; the
sweep is directional evidence, not a tuned optimum. See CHALLENGES.

**SUPERSEDED 2026-11-01 — v0.1.0 concept layer at weight 0.1.** That layer
measured literal-only 28.8% / 36.0% / 6.3% / MRR 0.214 against concept-on
28.8% / 34.0% / 12.5% / 0.215, and its sweep peaked near 28.8% hit@5 at 0.1.
The mechanism was the same; the scoring and data were weaker. Retained for
history only.

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
   until a fresh blind set confirms it on changed code.
2. **0.5 is a mechanism choice, not the sweep maximum.** 0.7 and 1.0 score
   higher on MRR (0.387) and 0.7 on hit@5 (48.5%), but the higher points cost
   direct head ranks and the curve is not monotonic. If a future edit moves the
   plateau, choose again by mechanism and record it.

```bash
npm run ablate -- --sweep   # weight sweep, same set, same code
```

## 10. BUG-001 fusion ablation — v0.1.1 (2026-11-01)

The rule was fixed before the numbers were looked at: overall hit@5 must not
fall; direct hit@5 and paraphrase hit@5 may each fall by at most 2 points. The
same pilot, the same code, flags only (`pipeline/tools/ablate-fusion.ts`).
This is a development-set measurement, not blind evidence. The table runs at
the shipped concept weight of 0.5.

| variant | hit@5 | direct | paraphrase | EN hit@5 | FA hit@5 | MRR |
|---|---:|---:|---:|---:|---:|---:|
| literal only | 28.8% (19/66) | 36.0% (18/50) | 6.3% (1/16) | 30.3% | 27.3% | 0.217 |
| concept only (v0.1.1) | 45.5% (30/66) | 48.0% (24/50) | 37.5% (6/16) | 45.5% | 45.5% | 0.365 |
| + coverage (D) | 47.0% (31/66) | 50.0% (25/50) | 37.5% (6/16) | 48.5% | 45.5% | 0.367 |
| + language weight (A) | 47.0% (31/66) | 50.0% (25/50) | 37.5% (6/16) | 45.5% | 48.5% | 0.381 |
| **+ A + D (shipped)** | **48.5% (32/66)** | **52.0% (26/50)** | **37.5% (6/16)** | 48.5% | 48.5% | **0.383** |

Acceptance: **PASS** — overall hit@5 +3.0 pt, direct +4.0 pt, paraphrase +0.0 pt,
MRR +1.8 pt. D and A each move a different language (D lifts EN, A lifts FA),
and together they match the full set at 48.5% hit@5. With 16 paraphrase items,
one item is 6.3 points: read the direction, not the effect size.

An earlier run of this tool at the old concept weight 0.1 measured the same
acceptance as flat (28.8% → 28.8% hit@5, 34.0% direct, MRR +1.3 pt). The
concept-layer changes raised both the baseline and the headroom; this table
supersedes that one.

Mechanism:

- **D (coverage)** groups the question into content terms after removing
  stopwords, frame terms and Persian light verbs (`كردن`, `میكنم`, …), keeping
  ZWNJ split/joined forms and inflections in one group. Punctuation separates
  topics (`wine/gambling` is two groups), and stopword or frame-term variants
  that appear only after stemming are filtered. A candidate's fused score is
  multiplied by `1 + coverageAlpha` **only when it matches every eligible
  group** across the literal ar/en/fa lists. Concept lists never count; the
  rerank is a no-op for one-term questions and when fewer than two groups
  matched. The light-verb filter was added after «ياد كردن از يوسف» (12:42)
  was falsely boosted over 13:28 by counting «كردن» as a covered group.
- **A (Arabic weight)** fuses the Arabic literal list at **0.3** for a Persian
  request when the Persian list covers at least **two** query groups. The
  request language, not script detection, decides: «شراب و قمار» is valid
  Arabic script. The two-group gate is load-bearing: the Persian list finds
  only «ميسر» in 2:280 for «الخمر والميسر», and an ungated weight hid 2:219.
  At 0.3, 2:219 is rank 6 in memory / 7 in D1 with A alone; D alone puts it at
  3/3; A + D stays 3/3. Base is 7/8.

**Rejected intermediate — fractional coverage.** The first implementation
multiplied by `1 + coverage` for any partial overlap. It promoted unrelated
verses: «درباره نحوه سخن گفتن با مردم راهنمایی وجود دارد؟» shares «مردم»,
«وجود» and «دارد» with 2:219, and the verse rose from rank 3 to rank 1.
Candidate-pool IDF weighting reduced but did not remove the effect. Full
coverage is the shipped rule; no document that fails to cover the whole
question receives a bonus, so generic-word overlap is inert.

Arabic-weight sweep at the shipped concept weight (PASS; 0–0.7 is a plateau,
1.0 costs FA hit@5):

| ar weight | hit@5 | direct | paraphrase | EN hit@5 | FA hit@5 | MRR |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 48.5% | 52.0% | 37.5% | 48.5% | 48.5% | 0.383 |
| 0.15 | 48.5% | 52.0% | 37.5% | 48.5% | 48.5% | 0.383 |
| **0.3** | **48.5%** | **52.0%** | **37.5%** | **48.5%** | **48.5%** | **0.383** |
| 0.45 | 48.5% | 52.0% | 37.5% | 48.5% | 48.5% | 0.383 |
| 0.5 | 48.5% | 52.0% | 37.5% | 48.5% | 48.5% | 0.383 |
| 0.55 | 48.5% | 52.0% | 37.5% | 48.5% | 48.5% | 0.383 |
| 0.6 | 48.5% | 52.0% | 37.5% | 48.5% | 48.5% | 0.383 |
| 0.65 | 48.5% | 52.0% | 37.5% | 48.5% | 48.5% | 0.382 |
| 0.7 | 48.5% | 52.0% | 37.5% | 48.5% | 48.5% | 0.382 |
| 1.0 | 47.0% | 50.0% | 37.5% | 48.5% | 45.5% | 0.367 |

0.3 was the value registered in the plan before measurement: a fallback below
half a literal list. The whole 0–0.7 band is flat at this pilot size, so 0.3
is a mechanism choice inside a plateau, not an optimum. The blind set is
untouched.

Coverage multiplier sweep at ar weight 0.3: alpha 1.0–2.0 gives 48.5% hit@5 /
52.0% direct / 37.5% paraphrase / MRR 0.383; 0–0.75 gives 47.0% / 50.0% /
37.5% / 0.381–0.382. alpha 1.0 sits at the edge of the plateau; it was
pre-registered and is kept.

```bash
npm run ablate:fusion            # acceptance table
npm run ablate:fusion -- --sweep # both sweeps
```
