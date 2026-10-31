# Handoff — current working state

Updated **2026-10-31**. `PROGRESS.md` is the historical record (append-only);
this file is the current state, the plan, and the operating notes a future
session needs first. Bugs live in `BUGS.md`.

## Where the build stands

| Area | State |
|---|---|
| M0 vertical slice | 🟡 5/6 — blind set frozen, **scholar review pending** |
| M1 answer path | 🟡 slice 1 live — D1/FTS5, RRF, cards, fixed copy; **G1 held, G2/G3 missing** |
| M2 UI | 🟡 slice 1 live — static EN/FA/RTL, no PWA/sitemap/Astro |
| G1 scope classifier | ⛔ built and evaluated, **not wired** — holdout 92.5% vs 97% target |
| Staging | ✅ https://faater.verafired.workers.dev (public URL, **not a launch**) |
| Tests | ✅ 167 pass (142 pipeline + 25 worker) |
| Release | ✅ **v0.1.0 source preview** — GitHub pre-release, not latest, **not a launch** |
| Repo | `origin/init` and `origin/main` at tag `v0.1.0`; GitHub repo is **public** |

## Deployed stack

- Worker `faater`; account workers.dev subdomain `verafired`.
- D1 `faater`, region WEUR, id `50163789-cd91-4f7b-bb9a-6eac3430a8a7`:
  6,236 verses / 6,236 FTS rows / 114 surahs / 34.3 MB.
- Turnstile widget `faater-staging` (managed). Site key is public in
  `wrangler.toml`; the secret is a Worker secret and must never be committed.
- `ALLOWED_ORIGIN` is the staging origin; CORS fails closed elsewhere.
- Turnstile secret was rotated after a CLI print; do not reuse any secret that
  appears in a transcript.
- Release `v0.1.0` (source preview):
  https://github.com/VeraFired/Faater/releases/tag/v0.1.0 — a pre-release with
  no attached assets. It is not a launch.

## What was verified (not assumed)

- `npm test` 167/167.
- `wrangler deploy --dry-run` bundles cleanly.
- `validate-blind.ts` prints `VALID`; the blind set is frozen and has **not**
  been run.
- `pnpm ablate` passes: paraphrase hit@5 6.3% → 12.5%, direct 36.0% → 34.0%
  (within the 2-point allowance).
- Remote D1 row counts and a known verse (`2:255`).
- Staging: health, config (site key only), page, CORS, 403 without a token;
  with a token: patience → cards (`70:5` first), `2:255` exact,
  `2:999` → `refused/out_of_range`.
- Eval is deterministic except `generated` / `elapsedMs`.
- Current pilot (in-memory / D1): hit@5 **28.8% / 30.3%**, direct
  34.0% / 34.0%, paraphrase 12.5% / 18.8%, MRR 0.215 / 0.229.

## Plan — ordered next actions

1. **v0.1.1 — BUG-001 targeted fix.** Implement cross-field query-term coverage
   at fusion (D, primary) plus a language-aware Arabic weight for Persian
   requests (A). Add `eval/issues/bug-001.json`; gate on the reported Persian
   phrase and the English alcohol+gambling control in both in-memory and D1
   paths; keep the pilot direct/paraphrase guard. Deploy to staging as a
   pre-release. Do **not** mark BUG-001 fixed: Persian `شراب` and English
   "wine" remain until v0.2.0.
2. **v0.2.0 — reviewed verse→subject relevance layer.** Owner-reviewed subject
   labels and edges; scholar sign-off before any public launch. This is the
   durable polysemy fix and the retrieval half of M4.
3. **Blind-set review (human).** Scholar + native Persian reviewer. Nothing
   from `eval/blind.json` is quotable until this passes. Any retrieval change
   invalidates the frozen set; create a new one before certification.
4. **G2 out-of-domain floor.** OOD separability is real (AUC 0.815); in-domain
   unanswerable remains chance (0.580). A floor is the narrowest honest gate.
5. **M3 dense retrieval.** The measured paraphrase failure (12.5% hit@5) and
   the polysemy case in BUG-001 are the reasons; concept expansion alone is
   not enough.
6. **Abuse controls and launch hygiene.** Per-IP daily caps, WAF rate-limit
   rule, Persian copy review, sensitive-verse metadata, legal review.

## Commands

```bash
npm test                 # pipeline + worker, 167 tests
npm run pipeline         # rebuild corpus + translations + lexicon + D1 seed
npm run eval             # pilot → eval/report.md / report.json
npm run eval:d1          # D1/FTS5 parity against the pilot
node pipeline/tools/validate-blind.ts
npx wrangler deploy --dry-run
npx wrangler deploy      # staging
npx wrangler tail        # live logs
```

Useful one-offs:
- `node pipeline/tools/find.ts fa <term> --refs` — authoring search, not ranking.
- `node pipeline/tools/eval-scope.ts <model> eval/scope-holdout.json` — G1
  holdout (burned; never tune on it).

## Do not

- Put an LLM on the answer path (see `quran-bot-zero-cost-architecture`).
- Commit `docs/blind-review.md` (full translations) or any Turnstile secret.
- Quote blind-set metrics before scholar review.
- Present staging as a launch. G1/G2, rate limits, copy review and
  sensitive-verse metadata are still missing.
- Present v0.1.0 as a launch or stable release: it is a source preview and a
  GitHub pre-release.
- Tune retrieval on `eval/blind.json` or `eval/scope-holdout.json`.

## Pointers

- History: `PROGRESS.md`
- Decisions: `DECISIONS.md`
- Risks: `CHALLENGES.md`
- Bugs: `BUGS.md`
- G1 record: `docs/g1-scope.md`
- Blind protocol: `docs/blind-set.md`
- Licensing: `docs/licensing.md`