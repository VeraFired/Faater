# Blind evaluation set — protocol

Status: **frozen 2026-10-31; not run; scholar review pending.** The current hash
lives in `eval/blind.json` → `_meta.freeze_sha256`. The protocol below is what
the set must follow.

## Why a separate set

The pilot (`eval/pilot.json`) was used to tune retrieval, the concept weight and
the frame-term guard. Any number measured on it is an upper bound on quality,
not an estimate. The blind set is authored independently, frozen, and evaluated
**once** after the scholar review. No retrieval or model change may be tuned on
it.

## Composition

Same shape as the pilot, fresh topics:

| category | pairs | items (EN+FA) |
|---|---:|---:|
| answerable_direct | 25 | 50 |
| answerable_paraphrase | 8 | 16 |
| unanswerable_indomain | 9 | 18 |
| out-of-domain | 6 | 12 |
| adversarial | 2 | 4 |
| **total** | **50** | **100** |

Every pair is one English question and its faithful Persian translation. EN and
FA items are **not independent** and are never pooled for power calculations.

## Authoring protocol

1. Drafters wrote questions from the topic list, never from retrieval output,
   and were forbidden to read `pipeline/lib/retrieve.ts`, `pipeline/eval.ts` or
   `eval/*.json`.
2. Gold verses were found with `pipeline/tools/find.ts` and read in full with
   `pipeline/tools/verse.ts` across Arabic, English and Persian.
3. A separate adversarial reviewer read every proposed verse and dropped any
   that merely shared a keyword or required unsupported inference.
4. A Persian reviewer checked naturalness and fidelity of every Persian
   question; a completeness auditor checked counts, labels and overlap.
5. No item was accepted without at least one surviving gold verse; a question
   that could not be grounded was dropped, not guessed.

This is still an **AI-authored** set. The scholar review is what makes it
usable, and it is the remaining M0 blocker.

## Freeze

- Items are canonical JSON; `_meta.freeze_sha256 = sha256(JSON.stringify(items))`.
- `pipeline/tools/validate-blind.ts` verifies hash, pair structure, category
  counts, gold refs and language integrity. It runs no retrieval.
- Any edit to an item invalidates the hash and requires re-freezing and
  re-review.

### Current state (v0.1.0, 2026-10-31)

- 100 items: 50 EN/FA pairs across the five categories above.
- `node pipeline/tools/validate-blind.ts` prints `freeze verified` and `VALID`.
- The set has **not been run**, and no blind metric appears in the v0.1.0
  release notes. The reviewer packet (`docs/blind-review.md`) is generated on
  demand and is not committed.
- The v0.1.0 tag includes the frozen set exactly as authored. The planned
  v0.1.1 retrieval change and the v0.2.0 subject layer both invalidate it; a new
  blind set is required before any certification claim on changed code.

## Evaluation rules

- Run once, after the scholar signs off, with the exact code that will ship.
- Report **per language** and per category; never pool EN and FA (paired
  translations).
- Report Clopper–Pearson intervals. At 33 answerable items per language, a
  zero-error false-refusal result still only bounds the rate at ~10.4%; the
  set is not sized to certify a 5% budget. That limitation is part of the
  result, not a footnote.
- Any later change to retrieval, the concept layer, the scope model or the
  translations requires a **new** blind set. This one can never be reused.

## What the scholar is asked

For every pair: do the gold verses answer the question, is the translation
faithful, and is the question something a user would plausibly ask? Approve or
flag with a reason. The packet is generated with:

```bash
node pipeline/tools/review-packet.ts
```