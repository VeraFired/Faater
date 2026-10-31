# PROGRESS — single source of truth

Append-only. Date every entry. Record failures as loudly as successes.
If a session dies mid-build, the next one resumes from this file alone.

**Current status:** `M0 step 5d complete`; `M1 slice 1 complete` (D1 FTS5 seed + zero-AI Worker answer path, 148 tests green). Public launch is blocked on **G1** — retrieval scores cannot refuse in-domain unanswerable questions (pilot AUC 0.551, chance) — and on the M0 step 6 scholar review.

---

## 2026-10-31 — Planning complete

**Done**
- Verified the corpus: 6,236 verses / 114 surahs / 1,353,702 bytes / SHA-256 `b3638f5c…c46089`.
- Ran 17 research agents over 8 dimensions (~2.35 h, ~1,960 tool calls), plus a dedicated abstention-research agent (~35 min, 192 tool uses).
- Ran 3 independent architecture proposals, an adversarial judge panel, and a completeness critic.
- Owner decisions captured: hybrid answers, KB scope, silent degradation, Cloudflare-first.
- Plan approved.

**What was learned (the short version)**
- A design whose $0 depends on a free LLM quota is a traffic bet. Free LLM ceiling ≈ 1,000–1,500 short answers/day.
- The winning architecture (52/60) never lets a model write the answer.
- A single cosine threshold cannot gate refusal (AUROC 0.583 vs 0.724 for top1−top5 gap).
- Prompting a model to abstain does not work (40–99.3% of insufficient-evidence questions still answered).
- The scope gate must be **three-way**, not binary — "Islamic but not Quranic" is a real class.
- Two live content defects found in the corpus: fused basmala, and QuranEnc inline footnote markers.

## 2026-10-31 — M0 step 1 complete: data pinned

**Done**
- Pinned three Tanzil sources into `Resources/`, hashes in `data/sources.lock.json`:
  - `quran-simple.txt` — 1,353,702 B — `b3638f5c…c46089`
  - `quran-simple-clean.txt` — 745,035 B — `2559f385…8027af`
  - `quran-data.xml` — 77,234 B — `8867c1d8…c5c7a`
- Added `.gitattributes` marking all three `-text` so Git never rewrites line endings. Verified the staged blob hash equals the working-file hash.
- Ran the normalized agreement cross-check: **6,236 / 6,236 = 100.00%**, zero mismatches.

**Verified independently**
- The basmala fusion is real and is a **Tanzil convention, not corruption**: Tanzil's own clean text has `2:1 = بسم الله الرحمن الرحيم الم`, and `9:1` has none.
- Precise shape: **1:1 is genuinely verse 1 of Al-Fatiha** (the only line that is the basmala alone). Surahs **2–114 except 9 get it prepended — 112 prefixes**. So 113 surahs show a basmala, 9 shows none.
- 100% agreement means both files carry the same fusion, so the cross-check alone **cannot** detect it. The basmala test must assert against the translation extent, not against clean-text agreement.

**Next action**
- M0 step 2: basmala segmentation — split into a `basmala` field, index once as a pseudo-document, add the three tests.

## 2026-10-31 — M0 step 2 complete: basmala segmented

**Done**
- `pipeline/` created with Node 24 native TypeScript — **zero dependencies, no build step**.
  - `lib/normalize.ts` — one canonical search alphabet (Arabic base letters), Arabic/Persian folding, mark stripping, ZWNJ dual forms, digit folding, script detection.
  - `lib/basmala.ts` — 4-token prefix split, lossless, raw bytes preserved.
  - `build-corpus.ts` — verifies the hash before parsing, then asserts 6,236 verses / 114 surahs / contiguous numbering / surah-ayah counts vs metadata / 113 basmala verses / 28-line copyright block. Emits `data/build/corpus.json` (5.7 MB, gitignored).
- Corpus records now carry `basmala`, `body`, `bodyNorm`, `basmalaIsWholeVerse` **alongside** unmodified `arabic`.
- **35 tests green** (`pnpm test`).

**Design decision made during the build**
- The FTS index must use **`bodyNorm`**, not `arabicNorm`. Using the whole verse would index the basmala 112 extra times and inflate the document frequency of الله/الرحمن/الرحيم — the three most common words in the corpus — corrupting BM25 where it matters most. A test now guards this: no verse body may *start with* the basmala key.
- 1:1's `bodyNorm` is empty on purpose: its entire content is carried by the single `basmala` pseudo-document, which points at 1:1. No duplication, and a basmala query still resolves to 1:1.

**Broke / would have broken**
- First test run: 2 failures, **both test bugs, not build bugs**.
  - Expected prefixes on surahs 1–114 minus 9; correct set is **2–114 minus 9** — surah 1 is excluded precisely because its basmala is a whole verse.
  - A literal-diacritics assertion on 2:255 failed because the source spells `إِلَـٰهَ` **with a tatweel**. Rewrote it to compare on the normalized key. Lesson: never assert on corpus diacritics literally.
- `joinedVariants` initially stripped ZWNJ before varying it, collapsing both forms into one and silently defeating the function. Caught by its own gold test; fixed.

**Still open from this step**
- The plan's **translation-extent** test (Arabic words ⊆ translation coverage) is *not* written yet — it needs translations, which arrive in step 3. The Arabic-side guarantee is complete; the cross-artifact half is not. Do not mark this closed until the translations land.

**Next action**
- M0 step 3: QuranEnc footnote policy — fetch `english_saheeh` + `persian_ih` (Rowwad), archive the terms page and the fetched JSON, decide markers-with-footnotes vs a marker-free display edition, then write the translation-extent test.

## 2026-10-31 — M0 step 3 complete: translations pinned, footnote policy decided

**Done**
- Fetched the QuranEnc **catalog** and discovered the editions ship as **SQLite downloads** — one file each instead of 6,236 API calls.
- Pinned into `data/source/quranenc/` (all hashed in `sources.lock.json`):
  - `english_saheeh.sqlite` — Noor International Center, **v1.1.2**, updated 2025-06-24
  - `persian_ih.sqlite` — Rowwad Translation Center, **v1.1.3**, updated 2026-02-23
  - `catalog.json`, and an archived copy of the terms page (`about-en.html`)
