/**
 * Translation artefact tests.
 *
 * The licence forbids modification, so the decisive test is mechanical:
 * every verse must rejoin from its segments to the EXACT bytes in the pinned
 * SQLite edition. Everything else (markers, footnotes, search keys) is
 * checked against that same source of truth.
 */

import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalize } from '../lib/normalize.ts'
import { rejoin } from '../lib/translation.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

interface VerseEntry {
  segments: Array<{ t: 'text' | 'num' | 'note'; v: string; n?: number }>
  footnotes: Array<{ n: number; text: string }>
  searchText: string
}

interface Artifact {
  edition: {
    key: string
    version: string
    publisher: string
    termsUrl: string
    termsSha256: string
    sqliteSha256: string
    licenseConditions: string[]
  }
  counts: { verses: number; withFootnotes: number; unresolvedNotes: number }
  unresolvedNotes: Array<{ ref: string; n: number }>
  verses: Record<string, VerseEntry>
}

const en = JSON.parse(
  await readFile(join(ROOT, 'data', 'build', 'translations.en.json'), 'utf8'),
) as Artifact
const fa = JSON.parse(
  await readFile(join(ROOT, 'data', 'build', 'translations.fa.json'), 'utf8'),
) as Artifact
const corpus = JSON.parse(await readFile(join(ROOT, 'data', 'build', 'corpus.json'), 'utf8')) as {
  verses: Array<{
    ref: string
    basmala: string | null
    basmalaIsWholeVerse: boolean
    bodyNorm: string
  }>
}

function openSource(key: string): Map<string, { translation: string; footnotes: string }> {
  const db = new DatabaseSync(join(ROOT, 'data', 'source', 'quranenc', `${key}.sqlite`), {
    readOnly: true,
  })
  const rows = db
    .prepare('select sura, aya, translation, footnotes from translations')
    .all() as Array<{ sura: number; aya: number; translation: string; footnotes: string }>
  db.close()
  return new Map(rows.map((r) => [`${r.sura}:${r.aya}`, { translation: r.translation, footnotes: r.footnotes }]))
}

const SOURCES: Record<string, Map<string, { translation: string; footnotes: string }>> = {
  english_saheeh: openSource('english_saheeh'),
  persian_ih: openSource('persian_ih'),
}
const ARTIFACTS: Record<string, Artifact> = { english_saheeh: en, persian_ih: fa }

for (const key of Object.keys(ARTIFACTS)) {
  const art = ARTIFACTS[key]
  const source = SOURCES[key]

  test(`${key}: 6,236 verses, each rejoining to the source byte-for-byte`, () => {
    const refs = Object.keys(art.verses)
    assert.equal(refs.length, 6236)
    let bad = 0
    for (const [ref, entry] of Object.entries(art.verses)) {
      const src = source.get(ref)
      assert.ok(src, `source missing ${ref}`)
      if (rejoin(entry.segments) !== src.translation) bad++
    }
    assert.equal(bad, 0, `${bad} verses were altered by segmentation — licence violation`)
  })

  test(`${key}: footnotes are reproduced exactly`, () => {
    let bad = 0
    for (const [ref, entry] of Object.entries(art.verses)) {
      const src = source.get(ref)!
      const parsed = art.verses[ref].footnotes
      if (!src.footnotes.trim()) {
        if (parsed.length !== 0) bad++
        continue
      }
      // Reconstruct `[n]- text` lines and compare to the source column.
      const rebuilt = parsed.map((f) => `[${f.n}]- ${f.text}`).join('\n')
      if (rebuilt !== src.footnotes.trim()) bad++
    }
    assert.equal(bad, 0, `${bad} verses have altered footnotes`)
  })

  test(`${key}: edition metadata satisfies the licence conditions`, () => {
    assert.ok(art.edition.version, 'version number is required (condition 3)')
    assert.ok(art.edition.publisher, 'publisher is required (condition 2)')
    assert.equal(art.edition.licenseConditions.length, 7)
    assert.match(art.edition.licenseConditions[0], /No modification, addition, or deletion/)
    assert.match(art.edition.termsUrl, /quranenc\.com/)
    // The archived terms page must be the one hashed here.
    assert.match(art.edition.termsSha256, /^[0-9a-f]{64}$/)
    assert.match(art.edition.sqliteSha256, /^[0-9a-f]{64}$/)
  })

  test(`${key}: search keys carry no markers or verse-number prefixes`, () => {
    for (const [ref, entry] of Object.entries(art.verses)) {
      assert.doesNotMatch(entry.searchText, /\[\d+\]/, `marker leaked into search key at ${ref}`)
      assert.doesNotMatch(entry.searchText, /^\(\d+\)/, `number leaked into search key at ${ref}`)
      assert.ok(entry.searchText.length > 0, `empty search key at ${ref}`)
    }
  })
}

