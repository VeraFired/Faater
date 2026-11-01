# Handoff — current working state

Updated **2026-11-01**. `PROGRESS.md` is the historical record (append-only);
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
| Tests | ✅ 210 pass (pipeline + worker) |
| Release | ✅ **v0.1.0 source preview** — GitHub pre-release, not latest, **not a launch** |
| Branch | 🟡 `fix/bug-001-v0.1.1` — BUG-001 partial fix (D + A) plus the keyword-matching layer; pushed and **deployed to staging** 2026-11-01, **not merged, tagged, or released** |
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

- `npm test` 210/210.
- `wrangler deploy --dry-run` bundles cleanly (re-run on this branch before any
  deploy).
- `validate-blind.ts` prints `VALID`; the blind set is frozen, byte-identical,
  and has **not** been run.
- `pnpm ablate` passes: paraphrase hit@5 6.3% → 37.5%, direct 36.0% → 48.0%
  (the rule allows a 2-point direct drop; there is none).
- `pnpm ablate:fusion` passes the BUG-001 acceptance at the shipped concept
  weight: hit@5 45.5% → 48.5%, direct 48.0% → 52.0%, paraphrase unchanged at
  37.5%, MRR 0.365 → 0.383. D is a full-coverage bonus; A is gated on Persian
  covering two query groups.
- `pnpm eval:issues -- --phase v0.1.1`: 6/6 in both in-memory and D1 paths;
  Persian `شراب و قمار` puts `5:90`, `5:91`, `2:219` in the top 5, with 24:31
  and 2:280 absent. Arabic-script `الخمر والميسر` in the Persian UI also keeps
  2:219 in the top 5.
- Staging: health, config (site key only), page, CORS, 403 without a token;
  with a token: patience → cards (`70:5` first), `2:255` exact,
  `2:999` → `refused/out_of_range`.
- **Staging deploy 2026-11-01** of this branch: commit `8c9e888`, Worker version
  `c41a0a35-11a0-459d-b255-c8cdf41df739`, API `m1-0.1.1`. D1 `meta.lexicon`
  upserted to the 95-concept table (60,644 chars, contains `gambling`); no
  schema change, no full re-seed. Verified after deploy: page title
  `Faater | Quran QA`, health, config (site key only), 403 without a Turnstile
  token, foreign-origin CORS fails closed. The token-gated answer path was not
  re-run headlessly — Turnstile needs a human — so it is covered by the D1
  parity run and tests against the same seed, not by a live click-through.
- Eval is deterministic except `generated` / `elapsedMs`.
- Current pilot (in-memory / D1): hit@5 **48.5% / 47.0%**, direct
  **52.0% / 48.0%**, paraphrase **37.5% / 43.8%**, MRR **0.383 / 0.372**
  (10.6 ms/item D1, 2026-11-01 run). Concept weight is 0.5; the pilot sweep that
  chose it is in `PROGRESS.md` (2026-11-01).
- Current refusal separation (pilot): OOD AUC **0.936**, in-domain unanswerable
  **0.753**, adversarial **0.807**. In-domain is above the 0.700 bar on the
  pilot, but the pilot is a development set — no gate is wired and this is not
  a calibration claim.

## Plan — ordered next actions

1. **v0.1.1 — BUG-001 targeted fix (implemented on branch).** Cross-field
   query-term coverage (D, full coverage only) plus a language-aware Arabic
   weight for Persian requests (A, 0.3, gated on the Persian field covering at
   least two query groups). Issue set, controls, and both retrieval paths pass.
   Owner decides whether to commit/tag/deploy; do **not** release without that
   instruction. Do **not** mark BUG-001 fixed: Persian `شراب` (2:219 #9
   in-memory / #6 D1) and English "wine" (#7 / #4, remaining cluster #12–13)
   still need the v0.2.0 subject layer.
2. **v0.2.0 — reviewed verse→subject relevance layer.** Owner-reviewed subject
   labels and edges; scholar sign-off before any public launch. This is the
   durable polysemy fix and the retrieval half of M4.
3. **Blind-set review (human).** Scholar + native Persian reviewer. Nothing
   from `eval/blind.json` is quotable until this passes. Any retrieval change
   invalidates the frozen set; create a new one before certification.
4. **G2 out-of-domain floor.** OOD separability is stronger after the keyword
   layer (pilot AUC 0.936, in-domain 0.753, adversarial 0.807), but these are
   development-set numbers and no gate is wired. A floor is the narrowest
   honest gate; recalibrate before wiring it.
5. **M3 dense retrieval.** The measured paraphrase failure (12.5% hit@5) and
   the polysemy case in BUG-001 are the reasons; concept expansion alone is
   not enough.
6. **Abuse controls and launch hygiene.** Per-IP daily caps, WAF rate-limit
   rule, Persian copy review, sensitive-verse metadata, legal review.

## Commands

```bash
npm test                 # pipeline + worker, 210 tests
npm run pipeline         # rebuild corpus + translations + lexicon + D1 seed
npm run eval             # pilot → eval/report.md / report.json
npm run eval:d1          # D1/FTS5 parity against the pilot
npm run eval:issues -- --phase v0.1.1   # targeted BUG-001 issue set, both paths
npm run ablate:fusion    # A/D acceptance + weight sweeps
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
- Present the v0.1.1 branch as merged, tagged, or deployed before the owner
  approves that step.
- Tune retrieval on `eval/blind.json` or `eval/scope-holdout.json`.

## Pointers

- History: `PROGRESS.md`
- Decisions: `DECISIONS.md`
- Risks: `CHALLENGES.md`
- Bugs: `BUGS.md`
- G1 record: `docs/g1-scope.md`
- Blind protocol: `docs/blind-set.md`
- Licensing: `docs/licensing.md`