- Archived the terms **verbatim**. Condition 1 reads: *"No modification, addition, or deletion of the content."*
- `pipeline/lib/translation.ts` — lossless segmenter. `build-translations.ts` verifies hashes, then asserts 6,236 rows, ref alignment with the corpus, byte-exact rejoining, and that each edition's own `(N)` matches its ayah number.
- **49 tests green.** `node:sqlite` is built in, so the pipeline still has zero dependencies.

**Facts that changed the decision**
| | English | Persian |
|---|---|---|
| Verses with footnotes | **1,613 (25.9%)** | **0** |
| Inline `[N]` markers | 1,904 | **0** |
| Dangling markers | **1 — 7:143/#403** | 0 |
| Leading `(N)` prefix | 6,236 / 6,236 | 0 |

- **The footnote problem is English-only.** Persian is marker-free; it never needed a policy.
- Every English verse begins with `(N)`, its own ayah number. Stripping it would break condition 1.
- Persian uses `[ ... ]` for translator glosses («[و سپاس‌ها]») — a naive bracket stripper would delete words from a no-modification edition.

**Decision (ADR-014).** Store verbatim; split into `text` / `num` / `note` segments. The renderer *uses* `(N)` as the verse-number badge (shown once, not deleted) and renders `[N]` as a superscript pointing at the translator's own footnote behind a disclosure, `tafsir_shown: true`.

**Translation-extent test written — the half deferred from step 2 is now closed.** For all 112 basmala prefixes, neither translation *begins* with a basmala translation. The assertion is `startsWith`, not `includes`: 96:1 legitimately reads "Recite in the name of your Lord".

**Broke / would have broken**
- A naive "no prefix verse mentions the basmala" test would have failed on 96:1 and wrongly condemned a correct split. Caught before writing it.
- `searchText` must exclude marker and number tokens, or a query for the string "2011" retrieves a verse about divine unity.

**License obligations now tracked in CHALLENGES**
- Condition 5: report the 7:143 `[403]` defect to QuranEnc (not blocking).
- Condition 6: update to the latest edition — hash pinning makes an upstream release fail loudly instead of silently.

**Next action**
- M0 step 4: Persian normalizer with a real gold corpus — ZWNJ dual forms, Finglish policy (`sabr`, `namaz`), and hand-authored Persian surah names (`nameFa` is still `null` for all 114).

## 2026-10-31 — M0 step 4 complete: Persian gold corpus, Finglish policy, surah names

**Done**
- **Persian surah names** hand-authored for all 114 (`data/lexicon/surahs.fa.json`), with alternates where a second name is standard (فاتحه/حمد, اخلاص/توحید, مسد/تبت, غافر/مؤمن, شرح/انشراح, اسراء/بنی‌اسرائیل). `nameFa` is no longer null. **Marked `_review: unreviewed`** — native sign-off is still owed.
- **Finglish policy decided and implemented** (ADR-015): curated aliases, **never** a general transliterator. 83 concepts + 19 proper names + 114 derived surah aliases = **476 keys**.
- **ZWNJ dual keys** (ADR-016): every Persian verse now carries `searchText` (ZWNJ as separator) and `searchTextJoined` (ZWNJ removed). Queries emit both.
- **Persian gold tests against the real Rowwad translation**, not toy strings.
- **69 tests green.**

**The measurement that justifies the whole step**
- 36 common Persian religious terms, routed correctly: **36/36 retrievable.**
- The same 36 terms used raw, without `normalize()`: **14 return ZERO.** «پیامبر» and «ایمان» — among the most common words in the file — match nothing, because the index holds Arabic yeh while a Persian keyboard emits Persian yeh.
- ZWNJ is load-bearing: **5,052 / 6,236** Persian verses contain it. «می‌خواهد» → 40 verses, «میخواهد» → 39.

**Broke / would have broken**
- `finglishKey` collapsed vowel *pairs*, so removing the apostrophe from "Ma'aarij" left a three-vowel run and produced a key the canonical form could never reproduce. Fixed with a fixed-point loop over the digraph table.
- A first draft asserted «می‌خواهد» and «میخواهد» retrieve **identical** sets. They do not, and the reason is legitimate: one verse uses a real space where a user types no separator. Changed to assert the safe direction (`joined ⊆ split`) and capped the gap, rather than weakening the test until it passed.
- The Persian-term probe initially reported 22/36 — I had searched for unnormalized terms. The false zeros were the failure mode itself.

**Open**
- Persian surah names and all Persian copy still need a native reviewer (CHALLENGES: Persian is the weaker peer).
- ZWNJ residual gap tracked as 🟡.

**Next action**
- M0 step 5: reference parser with fuzzing — `2:255`, `2:255-257`, «آیه ۲۵۵», «سوره بقره آیه ۲۵۵», "Surah Al-Baqarah 255", spelled-out numbers, and decimal guards (`2.5` must not parse as 2:5). Fuzz it; a wrong reference silently answers the wrong verse.

## 2026-10-31 — M0 step 5 complete: reference parser, fuzzed

**Done**
- `pipeline/lib/reference.ts` — parses numeric refs, ranges, Persian and English surah-name forms, and Finglish surah names, returning `single` / `range` / `surah` / `invalid`.
- Out-of-range is an explicit `invalid` with a reason (`no-such-surah`, `ayah-out-of-range`, `reversed-range`, `cross-surah-range`) so the UI can serve its own refusal copy instead of pretending nothing matched.
- **24 reference tests, 96 total, all green.** Includes 5,000 numeric-noise fuzz cases, 3,000 arbitrary-Unicode cases, and an exhaustive round-trip over all **6,236** verse refs.

**The bug that mattered**
- `normalize()` exists to build search keys, so it turns punctuation into spaces — `2:255` becomes `2 255`. Using it for reference parsing silently destroyed every reference. Added `normalizeStructural()`, which folds letters and digits but **preserves `:`, `-`, dashes and `.`**. Two views of one query: structural for numbers, words for names.
- Preserving `.` is deliberate: it keeps `2.5` as one token so the parser can **reject** it, rather than seeing `2` and `5` and inventing a verse.