test('english edition: only one unresolved footnote marker, and it is known', () => {
  // 7:143 references [403] but the edition's footnotes stop at [402].
  // This is a defect in the source edition, not in our pipeline.
  assert.deepEqual(en.unresolvedNotes, [{ ref: '7:143', n: 403 }])
  assert.equal(en.counts.unresolvedNotes, 1)
})

test('english edition: 1,613 verses carry footnotes', () => {
  assert.equal(en.counts.withFootnotes, 1613)
})

test('persian edition is marker-free — the footnote problem is English-only', () => {
  assert.equal(fa.counts.withFootnotes, 0)
  assert.equal(fa.unresolvedNotes.length, 0)
  for (const entry of Object.values(fa.verses)) {
    assert.equal(entry.footnotes.length, 0)
    assert.equal(entry.segments.filter((s) => s.t === 'note').length, 0)
  }
})

test('persian bracketed glosses survive — they are translation, not footnotes', () => {
  // «[و سپاس‌ها]» is a translator gloss WITHIN the text. A naive bracket
  // stripper would delete words from a no-modification edition.
  const segs = fa.verses['1:2'].segments
  const text = segs.map((s) => s.v).join('')
  assert.ok(text.includes('[و سپاس'), `gloss lost: ${text.slice(0, 80)}`)
  assert.equal(segs.filter((s) => s.t === 'note').length, 0)
})

/**
 * THE TRANSLATION-EXTENT TEST.
 *
 * This is the one that actually proves the basmala fix. Both Tanzil files
 * carry the same fused basmala, so cross-checking them is structurally blind
 * to it. Translations are the independent witness: for the 112 prefixed
 * verses, the edition must NOT begin with a translation of the basmala.
 *
 * Note the assertion is startsWith, not includes: 96:1 legitimately reads
 * "Recite in the name of your Lord…", which is the verse body, not the prefix.
 */
test('no surah-opening translation begins with the basmala (EN + FA)', () => {
  const prefixes = corpus.verses.filter((v) => v.basmala !== null && !v.basmalaIsWholeVerse)
  assert.equal(prefixes.length, 112, 'expected 112 prefixed verses to test')

  const enBasmala = en.verses['1:1'].searchText
  const faBasmala = fa.verses['1:1'].searchText
  assert.ok(enBasmala.length > 10, 'EN 1:1 must translate the basmala')
  assert.ok(faBasmala.length > 5, 'FA 1:1 must translate the basmala')

  const offenders: string[] = []
  for (const v of prefixes) {
    if (en.verses[v.ref].searchText.startsWith(enBasmala)) offenders.push(`EN ${v.ref}`)
    if (fa.verses[v.ref].searchText.startsWith(faBasmala)) offenders.push(`FA ${v.ref}`)
  }
  assert.deepEqual(offenders, [], 'translation covers the basmala prefix — split is wrong')
})

test('1:1 translations DO translate the basmala (it is a real verse)', () => {
  assert.match(en.verses['1:1'].searchText, /^in the name of/)
  assert.match(fa.verses['1:1'].searchText, /^به نام/)
  assert.equal(corpus.verses.find((v) => v.ref === '1:1')!.basmalaIsWholeVerse, true)
})