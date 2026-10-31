# M1 Worker — zero-AI answer API

Status: **implemented and tested locally; NOT deployable to the public yet.**
The retrieval and card path is complete. The scope and answerability gates
(G1/G2/G3) are not — see "What is missing" below.

## What it does

```
GET  /api/ask?q=...&lang=en|fa
POST /api/ask  { "q": "...", "lang": "en" }
GET  /api/health
```

Every response is one of:

| status | meaning |
|---|---|
| `answered` | verse cards returned |
| `answered_with_boundary` | verse cards + a fixed notice (a ruling was requested) |
| `refused` | fixed copy only, no cards (`reason`: `no_evidence`, `fiqh_no_verse`, `crisis`, `tafsir`, `meaning`) |
| `clarification` | input problem (`too_short`, `too_long`) |

The answer path is:

```
G0 input guard
  → crisis / tafsir / meaning branch (fixed copy, no retrieval)
  → retrieval (D1 FTS5, ar + en + fa, weighted RRF, concepts at 0.1)
  → zero results? refuse with fixed copy
  → verse cards (Arabic verbatim + EN + FA translations, links, context refs)
```

No model is called. `wrangler.toml` has no Workers AI binding on purpose.

## Deploy

```bash
npm run pipeline                     # builds data/build/d1/{schema,seed}.sql
npx wrangler d1 create faater        # copy the database_id into wrangler.toml
npx wrangler d1 execute faater --remote --file=data/build/d1/schema.sql
npx wrangler d1 execute faater --remote --file=data/build/d1/seed.sql
npx wrangler secret put TURNSTILE_SECRET   # required before public traffic
npx wrangler deploy
```

`data/build/` is gitignored by design: the seed is deterministic from the
pinned source and must be regenerated, never committed stale.

## What is measured

D1/FTS5 path vs the in-memory retriever that produced the pilot numbers:

| metric | in-memory | D1/FTS5 |
|---|---:|---:|
| hit@5 | 27.3% | 27.3% |
| direct hit@5 | 34.0% | 32.0% |
| paraphrase hit@5 | 6.3% | 12.5% |
| MRR | 0.198 | 0.212 |
| query time | — | ~10 ms/item local |

The two paths differ in two deliberate ways: FTS5 excludes frame terms from a
match when content terms exist (it cannot down-weight one term), and FTS5's
bm25 is its own statistic. Both are documented in `worker/src/retrieve.ts`.

## What is missing — do not launch without it

1. **G1 scope classifier.** The pilot measured that retrieval scores cannot
   separate in-domain unanswerable questions (AUC 0.551, chance). A question
   like "How many rak'ahs are in Fajr?" will retrieve prayer verses and be
   answered. This is the largest open risk in the product.
2. **G2/G3.** No learned retrieval floor or answerability score. Refusal today
   happens only when retrieval returns nothing.
3. **Rate limiting and abuse control.** Turnstile is wired (secret-gated), but
   per-IP daily caps and the WAF rule are not implemented. The Worker is public
   and unauthenticated.
4. **Copy review.** All Persian copy and the fiqh/crisis strings are marked
   UNREVIEWED; a native reviewer and scholar must pass them.
5. **Sensitive-verse metadata.** Not authored yet; sensitive verses can surface
   in ordinary cards.
6. **Fonts and RTL UI.** No frontend yet — this is API only.

## Files

- `worker/src/retrieve.ts` — D1 FTS5 retrieval, concept layer, weighted RRF
- `worker/src/ask.ts` — answer assembly, guards, cards
- `worker/src/config.ts` — limits and all fixed copy
- `worker/src/index.ts` — HTTP handler, CORS, Turnstile
- `pipeline/build-d1.ts` — schema + seed generator
- `pipeline/tools/eval-d1.ts` — parity check against the pilot
- `worker/tests/ask.test.ts` — 10 contract tests against the real seed

## Frontend

`web/` is a zero-dependency static site (no build step) served by the same
Worker through `[assets]` in `wrangler.toml`; `/api/*` runs the Worker first.

- English and Persian, with `dir=rtl` and `lang` set per element.
- Arabic is rendered first, verbatim; translations are labelled with the
  edition title; footnotes are disclosed, not hidden.
- Refusal and boundary copy comes from the API — the frontend never composes
  religious text.
- No analytics, no external fonts, no cookies.

Persian UI copy is **UNREVIEWED**. It must be reviewed by a native speaker
before launch.