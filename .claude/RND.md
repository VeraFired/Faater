# RND — verified research, with dates

Every number here was checked against a live primary page on **2026-10-31** unless marked otherwise.
Raw dumps: `.claude/research/dimension-reports.txt` (8 dimension reports) and
`.claude/research/workflow-full-output.json` (verification corrections, judge panel, critic).

**Rule:** free tiers change monthly. Re-verify before relying on any figure. Mark stale facts `SUPERSEDED`.

---

## 1. The strategic finding

Three architectures were proposed and judged adversarially (60-point rubric):

| Proposal | Score | Verdict |
|---|---:|---|
| Static, no-server, no-model-writes-answers | **52/60** | Winner — $0 is architectural, fabricated verses structurally impossible |
| Client-side ONNX model + learned gates | 43/60 | Best data discipline; loses on a 118–235 MB browser download that strands mobile and Iran-based users |
| Full RAG + LLM cascade | 36.5/60 | Best retrieval and only grounded prose; loses because ~1,000 free answers/day cannot serve 3,333/day demand |

**Conclusion:** the $0 claim must be architectural, not a traffic bet. Build the retrieval + cards product; treat generation as an optional layer.

---

## 2. Free LLM capacity (the hard ceiling)

| Provider | Allowance | Status |
|---|---|---|
| Workers AI `@cf/zai-org/glm-4.7-flash` | 5,500 in / 36,400 out per M neurons → **~20 neurons/answer ≈ 500/day** | ✅ verified |
| Workers AI `@cf/qwen/qwen3-30b-a3b-fp8` | 4,625 / 30,475 → **~12 neurons/answer ≈ 800/day** | ✅ verified |
| Workers AI `@cf/baai/bge-m3` embeddings | 1,075 neurons/M tokens → **~9.3M free tokens/day** | ✅ verified |
| Workers AI free allocation | **10,000 neurons/day**, resets 00:00 UTC, overage $0.011/1k | ✅ verified |
| Groq free plan | 30 RPM / 1,000 RPD / 8K TPM for gpt-oss-120b & qwen3.8-27b | ⚠️ verifier found a Free-plan table; earlier research wrongly said paid-only — confirm at signup |
| Gemini free tier | ~10 RPM / 250 RPD for 2.5 Flash (2025 values) | ❌ **unverifiable** — HTTP 403 from this network, quotas login-gated |
| OpenRouter `:free` | 20 RPM / 50 RPD (1,000 RPD after $10 lifetime) | ❌ **unverifiable** — 403 |
| Z.ai GLM-4.7-Flash | free | ⚠️ China residency |
| NVIDIA build.nvidia.com | ~40 RPM, prototyping only | ❌ unverifiable — 403 |

**Dead / unsuitable:** GitHub Models (retired 2026-07-30) · Cerebras (30-day promo, card required) · Cohere trial (1,000 calls/month, not for production) · Mistral Free (evaluation only) · SambaNova (20 RPD) · HF Inference (zero free credits) · DeepSeek V4.1 Flash on Workers AI (**Paid access required**) · Chutes (no free tier) · Together/DeepSeek (paid only).

**Realistic combined ceiling: ~1,000–1,500 short answers/day.** Design accordingly.

---

## 3. Cloudflare free tier (verified)

| Service | Free allowance | Notes |
|---|---|---|
| Workers | 100k req/day, **10 ms CPU**, 128 MB, 50 subrequests | CPU is the binding constraint |
| Pages | unlimited requests/bandwidth *(fair use, not contractual)*, **100 projects/account**, 500 builds/mo | "unlimited sites" was wrong |
| D1 | 5 GB, 5M rows read/day, 100k writes/day, 2 MB max row, 50 queries/invocation | FTS5 supported, built-in tokenizers only |
| KV | 100k reads/day, **1k writes/day**, 1 GB, 25 MB value | Never use for token buckets |
| Vectorize | 5M stored dims, 30M queried dims/month, 1536 max dims | Bills `(queried + stored) × dims`; 512-d 6,236 vectors ≈ **52k queries/month (~1,750/day)**; 1024-d **does not fit** |
| Workers AI | 10,000 neurons/day | see above |
| Durable Objects | 100k req/day, 13k GB-s/day | SQLite-backed only |
| Turnstile | 20 widgets, unlimited challenges | abuse protection |
| WAF | **1** rate-limiting rule (10 s window) | enough for a per-IP cap |

