# PROGRESS — single source of truth

Append-only. Date every entry. Record failures as loudly as successes.
If a session dies mid-build, the next one resumes from this file alone.

**Current status:** `M0 step 2 complete` — basmala segmented, corpus build + 35 tests green.

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

---

## Stage tracker

| Stage | Scope | Status |
|---|---|---|
| **M0** | Vertical slice — data pinning ✅, basmala segmentation ✅, footnote policy, Persian normalizer gold tests, reference parser + fuzz, 100-item blind bilingual eval with scholar review | 🟡 in progress (2/6) |
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