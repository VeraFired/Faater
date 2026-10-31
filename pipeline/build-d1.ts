/**
 * Build the D1 seed: schema + data for the zero-AI Worker.
 *
 * D1 gives 5 GB and 5M row reads/day on the free plan, and FTS5 runs inside
 * SQLite — the 10 ms Worker CPU budget never sees BM25. The index text is
 * pre-folded and pre-expanded here, because FTS5's unicode61 tokenizer does no
 * Arabic folding (it split the basmala into single letters).
 *
 * Usage:
 *   node pipeline/build-d1.ts
 *
 * Output: data/build/d1/schema.sql, data/build/d1/seed.sql
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { tokenize } from './lib/bm25.ts'
import { arabicVariants, englishVariants } from './lib/stem.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(ROOT, 'data', 'build')

const NOTICE =
  '-- Qur\'an text: Tanzil.net, CC BY 3.0 — https://tanzil.net\n' +
  '-- Translations: QuranEnc.com — english_saheeh (Noor International Center),\n' +
  '-- persian_ih (Rowwad Translation Center). See docs/licensing.md.\n'

type Corpus = {
  version: string
  counts: { verses: number; surahs: number }
  surahs: Array<{
    index: number
    ayahs: number
    nameAr: string
    nameEn: string
    nameTranslit: string
    nameFa: string
    nameFaAlt: string | null
    revelation: string | null
    revelationOrder: number | null
  }>
  verses: Array<{
    ref: string
    surah: number
    ayah: number
    arabic: string
    body: string
    bodyNorm: string
    basmala: string | null
    basmalaIsWholeVerse: boolean
  }>
}

type Edition = {
  edition: { key: string; title: string }
  verses: Record<
    string,
    {
      segments: Array<{ t: string; v: string }>
      footnotes: Array<{ n: number; text: string }>
      searchText: string
      searchTextJoined: string
    }
  >
}

const corpus = JSON.parse(await readFile(join(BUILD, 'corpus.json'), 'utf8')) as Corpus
const en = JSON.parse(await readFile(join(BUILD, 'translations.en.json'), 'utf8')) as Edition
const fa = JSON.parse(await readFile(join(BUILD, 'translations.fa.json'), 'utf8')) as Edition
const lexicon = await readFile(join(BUILD, 'lexicon.json'), 'utf8')

/** Index text: every token expanded exactly the way the in-memory index does. */
const expandText = (text: string, expand: (t: string) => string[]): string =>
  tokenize(text)
    .flatMap((t) => expand(t))
    .join(' ')

const display = (e: Edition, ref: string): string =>
  (e.verses[ref]?.segments ?? []).map((s) => s.v).join(' ').trim()

const q = (v: string | null | undefined): string =>
  v === null || v === undefined ? 'NULL' : `'${v.replace(/'/g, "''")}'`

const schema = `${NOTICE}
PRAGMA foreign_keys = ON;

CREATE TABLE surahs (
  idx INTEGER PRIMARY KEY,
  ayahs INTEGER NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_translit TEXT NOT NULL,
  name_fa TEXT NOT NULL,
  name_fa_alt TEXT,
  revelation TEXT,
  revelation_order INTEGER
);

CREATE TABLE verses (
  ref TEXT PRIMARY KEY,
  surah INTEGER NOT NULL,
  ayah INTEGER NOT NULL,
  arabic TEXT NOT NULL,
  body TEXT NOT NULL,
  basmala TEXT,
  body_norm TEXT NOT NULL,
  en_text TEXT NOT NULL,
  en_search TEXT NOT NULL,
  fa_text TEXT NOT NULL,
  fa_search TEXT NOT NULL,
  fa_search_joined TEXT NOT NULL,
  en_footnotes TEXT NOT NULL,
  fa_footnotes TEXT NOT NULL,
  ar_idx TEXT NOT NULL,
  en_idx TEXT NOT NULL,
  fa_idx TEXT NOT NULL,
  faj_idx TEXT NOT NULL
);

CREATE INDEX verses_surah ON verses (surah, ayah);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE verses_fts USING fts5(
  ref UNINDEXED,
  ar,
  en,
  fa,
  faj,
  tokenize = 'unicode61'
);
`

