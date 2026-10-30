/**
 * Build the translation artefacts.
 *
 * Input  : data/source/quranenc/{english_saheeh,persian_ih}.sqlite
 * Output : data/build/translations.en.json, data/build/translations.fa.json
 *
 * QuranEnc's terms (archived at data/source/quranenc/about-en.html):
 *   1. No modification, addition, or deletion of the content.
 *   2. Clearly referring to the publisher and the source (QuranEnc.com).
 *   3. Mentioning the version number when re-publishing the translation.
 *   4. Keeping the transcript information inside the document.
 *   5. Notifying the source of any note on the translation.
 *   6. Updating according to the latest version from the source.
 *   7. Inappropriate advertisements must not be included.
 *
 * Therefore: the text is stored verbatim, each artefact embeds the edition,
 * publisher, version and terms, and the parser only *segments* — never edits.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { parseTranslation, rejoin, selfNumber } from './lib/translation.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'data', 'source', 'quranenc')
const OUT = join(ROOT, 'data', 'build')
const LOCK = join(ROOT, 'data', 'sources.lock.json')

const EXPECTED_VERSES = 6236

const EDITIONS = [
  { key: 'english_saheeh', lang: 'en', file: 'translations.en.json' },
  { key: 'persian_ih', lang: 'fa', file: 'translations.fa.json' },
] as const

/** Verbatim from https://quranenc.com/en/home/about — archived alongside. */
const LICENSE_CONDITIONS = [
  'No modification, addition, or deletion of the content.',
  'Clearly referring to the publisher and the source (QuranEnc.com).',
  'Mentioning the version number when re-publishing the translation.',
  'Keeping the transcript information inside the document.',
  'Notifying the source (QuranEnc.com) of any note on the translation.',
  'Updating the translation according to the latest version issued from the source (QuranEnc.com).',
  'Inappropriate advertisements must not be included when displaying translations of the meanings of the Noble Quran.',
]

interface CatalogEntry {
  key: string
  title: string
  description: string
  version: string
  last_update: number
  direction: string
  language_iso_code: string
}

function fail(msg: string): never {
  throw new Error(`[build-translations] ${msg}`)
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function main(): Promise<void> {
  const lock = JSON.parse(await readFile(LOCK, 'utf8')) as {
    sources: Record<string, { sha256: string; bytes: number }>
  }
  const catalog = JSON.parse(await readFile(join(SRC, 'catalog.json'), 'utf8')) as {
    translations: CatalogEntry[]
  }
  const catalogByKey = new Map(catalog.translations.map((t) => [t.key, t]))

  const corpus = JSON.parse(await readFile(join(OUT, 'corpus.json'), 'utf8')) as {
    verses: Array<{ ref: string }>
  }
  const corpusRefs = new Set(corpus.verses.map((v) => v.ref))
  if (corpusRefs.size !== EXPECTED_VERSES) fail(`corpus has ${corpusRefs.size} refs`)

  await mkdir(OUT, { recursive: true })

  for (const ed of EDITIONS) {
    const sqlitePath = join(SRC, `${ed.key}.sqlite`)
    const actualHash = await sha256(sqlitePath)
    const pinned = lock.sources[`${ed.key}.sqlite`]
    if (!pinned) fail(`${ed.key}.sqlite is not pinned in sources.lock.json`)
    if (pinned.sha256 !== actualHash) {
      fail(
        `${ed.key}.sqlite hash mismatch\n  expected ${pinned.sha256}\n  actual   ${actualHash}\n` +
          'A moved hash means the edition changed. Record the new version deliberately.',
      )
    }

    const meta = catalogByKey.get(ed.key)
    if (!meta) fail(`${ed.key} missing from catalog.json`)

    const db = new DatabaseSync(sqlitePath, { readOnly: true })
    const rows = db
      .prepare('select sura, aya, translation, footnotes from translations order by sura, aya')
      .all() as Array<{ sura: number; aya: number; translation: string; footnotes: string }>
    db.close()

    if (rows.length !== EXPECTED_VERSES) {
      fail(`${ed.key}: expected ${EXPECTED_VERSES} rows, got ${rows.length}`)
    }

    const verses: Record<string, unknown> = {}
    const unresolved: Array<{ ref: string; n: number }> = []
    let withFootnotes = 0
    let lossy = 0
    let numberMismatch = 0

    for (const row of rows) {
      const ref = `${row.sura}:${row.aya}`
      if (!corpusRefs.has(ref)) fail(`${ed.key}: ref ${ref} does not exist in the corpus`)

      const text = row.translation ?? ''
      if (!text.trim()) fail(`${ed.key}: blank translation at ${ref}`)

      const parsed = parseTranslation(text, row.footnotes ?? '')
      if (rejoin(parsed.segments) !== text) lossy++
      if (parsed.footnotes.length) withFootnotes++
      for (const n of parsed.unresolvedNotes) unresolved.push({ ref, n })

      // The edition states its own verse number; it must agree with the row.
      const claimed = selfNumber(parsed.segments)
      if (claimed !== null && claimed !== row.aya) numberMismatch++

      if (!parsed.searchText) fail(`${ed.key}: empty search text at ${ref}`)

      verses[ref] = {
        segments: parsed.segments,
        footnotes: parsed.footnotes,
        searchText: parsed.searchText,
      }
    }

    if (lossy) fail(`${ed.key}: ${lossy} verses do not rejoin to the source text`)
    if (numberMismatch) fail(`${ed.key}: ${numberMismatch} verses disagree with their own (N) number`)

    const artifact = {
      edition: {
        key: ed.key,
        title: meta.title,
        publisher: meta.description,
        language: ed.lang,
        direction: meta.direction,
        version: meta.version,
        lastUpdate: new Date(meta.last_update * 1000).toISOString().slice(0, 10),
        source: 'QuranEnc.com',
        sourceUrl: 'https://quranenc.com',
        termsUrl: 'https://quranenc.com/en/home/about',
        termsArchive: 'data/source/quranenc/about-en.html',
        termsSha256: await sha256(join(SRC, 'about-en.html')),
        sqliteSha256: actualHash,
        licenseConditions: LICENSE_CONDITIONS,
        note: 'Text stored verbatim and never edited. Segments are a lossless split for display.',
      },
      counts: {
        verses: rows.length,
        withFootnotes,
        unresolvedNotes: unresolved.length,
      },
      unresolvedNotes: unresolved,
      verses,
    }

    const outPath = join(OUT, ed.file)
    const body = JSON.stringify(artifact)
    await writeFile(outPath, body, 'utf8')

    console.log(`[build-translations] ${ed.key} OK`)
    console.log(`  version      ${meta.version}  (updated ${artifact.edition.lastUpdate})`)
    console.log(`  verses       ${rows.length}`)
    console.log(`  footnoted    ${withFootnotes}`)
    console.log(`  unresolved   ${unresolved.length}${unresolved.length ? ' -> ' + unresolved.map((u) => `${u.ref}#${u.n}`).join(', ') : ''}`)
    console.log(`  output       ${outPath} (${(Buffer.byteLength(body) / 1024).toFixed(0)} KB)`)
  }
}

await main()