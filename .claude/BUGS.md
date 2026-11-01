# Bug log

Owner-reported defects, with reproduction and evidence. Status values:
`OPEN`, `INVESTIGATING`, `PARTIALLY FIXED`, `FIXED`, `WONTFIX`. Severity:
**P1** = wrong answer to a plainly valid question; **P2** = degraded but
usable; **P3** = cosmetic.

Add new reports at the bottom. Every entry needs: exact query, language,
expected, actual, and where it was seen (staging or local).

---

## BUG-001 — Persian «شراب و قمار» buries 2:219 below the card cutoff

- **Status:** PARTIALLY FIXED — v0.1.1 branch candidate, not released or merged
- **Severity:** P1 — a plainly valid topical question misses its exact verse
- **Reported:** 2026-10-31 by owner, seen on staging
- **Language:** Persian (fa)
- **Query:** `شراب و قمار`
- **Expected:** 2:219 («يَسْأَلُونَكَ عَنِ الْخَمْرِ وَالْمَيْسِرِ …» — "They ask
  you about wine and gambling…") among the verse cards.
- **Actual:** five cards are shown and 2:219 is not one of them. The user sees
  less relevant answers.

### Measured

Card limit is 5 (`LIMITS.maxCards`).

| path | 2:219 rank |
|---|---:|
| in-memory retriever (`Retriever.search`, limit 50) | **7** |
| D1/FTS5 (`searchD1`, limit 50) | **8** |
| English equivalent, "What does the Quran say about alcohol and gambling?" | **3** |

Top of the D1 result for `شراب و قمار`:

```
1. 6:70   [ar, fa, concept:ar]
2. 37:45  [fa, concept:ar, concept:en, concept:fa]
3. 83:25  [fa, concept:ar, concept:en, concept:fa]
4. 56:18  [fa, concept:ar, concept:en, concept:fa]
5. 5:91   [fa, concept:ar, concept:en]
6. 5:90   [fa, concept:ar, concept:en]
7. 78:34  [fa, concept:en, concept:fa]
8. 2:219  [fa, concept:ar, concept:en]
```

The field-level truth:

```
fa:شراب AND fa:قمار  → 5:91, 5:90, 2:219        (exactly right)
fa phrase "شراب و قمار" → 5:91, 5:90, 2:219      (2:219 is #3 in the fa list)
ar:شراب             → 38:51, 38:42, 16:10, 16:69, 10:4, 35:12, 18:29, 6:70
ar:خمر              → 5:91, 5:90, 2:219, 47:15, 24:31
```

So the Persian field ranks 2:219 correctly at #3. The damage happens in fusion.

### Root cause

1. **Persian words are also searched in the Arabic index.** «شراب» is a real
   Arabic word ("wine/drink"), and the Qur'an uses it for the rivers of wine in
   Paradise (6:70, 37:45, 56:18, 83:25, 78:34, 38:42, 38:51). Those verses
   enter the `ar` list. 2:219 uses **الخمر**, not شراب, so it misses that list.
2. **RRF rewards list membership, not matching more query terms.** A Paradise
   verse present in `ar` + `fa` + concept lists outranks 2:219, even though
   2:219 matches **both** «شراب» and «قمار» in the Persian field.
3. **The concept layer amplifies the wrong sense.** The `wine` concept includes
   Arabic شراب and therefore feeds the Paradise-wine verses; there is **no
   `gambling` concept** (قمار / ميسر) to pull the prohibition cluster. The
   concept weight (0.1) is too small to correct the boundary anyway.
   *SUPERSEDED 2026-11-01: the weight is now 0.5, a `gambling` concept exists,
   and `wine` / `gambling` carry verse exclusions for the veil/deferment false
   friends. The ranked result above was measured before those changes.*
4. **The card cutoff hides it.** Rank 8 with `maxCards = 5`.

Not the cause: the Persian translation in `persian_ih` does contain both
«شراب» and «قمار» for 2:219, and the query wins the fa phrase match. This is a
**sense/polysemy** failure, not a missing translation or a normalizer bug.

The English query works only because "gambling" is unique to the prohibition
cluster (5:90, 5:91, 2:219). "What does the Quran say about wine?" puts 2:219
at **#7 in D1** for the same polysemy reason, and "alcohol" does not match
"wine" at all. So this is not Persian-only; Persian just makes it worse because
the Arabic index is searched with Persian words.

### Candidate fixes (evaluate, do not guess)

| # | Fix | Risk |
|---|---|---|
| A | **Language-aware `ar` weight**: for a detected-Persian query, down-weight or skip the literal `ar` list unless the query has Arabic markers (ال، في، من) or the fa list is empty. | Loses Arabic recall for Persian queries that only match scripture; must be ablated per language. |
| B | **Persian→Arabic canonical bridge**: map query terms to Qur'anic Arabic via a reviewed bridge (شراب→خمر, قمار→ميسر) as a separate list, not by searching raw Persian tokens in `ar`. | Needs a reviewed lexical resource; شراب→خمر still includes 47:15 (Paradise), but ميسر is unique to the prohibition cluster. |
| C | **Concept sense split + gambling concept**: split `wine` into `wine_paradise` and `intoxicants`; add `gambling` (en: gambling/betting/wager; ar: ميسر; fa: قمار). | Concept data is UNREVIEWED. Implemented in part 2026-11-01: `gambling` added, `wine`/`gambling` have verse exclusions, weight now 0.5. |
| D | **Cross-field term-coverage bonus**: at fusion, boost documents that match more distinct query terms across fields (2:219 matches both; Paradise verses match one). | Changes RRF semantics; must not degrade direct hit@5. |
| E | **Dense retrieval (M3)**: semantic candidate generation. | Long-term; embeddings can still conflate the two wine senses. |

**Recommended first experiment:** A + C, measured on the pilot split by
language, plus a small new issue set containing this query and its English
counterpart. Acceptance: direct hit@5 must not fall; paraphrase must not fall;
2:219 must enter the top 5 for both queries. Never tune on `eval/blind.json`.

### Test queries for the issue set

- fa: `شراب و قمار` → expect 2:219, 5:90, 5:91
- fa: `شراب` → expect 2:219, 5:90, 5:91 (currently 2:219 is #20)
- en: `What does the Quran say about wine?` → expect 2:219, 5:90, 5:91
- en: `What does the Quran say about alcohol and gambling?` → 2:219 currently #3
- control: en: `What does the Quran say about patience?` → unchanged

---

### v0.1.1 result — D + A (2026-10-31, branch `fix/bug-001-v0.1.1`)

Implemented, not yet merged/tagged/deployed:

- **D — cross-field full-question coverage at fusion.** The query is grouped into
  content terms (ZWNJ split/joined forms and inflections merge; stopwords and
  frame terms are dropped; punctuation separates topics). A fused candidate's
  score is multiplied by `1 + coverageAlpha` only when it matches **every**
  eligible query group across the literal ar/en/fa lists. Partial coverage is
  deliberately not rewarded: an earlier fractional version lifted unrelated
  2:219 to rank 1 for «درباره نحوه سخن گفتن با مردم راهنمایی وجود دارد؟»
  because the question shares «مردم», «وجود» and «دارد» with that verse.
  Concept lists never count; a single-group query is a no-op.
- **A — language-aware Arabic weight.** When the request language is `fa` and
  the Persian literal list covers at least **two** query groups, the Arabic
  literal list's RRF weight is **0.3**. The request language is used, not script
  detection, because «شراب و قمار» is valid Arabic script too. The two-group
  gate prevents a recall regression on Arabic-script questions typed in the
  Persian UI: «الخمر والميسر» is Arabic, and the Persian list finds only
  «ميسر» (2:280), so down-weighting Arabic there hid 2:219.
- Both implementations: `pipeline/lib/retrieve.ts` and `worker/src/retrieve.ts`.
  `ask()` passes the detected language; `eval.ts` and `eval-d1.ts` pass the
  item language.

Measured with `limit: 50` (card cutoff remains 5):

| query | v0.1.0 rank (memory / D1) | v0.1.1 rank (memory / D1) |
|---|---:|---:|
| fa «شراب و قمار» | 7 / 8 | **3 / 3** |
| fa «شراب» | 20 / 20 | 20 / 20 (v0.2.0) |
| en "What does the Quran say about wine?" | 7 / 7 | 7 / 7 (v0.2.0) |
| en "What does the Quran say about alcohol and gambling?" | 3 / 3 | 3 / 3 |

*SUPERSEDED 2026-11-01 by the keyword layer: without changing A or D, fa
«شراب» now puts 2:219 at #9 in-memory / #6 in D1, and en "wine" at #7 / #4.
Both still fail the v0.2.0 `require_all` item (the rest of the prohibition
cluster is outside the top 5), so the planned subject layer is unchanged.*

Variant isolates (2:219 rank, memory / D1): base 7/8; A alone 6/7; D alone
3/3; A+D 3/3. For the reported query, both paths return top 5:
in-memory `5:90, 5:91, 2:219, 37:45, 56:18`; D1 `5:91, 5:90, 2:219, 37:45,
83:25`. The false friends 24:31 (خُمُر = veils) and 2:280 (ميسرة = deferment)
are not in the top 5.

Evidence:

- `eval-issues.ts --phase v0.1.1`: **6/6 PASS in both paths**, including both
  patience controls, the patience sentence, and the Arabic-script query.
  `eval/issues/bug-001.json`.
- Pilot in-memory: hit@5 **48.5%** (32/66); direct **52.0%** (26/50);
  paraphrase **37.5%** (6/16); MRR **0.383**.
- Pilot D1: hit@5 **47.0%** (31/66); direct **48.0%** (24/50); paraphrase
  **43.8%** (7/16); MRR **0.372**.
- The pilot numbers above include the keyword-layer work done after A+D:
  concept weight 0.5 (was 0.1), stem-expanded trigger/field matching, concept
  coverage opt-out, Arabic-prefix stemming, and new/cleaned synonym entries.
  The A+D ablation itself adds +3.0 hit@5 with no paraphrase loss
  (`ablate-fusion.ts`), after the Persian light-verb fix below.
- Ablation acceptance PASS: overall hit@5 does not fall, direct and paraphrase
  within 2 points. Arabic-weight sweep is flat on hit@5/direct/paraphrase from
  0 to 0.45; MRR at 0.3 is 0.228 against 0.218 at 0.6. The gate removes the old
  collateral: the patience sentence's gold 2:153 stays at rank 18 instead of 36.
- Tests: 210/210. Blind set unchanged and **not run**.

Still open: fa `شراب` (#20) and en "wine" (#7) need the reviewed verse→subject
layer in v0.2.0. This entry stays **PARTIALLY FIXED**, not FIXED.

---

## Template

```
## BUG-XXX — <one line>
- Status / Severity / Reported / Language
- Query:
- Expected:
- Actual:
- Measured:
- Root cause:
- Fix candidates:
```
