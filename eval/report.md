# Retrieval eval report

Set: M0 pilot — 100 items, EN+FA — PILOT — NOT BLIND-REVIEWED
Items: 100
Concept expansion: on

## Category counts

- adversarial: 4
- answerable_direct: 50
- answerable_paraphrase: 16
- ood: 12
- unanswerable_indomain: 18

## Retrieval quality — hit rate

**hit@k** = at least one gold verse in the top k (what a verse-card UI needs). **recall@k** = fraction of ALL gold refs in the top k (what retrieval quality is). A miss is a LOWER BOUND on recall: the gold lists name some valid verses, not all.

| k | all hit | en hit | fa hit | all recall | en recall | fa recall |
|---:|---|---|---|---|---|---|
| 1 | 28.8% (19/66) | 27.3% (9/33) | 30.3% (10/33) | 10.0% (19/190) | 9.5% (9/95) | 10.5% (10/95) |
| 3 | 37.9% (25/66) | 39.4% (13/33) | 36.4% (12/33) | 17.4% (33/190) | 17.9% (17/95) | 16.8% (16/95) |
| 5 | 48.5% (32/66) | 48.5% (16/33) | 48.5% (16/33) | 24.2% (46/190) | 23.2% (22/95) | 25.3% (24/95) |
| 10 | 63.6% (42/66) | 69.7% (23/33) | 57.6% (19/33) | 35.3% (67/190) | 35.8% (34/95) | 34.7% (33/95) |
| 20 | 71.2% (47/66) | 81.8% (27/33) | 60.6% (20/33) | 44.2% (84/190) | 48.4% (46/95) | 40.0% (38/95) |
| 50 | 86.4% (57/66) | 93.9% (31/33) | 78.8% (26/33) | 58.4% (111/190) | 63.2% (60/95) | 53.7% (51/95) |

hit@5 48.5% [36.0%, 61.1%] — MRR over a 50-candidate list 0.383

The pooled interval above is not a coverage interval for the population: EN and FA items are translations of the same questions and therefore paired, not independent. Quote the per-language columns.

## Hit and recall at 5 by answer type

| type | n | hit@k | recall@k |
|---|---:|---|---|
| direct | 50 | 52.0% (26/50) | 26.4% (39/148) |
| paraphrase | 16 | 37.5% (6/16) | 16.7% (7/42) |

Direct and paraphrase are never pooled: the direct items carry the average while the paraphrase items measure whether lexical retrieval can bridge wording it has never seen.

## Signal separation (AUC over answerable vs should-refuse)

| signal | AUC | oriented AUC |
|---|---:|---:|
| top | 0.817 | 0.817 |
| top3mean | 0.815 | 0.815 |
| fieldCount | 0.808 | 0.808 |
| top5sum | 0.805 | 0.805 |
| z | 0.684 | 0.684 |
| nHits | 0.608 | 0.608 |
| gap | 0.591 | 0.591 |
| ratio | 0.559 | 0.559 |

Oriented AUC folds the sign so higher is always better; 0.500 is chance and 0.700+ is the minimum worth building a gate on.

Scale caveat: `top`, `gap`, `ratio`, `top3mean` and `top5sum` are Reciprocal Rank Fusion constants (sums of 1/(60 + rank)), not calibrated similarities — their absolute values carry no meaning outside this index. `nHits` is capped by the 50-candidate search limit, so it cannot exceed 50 regardless of how much evidence exists.

## Threshold sweep on the strongest signal

Signal: `top` — direction fixed at "more evidence means answerable" (AUC 0.817). Budget: 5.0% false refusals.

**No point is certified at this sample size.** With 66 answerable items, even ZERO false refusals gives a 95% upper bound of 5.4% — above the 5.0% budget. The budget cannot be certified by this set; it would take **72 answerable items per language with zero errors**.

Illustrative (point-estimate) optimum — NOT a certified operating point: threshold 0.0216, false refusal 4.5% (3/66), refusal recall 52.9% (18/34).

## Separation by refusal type — the decisive measurement

| refusal type | n | raw AUC | oriented AUC | refusal recall (95% CI) | false refusal (95% CI) |
|---|---:|---:|---:|---|---|
| ood | 12 | 0.933 | 0.933 | 83.3% [51.6%, 97.9%] (10/12) | 0.0% [0.0%, 5.4%] (0/66) |
| unanswerable_indomain | 18 | 0.744 | 0.744 | 38.9% [17.3%, 64.3%] (7/18) | 4.5% [0.9%, 12.7%] (3/66) |
| adversarial | 4 | 0.799 | 0.799 | 25.0% [0.6%, 80.6%] (1/4) | 0.0% [0.0%, 5.4%] (0/66) |

Refusal-recall and false-refusal columns are at each row's own point-estimate optimum, computed over that row's answerable items plus its own refusal category. They are illustrative: none is certified at this sample size (see the power check).

**Finding.**

