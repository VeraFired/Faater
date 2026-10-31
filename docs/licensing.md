# Licensing and provenance

Status date: **2026-10-31**. Every shipped file must trace to a grant below.
This is an engineering inventory, not legal advice; a legal review is still a
launch requirement.

## Shipped content

### Qur'anic Arabic text — Tanzil Project

- Source file: `Resources/quran-simple.txt`
- Version: Tanzil Quran Text (Simple), version 1.1
- SHA-256: `b3638f5cf03e2b05e4000efc0e4b656aafb3cf6ed28f8770b6497c5b43c46089`
- Licence: Creative Commons Attribution 3.0 (CC BY 3.0), verbatim only
- Copyright: Copyright (C) 2007–2026 Tanzil Project — https://tanzil.net
- Terms: copying and distribution of **verbatim** copies is permitted;
  **changing the text is not allowed**. The source must be clearly indicated
  and linked to tanzil.net. The copyright notice must be reproduced in every
  derived file containing a substantial portion of the text.

The full copyright block is stored in `data/build/corpus.json` under
`source.notice`, copied into both generated D1 artifacts (`schema.sql` and
`seed.sql`) as SQL comments, and is present in `Resources/quran-simple.txt`.
The corpus build fails if the source hash moves. Basmala segmentation is a
presentational split; the displayed Arabic bytes are never edited.

### English translation — QuranEnc `english_saheeh`

- Publisher: Noor International Center
- Version: **1.1.2**, last updated 2025-06-24
- Source: QuranEnc.com — https://quranenc.com
- Terms page: https://quranenc.com/en/home/about
- Archived terms: `data/source/quranenc/about-en.html`
- Terms SHA-256: `ade80d4560ed4917852620dea09d387f87ee27563ec252663a6731f677950ce1`
- Data SHA-256: `8e3feedb9b6735d60355c53aef9ebc4b86a8b995d118c0387e7e1bd93b67eddb`
- Licence conditions (all seven apply):
  1. No modification, addition, or deletion of the content.
  2. Clearly refer to the publisher and the source (QuranEnc.com).
  3. Mention the version number when re-publishing the translation.
  4. Keep the transcript information inside the document.
  5. Notify the source (QuranEnc.com) of any note on the translation.
  6. Update the translation according to the latest version issued by the source.
  7. No inappropriate advertisements when displaying translations.

The API card includes the edition title, publisher, version and source URL so
the version number is visible wherever the translation is rendered.

### Persian translation — QuranEnc `persian_ih` (Rowwad)

- Publisher: Rowwad Translation Center (with Rabwah Dawah Association,
  Islamic Content Service Association in Languages, IslamHouse.com)
- Version: **1.1.3**, last updated 2026-02-23
- Source: QuranEnc.com — https://quranenc.com
- Terms page and archive: same as above
- Data SHA-256: `937cc090d78fd93be80802d2ac7bfe91a6dc179996635eea2e6c6fd0227da365`
- The same seven conditions apply.

## Explicitly not shipped

- **Quran Foundation / quran.com API content** — its terms forbid building ML
  models or embeddings from its content. Never indexed, never embedded.
- **Khattab, Abdel Haleem, Saffarzadeh, Haddad Adel translations** — not
  freely licensed.
- **Tafsir Ibn Kathir, Nemuneh, Al-Mizan, Noor, Qaraati** — copyrighted;
  outbound links only, never stored or rendered as text.
- **Quranic Arabic Corpus morphology** — GPL plus a no-change restriction;
  not used.

## Operational constraints

- Tanzil translations are **non-commercial only**. No ads, sponsorships or
  paid tiers while they are used.
- Do not machine-translate Qur'anic text at runtime; editions are fixed files.
- Do not add commentary, interpretation or a ruling. Concept cards, when they
  ship, require human review and must carry citations.
- Report any suspected translation defect to QuranEnc.com and log the report.

## Generated artifacts

`data/build/` is generated and gitignored. It includes `corpus.json` (with the
full Tanzil notice and source hash), `translations.en.json` /
`translations.fa.json` (edition metadata and the seven conditions), and
`d1/schema.sql` / `d1/seed.sql` (notice header plus `meta.corpus_source`).
Regenerate with `pnpm pipeline`; never commit stale generated data.
