/**
 * Build the lexicon artefact.
 *
 * Input  : data/build/corpus.json            (surah metadata from Tanzil)
 *          data/lexicon/surahs.fa.json       (hand-authored Persian names)
 *          data/lexicon/finglish.json        (curated Latin-script aliases)
 * Output : data/build/lexicon.json
 *
 * Persian surah names are a hand-authored gap-filler: Tanzil ships none, and
 * putting an English name in a Persian UI is not an option.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { finglishKey, translitKeys } from './lib/finglish.ts'
import { normalize } from './lib/normalize.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(ROOT, 'data', 'build')
const LEX = join(ROOT, 'data', 'lexicon')

const EXPECTED_SURAHS = 114

function fail(msg: string): never {
  throw new Error(`[build-lexicon] ${msg}`)
}

interface CorpusSurah {
  index: number
  nameAr: string
  nameEn: string
  nameTranslit: string
  nameFa: string | null
}

async function main(): Promise<void> {
  const corpus = JSON.parse(await readFile(join(BUILD, 'corpus.json'), 'utf8')) as {
    surahs: CorpusSurah[]
  }
  const faFile = JSON.parse(await readFile(join(LEX, 'surahs.fa.json'), 'utf8')) as {
    _note: string
    _review: string
    surahs: Array<{ index: number; fa: string; alt?: string }>
  }
  const finglish = JSON.parse(await readFile(join(LEX, 'finglish.json'), 'utf8')) as {
    _note: string
    concepts: Array<{ id: string; fa: string; en: string; keys: string[] }>
    names: Array<{ id: string; fa: string; en: string; keys: string[] }>
  }

  // ---- Persian surah names ------------------------------------------------
  if (faFile.surahs.length !== EXPECTED_SURAHS) {
    fail(`expected ${EXPECTED_SURAHS} Persian names, got ${faFile.surahs.length}`)
  }
  const faByIndex = new Map(faFile.surahs.map((s) => [s.index, s]))
  for (let i = 1; i <= EXPECTED_SURAHS; i++) {
    if (!faByIndex.has(i)) fail(`missing Persian name for surah ${i}`)
  }

  const persian = faFile.surahs.map((s) => s.fa)
  if (new Set(persian).size !== persian.length) {
    fail('duplicate Persian surah names')
  }

  const surahs = corpus.surahs.map((s) => {
    const fa = faByIndex.get(s.index)!
    if (!fa.fa.trim()) fail(`empty Persian name for surah ${s.index}`)
    // Transliteration only. The English "meaning name" (e.g. "Sincerity" for
  // surah 112) belongs to the concept layer — including it here would make
  // every English moral term a surah reference.
    const keys = new Set(translitKeys(s.nameTranslit))
    return {
      index: s.index,
      nameAr: s.nameAr,
      nameEn: s.nameEn,
      nameTranslit: s.nameTranslit,
      nameFa: fa.fa,
      nameFaAlt: fa.alt ?? null,
      nameFaNorm: normalize(fa.fa),
      finglishKeys: [...keys],
    }
  })

  // ---- Finglish aliases ---------------------------------------------------
  const entries = [...finglish.concepts, ...finglish.names]
  const seen = new Set<string>()
  for (const e of entries) {
    if (seen.has(e.id)) fail(`duplicate lexicon id: ${e.id}`)
    seen.add(e.id)
    // Authors write keys the way they speak ("rasool"); the resolver compares
    // canonical forms only ("rasul"). Canonicalise here so both work.
    e.keys = [...new Set(e.keys.map(finglishKey))].filter(Boolean)
    if (!e.keys.length) fail(`lexicon entry ${e.id} has no usable keys`)
  }

  // Surah aliases share the resolver's shape so callers need one lookup path.
  const surahAliases = surahs.map((s) => ({
    id: `surah:${s.index}`,
    fa: s.nameFa,
    en: s.nameEn,
    keys: s.finglishKeys,
  }))

  // Overlapping keys are legitimate: «اخلاص» is both surah 112 and the concept
  // of sincerity, so a query resolves to both and the gates sort it out.
  // Report them so a genuine typo-collision is visible at build time.
  const owners = new Map<string, string[]>()
  for (const e of [...entries, ...surahAliases]) {
    for (const k of e.keys) {
      const prev = owners.get(k) ?? []
      if (!prev.includes(e.id)) prev.push(e.id)
      owners.set(k, prev)
    }
  }
  const overlaps = [...owners.entries()].filter(([, ids]) => ids.length > 1)

  const artifact = {
    version: '1.0.0',
    notes: {
      persianNames: faFile._note,
      persianNamesReview: faFile._review,
      finglish: finglish._note,
    },
    counts: {
      surahs: surahs.length,
      concepts: finglish.concepts.length,
      names: finglish.names.length,
      aliasKeys: owners.size,
      overlappingKeys: overlaps.length,
    },
    surahs,
    concepts: finglish.concepts,
    names: finglish.names,
    surahAliases,
    overlappingKeys: overlaps.map(([key, ids]) => ({ key, ids })),
  }

  await mkdir(BUILD, { recursive: true })
  const body = JSON.stringify(artifact)
  await writeFile(join(BUILD, 'lexicon.json'), body, 'utf8')

  console.log('[build-lexicon] OK')
  console.log(`  surahs        ${surahs.length} (Persian names: ${faFile._review})`)
  console.log(`  concepts      ${finglish.concepts.length}`)
  console.log(`  proper names  ${finglish.names.length}`)
  console.log(`  alias keys    ${owners.size}`)
  if (overlaps.length) {
    console.log(`  overlaps      ${overlaps.length} -> ${overlaps.map(([k, ids]) => `${k} (${ids.join('/')})`).join(', ')}`)
  }
  console.log(`  output        data/build/lexicon.json (${(Buffer.byteLength(body) / 1024).toFixed(0)} KB)`)
}

await main()