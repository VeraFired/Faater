# CHALLENGES — known blockers and their status

Every item here is something that will bite if forgotten. Status: 🔴 open · 🟡 mitigated · 🟢 resolved.

---

## 🟢 Basmala fused into verse 1 of 113 surahs
Tanzil prepends `بِسْمِ اللَّهِ الرَّحْمَـٰنِ الرَّحِيمِ` to the first verse of every surah except At-Tawbah. QuranEnc translations **do not include it** — verified 2:1 Arabic `بسم الله الرحمن الرحيم الم` vs English `"Alif, Lām, Meem.[7]"`.

**RESOLVED 2026-10-31 (M0 step 2).** Split into `basmala` / `body` / `bodyNorm` fields with the verse bytes untouched. Shape verified: **113 verses carry it — 112 prefixes (surahs 2–114 except 9) + 1:1 as a whole verse**, which is genuine scripture, not a prefix. 27:30's mid-verse basmala is left alone.
**Index rule:** FTS uses `bodyNorm`, **never** `arabicNorm` — otherwise the basmala is indexed 112 extra times and BM25 is corrupted for the three most common words in the corpus. A test asserts no verse body begins with the basmala key.
**Proof:** the translation-extent test — for all 112 prefixes, neither the English nor the Persian translation *begins* with a basmala translation. (`startsWith`, not `includes`: 96:1 legitimately reads "Recite in the name of your Lord".)

## 🟢 QuranEnc inline footnote markers
API returns a separate `footnotes` field plus inline `[7]`, `[98]`, `[464]`, `[2011]` in the text. Shipping verbatim leaves dangling markers; stripping modifies a no-modification translation; showing them is tafsir.

**RESOLVED 2026-10-31 (M0 step 3) — see ADR-014.** Ship verbatim as lossless segments; render `(N)` as the verse-number badge and `[N]` as a superscript linked to the translator's own footnote behind a disclosure (`tafsir_shown: true`). Nothing is added, modified or deleted.
**Persian edition has ZERO footnotes and zero markers** — this was never a Persian problem.
**Live source defect:** `english_saheeh` 7:143 cites `[403]` but the edition's footnotes stop at `[402]`. Recorded in `unresolvedNotes`; the renderer must emit a bare superscript. **Condition 5 obliges us to notify QuranEnc** — outstanding action.

## 🟡 QuranEnc condition 5 — report the 7:143 defect
The terms require notifying the source of any note on the translation. We found one: `english_saheeh` v1.1.2, 7:143, marker `[403]` with no footnote.
**Fix:** send a report to QuranEnc and archive the outbound message + any reply in `data/source/quranenc/`. Not blocking the build.

## 🟡 QuranEnc condition 6 — edition updates are mandatory
The terms require updating to the latest edition. Both editions are pinned by hash, so an upstream release will fail the build loudly rather than silently.
**Fix:** a scheduled check of `catalog.json` versions; re-fetch, re-hash, re-run the translation tests, and record the version bump in PROGRESS.

## 🟡 Reference parser: spelled-out numbers unsupported
«آیه دویست و پنجاه و پنج» and "Surah Al-Baqarah verse two hundred fifty five" return null.
**Why it is acceptable:** null routes to the no-evidence refusal. A half-built number parser would guess, and a wrong reference silently answers the wrong verse.
**Fix if demand appears:** a Persian/English number-word parser behind a test that every produced reference re-validates against the corpus.
**Owner:** post-M0, driven by production refusals.

## 🟡 Persian ZWNJ residual recall gap
Persian uses ZWNJ in 5,052 of 6,236 verses. Dual search keys (split + joined) close most of the variation, but a joined query misses verses where the translator wrote a **real space** instead. Measured: «می‌خواهد» → 40 verses, «میخواهد» → 39.
**Impact:** small recall loss, never a wrong answer.
**Fix if it matters:** a space-stripped index variant. Rejected for now — it trades precision for recall. Re-measure with real Persian queries in the M0 blind eval before revisiting.

## 🔴 Persian is the weaker peer
One translation, one unvalidated default, hand-authored surah names, **no benchmark**, no Finglish support, no answer to Iranian reachability.
**Impact:** the product promise "English and Persian as equals" is not yet true.
**Fix:** native review budget for all copy and every concept card; hand-build 300 Persian eval items; decide the Finglish policy; test from Iranian networks.
**Owner:** M0–M2.