**Discovered while testing**
- Tanzil's `ename` is the English *meaning* ("The Cow"), not the transliteration ("Al-Baqara"). English users type "Al-Baqarah", "Al-Fatihah" — with a trailing `h` Tanzil omits. Added a general trailing-`h` variant at lookup time instead of hand-listing 114 spellings.
- Persian «آیه» normalizes to `ايه` (آ→ا, ی→ي). The first marker list used the unfolded spellings and matched nothing.

**Deliberately NOT supported (returns null, tested)**
- **Spelled-out numbers** — «آیه دویست و پنجاه و پنج», "verse two hundred fifty five". A half-working number parser guesses; returning null routes to the no-evidence refusal, which is correct.
- **Bare ayah numbers** — "255" and «آیه ۲۵۵» with no surah. There is no safe way to pick a surah.
- **Decimals** — `2.5`, `3.14` never parse.

**Next action**
- M0 step 6 — the last one: a **100-item blind bilingual eval** with a scholar reviewer. Sets must be grouped by topic, split train/calibration/blind, and sized so the claimed interval is actually measurable (with 75 unanswerable items per language, one error is 1.33% — the power check comes first).

---

## 2026-10-31 — M0 step 5b: vertical-slice retriever + eval harness

Built so that step 6 has something real to evaluate. Not a step in the plan, but a prerequisite:
a 100-item eval of a retriever that does not exist measures nothing.

**Done**
- `pipeline/lib/bm25.ts` — per-field BM25 with coverage weighting and a contiguous-phrase bonus; `rrf()` for fusion.
- `pipeline/lib/retrieve.ts` — three fields (`ar` bodyNorm, `en` searchText, `fa` searchText+joined), Finglish expansion, direct-reference short-circuit, basmala shortcut.
- `pipeline/lib/stem.ts` — conservative Arabic light stemming (dual-indexed) and English inflection variants.
- `pipeline/lib/stopwords.ts` — EN + FA query-side stopwords, frame terms, English language markers, `foldEnglish`.
- `pipeline/lib/stats.ts` — Clopper-Pearson, Wilson, beta quantile, AUC, `itemsForUpperBound`.
- `pipeline/eval.ts` + `eval/pilot.json` — 100 pilot items (50 EN / 50 FA), signal extraction, AUC, threshold sweep, power check.
- **118 tests green.** Index build ~300 ms for 6,236 verses × 3 fields.

**Five defects the eval exposed — every one was silent**

1. **English text was not matchable.** The translation writes «qurān» with a macron (U+0101) and «Qur'an» with an apostrophe; `normalize()` turns punctuation into spaces, so the token was `qur`+`an` or `qurān`. Typing "quran" matched **0 of 6,236** English verses. Fixed by folding NFD → strip combining marks → strip apostrophes, applied to the English **search** field only.
2. **The Finglish expander hijacked English questions.** "What does the Quran say about patience?" had `quran` resolved as a Finglish key, injecting Persian «قرآن» into the Arabic field; `ar` and `fa` then agreed on six tiny verses containing «القرآن» and outvoted the English list in RRF. Fixed with an English-function-word language guard.
3. **No stopwords, so the question frame won.** "say" appears in 647 English verses; «درباره» ("about") in only **12** Persian verses, which gives it a *high* idf — so every Persian question phrased «درباره X چه می‌گوید» returned those same 12 verses regardless of X. Rare is not informative.
4. **Persian stopwords written in Persian orthography could never match.** `normalize()` folds ک→ك, ی→ي, آ→ا, so a set literal containing «که» never equals the query token «كه». The set is now derived through the normalizer, in both ZWNJ-split and joined forms.
5. **Coverage counted stopwords as evidence.** `informative` was `idf > 0` on a clamped idf, which is true for almost every term; "the" (3,958 of 6,236 verses) scored as informative. Now `df < n/2`, matching BM25's sign convention.

**Measured (pilot set, NOT blind-reviewed, NOT scholar-reviewed)**

| metric | all | en | fa |
|---|---:|---:|---:|
| hit@5 | 27.3% | 30.3% | 24.2% |
| hit@10 | 39.4% | 45.5% | 33.3% |
| hit@20 | 51.5% | 51.5% | 51.5% |
| hit@50 | 68.2% | 69.7% | 66.7% |
| MRR (50 candidates) | 0.198 | — | — |

> **SUPERSEDED 2026-10-31 by step 5c.** hit@10 / hit@20 / hit@50 and every AUC below changed
> when the frame-term defect was fixed (hit@10 36.4%, hit@20 50.0%, hit@50 66.7%). The 5c
> entry is the current measurement.

**The decisive result: retrieval score cannot refuse.**
- Global AUC for the score-shape signals (top, gap, ratio, top3mean, top5sum, fieldCount) is **within noise of 0.5**.
- Out-of-domain questions separate weakly (AUC **0.715**).
- **In-domain unanswerable questions are WORSE than chance (AUC 0.337)** — "how many rak'ahs is in Fajr?" retrieves *more* verses than "what does the Quran say about patience?", because it is dense with prayer vocabulary. Adversarial prompts score 0.265 for the same reason.
- This is the measured justification for **G1 (scope classification on the question)**. No threshold on a retrieval score can ever refuse a fiqh question. Recorded in CHALLENGES.

> **SUPERSEDED 2026-10-31 by step 5c.** The 0.337 was an artifact: the Arabic field was
> answering Persian questions with verses that merely mention «قرآن», which inflated
> in-domain retrieval evidence. After the frame-only fix the honest value is **0.551 —
> chance**, not inversion. The conclusion (no retrieval threshold can refuse in-domain
> fiqh questions) is unchanged and in fact cleaner. See the 5c entry below.

