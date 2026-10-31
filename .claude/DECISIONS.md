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

## ADR-015 — Finglish is handled by curated aliases, never a transliterator
**Date:** 2026-10-31

`sabr`, `namaz`, `khoda` is how a large share of Persian speakers type. Script detection sees Latin, routes it to the English index, and it matches nothing.

**Decision.** A curated alias table (`data/lexicon/finglish.json`), compiled into `data/build/lexicon.json` alongside surah aliases. At launch: **83 concepts + 19 proper names + 114 surah aliases = 476 keys.**

**Why not a transliterator.** Finglish has no standard orthography — `khoda` / `khuda` / `xoda`, `sabr` / `sabur`. A rule-based transliterator converts arbitrary Latin into confident Persian, and in a religious Q&A product **a wrong verse is worse than a refusal**. Unlisted input resolves to nothing and the no-evidence refusal handles it.

**Why not skip it.** Routing Finglish to the English index is a guaranteed miss, and Persian users are the weaker peer we are explicitly trying to serve.

**Enforced by tests, not convention.** Near-misses must not match: `sabrina` does not resolve to `sabr`, `quranic` does not resolve to `quran`, and an unknown string resolves to nothing. Token matching is whole-token, never substring.

**Surah aliases are derived, not transcribed.** `translitKeys()` generates them from Tanzil's `tname` ("Al-Faatiha" → `al fatiha`, `fatiha`), so they cannot drift from the corpus. English "meaning names" (e.g. *Sincerity* for surah 112) are deliberately excluded — they belong to the concept layer, or every English moral word becomes a surah reference.

**Growth path.** The backlog is production refusals whose query was Latin-script and Persian-shaped. That is a data file, not a model.

---

## ADR-016 — Two search keys per Persian verse (ZWNJ split and joined)
**Date:** 2026-10-31

`normalize()` treats ZWNJ as a separator, so «می‌خواهد» becomes `مي خواهد`. A user who types the joined «میخواهد» produces `ميخواهد`, and the two never meet. Persian keyboards make ZWNJ easy to omit, so this is the common case, not an edge case.

**Decision.** Every Persian verse carries two search keys: the split form (`searchText`) and the joined form (`searchTextJoined`, ZWNJ removed). Queries emit both forms and match against both.

**Measured.** 5,052 of 6,236 Persian verses contain ZWNJ — the dual keys are load-bearing, not theoretical. «می‌خواهد» retrieves 40 verses; «میخواهد» retrieves 39.

**Residual gap, stated rather than hidden.** The one-verse difference is a verse where the translator wrote a **real space** where the user writes no separator; there is no ZWNJ in the source to split, so the joined query cannot match. Tests assert the safe direction (`joined ⊆ split`) and cap the gap at 5 verses so a regression is caught. Closing it completely would need a space-stripped index, which trades precision for recall — a bad bargain here.

---

## ADR-017 — Refusal is a classifier on the question, not a threshold on retrieval
**Date:** 2026-10-31

**Evidence.** The M0 pilot measured every candidate retrieval signal (top score, gap, ratio, top-3 mean, top-5 sum, z-score, hit count, field count) against 66 answerable and 34 should-refuse items.

- Every score-shape signal scored **AUC 0.505–0.543** against the pooled refusal set — chance.
- The best signal was **`nHits` (query coverage) at 0.645** — weak, and capped by the 50-candidate search limit.
- Out-of-domain questions separate (AUC 0.846): they share no vocabulary with scripture.
- **In-domain unanswerable questions score 0.551 — chance.** "How many rak'ahs are in the Fajr prayer?" retrieves as much evidence as "What does the Quran say about patience?" because it is saturated with prayer vocabulary. At the same false-refusal rate that catches 66.7% of OOD questions, the threshold catches 11.1% of these. Adversarial prompts are 0.470.

> **Correction 2026-10-31 (step 5c).** An earlier run reported in-domain AUC **0.337 — worse
> than chance**. That value was an artifact of the Arabic field answering Persian questions
> with verses that merely mention «قرآن». After the frame-only fix the honest value is
> 0.551. The decision below is unchanged and rests on the cleaner claim: no separation.

**Decision.** G1 (scope) is a **classifier over the question**, and it is mandatory. G2 (retrieval floor) survives only as a cheap out-of-domain filter, never as the refusal decision. G3 (answerability) scores (question, verse) pairs rather than a single score.

**Why this is not a preference.** A threshold that refuses "how many rak'ahs in Fajr" also refuses a large share of real questions, because the difference is not in the retrieval — it is in what the question asks for. No amount of score tuning can recover information the ranking does not contain.

**Consequence for calibration.** The pilot's power analysis stands, per language: 17 should-refuse items can only bound the error rate at 19.5% even with zero errors. G1 cannot be validated on this set. The false-refusal budget is likewise uncertifiable — 66 answerable items with zero false refusals gives a 5.4% upper bound against a 5% target.

---

## ADR-018 — Search text is folded, never displayed; expansions are additive
**Date:** 2026-10-31

Three separate matching problems produced the same class of silent miss, and they share one principle.

**1. English apostrophes and transliteration diacritics.** `normalize()` turns punctuation into spaces, so «Qur'an» becomes `qur` + `an`, and the Sahih International edition writes «qurān» with a macron (U+0101) and «ṣalāh» with dots below. Typing "quran" matched **0 of 6,236** English verses. `foldEnglish()` applies NFD decomposition, strips combining marks, then strips apostrophes and half-rings. Applied to **searchText only** — segments and footnotes keep the publisher's exact characters, which is what the no-modification condition requires.