**Deployment reality:** automatic health-checked failover requires Cloudflare Load Balancing (**paid**). A second host is a manual DNS repoint bounded by TTL.

---

## 4. Embeddings & retrieval

- **`@cf/baai/bge-m3`** — 1024-d, MIT upstream. MIRACL nDCG@10: **ar 78.4 / fa 60.9** dense; 80.2 / 63.4 with all modes. Best measured open multilingual model for these languages.
- BM25 alone: ar 39.5 / fa 28.7 — lexical hybrid adds a small but real gain, and BM25 alone is far weaker for Persian.
- **multilingual-e5-small** — 384-d, 118 MB int8, MIT. Best browser/WASM fallback. e5-large: ar 76.0 / fa 59.0.
- **Qwen3-Embedding-0.6B** — 1024-d, MRL to 512, Apache 2.0, MTEB multilingual 64.33. No per-language ar/fa published.
- **Measured CPU (Node v24.16.0, int8, 6,236 vectors):** 7.9–9.6 ms @1024-d, 6.0 ms @768-d, 4.0 ms @512-d — before fetch/parse/sort. **A naive float32 scan must not ship.**
- **No cross-encoder reranker at $0.** `@cf/baai/bge-reranker-base` is **Chinese/English only**. `bge-reranker-v2-m3` (Apache 2.0, MIRACL 69.32) is the best open option but needs a GPU host.
- **FTS5 is unusable on Arabic without pre-normalization.** Verified: it tokenized the Basmala into `['الر','الل','ب','ح','س','م','ن','ه','يم']`; `remove_diacritics` does nothing for Arabic; Persian ZWNJ split `میخواهم` into `می` + `خواهم`.

---

## 5. Normalization (with corrections)

| Tool | Reality |
|---|---|
| **Hazm 0.12.1** (MIT) | Its default `normalize()` **does** strip U+0670 and U+06D6–U+06ED via the special-chars pass — earlier claim was backwards. Real problem: converts digits to Persian, wrong for a search key. |
| **Parsivar 0.2.3.1** (MIT) | Folds teh-marbuta→heh and alef-maqsura→yeh. Fine as a search fold, destructive for displayed text. |
| **Alfanous** (LGPL) | Canonical Arabic Quran search normalization chain. Best reference implementation. |
| **adelpro/quran-search-engine** (MIT, TS) | Most complete modern regex, but its final `[^ء-ي]` filter **deletes Persian letters** (`پ چ ژ گ`). Fork or parameterize. |
| **`[ً-ٰٟۖ-ۜ۟-۪ۨ-ۼ]`** | Correct tashkeel range for Quranic text. |

**Rules:** Arabic fold strips U+064B–U+065F, U+0670, U+0640, U+06D6–U+06ED; folds `أإآٱ→ا`, `ة→ه`, `ى→ي`, `ؤئء→ء`. Persian fold unifies `ي→ی`, `ك→ک`, ZWNJ→separator, digits→ASCII. **Run the Persian fold only for Persian input.**

**Two traps:** (a) Persian produces `ی`/`ک` (U+06CC/U+06A9) while the Arabic index uses `ي`/`ك` — Persian loanwords silently fail to match unless one canonical form is used on both sides. (b) ZWNJ must be indexed **both** separated and joined.

---

## 6. Data & licensing

| Source | Status |
|---|---|
| Tanzil Arabic text | **CC BY 3.0, verbatim only.** Notice in every derived file, attribution + link. |
| Tanzil translations (13 FA, 17 EN) | **Non-commercial only.** Backlink if >3 used. No ads, ever. |
| QuranEnc `english_saheeh` | Redistributable under 7 conditions (no modification, credit Noor International Center + QuranEnc + version, no inappropriate ads). |
| QuranEnc `persian_ih` (Rowwad) | Same terms. |
| Talal Itani ClearQuran | CC BY-ND 4.0 + permission to reformat. Marker-free — good display alternative. |
| Pickthall (d. 1936) | Public domain in life+70 since 2007; US from 2026-01-01. |
| Yusuf Ali (d. 1953) | Public domain life+70 since 2024; US from 2030. |
| Khattab, Abdel Haleem, Saffarzadeh, Haddad Adel | **Not freely licensed. Do not ship.** |
| quran.com / Quran Foundation API | Forbids building ML models or **embeddings** from its content. **Never index it.** |
| Tafsir (Nemuneh, Al-Mizan, Noor, Qaraati) | Copyrighted, absent from every free catalog. **Outbound links only.** |
| Quranic Arabic Corpus morphology | GPL **+ "changing it is not allowed"**. Avoid or isolate with legal review. |
| Turso free tier | **Unverified** — site refused automated access. Do not plan on it. |