**Also learned: lexical retrieval cannot bridge paraphrase.**
- hit@50 is only 68%, and the misses are vocabulary mismatches, not ranking errors: the query says "charity", the translation says *"spend their wealth"* (2:261); the query says "alcohol", the translation says *"intoxicants"*.
- Top-5 hits for "charity" (57:18, 2:263) and "arrogance" (23:67, 7:206) are **genuinely about those topics** — they are simply not the verses on my gold list. So hit@k here is a **lower bound**, and the gold lists are the weak part of the measurement, not the retriever.
- Consequence for planning: the **concept/synonym layer is load-bearing, not decorative**. It was scheduled at M4; the evidence says a synonym-expanded query is needed before the slice can be called usable. Does not change M1–M3 ordering, but does raise M4's priority.

**Not yet done**
- No gates (G0–G3) exist — this harness computes features, it does not make decisions.
- The item set is a pilot authored by me: not blind, not scholar-reviewed, and the gold lists are incomplete (see above). Step 6 still requires an independent reviewer.

**Next action**
- M0 step 6: expand the pilot toward a 100-item blind bilingual set with an independent scholar reviewer, and expand gold lists before quoting any recall number as a quality claim.

---

## 2026-10-31 — M0 step 5c: review pass, corrected measurements, regression tests

A 25-finding review of the 5b code was run (7 retrieval, 11 eval-harness, 7 test-coverage).
All were fixed before commit. The 5b numbers above are kept for the record; several are
**SUPERSEDED** here because the retriever they measured had a frame-term defect.

**Retrieval defect found by re-measuring (not on the review list)**
- The `ar` field answered Persian questions with verses that only mention «قرآن».
  «قرآن درباره ازدواج چه می‌گوید» has no Arabic content term, so the field matched the
  frame term alone and returned 4:82, 2:185, 7:204, 15:1, 5:101, 6:19 — then outvoted the
  Persian list in RRF. `searchField` now returns **nothing** when the query has content
  words but the field matched only frame terms. A bare «القرآن» query still works.
- Effect on the decisive measurement: in-domain-unanswerable AUC moved 0.337 → **0.551**
  (chance), out-of-domain 0.715 → **0.846**. The old 0.337 was an artifact of the pollution,
  not evidence of inversion. The G1 conclusion is unchanged: no retrieval threshold can
  refuse an in-domain fiqh question.
- Effect on hit@5: overall 27.3% (unchanged), but the composition is now honest.

**Corrected pilot measurements (2026-10-31, NOT blind- or scholar-reviewed)**

| metric | all | en | fa |
|---|---:|---:|---:|
| hit@5 | 27.3% | 30.3% | 24.2% |
| hit@10 | 36.4% | 45.5% | 27.3% |
| hit@20 | 50.0% | 54.5% | 45.5% |
| hit@50 | 66.7% | 69.7% | 63.6% |
| gold recall@5 | 13.2% | 12.6% | 13.7% |
| MRR (50 candidates) | 0.199 | — | — |

Split by answer type at k=5: **direct 36.0% / 16.9% recall** (n=50), **paraphrase 0.0% /
0.0%** (n=16). Pooling the two hid the entire finding; the report no longer pools them.

**Refusal signals, best feature `nHits` (coverage, capped at 50)**

| refusal type | n | raw AUC | refusal recall at ~4.5% false refusal |
|---|---:|---:|---:|
| out-of-domain | 12 | 0.846 | 66.7% (8/12) |
| in-domain unanswerable | 18 | 0.551 | 11.1% (2/18) |
| adversarial | 4 | 0.470 | 0.0% (0/4) |

**Eval harness corrections**
- The sweep now selects on the **Clopper-Pearson upper bound**, not the point estimate.
  Consequence: **no operating point is certified** at pilot size — 66 answerable items with
  zero false refusals still gives a 5.4% upper bound, above the 5% budget. 72 per language
  are needed. The point-estimate optimum is reported separately and labelled illustrative.
- Zero-error power bound is now computed **per language and never pooled**: 17 EN + 17 FA,
  zero-error upper bound 19.5% each; 183 items per language for a 2% bound, 72 for 5%.
- `hit@k` is any-gold; `gold recall@k` is the fraction of all gold refs. Both reported.
- Per-type refusal rows carry Clopper-Pearson intervals; failure rows distinguish
  "no hits at all" from "not in top 50".
- RRF-scale caveats stated in the report (`top`/`gap` are 1/(60+rank) sums; `nHits` capped).
- The finding condition no longer subtracts raw AUCs (the 5b bug that read 0.052 as 0.378).

**Retrieval corrections**
- Persian phrase bonus now actually fires (`phrase: normalizeJoined(query)`); it was dead
  because the fa query string concatenates two ZWNJ variants and appears in no document.
- `arabicVariants` derives from `body`, not the full verse — the basmala was re-embedded in
  all 112 surah-opening variant keys.
- `derive()` adds only the ZWNJ-joined form; splitting «می‌توان» smuggled «توان»
  ("power/ability") into the stopword set.
- Frame terms are **down-weighted (0.2), not deleted**, and cannot carry a list on their own.

**Tests**
- New `pipeline/tests/search-quality.test.ts` (13 tests): `foldEnglish`, the
  `ENGLISH_MARKERS` language guard (behavioural, with a stub retriever), stopword
  derivation, `englishVariants`, and the frame-only regression.
- `corpus.test.ts` now asserts the basmala is absent from all 112 opening variant keys.
- Three tests that measured less than their names claimed were renamed or scoped.
- **132 tests green.**

**Next action**
- Commit step 5c on `init`, then M0 step 6: blind bilingual set + independent scholar review.

---

## 2026-10-31 — M0 step 5d: concept synonym layer, fused at a measured weight

**What was built**
- `data/lexicon/synonyms.json`: **83 concepts**, 410 EN + 387 FA + 443 AR search terms.
  Drafted against the real corpus and verified term-by-term: **269 candidate terms were
  dropped** as dead (`df=0`), too common (>50% of documents), or wrong-sense. The build
  fails on an unknown concept id, a duplicate, or a concept with no usable term.
- `pipeline/tools/df.ts` — document-frequency probe used for that verification.
- `pipeline/tools/merge-synonyms.ts` — validates a workflow draft against `finglish.json`
  (the concept-id source of truth) and writes the artifact.
