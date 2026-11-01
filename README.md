# Faater

**A free, public, Qur'an-grounded Q&A system in English and Persian.**
Source preview — **not a launch**. v0.1.0 is the published GitHub pre-release;
the `fix/bug-001-v0.1.1` branch carries an unreleased targeted fix.

> قُلِ اللَّهُمَّ فَاطِرَ السَّمَاوَاتِ وَالْأَرْضِ عَالِمَ الْغَيْبِ وَالشَّهَادَةِ أَنتَ تَحْكُمُ بَيْنَ عِبَادِكَ فِي مَا كَانُوا فِيهِ يَخْتَلِفُونَ
>
> Qur'an 39:46. Arabic text from the Tanzil Project (CC BY 3.0, verbatim).

Faater takes a question, searches the Qur'an in Arabic, English and Persian,
and returns verse cards: the Arabic text, two labelled translations, and links.
If it cannot find relevant text it refuses with fixed copy. It never interprets,
never issues a ruling, and never calls an AI provider on the answer path.

**Staging:** https://faater.verafired.workers.dev — a Turnstile-gated test
instance. No SLA, may reset, and not presented as a launch.

## Status

| | |
|---|---|
| Version | `0.1.1` branch candidate (unreleased); `v0.1.0` is the published pre-release |
| Scope | EN + FA; Qur'an only; deterministic answer path |
| Tests | 210 pass (pipeline + worker) |
| Pilot retrieval | hit@5 48.5% in-memory / 47.0% D1 — pilot only, not blind, not certified |
| Launch readiness | **not launch-ready** — see known blockers |

## Quick start

Requires Node.js >= 24.

```bash
pnpm install
pnpm pipeline                 # pinned sources -> data/build/ (gitignored)
npm test                      # 210 tests
pnpm eval                     # 100-item pilot -> eval/report.md
pnpm eval:d1                  # D1/FTS5 parity against the same pilot
npx wrangler deploy --dry-run # bundle check; needs no Cloudflare credentials
```

`data/build/` is generated from the pinned source files and is never committed.
To run the Worker locally against a real D1 database, follow
`docs/m1-worker.md`.

## Architecture

- Pinned Tanzil Arabic (SHA-256 locked) and QuranEnc `english_saheeh` /
  `persian_ih` editions; Arabic is displayed verbatim, never edited.
- Normalized search fields for Arabic, English, Persian, plus a joined Persian
  field; indexed with D1 FTS5.
- Trilingual BM25 retrieval, 95 concept synonym lists, and weighted reciprocal
  rank fusion (k=60; concept lists 0.5, literal fields 1.0); five cards maximum.
  A full-question coverage bonus (v0.1.1) prefers a verse that contains every
  eligible query term across the literal fields.
- Fixed input guards, fixed refusal/boundary copy, and verse cards built from
  the corpus. No model call, no provider on the critical path.
- Static EN/FA/RTL frontend served by the same Worker; Turnstile-gated API with
  a fail-closed CORS allowlist.

Concept lists are **unreviewed search vocabulary**, never display text. They can
change which verses are retrieved; they can never put a wrong word in front of a
user.

## Repository map

```
.claude/        handoff, progress history, bug log, ADRs
Resources/      pinned Qur'an Arabic source (Tanzil)
data/source/    pinned QuranEnc editions and catalog
data/lexicon/   search vocabulary: concept synonyms, surah names, Finglish
data/scope-model.json   lexical G1 model (built, held, not wired)
eval/           pilot, frozen blind set, burned scope holdout, reports
pipeline/       build scripts, retrieval library, eval runner, tools, tests
worker/         Cloudflare Worker answer API and tests
web/            static EN/FA UI (no build step)
docs/           licensing, methodology, M1 worker notes, G1 record
```

`data/build/` is generated and gitignored.

## Evidence

The retrieval numbers quoted here come from the 100-item pilot: 66 answerable
items, 34 should-refuse items, EN and FA are paired translations. It is a
development set, not the blind set, and it has not been scholar-reviewed.

| metric | in-memory | D1/FTS5 |
|---|---:|---:|
| hit@5 | 48.5% (32/66) | 47.0% (31/66) |
| direct hit@5 | 52.0% (26/50) | 48.0% (24/50) |
| paraphrase hit@5 | 37.5% (6/16) | 43.8% (7/16) |
| MRR | 0.383 | 0.372 |

