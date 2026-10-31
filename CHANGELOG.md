# Changelog

Notable changes to Faater. Dates are UTC. This project is a source preview:
versions are pre-releases until the launch gates pass.

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