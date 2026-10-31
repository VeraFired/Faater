/**
 * Build the canonical corpus artifact from the pinned Tanzil text.
 *
 * Input  : Resources/quran-simple.txt  (CC BY 3.0, verbatim — never edited)
 *          Resources/quran-data.xml    (surah metadata)
 * Output : data/build/corpus.json
 *
 * The verse text is copied byte-for-byte from the source. Normalization is
 * written to separate `*_norm` fields and basmala segmentation to separate
 * `basmala`/`body` fields, so nothing downstream can mistake a search key or
 * a display convenience for the Qur'anic text itself.
 *
 * Fails loudly on any invariant violation. A silent partial build is worse
 * than no build.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { joinedVariants, normalize } from './lib/normalize.ts'
import { splitBasmala } from './lib/basmala.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(ROOT, 'Resources', 'quran-simple.txt')
const META = join(ROOT, 'Resources', 'quran-data.xml')
const LOCK = join(ROOT, 'data', 'sources.lock.json')
const OUT_DIR = join(ROOT, 'data', 'build')

/** The corpus is closed. These numbers are the contract. */
const EXPECTED_VERSES = 6236
const EXPECTED_SURAHS = 114
/** 1:1 is the basmala as a whole verse; 112 surahs carry it as a prefix. */
const EXPECTED_BASMALA_VERSES = 113
const EXPECTED_PREFIXES = 112

interface SuraMeta {
  index: number
  ayas: number
  name: string
  tname: string
  ename: string
  type: string
  order: number
}

interface Verse {
  ref: string
  surah: number
  ayah: number
  /** Verbatim Tanzil text. Never normalized, never displayed-adjacent. */
  arabic: string
  /** Search key only. Must never be rendered. */
  arabicNorm: string
  /**
   * Search key of `body` only — the text the FTS index must use.
   *
   * Using `arabicNorm` here instead would index the basmala 112 extra times
   * and corrupt BM25 for الله/الرحمن/الرحيم. Empty for 1:1, whose entire
   * content is carried by the single `basmala` pseudo-document.
   */
  bodyNorm: string
  /** ZWNJ-joined and ZWNJ-split forms, for Persian-tolerant matching. */
  arabicVariants: string[]
  /** Basmala prefix, or null. Presentational metadata, not a text edit. */
  basmala: string | null
  /** Verse text minus the basmala prefix. Equals `arabic` when there is none. */
  body: string
  /** True only for 1:1. A whole-verse basmala is scripture, not a prefix. */
  basmalaIsWholeVerse: boolean
}

