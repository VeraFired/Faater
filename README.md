# Faater

**A free, public, Qur'an-grounded Q&A system in English and Persian.**
Source preview — **not a launch**. v0.1.0 is a GitHub pre-release.

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
| Version | `v0.1.0` source preview (GitHub pre-release) |
| Scope | EN + FA; Qur'an only; deterministic answer path |
| Tests | 167 pass (142 pipeline + 25 worker) |
| Pilot retrieval | hit@5 28.8% in-memory / 30.3% D1 — pilot only, not blind, not certified |
| Launch readiness | **not launch-ready** — see known blockers |

## Quick start

Requires Node.js >= 24.

```bash
pnpm install
pnpm pipeline                 # pinned sources -> data/build/ (gitignored)
npm test                      # 167 tests
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
- Trilingual BM25 retrieval, 83 concept synonym lists, and weighted reciprocal
  rank fusion (k=60; concept lists 0.1, literal fields 1.0); five cards maximum.
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
| hit@5 | 28.8% (19/66) | 30.3% (20/66) |
| direct hit@5 | 34.0% (17/50) | 34.0% (17/50) |
| paraphrase hit@5 | 12.5% (2/16) | 18.8% (3/16) |
| MRR | 0.215 | 0.229 |

The concept layer clears its pre-registered acceptance rule: paraphrase hit@5
rises 6.3% → 12.5%, direct hit@5 falls 36.0% → 34.0% (exactly the allowed 2.0
points). The blind set is frozen and **has not been run**; no blind metric is
quoted anywhere in this release.

## Known blockers

- **BUG-001 (open).** Persian `شراب و قمار` puts 2:219 at rank 7 in-memory / 8
  in D1, outside the five-card cutoff. English "alcohol and gambling" finds it
  at rank 3; English "wine" at rank 7 and Persian `شراب` at rank 20. The root
  cause is polysemy between the prohibition verses and Paradise-wine verses,
  made worse by searching raw Persian tokens in the Arabic field. A targeted
  fix is planned for v0.1.1; the reviewed subject layer is v0.2.0.
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
| Git tag | `v0.1.0` |
| Package | `0.1.0` (private) |
| Worker API | `m1-0.1.0` |
| Corpus schema | `1.0.0` (`data/build/corpus.json`) |

The D1 schema and seed are generated from `pipeline/build-d1.ts` at this tag;
they are not committed.

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