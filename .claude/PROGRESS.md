# PROGRESS — single source of truth

Append-only. Date every entry. Record failures as loudly as successes.
If a session dies mid-build, the next one resumes from this file alone.

**Current status:** `M0 step 4 complete` — Persian gold tests + Finglish policy, 69 tests green.

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

---

## Stage tracker

| Stage | Scope | Status |
|---|---|---|
| **M0** | Vertical slice — data pinning ✅, basmala segmentation ✅, footnote policy ✅, Persian normalizer + Finglish ✅, reference parser + fuzz, 100-item blind bilingual eval with scholar review | 🟡 in progress (4/6) |
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

---

## Session log template

```
## YYYY-MM-DD — <what>
**Done** ...
**Broke** ...
**Learned** ...
**Next action** ...
```