The concept layer clears its pre-registered acceptance rule by a wide margin:
with A and D pinned off in both arms, paraphrase hit@5 rises 6.3% → 37.5% and
direct hit@5 rises 36.0% → 48.0% at the shipped weight of 0.5. The weight sweep
put 0.5 at hit@5 48.5% / MRR 0.383; higher weights added no monotonic paraphrase
gain and cost head ranks on direct topics (prayer 3 → 7), so 0.5 is the
mechanism choice, not an argmax. The v0.1.1 fusion change clears its own rule:
hit@5 rises 45.5% → 48.5%, direct 48.0% → 52.0%, paraphrase unchanged, MRR
0.365 → 0.383. The blind set is frozen and **has not been run**; no blind
metric is quoted anywhere in this branch.

## Known blockers

- **BUG-001 (partially fixed on the v0.1.1 branch; unreleased).** Persian
  `شراب و قمار` now puts `5:90`, `5:91`, and 2:219 in the top 5 (2:219 at rank
  3 in both paths), and the false friends 24:31/2:280 stay out. Arabic-script
  `الخمر والميسر` in the Persian UI also keeps 2:219 at rank 3. Persian
  `شراب` (2:219 at #9 in-memory, #6 in D1) and English "wine" (2:219 at #7,
  #4 in D1; the rest of the prohibition cluster is at #12–13) still miss the
  full top 5: a one-word query has no cross-field coverage to compare, so the
  reviewed verse→subject layer in v0.2.0 is the remaining fix.
- **G1 scope classifier held.** Independent holdout Quran recall is 92.5%
  (EN 95.0%, FA 90.0%) against a 97% target, so it is built but not wired. A
  fiqh question can retrieve prayer verses and be answered. This is the largest
  open product risk.
- **G2/G3 missing.** There is no learned retrieval floor or answerability score;
  refusal happens only when retrieval returns nothing.
- **Abuse controls incomplete.** Turnstile and CORS are wired; per-IP daily caps
  and the Cloudflare WAF rate-limit rule are not.
- **Copy review pending.** Persian UI copy and the fiqh/crisis strings are
  marked UNREVIEWED. No sensitive-verse metadata exists yet.
- **Legal review pending.** See licensing below.
- **M3/M4 not implemented.** No dense retrieval, no concept cards, no generated
  prose.
- **Blind set not reviewed or run.** Any retrieval change invalidates the frozen
  set; a new set is required before any certification claim.

## Version mapping

| artifact | version |
|---|---|
| Git tag (published) | `v0.1.0` |
| Branch candidate | package `0.1.1`, Worker API `m1-0.1.1` (unreleased) |
| Package (v0.1.0 tag) | `0.1.0` (private) |
| Worker API (v0.1.0 tag) | `m1-0.1.0` |
| Corpus schema | `1.0.0` (`data/build/corpus.json`) |

The D1 schema and seed are generated from `pipeline/build-d1.ts` at this tag;
they are not committed. The v0.1.1 branch does not change the schema or seed.

## Licensing and attribution

- **Qur'anic Arabic:** Tanzil Quran Text (Simple) v1.1, CC BY 3.0, **verbatim
  only**. Copyright (C) 2007–2026 Tanzil Project — https://tanzil.net. The
  notice is reproduced in every generated corpus/D1 artifact.
- **English:** QuranEnc `english_saheeh` v1.1.2 (Noor International Center).
- **Persian:** QuranEnc `persian_ih` v1.1.3 (Rowwad Translation Center).
  Both QuranEnc editions are used under their seven conditions; the edition
  title, publisher, version and source URL are shown on every card.
- **Never shipped:** Quran Foundation / quran.com content, non-free
  translations, copyrighted tafsir text, or Quranic Arabic Corpus morphology.
- **No ads, sponsorships or paid tiers** while Tanzil translations are used.

The full inventory, hashes and terms are in [`docs/licensing.md`](docs/licensing.md).

**No code licence is granted for this pre-release.** Legal review is pending.
The Qur'an text and translations retain their own licences; do not reuse the
code until a licence is published.

## Links

- Staging: https://faater.verafired.workers.dev
- Bugs and limitations: [`.claude/BUGS.md`](.claude/BUGS.md)
- Current handoff: [`.claude/HANDOFF.md`](.claude/HANDOFF.md)
- Evaluation methodology: [`docs/eval-methodology.md`](docs/eval-methodology.md)
- M1 Worker notes: [`docs/m1-worker.md`](docs/m1-worker.md)
- Changelog: [`CHANGELOG.md`](CHANGELOG.md)

Maintained by [Amir Vafaei](https://vafaeiam.ir) / [VeraFired](https://github.com/VeraFired).