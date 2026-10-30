# CHALLENGES — known blockers and their status

Every item here is something that will bite if forgotten. Status: 🔴 open · 🟡 mitigated · 🟢 resolved.

---

## 🟢 Basmala fused into verse 1 of 113 surahs
Tanzil prepends `بِسْمِ اللَّهِ الرَّحْمَـٰنِ الرَّحِيمِ` to the first verse of every surah except At-Tawbah. QuranEnc translations **do not include it** — verified 2:1 Arabic `بسم الله الرحمن الرحيم الم` vs English `"Alif, Lām, Meem.[7]"`.

**RESOLVED 2026-10-31 (M0 step 2).** Split into `basmala` / `body` / `bodyNorm` fields with the verse bytes untouched. Shape verified: **113 verses carry it — 112 prefixes (surahs 2–114 except 9) + 1:1 as a whole verse**, which is genuine scripture, not a prefix. 27:30's mid-verse basmala is left alone.
**Index rule:** FTS uses `bodyNorm`, **never** `arabicNorm` — otherwise the basmala is indexed 112 extra times and BM25 is corrupted for the three most common words in the corpus. A test asserts no verse body begins with the basmala key.
**Proof:** the translation-extent test — for all 112 prefixes, neither the English nor the Persian translation *begins* with a basmala translation. (`startsWith`, not `includes`: 96:1 legitimately reads "Recite in the name of your Lord".)

## 🟢 QuranEnc inline footnote markers
API returns a separate `footnotes` field plus inline `[7]`, `[98]`, `[464]`, `[2011]` in the text. Shipping verbatim leaves dangling markers; stripping modifies a no-modification translation; showing them is tafsir.

**RESOLVED 2026-10-31 (M0 step 3) — see ADR-014.** Ship verbatim as lossless segments; render `(N)` as the verse-number badge and `[N]` as a superscript linked to the translator's own footnote behind a disclosure (`tafsir_shown: true`). Nothing is added, modified or deleted.
**Persian edition has ZERO footnotes and zero markers** — this was never a Persian problem.
**Live source defect:** `english_saheeh` 7:143 cites `[403]` but the edition's footnotes stop at `[402]`. Recorded in `unresolvedNotes`; the renderer must emit a bare superscript. **Condition 5 obliges us to notify QuranEnc** — outstanding action.

## 🟡 QuranEnc condition 5 — report the 7:143 defect
The terms require notifying the source of any note on the translation. We found one: `english_saheeh` v1.1.2, 7:143, marker `[403]` with no footnote.
**Fix:** send a report to QuranEnc and archive the outbound message + any reply in `data/source/quranenc/`. Not blocking the build.

## 🟡 QuranEnc condition 6 — edition updates are mandatory
The terms require updating to the latest edition. Both editions are pinned by hash, so an upstream release will fail the build loudly rather than silently.
**Fix:** a scheduled check of `catalog.json` versions; re-fetch, re-hash, re-run the translation tests, and record the version bump in PROGRESS.

## 🟡 Reference parser: spelled-out numbers unsupported
«آیه دویست و پنجاه و پنج» and "Surah Al-Baqarah verse two hundred fifty five" return null.
**Why it is acceptable:** null routes to the no-evidence refusal. A half-built number parser would guess, and a wrong reference silently answers the wrong verse.
**Fix if demand appears:** a Persian/English number-word parser behind a test that every produced reference re-validates against the corpus.
**Owner:** post-M0, driven by production refusals.

## 🟡 Persian ZWNJ residual recall gap
Persian uses ZWNJ in 5,052 of 6,236 verses. Dual search keys (split + joined) close most of the variation, but a joined query misses verses where the translator wrote a **real space** instead. Measured: «می‌خواهد» → 40 verses, «میخواهد» → 39.
**Impact:** small recall loss, never a wrong answer.
**Fix if it matters:** a space-stripped index variant. Rejected for now — it trades precision for recall. Re-measure with real Persian queries in the M0 blind eval before revisiting.

## 🔴 Persian is the weaker peer
One translation, one unvalidated default, hand-authored surah names, **no benchmark**, no Finglish support, no answer to Iranian reachability.
**Impact:** the product promise "English and Persian as equals" is not yet true.
**Fix:** native review budget for all copy and every concept card; hand-build 300 Persian eval items; decide the Finglish policy; test from Iranian networks.
**Owner:** M0–M2.