## 🔴 No public Persian Quran-QA benchmark
QRCD and AyaTEC are Arabic. IslamicFaithQA is Arabic/English. Nothing Persian with refusal labels.
**Fix:** build internally — 300 items minimum, grouped, with a cross-lingual slice.
**Note:** absence claims are bounded by search; this is a gap, not a proven non-existence.

## 🔴 Sensitive-topic handling is undefined and is a duty of care
No detector, no verse-level sensitivity metadata, no precedence rules, no crisis branch.
**Impact:** a user in crisis gets verse cards; a reference to 9:5 or 4:34 bypasses query-text classification entirely.
**Fix:** authored `sensitivity` metadata per verse (not inferred at request time); larger canonical windows; two named translations + two named tafsirs; fixed scholar-approved framing; **separate safety escalation** for self-harm, domestic abuse, medical, legal.
**Owner:** M0 scoping, M6 governance.

## 🔴 Fiqh detection has false positives and false negatives
"Masjid al-**Haram**" contains "haram"; «مجاز» also means figurative. Misses: "Can I pray while traveling?", "Is crypto halal?".
**Fix:** learned classifier is primary, marker lists are recall boosters only. Boundary notice is fixed copy.

## 🟡 Dar al-Ifta ruling is secondary-sourced
January 2026 reports (Gulf News, IQNA, TIME) that Egypt's Dar al-Ifta ruled AI Qur'an interpretation impermissible. **Not confirmed against a primary source** — the critic's check could not verify it.
**Action:** do not publish it as fact. The design is already compatible (no model-authored interpretation), so it changes nothing operationally.

## 🟡 10 ms CPU ceiling
Measured: 7.9–9.6 ms for an int8 scan over 6,236 vectors at 1024-d, before fetch/parse/sort. Budget is 10 ms total.
**Mitigation:** binary prefilter + int8 rerank of top 512. Escape hatch: Workers Paid at $5/mo removes the cap.

## 🟡 Free-tier numbers are unstable
Every figure is dated 2026-10-31. Gemini, OpenRouter and NVIDIA could **not** be verified from this network (HTTP 403). Turso's free tier is unverified.
**Mitigation:** cascade built around Workers AI (verified), config in one file, retrieval-only floor.
**Rule:** re-verify before relying; mark stale facts `SUPERSEDED <date>`.

## 🟡 Translation provenance is not neutral
Sahih International (Noor International Center) and Rowwad (Iranian) carry institutional and theological provenance. Switching UI language visibly changes the theology on screen.
**Mitigation:** always offer multiple editions, label each, disclose the default rationale on the Methodology page.

## 🟡 "No tafsir" does not mean "no interpretation"
Translation choice, verse selection, context windows and the sensitivity taxonomy are all interpretive acts.
**Mitigation:** scholar board with credentials and madhhab balance; correction SLA; pre-launch review of every sensitive card.

## 🔴 Retrieval score cannot refuse — measured, not assumed
The M0 pilot (100 items) measured every candidate gate signal (top, gap, ratio, top3mean, top5sum, z, nHits, fieldCount) for separation between answerable and should-refuse items.

| refusal type | n | raw AUC | refusal recall at ~4.5% false refusal |
|---|---:|---:|---:|
| out-of-domain | 12 | 0.846 | 66.7% (8/12) |
| **in-domain unanswerable** | 18 | **0.551** | 11.1% (2/18) |
| adversarial | 4 | 0.470 | 0.0% (0/4) |

**Update 2026-11-01 (keyword layer) — the numbers moved, the conclusion did not.**
On the current pilot the strongest signal is `top` at AUC 0.817 (`top3mean`
0.815, `fieldCount` 0.808, `top5sum` 0.805); separation by refusal type is
**OOD 0.933, adversarial 0.799, in-domain unanswerable 0.744**. The table above
came from an index with much weaker answerable retrieval and is superseded.
At the illustrative 4.5% false-refusal point (3/66) the same signal catches
**83.3% (10/12)** of out-of-domain questions but **38.9% (7/18)** of in-domain
unanswerable ones — a 0.189 AUC gap, and the in-domain group is exactly the one
a threshold cannot catch. **No operating point is certified:** with 66
answerable items, zero false refusals still allows a 5.4% upper bound, above the
5% budget, and the 34 should-refuse items are 17 paired EN/FA questions, so a
zero-error result still permits 19.5% per language. G1 remains mandatory.