**Other corrections:** `tarteel-ai/quranqa` is **QRCD**, not AyaTEC. QUL's tafsir catalog is 115, not 220. Cloudflare Pages caps at 100 projects. Muslim Pro's Ask AiDeen launched March 2024, not Ramadan 2025.

---

## 7. Refusal / abstention

- **Absolute cosine thresholds fail.** 11 retrievers × 28 datasets: max-score AUROC 0.583 vs top1−top5 gap 0.724.
- **Prompt-based abstention fails.** 12 generators answered 40.0–99.3% of insufficient-evidence questions even when told to abstain. RGB negative-rejection: 5–45%. AbstentionBench: reasoning fine-tuning degraded abstention by 24%.
- **Retrieval relevance ≠ answerability.** ELOQ: top models retrieve the source document in the top-10 for ~85% of out-of-scope questions.
- **Lightweight classifiers win.** WideMLP 88% @ <4 ms; LLM routers 91% @ 62–669 ms. SetFit: 71.3% on RAFT with 8 examples/class.
- **Self-RAG / CRAG are not deployable here** — 7B/13B fine-tuning and a 770M evaluator. Borrow the decomposition (relevance / support / usefulness), not the checkpoints.
- **Post-generation NLI does not fit.** HHEM ~1.5 s/2k tokens on CPU; MiniCheck 770M. Use deterministic citation verification instead.
- **Conformal prediction is an audit tool**, not a runtime guarantee — exchangeability fails under query drift.
- **Recommended shape:** pre-retrieval 3-way scope classifier → retrieval → multi-signal floor → learned answerability on `(question, top-5)` → deterministic citation check.
- **Calibration:** selective prediction with Clopper–Pearson bounds; separate train/calibration/blind; grouped splits; shadow mode before switch.

---

## 8. Prior art worth reusing

| Resource | What it gives | License |
|---|---|---|
| **IslamicFaithQA** | 3,810 bilingual abstention-focused items, 6,236-verse corpus | Apache-2.0 |
| **QRCD v1.2** | 1,093 QA pairs + **62 unanswerable** | CC BY-NC-ND (test only) |
| **AyaTEC v1.2** | 251 questions, **37 zero-answer**, 11-category taxonomy | CC BY-ND |
| **AyaTEC taxonomy** | 11 topic categories — good seed for the concept layer | CC BY-ND |
| **tafsir-mcp** | 5 classical tafsirs, MIT code, CC BY 4.0 data | MIT / CC BY 4.0 |
| **Mofaser** | 243k tafsir QA records, 18 tafsirs | CC-BY-4.0 (underlying rights unclear) |
| **quran-search-engine** | MIT TypeScript tokenizer + root/lemma search | MIT |

**No public Persian Quran-QA benchmark exists.** Treat as a gap to fill internally — absence claims are bounded by search, not proof.

**Persian quality of LLMs is unbenchmarked.** The only current Farsi eval repo (heyparsadev/persian-llm-eval) covers OpenAI/Anthropic/OpenRouter only — no Gemini, Qwen, GLM or DeepSeek. Validate on 50–100 native-written questions before trusting any model.

---

## 9. Two content defects in the corpus

1. **Basmala fused into verse 1 of 113 surahs.** Tanzil prepends it; QuranEnc translations do not include it. Verified: 2:1 Arabic is `بسم الله الرحمن الرحيم الم` while English is `"Alif, Lām, Meem.[7]"`. Needs a display split **and** a search-index rule (index it once as a pseudo-document, not 113 times).
2. **QuranEnc inline footnote markers** (`[7]`, `[98]`, `[2011]`) with no field in the answer contract. Ship markers + footnotes with `tafsir_shown: true`, or use a marker-free edition.