## 🔴 No public Persian Quran-QA benchmark
QRCD and AyaTEC are Arabic. IslamicFaithQA is Arabic/English. Nothing Persian with refusal labels.
**Fix:** build internally — 300 items minimum, grouped, with a cross-lingual slice.
**Note:** absence claims are bounded by search; this is a gap, not a proven non-existence.

## 🔴 Sensitive-topic handling is undefined and is a duty of care
No detector, no verse-level sensitivity metadata, no precedence rules, no crisis branch.
**Impact:** a user in crisis gets verse cards; a reference to 9:5 or 4:34 bypasses query-text classification entirely.
**Fix:** authored `sensitivity` metadata per verse (not inferred at request time); larger canonical windows; two named translations + two named tafsirs; fixed scholar-approved framing; **separate safety escalation** for self-harm, domestic abuse, medical, legal.
**Owner:** M0 scoping, M6 governance.

## 🔴 Fiqh detection has false positives and false negatives
"Masjid al-**Haram**" contains "haram"; «مجاز» also means figurative. Misses: "Can I pray while traveling?", "Is crypto halal?".
**Fix:** learned classifier is primary, marker lists are recall boosters only. Boundary notice is fixed copy.

## 🟡 Dar al-Ifta ruling is secondary-sourced
January 2026 reports (Gulf News, IQNA, TIME) that Egypt's Dar al-Ifta ruled AI Qur'an interpretation impermissible. **Not confirmed against a primary source** — the critic's check could not verify it.
**Action:** do not publish it as fact. The design is already compatible (no model-authored interpretation), so it changes nothing operationally.

## 🟡 10 ms CPU ceiling
Measured: 7.9–9.6 ms for an int8 scan over 6,236 vectors at 1024-d, before fetch/parse/sort. Budget is 10 ms total.
**Mitigation:** binary prefilter + int8 rerank of top 512. Escape hatch: Workers Paid at $5/mo removes the cap.

## 🟡 Free-tier numbers are unstable
Every figure is dated 2026-10-31. Gemini, OpenRouter and NVIDIA could **not** be verified from this network (HTTP 403). Turso's free tier is unverified.
**Mitigation:** cascade built around Workers AI (verified), config in one file, retrieval-only floor.
**Rule:** re-verify before relying; mark stale facts `SUPERSEDED <date>`.

## 🟡 Translation provenance is not neutral
Sahih International (Noor International Center) and Rowwad (Iranian) carry institutional and theological provenance. Switching UI language visibly changes the theology on screen.
**Mitigation:** always offer multiple editions, label each, disclose the default rationale on the Methodology page.

## 🟡 "No tafsir" does not mean "no interpretation"
Translation choice, verse selection, context windows and the sensitivity taxonomy are all interpretive acts.
**Mitigation:** scholar board with credentials and madhhab balance; correction SLA; pre-launch review of every sensitive card.

## 🟡 Evaluation is underpowered as originally scoped
With 75 unanswerable items per language, one error is 1.33% — a "≤2% false answer" target cannot be measured. The original 2% / 10% / 95% targets were mutually inconsistent.
**Fix:** size the set to the target or report intervals; never quote point targets that the sample cannot support.

## 🟡 Worker is public and unauthenticated
One abuser can burn 10,000 neurons and 100k requests/day, degrading everyone to cards.
**Required:** Turnstile, the one free WAF rate-limit rule, per-IP daily cap in D1, origin check, hotlink protection on index assets.

## 🟡 Licensing is not fully cleared
QuranEnc embedding rights, ClearQuran under CC BY-ND for search indexing, and font licences are all unverified.
**Required:** archive terms at build; `docs/licensing.md` tracing every shipped file; legal review before launch.

## 🟡 Font metrics and harakat rendering unverified
Amiri Quran / KFGQPC / Vazirmatn claims could not be fetched. Stacked marks (shadda+fatha, superscript alef) may clip on low-end Android.
**Fix:** device lab before launch; line-height ≥ 1.8, no letter-spacing.

---

## Resolved

## 🟢 Corpus integrity
6,236 verses / 114 surahs / 1,353,702 bytes / SHA-256 `b3638f5cf03e2b05e4000efc0e4b656aafb3cf6ed28f8770b6497c5b43c46089` — verified.

## 🟢 Whether a vector DB is needed
No. See ADR-008.

## 🟢 Whether Cloudflare's reranker can be used
No — `bge-reranker-base` is Chinese/English only. See ADR-009.