- Synonyms are **search-only metadata, never displayed, labelled UNREVIEWED**. They cannot
  put a word in front of a user; they can only move a verse into the candidate set.

**The measurement that changed the design**
- First ablation with concept lists fused at weight 1 (equal to a literal field):
  paraphrase hit@5 **0.0% → 12.5%**, but direct hit@5 **36.0% → 18.0%** and MRR
  0.199 → 0.146. Acceptance rule fixed in advance: paraphrase must rise **and** direct may
  fall at most 2 points. **FAIL.**
- `rrf()` now takes per-list weights. Concept lists are fused at **0.1**; literal
  `ar`/`en`/`fa` lists stay at 1.0. At 0.1 a concept list's rank-1 document contributes
  `0.1/61 ≈ 0.0016` against a literal list's `1/61 ≈ 0.0164`, so a concept can only
  promote a verse literal retrieval missed or ranked low — it cannot rewrite the literal head.
- Weight sweep (same pilot, same code):

| weight | hit@5 | direct hit@5 | paraphrase hit@5 | MRR |
|---:|---:|---:|---:|---:|
| 0.05 | 28.8% | 36.0% | 6.3% | 0.221 |
| 0.08 | 28.8% | 36.0% | 6.3% | 0.228 |
| **0.1 (chosen)** | **28.8%** | **36.0%** | **6.3%** | **0.224** |
| 0.15 | 28.8% | 36.0% | 6.3% | 0.212 |
| 0.3 | 25.8% | 32.0% | 6.3% | 0.178 |
| 0.4 | 21.2% | 24.0% | 12.5% | 0.160 |
| 1.0 | 16.7% | 18.0% | 12.5% | 0.146 |
| 0 (off) | 27.3% | 36.0% | 0.0% | 0.199 |

- 0.05–0.15 is a **plateau with identical retrieval and refusal numbers**, so 0.1 is a
  mechanism choice, not the argmax of noise. Acceptance at 0.1: paraphrase rises (+6.3 pt),
  direct holds (+0.0 pt), overall hit@5 +1.5 pt, gold recall@5 +1.1 pt, MRR +2.6 pt. **PASS.**
- Refusal signals did not degrade (concept lists could have lifted scores on unanswerable
  questions): `nHits` AUC 0.645 → **0.661**; OOD 0.846 → 0.868; in-domain 0.551 → 0.564
  (still chance); adversarial 0.470 → 0.477.

**Honest limits**
- The weight was selected on the same pilot set it is measured on. With 16 paraphrase items,
  one item is 6.3 points. Treat 0.1 as **provisional** until the blind set; do not report
  the +6.3 as an effect size.
- One paraphrase item bridged. The layer is a proof of mechanism, not a solved problem.
- Synonyms are unreviewed. Before shipping any concept card or showing a synonym anywhere,
  a native reviewer must pass the whole file.

**Bug found by the new tests**
- `rrf()` inserted zero-weight documents into the fused map with score 0 — a weight-0 list
  still changed the candidate set. Now skipped entirely. Pinned by
  `pipeline/tests/fusion.test.ts` (weight scaling, zero weight, weight-0 ≡ expansion off,
  and a guard that the default weight still bridges).

**Tests / eval**
- **138 tests green** (was 132). Full `npm run eval` re-run; report now prints
  `Concept expansion: on`.
- Report totals with concepts on: hit@5 28.8% [18.3, 41.3], hit@10 36.4%, hit@50 66.7%,
  MRR 0.224; direct 36.0% / 17.6% recall; paraphrase 6.3% / 2.4%.

**Next action**
- Commit step 5d on `init`. Then M0 step 6 — blind set + scholar review — which remains
  blocked on a human reviewer.

---

## 2026-10-31 — M1 slice 1: D1 seed + zero-AI Worker answer path

**Built**
- `pipeline/build-d1.ts` → `data/build/d1/schema.sql` + `seed.sql` (14.5 MB):
  `surahs`, `verses` (verbatim Arabic, body/basmala split, both translations,
  folded+expanded search text), `meta` (lexicon, surahs, editions), and
  `verses_fts` (FTS5 over `ar`, `en`, `{fa faj}`, `unicode61`).
- `worker/src/retrieve.ts` — D1/FTS5 port of the in-memory retriever: three
  field queries, frame-term guard, coverage + phrase bonuses, concept lists at
  RRF weight 0.1. FTS5 cannot down-weight a single term, so frame terms are
  excluded when content terms exist; documented in the module.
- `worker/src/ask.ts` — G0 input guard, crisis/tafsir/meaning branches, fiqh
  boundary, verse-card assembly (Arabic + EN + FA, footnotes, links, context
  refs), fixed copy. No model call anywhere.
- `worker/src/index.ts` — GET/POST `/api/ask`, `/api/health`, CORS, optional
  Turnstile verification. `wrangler.toml` has **no Workers AI binding**.
- `pipeline/tools/eval-d1.ts` — parity harness: Node's built-in SQLite + FTS5
  loads the same schema/seed and runs the pilot through the Worker path.
- `worker/tests/ask.test.ts` — 10 contract tests against the real seed.
- `docs/m1-worker.md` — deploy steps and the explicit "do not launch" list.

**Measured parity (pilot, same items)**

| metric | in-memory | D1/FTS5 |
|---|---:|---:|
| hit@5 | 27.3% | 27.3% |
| direct hit@5 | 34.0% | 32.0% |
| paraphrase hit@5 | 6.3% | 12.5% |
| MRR | 0.198 | 0.212 |
| local query time | — | ~10 ms/item |

**Second frame-term defect found and fixed**
- Concept matching treated the word "quran" as a topical concept. A question
  like "What does the Quran say about modesty?" (a word absent from the English
  translation) therefore expanded into verses that merely mention the Book —
  28:2, 31:2, 24:1 — which won by default when literal retrieval was empty.
- `matchConcepts` now skips any trigger made only of frame terms when the query
  has content words, in both the in-memory retriever and the Worker port.
