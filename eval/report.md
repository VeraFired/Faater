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
| 1 | 15.2% (10/66) | 18.2% (6/33) | 12.1% (4/33) | 5.3% (10/190) | 6.3% (6/95) | 4.2% (4/95) |
| 3 | 24.2% (16/66) | 24.2% (8/33) | 24.2% (8/33) | 11.1% (21/190) | 10.5% (10/95) | 11.6% (11/95) |
| 5 | 28.8% (19/66) | 30.3% (10/33) | 27.3% (9/33) | 14.2% (27/190) | 13.7% (13/95) | 14.7% (14/95) |
| 10 | 36.4% (24/66) | 42.4% (14/33) | 30.3% (10/33) | 17.9% (34/190) | 20.0% (19/95) | 15.8% (15/95) |
| 20 | 50.0% (33/66) | 54.5% (18/33) | 45.5% (15/33) | 26.3% (50/190) | 29.5% (28/95) | 23.2% (22/95) |
| 50 | 66.7% (44/66) | 69.7% (23/33) | 63.6% (21/33) | 46.8% (89/190) | 47.4% (45/95) | 46.3% (44/95) |

hit@5 28.8% [18.3%, 41.3%] — MRR over a 50-candidate list 0.224

The pooled interval above is not a coverage interval for the population: EN and FA items are translations of the same questions and therefore paired, not independent. Quote the per-language columns.

## Hit and recall at 5 by answer type

| type | n | hit@k | recall@k |
|---|---:|---|---|
| direct | 50 | 36.0% (18/50) | 17.6% (26/148) |
| paraphrase | 16 | 6.3% (1/16) | 2.4% (1/42) |

Direct and paraphrase are never pooled: the direct items carry the average while the paraphrase items measure whether lexical retrieval can bridge wording it has never seen.

## Signal separation (AUC over answerable vs should-refuse)

| signal | AUC | oriented AUC |
|---|---:|---:|
| nHits | 0.661 | 0.661 |
| fieldCount | 0.618 | 0.618 |
| top5sum | 0.604 | 0.604 |
| top | 0.578 | 0.578 |
| top3mean | 0.578 | 0.578 |
| z | 0.571 | 0.571 |
| ratio | 0.557 | 0.557 |
| gap | 0.555 | 0.555 |

Oriented AUC folds the sign so higher is always better; 0.500 is chance and 0.700+ is the minimum worth building a gate on.

Scale caveat: `top`, `gap`, `ratio`, `top3mean` and `top5sum` are Reciprocal Rank Fusion constants (sums of 1/(60 + rank)), not calibrated similarities — their absolute values carry no meaning outside this index. `nHits` is capped by the 50-candidate search limit, so it cannot exceed 50 regardless of how much evidence exists.

## Threshold sweep on the strongest signal

Signal: `nHits` — direction fixed at "more evidence means answerable" (AUC 0.661). Budget: 5.0% false refusals.

**No point is certified at this sample size.** With 66 answerable items, even ZERO false refusals gives a 95% upper bound of 5.4% — above the 5.0% budget. The budget cannot be certified by this set; it would take **72 answerable items per language with zero errors**.

Illustrative (point-estimate) optimum — NOT a certified operating point: threshold 48.0000, false refusal 1.5% (1/66), refusal recall 35.3% (12/34).

## Separation by refusal type — the decisive measurement

| refusal type | n | raw AUC | oriented AUC | refusal recall (95% CI) | false refusal (95% CI) |
|---|---:|---:|---:|---|---|
| ood | 12 | 0.868 | 0.868 | 75.0% [42.8%, 94.5%] (9/12) | 1.5% [0.0%, 8.2%] (1/66) |
| unanswerable_indomain | 18 | 0.564 | 0.564 | 16.7% [3.6%, 41.4%] (3/18) | 1.5% [0.0%, 8.2%] (1/66) |
| adversarial | 4 | 0.477 | 0.523 | 0.0% [0.0%, 60.2%] (0/4) | 0.0% [0.0%, 5.4%] (0/66) |

