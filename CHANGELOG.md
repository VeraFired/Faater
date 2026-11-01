# Changelog

Notable changes to Faater. Dates are UTC. This project is a source preview:
versions are pre-releases until the launch gates pass.

## [0.1.1] — 2026-11-01 (unreleased branch candidate)

Targeted BUG-001 fix plus a keyword-matching layer. Still a source preview,
not a launch. The branch `fix/bug-001-v0.1.1` is not merged, tagged, or
deployed.

### Fixed (partial)

- **Cross-field full-question coverage (D).** At fusion, a candidate that
  matched **every** eligible query group across the literal ar/en/fa lists is
  boosted by a bounded multiplier (`1 + coverageAlpha`). Partial overlap is not
  rewarded: common question words otherwise lifted unrelated verses. Concept
  lists do not count; the rerank is a no-op for one-term questions and when
  fewer than two groups matched. Grouping is punctuation-aware; stopword,
  frame-term and Persian light-verb variants are filtered after stemming.
- **Language-aware Arabic weight (A).** For a Persian request whose Persian
  literal list covers at least two query groups, the Arabic literal list is
  fused at weight 0.3 instead of 1.0. The two-group gate keeps full Arabic
  weight for Arabic-script questions typed in the Persian UI, where the
  Persian field may cover only one term.
- **Reported query fixed in both paths.** Persian `شراب و قمار` now returns
  `5:90`, `5:91`, `2:219` in the top 5 (2:219 at rank 3 in-memory and D1).
  False friends 24:31 (veils) and 2:280 (deferment) stay out of the top 5.
  Arabic-script `الخمر والميسر` in the Persian UI also keeps 2:219 in the top 5.
- **Page title** changed to `Faater | Quran QA`.

### Keyword-matching layer

- **Concept weight 0.1 → 0.5.** A concept list's rank-1 verse now ties a
  literal list's rank-2 verse; it can promote a bridge but not outvote an exact
  user term. Chosen by a pilot sweep, not an argmax.
- **Concept coverage opt-out.** Concept synonyms are alternatives, not a
  conjunction; scoring them with a matched-term fraction pushed the
  forgiveness verses out of the top 50.
- **Persian and English stem-aware matching.** Persian plurals, «می/نمی» and
  Arabic loanword prefixes; English inflection variants are also used for
  concept triggers ("tested" → `trial`). «والدین» no longer stems to «دين»
  (religion) in either the Persian or the Arabic field.
- **Concept specificity and exclusions.** Generic concepts are a fallback only;
  `wine` excludes 24:31 and `gambling` excludes 2:280. New topics include
  `healing` (شفا/درمان), `gambling`, `backbiting`, `usury`, `inheritance`,
  `neighbor`, `remembrance`, `insult`, `modesty`, `arrogance`; generosity is
  folded into `charity`.
- **Persian digits in the Persian UI.** Verse references render as ۱۵:۸۷;
  links and footnote anchors keep the canonical Latin form.

### Evidence

- `npm test`: 210 pass (new stem, query-plan, concept-exclusion, and D1 tests).
- `eval-issues.ts --phase v0.1.1`: 6/6 pass in both in-memory and D1 paths.
- Pilot in-memory / D1: hit@5 **48.5% / 47.0%**; direct **52.0% / 48.0%**;
  paraphrase **37.5% / 43.8%**; MRR **0.383 / 0.372**. Pilot only — not blind,
  not scholar-reviewed, not certified.
- `ablate.ts` (concept layer, A/D pinned off): paraphrase 6.3% → 37.5%, direct
  36.0% → 48.0%. Pre-registered acceptance PASS.
- `ablate-fusion.ts` (shipped weight): hit@5 45.5% → 48.5%, direct 48.0% →
  52.0%, paraphrase unchanged, MRR 0.365 → 0.383. PASS.
- Blind set: byte-identical and **not run**. Any retrieval change invalidates
  the frozen set before a certification claim.

### Known issues