The best earlier signal was **`nHits` (query coverage) at 0.645** — weak, and it is capped by the 50-candidate search limit. On the old index every score-shape signal (`top`, `gap`, `ratio`, `top3mean`, `top5sum`, `fieldCount`) was **0.505–0.543 — indistinguishable from chance**.

**The in-domain number is the important one.** "How many rak'ahs are in the Fajr prayer?" retrieves nearly as much evidence as "What does the Quran say about patience?", because it is dense with prayer vocabulary. At the same false-refusal rate that catches 83% of out-of-domain questions, a threshold catches **39%** of these — and the pilot's 34 should-refuse items cannot certify any threshold. A gate that fires on the wrong nine of eighteen is not a product.

**Consequence:** G1 (scope classification on the question) is mandatory and cannot be replaced by a retrieval threshold. G2 remains a floor for the out-of-domain case only. This is now evidence rather than a design assumption.

> **Correction 2026-10-31 (step 5c).** An earlier run reported **0.337 — below chance** for this row.
> That was an artifact: the Arabic field was answering Persian questions with verses that only
> mentioned «قرآن», which inflated in-domain evidence. After the frame-only fix the honest value
> is 0.551. The conclusion is unchanged and cleaner: no separation, not inverted separation.

## 🔴 Lexical retrieval cannot bridge paraphrase — the concept layer is load-bearing
Pilot hit rate on gold refs: **hit@5 27.3%, hit@10 36.4%, hit@20 50.0%, hit@50 66.7%**. A third of gold verses are not retrievable at all.

Split by answer type at k=5, the aggregate is misleading and is now never quoted pooled:
- **direct 36.0%** hit / 16.9% gold recall (n=50)
- **paraphrase 0.0%** hit / 0.0% gold recall (n=16)

Inspection shows these are **vocabulary mismatches, not ranking failures**:
- the query says "charity"; the translation says *"spend their wealth"* (2:261)
- the query says "alcohol"; the translation says *"intoxicants"*
- the query says "modesty"; the translation says *"modest"* / *"guard their private parts"*

The top-5 for "charity" (57:18, 2:263) and "arrogance" (23:67, 7:206) are genuinely about those topics — they are simply not the verses on the gold list. So hit@k here is a **lower bound**, and the gold lists are the weak part of the instrument.

**Consequence:** synonym/concept expansion was scheduled at M4. The evidence says it is needed before the slice is usable, because a user's vocabulary is not the translator's. Priority raised; the *mechanism* (query expansion from a reviewed concept table) should land with M1's retrieval, even if the full 400–800-card corpus stays at M4.

**Update 2026-10-31 (step 5d).** The mechanism now exists: 83 concepts with corpus-verified synonyms, fused as separate BM25 lists at RRF weight 0.1. Measured on the same pilot: paraphrase hit@5 **0.0% → 6.3%** (one item), direct unchanged at 36.0%, MRR 0.224. Unweighted fusion was rejected because it bought 12.5% paraphrase by halving direct precision. This is a **proof of mechanism, not a fix**: 15/16 paraphrase items still miss. Dense retrieval (M3) remains the intended remedy.

**Update 2026-10-31 (M1 slice 1).** A second frame-term defect surfaced while porting to D1: the word "quran" matched the *quran concept*, so a question whose topical word was absent from the translation expanded into verses that merely mention the Book. Concept matching now ignores frame-only triggers whenever the query has content words. Pilot effect: hit@5 28.8% → 27.3%, direct 36.0% → 34.0% — the removed hits were correct-looking garbage.

**Update 2026-10-31 (hardening).** After the ۀ (Persian heh with hamza) fold and the verbatim segment join, the pilot was hit@5 **28.8%**, direct 34.0%, paraphrase **12.5%** (2/16), MRR 0.215; D1 parity 30.3% / 34.0% / 18.8% / 0.229.