- Out-of-domain questions separate in the expected direction: raw AUC 0.933, oriented 0.933 — they retrieve less evidence than answerable questions.
- In-domain unanswerable questions do NOT: raw AUC 0.744, oriented 0.744. It separates less than out-of-domain questions.
- The two types differ by 0.189 on the oriented scale. This is the measured justification for G1: scope must be classified from the question, not inferred from a retrieval threshold.
- At a comparable false-refusal rate (0.0% vs 4.5%), the same signal catches 83.3% (10/12) of out-of-domain questions but only 38.9% (7/18) of in-domain unanswerable ones.

## Power check — what this sample can support

- should-refuse items: 17 EN + 17 FA = 34 total, but the languages are paired translations of the same questions, so this is NOT 34 independent observations and the two are never pooled into one interval.

**No gate exists in this build.** The following are sizing arithmetic under an assumed zero-error gate, not observed error rates:

| language | n | zero-error 95% upper bound |
|---|---:|---:|
| EN | 17 | 19.5% |
| FA | 17 | 19.5% |

- a 2% upper bound requires **183 should-refuse items per language** (366 total for EN+FA)
- a 5% upper bound requires **72 per language** (144 total)

A point estimate such as 1/17 = 5.9% is not a bound and must not be quoted as one.

## Failures (answerable items with no gold verse in the top 10)

- **en-a06** (en) «What does the Quran say about the Day of Judgment?» — gold rank 48; top: 33:42, 20:59, 76:25, 19:62, 78:11
- **en-a10** (en) «What does the Quran say about justice?» — gold rank 13; top: 55:9, 42:17, 21:47, 6:115, 3:18
- **en-a21** (en) «What does the Quran say about the poor?» — gold rank 46; top: 74:44, 69:34, 107:3, 68:24, 89:18
- **en-a23** (en) «What does the Quran say about angels?» — gold not in top 50; top: 15:30, 38:73, 25:22, 97:4, 2:98
- **en-a24** (en) «What does the Quran say about Satan?» — gold rank 39; top: 17:27, 26:221, 20:120, 58:19, 7:20
- **en-a25** (en) «What does the Quran say about death?» — gold rank 11; top: 44:56, 39:42, 25:3, 14:17, 74:47
- **en-p01** (en) «How should someone behave when another person insults them?» — gold rank 13; top: 6:108, 21:36, 49:11, 58:4, 90:16
- **en-p06** (en) «How should wealth be used?» — gold not in top 50; top: 16:92, 89:20, 69:28, 68:14, 92:11
- **en-p07** (en) «What does it say about human beings being tested?» — gold rank 15; top: 21:35, 33:11, 20:90, 8:17, 27:47
- **en-p08** (en) «Is there guidance on how to speak to people?» — gold rank 34; top: 27:82, 14:4, 3:41, 23:67, 27:77
- **fa-a07** (fa) «چه کسی آسمان‌ها و زمین را آفرید؟» — gold rank 20; top: 25:59, 36:81, 42:11, 52:35, 6:79
- **fa-a09** (fa) «قرآن درباره پیروان ادیان دیگر چه می‌گوید؟» — gold not in top 50; top: 22:67, 37:83, 4:121, 37:77, 7:132
- **fa-a13** (fa) «قرآن درباره ازدواج چه می‌گوید؟» — gold not in top 50; top: 33:37, 4:22, 24:3, 4:23, 2:240
- **fa-a18** (fa) «قرآن درباره راستگویی چه می‌گوید؟» — gold rank 29; top: 33:24, 3:58, 37:14, 29:29, 30:58
- **fa-a19** (fa) «قرآن درباره رحمت چه می‌گوید؟» — gold rank 23; top: 24:20, 19:2, 21:75, 38:9, 21:86
- **fa-a21** (fa) «قرآن درباره فقرا چه می‌گوید؟» — gold not in top 50; top: 74:44, 69:34, 107:3, 68:24, 89:18
- **fa-a23** (fa) «قرآن درباره فرشتگان چه می‌گوید؟» — gold not in top 50; top: 15:30, 38:73, 25:22, 97:4, 2:98
- **fa-a24** (fa) «قرآن درباره شیطان چه می‌گوید؟» — gold rank 26; top: 37:7, 17:27, 81:25, 15:17, 22:3
- **fa-a25** (fa) «قرآن درباره مرگ چه می‌گوید؟» — gold rank 23; top: 44:56, 37:58, 39:42, 85:4, 25:3
- **fa-p01** (fa) «اگر کسی به انسان توهین کند چه باید کرد؟» — gold rank 32; top: 6:108, 55:3, 103:2, 80:17, 75:10
- **fa-p02** (fa) «برای کسی که در سختی است چه راهنمایی وجود دارد؟» — gold not in top 50; top: 7:94, 67:22, 2:177, 41:52, 39:42
- **fa-p06** (fa) «مال و ثروت را چگونه باید خرج کرد؟» — gold rank 45; top: 89:20, 4:2, 26:88, 68:14, 65:7
- **fa-p07** (fa) «درباره آزمایش شدن انسان چه می‌گوید؟» — gold not in top 50; top: 90:4, 39:49, 33:11, 21:111, 37:115
- **fa-p08** (fa) «درباره نحوه سخن گفتن با مردم راهنمایی وجود دارد؟» — gold not in top 50; top: 22:24, 55:4, 3:41, 78:37, 11:37

