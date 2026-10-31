# Faater — project instructions

A free, public, **Qur'an-grounded** Q&A system, in **English and Persian**. Answers only from the Qur'an. Refuses questions that are off-topic or unsupported by retrieved text. Target operating cost: **$0**.

Read `.claude/HANDOFF.md` first — it is the current state, plan and operating
notes. `.claude/PROGRESS.md` is the append-only history; `.claude/BUGS.md` is
the owner-reported defect log; `.claude/DECISIONS.md` holds the ADRs.

---

## The one rule that shapes everything

**The answer path must never depend on an AI provider.**

Retrieval, refusal gates and verse cards run on free compute with no external dependency and no scale ceiling. Prose comes from **concept cards generated offline and human-reviewed**, shipped as data. A runtime LLM is an optional garnish that fails silently to the card layer.

Any change that puts an LLM call on the critical path — or makes an answer impossible when a free quota is exhausted — is a regression, not a feature.

---

## Non-negotiable content rules

1. **Never modify Qur'anic text.** `arabic` is Tanzil bytes, verbatim. Normalization is a *search-only* field (`arabic_norm`) and is never displayed.
2. **Every sentence needs a citation.** No `[surah:ayah]`, no sentence. A claim without a retrieved verse is deleted, not softened.
3. **Never interpret.** The system may navigate and restate translations. It may not explain, derive meaning, issue rulings, or author commentary. Concept-card summaries are drafts that require human review before shipping.
4. **Never issue a fatwa.** Ruling requests get `answered_with_boundary`: relevant verses + a fixed "a ruling requires a qualified mufti" notice.
5. **Refusal copy is fixed, never model-generated.** See the answer contract in the plan.
6. **Sensitive verses are never truncated** and never get AI-written framing.

## Non-negotiable licensing rules

| Never | Why |
|---|---|
| Index or embed **Quran Foundation / quran.com API** content | Their terms forbid building ML models or embeddings from it |
| Ship **Khattab, Abdel Haleem, Saffarzadeh, Haddad Adel** translations | Not freely licensed |
| Add **ads, sponsorships or a paid tier** while using Tanzil translations | Tanzil translations are **non-commercial only** |
| Ship **Tafsir Nemuneh / Al-Mizan / Noor / Qaraati** text | Copyrighted, absent from every free catalog — links only |
| Use **Quranic Arabic Corpus** morphology without review | GPL **plus** "changing it is not allowed" |

Tanzil Arabic text is **CC BY 3.0, verbatim only** — the copyright notice must appear in every derived file, with attribution and a link to tanzil.net.

---

## Corpus facts (verified 2026-10-31)

- `Resources/quran-simple.txt` — 6,236 verses, 114 surahs, 1,353,702 bytes
- SHA-256 `b3638f5cf03e2b05e4000efc0e4b656aafb3cf6ed28f8770b6497c5b43c46089`
- Format `surah|ayah|text`, 28-line Tanzil copyright block starts at line 6239
- **Fully vowelled** — 121,886 fatha, 3,330 superscript alef U+0670, 939 tatweel U+0640, 4,551 waqf marks. Plain search for `الرحمن` returns **zero** hits.
- **The basmala is fused into verse 1 of 113 surahs** (all but At-Tawbah). QuranEnc translations do **not** include it. This must be segmented before display.

---

## Stack

Cloudflare Pages (static) + Workers (API) + D1 (corpus, cache, quota ledger) + KV (compiled index) + Workers AI (embeddings, rare summaries). Frontend: Astro, EN/FA, RTL.

Retrieval: trilingual BM25 over FTS5 (`ar_norm` + `en` + `fa_norm`) ⊕ dense ⊕ concept, fused with **RRF**, diversified with **MMR (λ=0.7, max 2 verses/surah)**. Never pad to a minimum card count.

---

## Commands

```bash
pnpm pipeline      # build corpus + translations + lexicon from data/source (hashes verified first)
pnpm test          # pipeline unit tests (Node native test runner, zero deps)
pnpm eval          # pilot retrieval/refusal eval → eval/report.md + report.json
pnpm dev           # not implemented yet — arrives with M1 (worker) / M2 (web)
pnpm deploy        # not implemented yet — arrives with M1
```

`pnpm eval` writes evidence, it does not gate: there are no gates to test yet. Its
per-type AUC table is the justification for G1 — see `.claude/DECISIONS.md` ADR-017.

---

## Repo map

```
.claude/            # RND, DECISIONS, CHALLENGES, PROGRESS, SOURCES, research dumps
data/source/        # pinned Tanzil text, QuranEnc JSON, metadata
data/concepts/      # YAML concept cards — human-editable, the growing KB
data/build/         # generated corpus.json, index blobs, d1 seed
pipeline/           # normalize, build-corpus, build-concepts, embed, build-index
worker/             # src/{index,retrieve,gates,llm,cache,quota,config}.ts
web/                # Astro frontend, i18n en/fa
eval/               # train / calibration / blind sets + runner
docs/               # licensing, runbook, methodology
```

---

## Conventions

- Every free-tier number carries a **date**. Free tiers change monthly.
- Thresholds are **versioned with the index** and recalibrated on any model change. Never copy a constant from a blog post.
- Append to `.claude/PROGRESS.md`; never overwrite. Record failures as loudly as successes.
- When a fact is superseded, mark it `SUPERSEDED <date>` with the new source — do not delete it.