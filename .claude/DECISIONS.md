# DECISIONS — architecture decision records

Append-only. Each decision records what was chosen, what was rejected, and why — so a future session does not relitigate it without new evidence.

---

## ADR-001 — Hybrid answers, verses always
**Date:** 2026-10-31 · **Owner decision**

Verses + translations are always shown. An LLM may add a short grounded summary only when free quota exists.

**Rejected:** retrieval-only (no prose), LLM-first (cost + hallucination risk).
**Consequence:** the LLM is never on the critical path. See ADR-004.

---

## ADR-002 — KB scope
**Date:** 2026-10-31 · **Owner decision**

Verses + EN/FA translations + a concept layer + tafsir as **outbound links only**.

**Rejected:** embedding full tafsir text — every named Persian tafsir is copyrighted and absent from free catalogs; only Al-Mukhtasar and As-Saadi appear anywhere, and neither is the tafsir Persian users expect.

---

## ADR-003 — Quota exhaustion degrades silently
**Date:** 2026-10-31 · **Owner decision**

When every free LLM quota is spent, the site returns verses + translations + links with a small notice. No error, no "try later".

**Rejected:** BYOK prompt (most users won't), hard refusal (poor experience).

---

## ADR-004 — Cloudflare-first, no credit card
**Date:** 2026-10-31 · **Owner decision**

Pages + Workers + D1 + KV + Workers AI. No card on file, no bill path.

**Rejected:** Vercel Hobby (non-commercial clause, projects pause), pure static GitHub Pages (heavy browser model, weak Persian on low-end phones), Supabase (pauses after 7 days).
**Consequence:** 10 ms CPU per request is the binding constraint — see ADR-008.

---

## ADR-005 — The answer path never calls an AI provider
**Date:** 2026-10-31 · **Derived from the judge panel**

Retrieval, gates and verse cards run with zero external AI dependency. Prose comes from pre-generated, human-reviewed concept cards shipped as data.

**Why:** the winning design (52/60) was the only one whose $0 was architectural rather than a traffic bet. Free LLM capacity tops out ~1,000–1,500 answers/day; a site that must generate per request will bill or break.
**Rejected:** full RAG with LLM cascade (36.5/60 — admits paid overflow at target volume).
**Consequence:** the product's quality ceiling is set by retrieval and card quality, not model quality. That is an acceptable trade for a religious-reference tool.

---

## ADR-006 — Concept cards instead of runtime summarisation
**Date:** 2026-10-31

400–800 concepts, each with bilingual summary, synonyms in AR/EN/FA, ranked verses, and a `reviewed` block. Generated offline, reviewed by a human, shipped as static data.

**Why:** shifts ~all LLM cost off the request path. Most Quran questions are repeats or near-repeats of a few hundred themes.
**Rejected:** per-request generation.
**Consequence:** adding a concept is a data change, not a deploy — the KB grows incrementally, which is exactly the owner's stated goal.

---

## ADR-007 — Three-way scope gate, not binary
**Date:** 2026-10-31

`QURAN | ISLAMIC_OTHER | FIQH | HISTORY | OOD`.

**Why:** "what colour was the Prophet's camel", "is music haram" and "how do I pray" are Islamic but not Quranic. A binary gate accepts them, then answers confidently from adjacent verses.
**Evidence:** ELOQ — top models retrieve the source document in the top-10 for ~85% of out-of-scope questions.

---

## ADR-008 — No vector database; binary prefilter + int8 rerank in the Worker
**Date:** 2026-10-31

512-bit binary codes (64 B × 6,236 ≈ 399 KB) → Hamming scan (~1–3 ms) → int8 cosine rerank of top 512.

**Why:** measured int8 scan cost is 7.9–9.6 ms @1024-d, 6.0 @768-d, 4.0 @512-d — a naive scan blows the 10 ms budget. Vectorize's 5M stored-dim cap cannot hold 1,024-d × 6,236.
**Rejected:** Vectorize as primary (~52k queries/month at 512-d); naive float32 scan (over budget).

---

## ADR-009 — No cross-encoder reranker at $0
**Date:** 2026-10-31

Use RRF + the learned answerability model.

**Why:** Cloudflare's only hosted reranker, `bge-reranker-base`, is **Chinese/English only** — unusable for Arabic or Persian. `bge-reranker-v2-m3` is the right model but needs a GPU host.
**Revisit if:** a multilingual reranker appears on a free tier.

---

## ADR-010 — Deterministic citation verification instead of NLI
**Date:** 2026-10-31

Check: reference exists; every sentence has a citation; citations ⊆ retrieved ids; quoted spans are exact substrings after normalization; no entity/number absent from the retrieved verses.

**Why:** HHEM ~1.5 s/2k tokens on CPU; MiniCheck 770M; budget is 10 ms. Fabricated verse references are the highest-risk failure and are fully catchable deterministically.
**Rejected:** per-query NLI, LLM-judge-per-query (62–669 ms).

---

## ADR-011 — Index Tanzil only; never Quran Foundation content
**Date:** 2026-10-31

**Why:** QF developer terms forbid building ML models or embeddings from their content, and "Derived Materials" explicitly includes AI-generated responses. Tanzil is CC BY 3.0 verbatim.
**Consequence:** translations come from QuranEnc (redistribution grant) and Tanzil (non-commercial), not from quran.com.

---

## ADR-012 — Astro frontend, static verse pages
**Date:** 2026-10-31

**Why:** SEO on 6,236 verse pages is the main organic-acquisition channel for a free site; Astro ships zero JS by default and handles i18n routing cleanly.
**Rejected:** Next.js (heavier, Vercel-shaped), SPA (no SEO).

---

## ADR-013 — Build starts with a one-week vertical slice
**Date:** 2026-10-31 · **From the completeness critic**

M0 proves: data pinning, basmala segmentation, footnote policy, Persian normalizer, reference parser, 100-item blind bilingual eval.

**Why:** the two content defects are invisible to row-count validation; the Persian path is the weakest peer; better to learn that in a week than a month.

---

## ADR-014 — Ship QuranEnc translations verbatim, as segments
**Date:** 2026-10-31 · **Resolves the footnote defect**

QuranEnc's terms (archived at `data/source/quranenc/about-en.html`, hash pinned) begin: **"No modification, addition, or deletion of the content."** That sentence decides the whole design: we cannot strip the inline `[7]` markers, and we cannot strip the leading `(N)` verse number either.

Evidence gathered from the pinned SQLite editions:

| Fact | English (`english_saheeh` v1.1.2) | Persian (`persian_ih` v1.1.3) |
|---|---|---|
| Verses | 6,236 | 6,236 |
| With footnotes | **1,613 (25.9%)** | **0** |
| Inline `[N]` markers | 1,904 | **0** |
| Footnote entries | 1,903 | 0 |
| Dangling markers | **1 — 7:143/#403** | 0 |
| Leading `(N)` prefix | **6,236 / 6,236** | 0 |

**The footnote problem is English-only.** The Persian edition is marker-free and needs no policy at all.

**Decision.** Store the text verbatim and split it losslessly into typed segments — `text`, `num` (the `(N)` prefix), `note` (the `[N]` marker). The renderer then:
- uses the edition's own `(N)` as the **verse-number badge**, so the number is displayed once instead of duplicated — nothing is deleted;
- renders `[N]` as a superscript linked to **the translator's own footnote**, behind a per-verse disclosure, with `tafsir_shown: true`;
- leaves `[ ... ]` glosses without digits (e.g. FA «[و سپاس‌ها]») inside the text — they are translation, not apparatus.

Every emitted artefact embeds the edition, publisher, version, seven licence conditions and the SHA-256 of both the SQLite file and the archived terms page.

**Why footnotes are not "tafsir" under our content rules.** CLAUDE.md bans shipping tafsir *works* (Nemuneh, Al-Mizan). A translator's own footnotes are part of the licensed edition and reproduce its apparatus; we author nothing. The rule that forbids *us* from interpreting is untouched.

**Rejected:** strip markers (violates condition 1 outright); switch to ClearQuran (CC BY-ND, loses Sahih International's ubiquity, and ND makes a search index legally murkier); request written permission to strip (slow, probably refused, and unnecessary once rendering can use the number).

**Consequence for search.** `searchText` is built from text segments only — no `(N)`, no `[N]` — then normalized. Footnote bodies are never indexed, so a query about a footnote's prose cannot retrieve its verse.

**Open action (condition 5).** The source must be notified of the 7:143 defect. Tracked in CHALLENGES.

---

## Rejected ideas worth remembering

- **118–235 MB in-browser ONNX model** — strands mobile and Iran-based users, ~2.6 TB/month at 100k cold loads.
- **Automatic DNS failover at $0** — false; Cloudflare Load Balancing is paid.
- **GitHub Pages as a byte-identical mirror** — cannot set headers or preserve base paths.
- **"Runs from a USB stick"** — impossible for a module app that fetches JSON; `file://` blocks fetch, modules and service workers.
- **Fixed cosine thresholds (0.38 / 0.42 / 0.45)** — no primary source; scores do not port across models.
- **Self-RAG / CRAG as published** — 7B/13B and 770M models; only the decomposition transfers.