const rows: string[] = []
for (const s of corpus.surahs) {
  rows.push(
    `INSERT INTO surahs VALUES (${s.index}, ${s.ayahs}, ${q(s.nameAr)}, ${q(s.nameEn)}, ` +
      `${q(s.nameTranslit)}, ${q(s.nameFa)}, ${q(s.nameFaAlt)}, ${q(s.revelation)}, ${s.revelationOrder ?? 'NULL'});`,
  )
}

const verseRows: string[] = []
const ftsRows: string[] = []
for (const v of corpus.verses) {
  const enV = en.verses[v.ref]
  const faV = fa.verses[v.ref]
  const enText = display(en, v.ref)
  const faText = display(fa, v.ref)
  const enSearch = enV?.searchText ?? ''
  const faSearch = faV ? `${faV.searchText} ${faV.searchTextJoined}` : ''
  verseRows.push(
    `(${q(v.ref)}, ${v.surah}, ${v.ayah}, ${q(v.arabic)}, ${q(v.body)}, ${q(v.basmala)}, ` +
      `${q(v.bodyNorm)}, ${q(enText)}, ${q(enSearch)}, ${q(faText)}, ${q(faV?.searchText ?? '')}, ` +
      `${q(faV?.searchTextJoined ?? '')}, ${q(JSON.stringify(enV?.footnotes ?? []))}, ` +
      `${q(JSON.stringify(faV?.footnotes ?? []))}, ` +
      `${q(expandText(v.bodyNorm, arabicVariants))}, ` +
      `${q(expandText(enSearch, englishVariants))}, ` +
      `${q(expandText(faV?.searchText ?? '', arabicVariants))}, ` +
      `${q(expandText(faV?.searchTextJoined ?? '', arabicVariants))})`,
  )
  ftsRows.push(
    `(${q(v.ref)}, ${q(expandText(v.bodyNorm, arabicVariants))}, ` +
      `${q(expandText(enSearch, englishVariants))}, ` +
      `${q(expandText(faV?.searchText ?? '', arabicVariants))}, ` +
      `${q(expandText(faV?.searchTextJoined ?? '', arabicVariants))})`,
  )
}

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

const seedParts: string[] = [NOTICE, 'BEGIN TRANSACTION;']
for (const batch of chunk(rows, 50)) seedParts.push(batch.join('\n'))
for (const batch of chunk(verseRows, 25)) {
  seedParts.push(
    'INSERT INTO verses (ref, surah, ayah, arabic, body, basmala, body_norm, en_text, en_search, ' +
      'fa_text, fa_search, fa_search_joined, en_footnotes, fa_footnotes, ar_idx, en_idx, fa_idx, faj_idx) VALUES\n' +
      batch.join(',\n') +
      ';',
  )
}
for (const batch of chunk(ftsRows, 25)) {
  seedParts.push(
    'INSERT INTO verses_fts (ref, ar, en, fa, faj) VALUES\n' + batch.join(',\n') + ';',
  )
}
seedParts.push(
  `INSERT INTO meta VALUES ('corpus_version', ${q(corpus.version)});`,
  `INSERT INTO meta VALUES ('counts', ${q(JSON.stringify(corpus.counts))});`,
  `INSERT INTO meta VALUES ('lexicon', ${q(lexicon)});`,
  `INSERT INTO meta VALUES ('surahs', ${q(JSON.stringify(corpus.surahs))});`,
  `INSERT INTO meta VALUES ('en_edition', ${q(JSON.stringify(en.edition))});`,
  `INSERT INTO meta VALUES ('fa_edition', ${q(JSON.stringify(fa.edition))});`,
  'COMMIT;',
)

await mkdir(join(BUILD, 'd1'), { recursive: true })
await writeFile(join(BUILD, 'd1', 'schema.sql'), schema, 'utf8')
await writeFile(join(BUILD, 'd1', 'seed.sql'), seedParts.join('\n') + '\n', 'utf8')

console.log('[build-d1] OK')
console.log(`  surahs        ${corpus.surahs.length}`)
console.log(`  verses        ${corpus.verses.length}`)
console.log(`  fts rows      ${ftsRows.length}`)
console.log(`  schema        data/build/d1/schema.sql`)
console.log(`  seed          data/build/d1/seed.sql (${(seedParts.join('\n').length / 1e6).toFixed(1)} MB)`)