function fail(message: string): never {
  throw new Error(`[build-corpus] ${message}`)
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

/** Parse `<sura ... />` elements. Attributes are flat, so no XML dependency. */
function parseSuraMeta(xml: string): SuraMeta[] {
  const out: SuraMeta[] = []
  const tag = /<sura\b([^>]*)\/>/g
  for (const match of xml.matchAll(tag)) {
    const attrs: Record<string, string> = {}
    for (const a of match[1].matchAll(/(\w+)="([^"]*)"/g)) attrs[a[1]] = a[2]
    out.push({
      index: Number(attrs.index),
      ayas: Number(attrs.ayas),
      name: attrs.name ?? '',
      tname: attrs.tname ?? '',
      ename: attrs.ename ?? '',
      type: attrs.type ?? '',
      order: Number(attrs.order),
    })
  }
  return out
}

async function main(): Promise<void> {
  // ---- 1. verify the source before trusting a single byte of it -----------
  const lockRaw = await readFile(LOCK, 'utf8').catch(() =>
    fail(`missing ${LOCK} — run the data-pinning step first`),
  )
  const lock = JSON.parse(lockRaw) as {
    sources: Record<string, { sha256: string; bytes: number }>
  }
  const expected = lock.sources['quran-simple.txt']
  if (!expected) fail('sources.lock.json has no entry for quran-simple.txt')

  const actualHash = await sha256(SOURCE)
  if (actualHash !== expected.sha256) {
    fail(
      `corpus hash mismatch\n  expected ${expected.sha256}\n  actual   ${actualHash}\n` +
        'The pinned text changed. Do not "fix" the hash — find out why the file moved.',
    )
  }

  // ---- 2. parse verse rows ------------------------------------------------
  const raw = await readFile(SOURCE, 'utf8')
  const lines = raw.split(/\r?\n/)

  const verses: Verse[] = []
  let skippedNonVerse = 0
  // The copyright block is captured VERBATIM, not summarised. CC BY 3.0
  // requires the notice to be reproduced in every derived file, and a
  // hand-typed summary is how it drifts: the previous hard-coded string said
  // "(C) 2008-2026 Tanzil.info" while the source says
  // "Copyright (C) 2007-2026 Tanzil Project".
  const noticeLines: string[] = []

  for (const line of lines) {
    const m = /^(\d{1,3})\|(\d{1,3})\|(.+)$/.exec(line.trimEnd())
    if (!m) {
      if (line.trim()) {
        skippedNonVerse++
        noticeLines.push(line.trimEnd())
      }
      continue
    }
    const surah = Number(m[1])
    const ayah = Number(m[2])
    const arabic = m[3]

    const split = splitBasmala(arabic)
    verses.push({
      ref: `${surah}:${ayah}`,
      surah,
      ayah,
      arabic,
      arabicNorm: normalize(arabic),
      bodyNorm: split.body.trim() ? normalize(split.body) : '',
      // Derived from `body`, not `arabic`. Using the full verse re-embeds the
      // basmala in all 112 surah-opening search keys — the same defect the
      // bodyNorm field exists to avoid, except in the Persian variant field.
      arabicVariants: split.body.trim() ? joinedVariants(split.body) : [],
      basmala: split.basmala,
      body: split.body,
      basmalaIsWholeVerse: split.isWholeVerse,
    })
  }

  // ---- 3. invariants ------------------------------------------------------
  if (verses.length !== EXPECTED_VERSES) {
    fail(`expected ${EXPECTED_VERSES} verses, parsed ${verses.length}`)
  }
  if (skippedNonVerse !== 28) {
    // The Tanzil copyright block. If this moves, the file was tampered with.
    fail(`expected 28 non-verse lines (copyright block), got ${skippedNonVerse}`)
  }

  // The notice is a licence obligation, so its content is asserted, not assumed.
  const notice = noticeLines.join('\n')
  for (const required of [
    'Copyright (C) 2007-2026 Tanzil Project',
    'Creative Commons Attribution 3.0',
    'tanzil.net',
    'CHANGING IT IS NOT ALLOWED',
  ]) {
    if (!notice.includes(required)) {
      fail(`Tanzil notice is missing ${JSON.stringify(required)} — refusing to build`)
    }
  }

  const surahNumbers = new Set(verses.map((v) => v.surah))
  if (surahNumbers.size !== EXPECTED_SURAHS) {
    fail(`expected ${EXPECTED_SURAHS} surahs, saw ${surahNumbers.size}`)
  }

  // numbering must be contiguous 1..6236 in mushaf order
  const ordered = [...verses].sort((a, b) =>
    a.surah === b.surah ? a.ayah - b.ayah : a.surah - b.surah,
  )
  for (let i = 0; i < ordered.length; i++) {
    const v = ordered[i]
    const prev = ordered[i - 1]
    if (!prev) {
      if (v.surah !== 1 || v.ayah !== 1) fail(`first verse is ${v.ref}, expected 1:1`)
      continue
    }
    const continuesSurah = v.surah === prev.surah && v.ayah === prev.ayah + 1
    const startsSurah = v.surah === prev.surah + 1 && v.ayah === 1
    if (!continuesSurah && !startsSurah) {
      fail(`non-contiguous verse numbering at ${prev.ref} -> ${v.ref}`)
    }
  }

  // ---- 4. basmala shape ---------------------------------------------------
  const withBasmala = verses.filter((v) => v.basmala !== null)
  const prefixes = withBasmala.filter((v) => !v.basmalaIsWholeVerse)
  const wholeVerse = withBasmala.filter((v) => v.basmalaIsWholeVerse)

  if (withBasmala.length !== EXPECTED_BASMALA_VERSES) {
    fail(
      `expected ${EXPECTED_BASMALA_VERSES} verses opening with a basmala, ` +
        `found ${withBasmala.length}`,
    )
  }
  if (prefixes.length !== EXPECTED_PREFIXES) {
    fail(`expected ${EXPECTED_PREFIXES} basmala prefixes, found ${prefixes.length}`)
  }
  if (wholeVerse.length !== 1 || wholeVerse[0].ref !== '1:1') {
    fail(
      `expected exactly 1:1 to be a whole-verse basmala, got ` +
        wholeVerse.map((v) => v.ref).join(', ') || '(none)',
    )
  }

  // every prefixed verse must be the FIRST ayah of its surah
  const badPrefix = prefixes.find((v) => v.ayah !== 1)
  if (badPrefix) fail(`basmala prefix found outside a surah opening: ${badPrefix.ref}`)

  // At-Tawbah must carry none
  const tawbah = verses.find((v) => v.ref === '9:1')
  if (!tawbah) fail('missing 9:1')
  if (tawbah.basmala !== null) fail('9:1 carries a basmala; it must not')

  // a prefix must never swallow the verse
  const emptied = prefixes.find((v) => v.body.trim().length === 0)
  if (emptied) fail(`basmala split left ${emptied.ref} with an empty body`)

  // concatenation identity: prefix + ' ' + body === arabic, character for character
  for (const v of withBasmala) {
    const rejoined = v.basmalaIsWholeVerse ? v.basmala : `${v.basmala} ${v.body}`
    if (rejoined !== v.arabic) fail(`split is not lossless at ${v.ref}`)
  }

  // ---- 5. metadata --------------------------------------------------------
  const meta = parseSuraMeta(await readFile(META, 'utf8'))
  if (meta.length !== EXPECTED_SURAHS) {
    fail(`expected ${EXPECTED_SURAHS} surahs in metadata, got ${meta.length}`)
  }
  for (let i = 0; i < meta.length; i++) {
    const m = meta[i]
    if (m.index !== i + 1) fail(`metadata out of order at index ${m.index}`)
    const actual = verses.filter((v) => v.surah === m.index).length
    if (actual !== m.ayas) {
      fail(`surah ${m.index}: metadata says ${m.ayas} ayahs, corpus has ${actual}`)
    }
  }

  // ---- 6. Persian names ---------------------------------------------------
  // Tanzil ships no Persian surah names; they are hand-authored in
  // data/lexicon/surahs.fa.json. Missing one here is a build failure, not a
  // silent English name in a Persian UI.
  const faRaw = await readFile(join(ROOT, 'data', 'lexicon', 'surahs.fa.json'), 'utf8')
  const faFile = JSON.parse(faRaw) as {
    surahs: Array<{ index: number; fa: string; alt?: string }>
  }
  const faByIndex = new Map(faFile.surahs.map((s) => [s.index, s]))

  // ---- 7. emit ------------------------------------------------------------
  const surahs = meta.map((m) => {
    const fa = faByIndex.get(m.index)
    if (!fa?.fa?.trim()) fail(`no Persian name for surah ${m.index}`)
    return {
      index: m.index,
      ayahs: m.ayas,
      nameAr: m.name,
      nameTranslit: m.tname,
      nameEn: m.ename,
      nameFa: fa.fa,
      nameFaAlt: fa.alt ?? null,
      revelation: m.type.toLowerCase(),
      revelationOrder: m.order,
    }
  })

  const corpus = {
    version: '1.0.0',
    builtAt: new Date().toISOString().slice(0, 10),
    source: {
      file: 'Resources/quran-simple.txt',
      sha256: actualHash,
      license: 'Creative Commons Attribution 3.0 — Tanzil Project — verbatim only',
      notice,
    },
    counts: {
      verses: verses.length,
      surahs: surahs.length,
      basmalaVerses: withBasmala.length,
      basmalaPrefixes: prefixes.length,
    },
    /**
     * One pseudo-document, indexed once. Indexing the basmala 113 times would
     * return 113 near-identical openings for a basmala query and inflate the
     * document frequency of الله/الرحمن/الرحيم — the three most common words
     * in the corpus — corrupting BM25 exactly where it matters most.
     */
    basmalaDocument: {
      id: 'basmala',
      ref: '1:1',
      text: wholeVerse[0].basmala,
      norm: normalize(wholeVerse[0].basmala as string),
      variants: joinedVariants(wholeVerse[0].basmala as string),
    },
    surahs,
    verses,
  }

  await mkdir(OUT_DIR, { recursive: true })
  const outPath = join(OUT_DIR, 'corpus.json')
  const body = JSON.stringify(corpus)
  await writeFile(outPath, body, 'utf8')

  const kb = (Buffer.byteLength(body) / 1024).toFixed(0)
  console.log('[build-corpus] OK')
  console.log(`  verses         ${verses.length}`)
  console.log(`  surahs         ${surahs.length}`)
  console.log(`  basmala verses ${withBasmala.length} (${prefixes.length} prefixes + 1 whole)`)
  console.log(`  output         ${outPath} (${kb} KB)`)
}

await main()