Refusal-recall and false-refusal columns are at each row's own point-estimate optimum, computed over that row's answerable items plus its own refusal category. They are illustrative: none is certified at this sample size (see the power check).

**Finding.**

- Out-of-domain questions separate in the expected direction: raw AUC 0.868, oriented 0.868 — they retrieve less evidence than answerable questions.
- In-domain unanswerable questions do NOT: raw AUC 0.564, oriented 0.564. It separates less than out-of-domain questions.
- The two types differ by 0.305 on the oriented scale. This is the measured justification for G1: scope must be classified from the question, not inferred from a retrieval threshold.
- At a comparable false-refusal rate (1.5% vs 1.5%), the same signal catches 75.0% (9/12) of out-of-domain questions but only 16.7% (3/18) of in-domain unanswerable ones.

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

- **en-a05** (en) «What does the Quran say about charity?» — gold rank 17; top: 2:263, 57:18, 9:79, 2:276, 58:13
- **en-a06** (en) «What does the Quran say about the Day of Judgment?» — gold rank 31; top: 74:9, 19:15, 30:14, 19:33, 23:113
- **en-a09** (en) «What is the Quran's view of other religions?» — gold rank 14; top: 61:9, 9:33, 10:105, 3:85, 6:161
- **en-a12** (en) «What does the Quran say about arrogance?» — gold not in top 50; top: 23:67, 7:206, 21:19, 71:7, 8:49
- **en-a15** (en) «What does the Quran say about alcohol?» — gold not in top 50; top: 15:1, 28:2, 24:1, 31:2, 26:2
- **en-a17** (en) «What does the Quran say about modesty?» — gold not in top 50; top: 15:1, 28:2, 24:1, 31:2, 26:2
- **en-a18** (en) «What does the Quran say about truthfulness?» — gold not in top 50; top: 5:119, 2:23, 2:89, 3:164, 2:97
- **en-a19** (en) «What does the Quran say about mercy?» — gold rank 12; top: 7:204, 16:98, 45:20, 31:3, 6:155
- **en-a20** (en) «What does the Quran say about forgiveness?» — gold not in top 50; top: 4:106, 9:80, 51:18, 4:96, 63:6
- **en-a21** (en) «What does the Quran say about the poor?» — gold not in top 50; top: 107:3, 68:24, 74:44, 69:34, 93:8
- **en-a23** (en) «What does the Quran say about angels?» — gold not in top 50; top: 77:5, 74:30, 51:4, 15:30, 77:4
- **en-a24** (en) «What does the Quran say about Satan?» — gold rank 25; top: 17:27, 58:19, 4:120, 19:44, 17:53
- **en-p01** (en) «How should someone behave when another person insults them?» — gold not in top 50; top: 90:16, 21:36, 70:38, 49:11, 58:4
- **en-p03** (en) «Is there anything about treating neighbours well?» — gold not in top 50; top: 55:60, 70:10, 23:59, 18:23, 34:49
- **en-p04** (en) «What does it say about people being made into different nations?» — gold rank 27; top: 7:160, 29:18, 16:63, 41:25, 23:44
- **en-p05** (en) «What is said about remembering God often?» — gold rank 29; top: 37:86, 12:85, 4:142, 38:5, 12:45
- **en-p06** (en) «How should wealth be used?» — gold not in top 50; top: 69:28, 16:92, 70:18, 92:18, 74:12
- **en-p07** (en) «What does it say about human beings being tested?» — gold rank 11; top: 27:47, 20:90, 33:11, 30:20, 49:3
- **en-p08** (en) «Is there guidance on how to speak to people?» — gold rank 23; top: 22:8, 17:94, 3:46, 45:20, 3:138
- **fa-a01** (fa) «قرآن درباره صبر چه می‌گوید؟» — gold rank 33; top: 76:12, 90:17, 49:5, 12:83, 12:18
- **fa-a05** (fa) «قرآن درباره انفاق چه می‌گوید؟» — gold not in top 50; top: 17:100, 2:185, 4:82, 5:101, 6:19
- **fa-a07** (fa) «چه کسی آسمان‌ها و زمین را آفرید؟» — gold rank 34; top: 14:32, 29:61, 56:74, 16:3, 31:25
- **fa-a09** (fa) «قرآن درباره پیروان ادیان دیگر چه می‌گوید؟» — gold not in top 50; top: 75:18, 15:1, 11:27, 22:67, 2:185
- **fa-a12** (fa) «قرآن درباره تکبر چه می‌گوید؟» — gold rank 20; top: 2:185, 4:82, 5:101, 6:19, 7:204
- **fa-a13** (fa) «قرآن درباره ازدواج چه می‌گوید؟» — gold not in top 50; top: 33:37, 4:22, 4:23, 2:230, 24:3
- **fa-a14** (fa) «قرآن درباره ارث چه می‌گوید؟» — gold rank 16; top: 23:10, 19:6, 26:85, 26:59, 23:11
- **fa-a15** (fa) «قرآن درباره شراب چه می‌گوید؟» — gold rank 37; top: 6:70, 2:185, 4:82, 5:101, 6:19
- **fa-a17** (fa) «قرآن درباره حجاب و پوشش چه می‌گوید؟» — gold not in top 50; top: 42:51, 41:5, 2:185, 17:46, 4:82
- **fa-a18** (fa) «قرآن درباره راستگویی چه می‌گوید؟» — gold rank 14; top: 37:14, 3:58, 29:29, 30:58, 17:92
- **fa-a19** (fa) «قرآن درباره رحمت چه می‌گوید؟» — gold rank 26; top: 19:2, 21:75, 19:53, 21:86, 3:74
- **fa-a20** (fa) «قرآن درباره بخشش چه می‌گوید؟» — gold not in top 50; top: 17:20, 74:6, 27:73, 4:70, 57:29
- **fa-a21** (fa) «قرآن درباره فقرا چه می‌گوید؟» — gold not in top 50; top: 2:185, 4:82, 12:2, 6:25, 5:101
- **fa-a23** (fa) «قرآن درباره فرشتگان چه می‌گوید؟» — gold not in top 50; top: 15:30, 38:73, 37:150, 56:26, 37:158
- **fa-a24** (fa) «قرآن درباره شیطان چه می‌گوید؟» — gold rank 24; top: 81:25, 37:7, 15:17, 58:19, 19:44
- **fa-a25** (fa) «قرآن درباره مرگ چه می‌گوید؟» — gold rank 16; top: 85:4, 51:10, 15:24, 74:47, 44:56
- **fa-p01** (fa) «اگر کسی به انسان توهین کند چه باید کرد؟» — gold not in top 50; top: 55:3, 70:19, 80:17, 17:11, 80:24
- **fa-p02** (fa) «برای کسی که در سختی است چه راهنمایی وجود دارد؟» — gold not in top 50; top: 2:177, 11:44, 41:52, 39:42, 55:26
- **fa-p03** (fa) «درباره رفتار با همسایه چه گفته شده؟» — gold not in top 50; top: 77:18, 37:34, 42:6, 23:3, 8:54
- **fa-p05** (fa) «درباره یاد کردن خدا چه می‌گوید؟» — gold rank 35; top: 74:56, 20:42, 12:42, 90:13, 11:33
- **fa-p06** (fa) «مال و ثروت را چگونه باید خرج کرد؟» — gold rank 17; top: 89:20, 26:88, 27:36, 68:14, 92:18
- **fa-p07** (fa) «درباره آزمایش شدن انسان چه می‌گوید؟» — gold not in top 50; top: 55:3, 70:19, 80:17, 103:2, 80:24
- **fa-p08** (fa) «درباره نحوه سخن گفتن با مردم راهنمایی وجود دارد؟» — gold not in top 50; top: 11:37, 11:44, 55:26, 2:219, 57:25