**2. Stopwords are a query-side filter, never an index filter.** The index keeps every token so contiguous-phrase matching still sees exact document text. Coverage is computed over terms with `df < n/2`, matching BM25's sign convention; the previous `idf > 0` test was true for "the" (3,958 of 6,236 verses) and made every short verse look well-covered.

**3. Stopwords must be derived through the normalizer.** Persian sets written in Persian orthography can never match: `normalize()` folds ک→ك, ی→ي, آ→ا, so a literal «که» never equals the query token «كه». `STOPWORDS_FA` is built by running each entry through `normalizeJoined()`, producing exactly the token the tokenizer will emit. The ZWNJ-**split** form is deliberately NOT added: splitting «می‌توان» yields «توان» ("power/ability"), which silently deleted a content word from every query containing it. The split parts that genuinely are function words («مي», «گويد») are listed explicitly.

**4. Frame terms are down-weighted (0.2), never deleted, and never sufficient alone.** "quran" names the corpus itself and cannot discriminate between verses; in "what does the Quran say about X" it is part of the question frame. Deleting it made «قرآن چیست» return unrelated verses, so it is down-weighted instead. Separately, a query that contains content words may not be answered by a field that matched **only** frame terms — that rule is what stopped the Arabic field answering «قرآن درباره ازدواج» with verses that merely mention «قرآن».

**5. Expansions are additive.** Arabic light stemming, English inflection variants, and Finglish concept terms are added **alongside** the exact token, never replacing it. An over-eager expansion costs index space and a little noise; it can never lose an exact match. This is the same rule already used for Persian ZWNJ dual keys (ADR-016).

**Regression risk this creates.** Every one of these is silent: the system keeps returning results, just the wrong ones. Behavioural tests are the only guard, and they must assert the safe direction rather than exact ranks.

---

## ADR-019 — Concept synonyms are search-only, and fuse at weight 0.1
**Date:** 2026-10-31

**Problem.** Lexical retrieval cannot bridge wording it has never seen: the pilot's
paraphrase slice scored **0/16 at hit@5**. A user asking "charity" should reach verses
about «صدقه» / "spend their wealth", and no amount of BM25 tuning produces that bridge.

**Decision.**
1. A concept synonym file (`data/lexicon/synonyms.json`) exists per concept: EN, FA
   (split and ZWNJ-joined), and Arabic terms. It is **search-only metadata**. Synonyms are
   never displayed, never used in an answer, and never presented as meaning. The file is
   labelled `_review: UNREVIEWED` until a native reviewer passes it.
2. Every term was verified against the corpus with `pipeline/tools/df.ts` before shipping:
   terms with `df=0` (dead), `df > 50%` (no signal), or the wrong sense were dropped —
   269 of 682 candidates. A concept with no usable term in any language fails the build.
3. Concept matches generate **separate** BM25 lists per field (`concept:ar`, `concept:en`,
   `concept:fa`), not a query concatenation. Each list keeps its own language statistics.
4. Concept lists are fused into RRF at **weight 0.1**; literal field lists stay at 1.0.
   At 0.1, a concept list's rank-1 contribution is `0.1/61 ≈ 0.0016` against a literal
   list's `1/61 ≈ 0.0164`. A concept can therefore only promote a verse that literal
   retrieval missed or ranked low — it cannot rewrite the literal head.
5. Expansion is **on by default**; `--no-concepts` and `conceptExpansion: false` exist for
   ablation and rollback.

**Why weight 0.1, and why that is not an overfit claim.** Unweighted fusion was measured
first and failed the pre-registered rule: paraphrase rose to 12.5% but direct hit@5 fell
from 36.0% to 18.0%. The weights 0.05–0.15 form a **plateau with identical retrieval and
refusal numbers**, so 0.1 is chosen for its mechanism (an order of magnitude below a
literal field), not because it was the sweep maximum. Acceptance at 0.1: paraphrase
0.0 → 6.3%, direct 36.0 → 36.0%, MRR 0.199 → 0.224, overall hit@5 +1.5 pt.

**Rejected alternatives.**
- **Unweighted concept fusion** — measured; destroys literal precision (ADR-018's
  "expansions are additive" does not mean "expansions are equal").
- **Concatenating synonyms into the query string** — a long synonym tail inflates term
  frequencies and lets one field's concept list dominate every other list.
- **Showing synonyms or using them in copy** — they are unreviewed guesses about wording;
  displaying one would put an unverified interpretation in front of a user.
- **Request-time LLM query expansion** — puts a provider on the critical path, breaking
  the one architectural rule.

**Consequences.**
- The weight was selected on the pilot set and is measured on the same set. With 16
  paraphrase items, one item is 6.3 points. **0.1 is provisional until the blind set.**
  Report the direction, not the effect size.
- The synonym file is versioned with the index. Any edit requires re-running the ablation;
  any weight change requires recalibrating the refusal thresholds' surrounding analysis.
- One paraphrase item bridged is a proof of mechanism, not a solved paraphrase problem.
  Dense retrieval (M3) remains the intended fix for the rest.

---

## Rejected ideas worth remembering

- **118–235 MB in-browser ONNX model** — strands mobile and Iran-based users, ~2.6 TB/month at 100k cold loads.
- **Automatic DNS failover at $0** — false; Cloudflare Load Balancing is paid.
- **GitHub Pages as a byte-identical mirror** — cannot set headers or preserve base paths.
- **"Runs from a USB stick"** — impossible for a module app that fetches JSON; `file://` blocks fetch, modules and service workers.
- **Fixed cosine thresholds (0.38 / 0.42 / 0.45)** — no primary source; scores do not port across models.
- **Self-RAG / CRAG as published** — 7B/13B and 770M models; only the decomposition transfers.