- Effect on the pilot: hit@5 28.8% → **27.3%**, direct 36.0% → **34.0%**,
  paraphrase unchanged at 6.3%. Acceptance still passes (direct -2.0 pt is the
  rule's limit), and the removed hits were correct-looking garbage.

**Tests**
- **148 tests green** (138 pipeline + 10 worker). `npm test` now runs both.

**What this does NOT include**
- G1 scope classifier, G2/G3 — in-domain unanswerable questions still retrieve
  verses (pilot AUC 0.551, chance). Public launch remains blocked.
- Rate limiting and per-IP caps; Turnstile is wired but secret-gated.
- Sensitive-verse metadata, Persian copy review, and any frontend.

**Next action**
- Commit M1 slice 1. Then either G1 training data/classifier or the blind-set
  scholar review — both block launch.

---

## 2026-10-31 — M2 slice: zero-dependency EN/FA frontend

**Built**
- `web/index.html`, `web/app.js`, `web/styles.css` — a static site with **no
  build step and no dependencies**, served by the same Worker through
  `[assets]`; `/api/*` runs the Worker first (`run_worker_first`).
- EN/FA routing in-page, `dir=rtl` for Persian, Arabic rendered first and
  verbatim, translations labelled with edition title and publisher version.
- Refusal and boundary copy comes from the API; the frontend never composes
  religious text. No analytics, external fonts or cookies.
- `worker/src/ask.ts` imports `data/scope-model.json` as a build-time bundle
  slot. The committed file is a **placeholder** (`version: "placeholder"`);
  the Worker explicitly skips G1 while it is a placeholder.

**Not included**
- Persian UI copy and RTL rendering are **UNREVIEWED** on a real device.
- No PWA, sitemap or Astro pipeline yet — the zero-dependency static page was
  chosen first so the answer path could be exercised end to end.

**Next action**
- Harden the Worker around the reference, language and safety edges now
  exposed by real input (done in the next entry).

---

## 2026-10-31 — M1/M2 hardening: reference ranges, language, safety, translation fidelity

**Fixed**
- **Reference parser.** A sentence-final period is allowed (`Show me 2:255.`)
  while a decimal is not (`2:255.5`). An **out-of-range** reference (`2:999`,
  `114:7`) is now refused with fixed copy instead of falling through to
  unrelated verses.
- **Full-surah ranges.** `2:1-286` previously bound one SQL placeholder per
  ayah and exceeded D1's 100-parameter cap; it is now one `BETWEEN` query.
  An explicit reference also bypasses G1 — the user has chosen the scope.
- **Surah aliases.** `buildSurahRefs` is the single source for both retrieval
  and reference parsing. The Worker's copy had omitted `nameFaAlt`, so
  «سوره حمد» silently fell through to free-text search.
- **Language detection** is by dominant script, not the presence of one
  Arabic character: an English question quoting «الصبر» stays English.
- **Crisis branch.** Arabic-script self-harm markers added and matched through
  `normalize()` (hamza/diacritic variants); the crisis branch now runs before
  the length cap, so an over-long crisis message is never answered with
  "please shorten it". Control characters get their own clarification reason.
- **CORS fails closed.** A disallowed origin no longer receives
  `access-control-allow-origin: null` (opaque origins match `null`, which
  silently disabled the allowlist); the header is omitted and `Vary: Origin`
  is set.
- **Turnstile outcomes.** Invalid token → 403; verifier 5xx/timeout → 503
  (`turnstile_unavailable`) so the client can distinguish an outage from a
  rejected token. `/api/config` exposes only the public site key.
- **Translation fidelity.** QuranEnc segments are rejoined **without
  inserting spaces** — the stored text is now verbatim. Cards carry
  `version`, `publisher` and `sourceUrl` (licence conditions 2 and 3);
  footnotes are linked by the publisher's number, not list position.
- **Basmala indexing.** 1:1 stores an empty body but the basmala is indexed as
  a document, so an ordinary basmala query still finds it.
- **FTS ranking bug.** Coverage and phrase bonuses were applied but never
  sorted, so they had no effect on RRF list positions. The field results are
  now sorted by our score before fusion.
- Tanzil's copyright block is copied verbatim into both D1 artifacts.

**Tests**
- **167 tests green** (142 pipeline + 25 worker; up from 138 + 10).
- `worker/tests/http.test.ts` (new) covers CORS fail-closed, JSON `null`
  bodies and the public config endpoint without a database.

**Not fixed**
- G1/G2/G3 are still absent. In-domain unanswerable questions still retrieve
  and are answered.
- No per-IP caps or WAF rule; Turnstile is secret-gated.

---

## 2026-10-31 — G1 scope classifier: built, measured, **held**

**Built**
- `pipeline/lib/scope.ts` — lexical features (normalized unigrams + bigrams,
  both Persian ZWNJ forms) shared by training and inference; inference is a
  sparse dot product plus sigmoid, so it runs in the Worker with no provider.
- `pipeline/train-scope.ts` — class-balanced sparse logistic regression,
  grouped 70/15/15 split by author topic, threshold chosen on calibration to
  maximize negative refusal subject to Quran recall ≥ 97%.
- `pipeline/tools/{assemble-scope,augment-scope,eval-scope}.ts` — audited
  assembly, 594 template-controlled questions (P1 positives + hard negatives
  using the same surface frames), and a holdout scorer that prints aggregate
  rates only.
- Training set: **1,225 items** (514 Quran, 201 fiqh, 178 history,
  178 other Islamic, 154 OOD), committed as `eval/scope-train.json`.
  AI-generated and AI-audited; **not human-reviewed**.

**Measured**

| split | Quran recall | negative refusal | AUC |
|---|---:|---:|---:|
| calibration (threshold 0.010) | 98.5% (n=194) | 51.2% (n=160) | 0.929 |
| test | 95.5% (n=134) | 64.6% (n=178) | 0.903 |
| **independent holdout** | **92.5%** (EN 95.0%, FA **90.0%**) | 81.0% (n=100) | — |

**Decision: do not wire G1.** Both languages miss the pre-registered 97%
Quran-recall target on the untouched holdout. A gate that refuses 10% of valid
Persian Quran questions trades one visible failure for a worse invisible one.
`worker/src/ask.ts` keeps the placeholder and performs no scope refusal.

**What the failure taught**
- The lexical boundary is **not stable**: cleaning the training data moved the
  operating point from 96.3% → 92.5% Quran recall and 66% → 81% negative
  refusal. Small, defensible data edits move the shipped refusal rate by
  several points.
- The pilot number (98.5%) was inflated by having inspected pilot misses while
  adding templates. The holdout is the honest estimate.
- `eval/scope-holdout.json` (90 pairs / 180 items) is committed so the refusal
  is reproducible, and marked **burned**: never tune on it.

Full record: `docs/g1-scope.md`.

---

## 2026-10-31 — Blind eval set frozen; licensing inventory

**Blind set**
- 50 bilingual pairs / 100 items, authored independently of the retriever and
  pilot, then frozen: `eval/blind.json` (`_meta.freeze_sha256`
  `9bed798b…`). Composition: 25 direct, 8 paraphrase, 9 in-domain
  unanswerable, 6 OOD, 2 adversarial.
- Protocol in `docs/blind-set.md`; `pipeline/tools/{assemble-blind,
  validate-blind,review-packet}.ts` enforce composition, validate the frozen
  file, and generate the scholar packet.
- Status: **AI-AUTHORED, PENDING SCHOLAR REVIEW.** No retrieval metric may be
  quoted from it until the review passes.
- The review packet (`docs/blind-review.md`) contains full verse text in all
  three editions and is generated on demand; it is **gitignored** so a public
  repo does not redistribute the reviewer-only packet.

**Licensing**
- `docs/licensing.md` — file-by-file inventory with source hashes, edition
  versions, the seven QuranEnc conditions, the Tanzil notice requirements, and
  the explicit never-ship list. Engineering inventory, not legal advice; legal
  review remains a launch requirement.

**Next action**
- Scholar review of the blind set, or G2 (out-of-domain floor only) as a
  narrower launch gate. G1 stays parked until a semantic feature or a larger
  human-authored positive set exists.

---

## 2026-10-31 — Staging deployment on Cloudflare

**Provisioned**
- D1 `faater` created (WEUR, id `50163789-…`); schema applied and the full seed
  loaded remotely: **6,236 verses / 6,236 FTS rows / 114 surahs**, 34.3 MB.
- Account workers.dev subdomain registered as **`verafired`**. `vera` was
  globally taken; `verafired` is the first available variant. The dashboard
  onboarding URL from the CLI returned 404, so registration was done through
  the Cloudflare API with the wrangler OAuth token.
- Worker `faater` deployed: **https://faater.verafired.workers.dev**.
- Turnstile widget `faater-staging` (managed) for the staging host. Site key is
  public in `[vars]`; the secret is a Worker secret. `ALLOWED_ORIGIN` is now
  the staging origin, not `*`.

**Verified on the deployed edge**
- `/api/health` 200; `/api/config` returns only the site key; static page 200.
- CORS: no allow-origin header for a foreign origin, exact echo for the
  staging origin.
- Without a token: 403 `turnstile_failed`. With Cloudflare's always-pass test
  secret (temporarily set, then restored): "patience" returned verse cards
  (`70:5` first), `2:255` returned exactly that verse, `2:999` returned
  `refused/out_of_range`.
- The Turnstile secret was rotated after the test to invalidate the value that
  had appeared in CLI output.

**Learned**
- Headless Chromium cannot solve a managed Turnstile challenge; the UI showed
  the fixed "complete the verification" copy, which is the expected path.
- `wrangler dev --remote` requires a workers.dev subdomain before it will run,
  even for a preview that publishes nothing.
- The dashboard route printed by wrangler (`/workers/onboarding`) 404s; the
  route in the API error (`?to=/:account/workers/workers-and-pages`) works, and
  the API itself is a reliable fallback.

**Not launched**
- G1/G2, per-IP rate limits, native copy review and sensitive-verse metadata
  are still open. The staging URL is public but must not be presented as a
  launch.

## 2026-10-31 — v0.1.0 source preview release

**Done**
- Tagged the first release, `v0.1.0`, as a source preview and published it as a
  GitHub **pre-release** (not latest, no attached assets). Fast-forwarded
  `main` to the release commit so the default branch matches the tag.
- Release docs: `README.md`, `CHANGELOG.md`, `docs/releases/v0.1.0.md`,
  `docs/eval-methodology.md` (current AUC/ablation values; earlier values kept
  as SUPERSEDED), `docs/m1-worker.md`, `docs/blind-set.md`, `HANDOFF.md`.
- Added a black-nib (✒️) SVG favicon and a footer credit linking VeraFired to
  GitHub and Amir Vafaei to vafaeiam.ir.
- Regenerated `eval/report.md` / `eval/report.json` from the release code.

**Verified**
- `pnpm pipeline`; `npm test` **167/167**.
- `validate-blind.ts` → `VALID`, freeze verified; the blind set was **not run**.
- Pilot in-memory / D1: hit@5 28.8% / 30.3%, direct 34.0% / 34.0%,
  paraphrase 12.5% / 18.8%, MRR 0.215 / 0.229.
- `pnpm ablate`: paraphrase 6.3% → 12.5%, direct 36.0% → 34.0% (PASS).
- `npx wrangler deploy --dry-run` clean.

**Not fixed**
- BUG-001 remains open (Persian `شراب و قمار` puts 2:219 at rank 7/8; English
  alcohol+gambling rank 3). v0.1.1 is the targeted fix; v0.2.0 is the reviewed
  subject layer.
- G1 held (92.5% vs 97%); G2/G3 missing; no per-IP caps/WAF; copy and legal
  review pending. Staging remains a preview, not a launch.

**Next action**
- v0.1.1: cross-field coverage (D) + language-aware Arabic weight (A), with
  `eval/issues/bug-001.json`; do not tune on the blind set.

---

## Stage tracker

| Stage | Scope | Status |
|---|---|---|
| **M0** | Vertical slice — data pinning ✅, basmala segmentation ✅, footnote policy ✅, Persian normalizer + Finglish ✅, reference parser + fuzz ✅, 100-item blind bilingual eval with scholar review | 🟡 in progress (5/6 — blind set frozen, review pending) |
| **M1** | Core product, zero AI — D1 + FTS5, RRF, G0–G3 gates, verse cards, refusal copy | 🟡 slice 1 done — answer path complete; G1 held (not wired), G2/G3 missing |
| **M2** | UI — Astro, EN/FA routing, RTL, verse pages, PWA, headers, sitemap | 🟡 slice 1 done — static EN/FA/RTL UI; no PWA/sitemap/Astro yet |
| **M3** | Dense retrieval — bge-m3 build-time embeddings, 512-bit codes, Hamming + int8 rerank | ⬜ |
| **M4** | Concept cards — 400–800 concepts, offline generation, human review | ⬜ |
| **M5** | Optional runtime LLM — provider cascade, quota ledger, citation validator | ⬜ |
| **M6** | Governance — methodology page, scholar board, correction SLA, monitoring | ⬜ |

**Staging:** live at https://faater.verafired.workers.dev — a test deployment,
not a public launch. See the deployment entry above.

**Do not skip M0.** If the slice fails, the product promise is wrong — cheaper to learn in a week than in a month.

---

## Open questions to resolve during M0

- [ ] QuranEnc footnote policy — ship markers + footnotes (`tafsir_shown: true`), or switch display edition to marker-free ClearQuran?
- [ ] Arabic-script input — refuse with scope copy, or accept as search-only?
- [ ] Finglish policy — add transliteration keys to the concept lexicon, or document the gap?
- [ ] Which Persian translation is the default, and on what evidence? (No usage-share data exists — treat as a hypothesis and test with Iranian users.)
- [ ] Sensitive-verse taxonomy — who authors it, and does it live in the public repo?
- [ ] Scholar reviewer — who, credentials, madhhab balance, SLA.

---

## Measurements log

| Date | Metric | Value | Notes |
|---|---|---|---|
| 2026-10-31 | int8 scan, 1024-d, 6,236 vectors | 7.9–9.6 ms | Node v24.16.0, before fetch/parse/sort — **over** the 10 ms Workers Free budget |
| 2026-10-31 | int8 scan, 768-d | 6.0 ms | borderline |
| 2026-10-31 | int8 scan, 512-d | 4.0 ms | fits, still needs the binary prefilter |
| 2026-10-31 | bge-m3 full trilingual index | ~804 neurons | ~748k tokens, 8% of one free day |
| 2026-10-31 | BM25 index build, 3 fields × 6,236 verses | ~300 ms | in-memory, Node 24; shipped worker will read a KV artefact |
| 2026-10-31 | pilot hit@5 / hit@10 / hit@50 | 27.3% / 39.4% / 68.2% | gold lists incomplete — lower bound, not a quality claim |
| 2026-10-31 | retrieval-signal AUC, answerable vs should-refuse | 0.46–0.51 | **no usable signal**; in-domain-unanswerable 0.337 (worse than chance) |
| 2026-10-31 | **CORRECTED** same measurement after the frame-only fix | best signal `nHits` 0.645; ood 0.846; in-domain **0.551 (chance)**; adversarial 0.470 | supersedes the 0.337 row — that value was frame-term pollution, not inversion |
| 2026-10-31 | pilot hit@5 by answer type | direct 36.0% (18/50), paraphrase **0.0%** (0/16) | pooling the two hid the paraphrase failure |
| 2026-10-31 | false-refusal budget certification at pilot size | **uncertifiable**: 0 false refusals over 66 answerable items gives UCB 5.4% > 5% budget | needs 72 answerable items per language |
| 2026-10-31 | should-refuse power, per language | 17 EN / 17 FA; zero-error UCB 19.5% each | 183 per language for 2%, 72 for 5% |
| 2026-10-31 | concept layer, unweighted fusion | paraphrase 0.0% → 12.5%, **direct 36.0% → 18.0%** | acceptance FAIL; concept lists drowned literal precision |
| 2026-10-31 | concept RRF weight sweep | 0.05–0.15 plateau: hit@5 28.8%, direct 36.0%, paraphrase 6.3% | weight **0.1** chosen by mechanism, not argmax; tuned on the pilot — provisional |
| 2026-10-31 | concept expansion effect on refusal signals | `nHits` 0.645 → 0.661; OOD 0.846 → 0.868; in-domain 0.551 → 0.564; adversarial 0.470 → 0.477 | no degradation; in-domain still chance |
| 2026-10-31 | G1 lexical scope — calibration | Quran recall 98.5% (n=194), negative refusal 51.2% (n=160), AUC 0.929 | threshold 0.010 |
| 2026-10-31 | G1 lexical scope — test | Quran recall 95.5% (n=134), negative refusal 64.6% (n=178), AUC 0.903 | same model |
| 2026-10-31 | **G1 lexical scope — independent holdout** | Quran **92.5%** (EN 95.0%, FA **90.0%**); non-Quran refused 81.0% (n=100) | **fails 97% target — held, not wired**; holdout burned |
| 2026-10-31 | D1 full-surah range `2:1-286` | answered with 5 cards, no 500 | one `BETWEEN` query replaces per-ayah placeholders (D1 100-param cap) |
| 2026-10-31 | pilot retrieval after ۀ fold + verbatim segments | hit@5 28.8%, direct 34.0%, paraphrase 12.5%, MRR 0.215 | regenerated `eval/report.md`; supersedes the 27.3% rows for current code |
| 2026-10-31 | D1/FTS5 parity, same code | hit@5 30.3%, direct 34.0%, paraphrase 18.8%, MRR 0.229, 12.3 ms/item | `npm run eval:d1` |
| 2026-10-31 | full test suite | **167 pass, 0 fail** (142 pipeline + 25 worker) | `npm test` |
| 2026-10-31 | v0.1.0 release verification | 167/167; pilot 28.8/30.3 hit@5; blind `VALID` (not run); ablation PASS | tag `v0.1.0`, GitHub pre-release, no launch |

---

## Session log template

```
## YYYY-MM-DD — <what>
**Done** ...
**Broke** ...
**Learned** ...
**Next action** ...
```