- **BUG-001 is partially fixed.** Persian `شراب` (2:219 #9 in-memory / #6 D1)
  and English "wine" (#7 / #4; the rest of the prohibition cluster is at
  #12–13) still miss the full top 5; the reviewed verse→subject layer is
  planned for 0.2.0. The entry remains PARTIALLY FIXED.
- Long verses still lose to short ones under BM25 length normalization:
  parents returns inheritance verses before 17:23, and «فرشتگان» does not
  surface 2:285. Recorded, not papered over.
- All v0.1.0 launch blockers remain: G1 held, G2/G3 missing, no abuse caps,
  Persian/fiqh/crisis copy UNREVIEWED, no sensitive-verse metadata, legal
  review pending, M3/M4 not implemented.

## [0.1.0] — 2026-10-31

First tagged source preview. Not a launch.

### Added

- **M0 corpus and evaluation.** Pinned Tanzil Arabic (SHA-256 checked), QuranEnc
  `english_saheeh` 1.1.2 and `persian_ih` 1.1.3; basmala segmentation;
  trilingual normalization (Arabic, English, Persian, joined Persian);
  deterministic corpus and D1 seed generation.
- **M1 answer API.** Cloudflare Worker on D1/FTS5: explicit verse and surah
  references, fixed input guards, fixed refusal and boundary copy, five-card
  answers with Arabic and both translations, Turnstile-aware HTTP surface, and
  fail-closed CORS.
- **M2 frontend.** Static EN/FA UI with RTL, verse cards, labelled translation
  editions, disclosed footnotes, and no analytics or external fonts.
- **Retrieval evaluation.** 100-item pilot, frozen 100-item blind set (not run),
  burned scope holdout, hit/MRR/refusal reports, and concept-layer ablations.
- **Concept layer.** 83 synonym lists fused at RRF weight 0.1. Search
  vocabulary only; unreviewed and never displayed.
- **Favicon and footer credit.** Black-nib favicon; VeraFired / Amir Vafaei
  credit links in the site footer.

### Evidence

- `npm test`: 167 pass (142 pipeline + 25 worker).
- Pilot, in-memory / D1: hit@5 28.8% / 30.3%; direct 34.0% / 34.0%;
  paraphrase 12.5% / 18.8%; MRR 0.215 / 0.229. Pilot only — not blind, not
  scholar-reviewed, not certified.
- Concept ablation: paraphrase hit@5 6.3% → 12.5%; direct 36.0% → 34.0%
  (within the pre-registered 2-point allowance). PASS.
- Blind set: frozen and verified, **not run**.

### Known issues

- **BUG-001 (open).** Persian `شراب و قمار` puts 2:219 at rank 7 in-memory / 8
  in D1, below the five-card cutoff. English alcohol+gambling rank 3; English
  "wine" rank 7; Persian `شراب` rank 20. Targeted fix planned for 0.1.1;
  reviewed verse→subject layer planned for 0.2.0.
- **G1 held.** Independent holdout Quran recall 92.5% (EN 95.0%, FA 90.0%)
  against a 97% target; the classifier is built but not wired.
- **G2/G3 missing.** No learned retrieval floor or answerability score.
- **Abuse controls incomplete.** No per-IP daily caps or WAF rate-limit rule.
- **Copy review pending.** Persian UI and fiqh/crisis copy are UNREVIEWED; no
  sensitive-verse metadata.
- **Legal review pending.** No code licence is granted by this pre-release.
- **M3/M4 not implemented.** No dense retrieval, concept cards, or generated
  prose.

### Licensing

Qur'anic Arabic is Tanzil v1.1, CC BY 3.0, verbatim only. English and Persian
translations are QuranEnc `english_saheeh` 1.1.2 and `persian_ih` 1.1.3 under
their seven conditions. No Quran Foundation/quran.com content is indexed or
embedded. No ads, sponsorships, or paid tiers while Tanzil translations are
used. See `docs/licensing.md`.