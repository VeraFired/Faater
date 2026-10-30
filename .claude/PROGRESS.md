# PROGRESS — single source of truth

Append-only. Date every entry. Record failures as loudly as successes.
If a session dies mid-build, the next one resumes from this file alone.

**Current status:** `M0 not started` — plan approved 2026-10-31, persistence layer created.

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

**Next action**
- M0 step 1: pin the data — `sources.lock.json`, fetch `quran-simple-clean.txt`, assert ≥99.5% normalized agreement.

---

## Stage tracker

| Stage | Scope | Status |
|---|---|---|
| **M0** | Vertical slice — data pinning, basmala segmentation, footnote policy, Persian normalizer gold tests, reference parser + fuzz, 100-item blind bilingual eval with scholar review | ⬜ not started |
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