**Update 2026-11-01 (keyword layer).** Concept lists stopped being divided by the fraction of synonyms matched, trigger matching became stem-aware, generic concepts were demoted, and the weight moved to 0.5. The layer now carries 95 concepts (new: healing, gambling, backbiting, usury, inheritance, neighbour, remembrance, insult, modesty, arrogance; generosity folded into charity). Pilot: hit@5 **48.5%** in-memory / **47.0%** D1, paraphrase **37.5% / 43.8%**, MRR 0.383 / 0.372. Six of sixteen paraphrase items still miss; dense retrieval (M3) remains the intended remedy for those, and for the long-verse bias (17:23, 2:285 never reach the head).

## 🟡 Concept synonyms are unreviewed — search-only, but still load-bearing
The synonym file was drafted by agents and verified only for **corpus existence**, not for **sense**. `df.ts` proves a term occurs; it cannot prove «صدقه» is the right Arabic term for the concept "charity" in every verse it touches. Moving a wrong-sense verse into the candidate set is invisible until a human reads it.
**Mitigations in place:** synonyms are never displayed; the file is labelled `_review: UNREVIEWED`; content rules already forbid interpreting.
**Required before any ship:** a native EN + FA reviewer passes all 95 concepts; re-run the ablation after review, because edits change the measured weight plateau.

## 🟡 The concept weight was tuned on the pilot it is measured on
`conceptWeight = 0.5` (was 0.1) was chosen from a sweep on `eval/pilot.json`,
after the concept-list scoring and trigger matching changed. The chosen point
is a mechanism choice (a concept rank-1 ties a literal rank-2), not the sweep
maximum — 0.7 and 1.0 scored higher on MRR but cost direct head ranks. With
**16 paraphrase items, one item is 6.3 points**, and the same set produced the
number being quoted.
**Rule:** report the direction, not the effect size; do not treat 0.5 as
validated until a fresh blind set confirms it on changed code.

## 🟡 Evaluation is underpowered as originally scoped
With 75 unanswerable items per language, one error is 1.33% — a "≤2% false answer" target cannot be measured. The original 2% / 10% / 95% targets were mutually inconsistent.
**Measured power (2026-10-31, pilot):** 17 should-refuse items **per language** → a zero-error result still permits a **19.5%** true rate. The two languages are paired translations of the same questions and are never pooled: quoting a 34-item bound (10.3%) would pretend to a precision the design does not have. To claim an upper bound of 2% at 95% confidence with zero errors you need **183 unanswerable items per language**; for 5%, **72**.
**Also measured:** the *false-refusal* budget is not certifiable at pilot size either — 66 answerable items with **zero** false refusals gives a 95% upper bound of 5.4%, above the 5% target. The sweep therefore reports no certified operating point and labels the point-estimate optimum as illustrative.
**Fix:** size the set to the target or report intervals; never quote point targets that the sample cannot support.

## 🟡 Worker is public and unauthenticated
One abuser can burn 10,000 neurons and 100k requests/day, degrading everyone to cards.
**Required:** Turnstile, the one free WAF rate-limit rule, per-IP daily cap in D1, origin check, hotlink protection on index assets.

## 🟡 Licensing is not fully cleared
QuranEnc embedding rights, ClearQuran under CC BY-ND for search indexing, and font licences are all unverified.
**Required:** archive terms at build; `docs/licensing.md` tracing every shipped file; legal review before launch.

## 🟡 Font metrics and harakat rendering unverified
Amiri Quran / KFGQPC / Vazirmatn claims could not be fetched. Stacked marks (shadda+fatha, superscript alef) may clip on low-end Android.
**Fix:** device lab before launch; line-height ≥ 1.8, no letter-spacing.

---

## Resolved

## 🟢 Corpus integrity
6,236 verses / 114 surahs / 1,353,702 bytes / SHA-256 `b3638f5cf03e2b05e4000efc0e4b656aafb3cf6ed28f8770b6497c5b43c46089` — verified.

## 🟢 Whether a vector DB is needed
No. See ADR-008.

## 🟢 Whether Cloudflare's reranker can be used
No — `bge-reranker-base` is Chinese/English only. See ADR-009.