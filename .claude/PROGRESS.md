# PROGRESS — single source of truth

Append-only. Date every entry. Record failures as loudly as successes.
If a session dies mid-build, the next one resumes from this file alone.

**Current status:** `M0 step 5d complete` — concept synonym layer built and fused at a measured weight; 138 tests green. Step 6 (blind bilingual eval with scholar review) is the remaining M0 item.

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

## Stage tracker

| Stage | Scope | Status |
|---|---|---|
| **M0** | Vertical slice — data pinning ✅, basmala segmentation ✅, footnote policy ✅, Persian normalizer + Finglish ✅, reference parser + fuzz ✅, 100-item blind bilingual eval with scholar review | 🟡 in progress (5/6) |
| **M1** | Core product, zero AI — D1 + FTS5, RRF, G0–G3 gates, verse cards, refusal copy | ⬜ |
| **M2** | UI — Astro, EN/FA routing, RTL, verse pages, PWA, headers, sitemap | ⬜ |
| **M3** | Dense retrieval — bge-m3 build-time embeddings, 512-bit codes, Hamming + int8 rerank | ⬜ |
| **M4** | Concept cards — 400–800 concepts, offline generation, human review | ⬜ |
| **M5** | Optional runtime LLM — provider cascade, quota ledger, citation validator | ⬜ |
| **M6** | Governance — methodology page, scholar board, correction SLA, monitoring | ⬜ |

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

---

## Session log template

```
## YYYY-MM-DD — <what>
**Done** ...
**Broke** ...
**Learned** ...
**Next action** ...
```