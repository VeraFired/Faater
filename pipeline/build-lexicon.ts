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
import { normalize, normalizeJoined } from './lib/normalize.ts'
import { foldEnglish } from './lib/stopwords.ts'

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
    verses: Array<{ ref: string }>
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

  // Synonyms are optional while the layer is being built: absence must not
  // break the build, but a malformed file must.
  const synonymsRaw = await readFile(join(LEX, 'synonyms.json'), 'utf8').catch(() => null)
  const synonymsFile = synonymsRaw
    ? (JSON.parse(synonymsRaw) as {
        _note: string
        _review: string
        concepts: Array<{
          id: string
          en: string[]
          fa: string[]
          ar: string[]
          excludes?: string[]
        }>
      })
    : null

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

  // ---- Search synonyms ----------------------------------------------------
  // Search-only keys: normalized exactly the way the index and query are, so
  // an expansion can never fail to meet its own document. Nothing here is
  // displayed; a wrong term costs recall, never a visible claim.
  const conceptIds = new Set(finglish.concepts.map((c) => c.id))
  const corpusRefs = new Set(corpus.verses.map((v) => v.ref))
  const synonymsById = new Map<
    string,
    { en: string[]; fa: string[]; faJoined: string[]; ar: string[]; excludes: string[] }
  >()
  if (synonymsFile) {
    for (const entry of synonymsFile.concepts) {
      if (!conceptIds.has(entry.id)) {
        fail(`synonyms.json references unknown concept: ${entry.id}`)
      }
      if (synonymsById.has(entry.id)) fail(`duplicate synonyms for concept: ${entry.id}`)
      const clean = (terms: string[]) => [...new Set(terms.map((t) => t.trim()).filter(Boolean))]
      const faTerms = clean(entry.fa)
      // A concept can name a verse that shares its spelling but not its sense:
      // «خُمُر» in 24:31 is a veil, not wine; «ميسرة» in 2:280 is deferment,
      // not gambling. Search-only exclusions; nothing here is displayed.
      const excludes = clean(entry.excludes ?? [])
      for (const ref of excludes) {
        if (!/^\d+:\d+$/.test(ref)) fail(`concept ${entry.id} has malformed exclude: ${ref}`)
        if (!corpusRefs.has(ref)) fail(`concept ${entry.id} excludes missing verse: ${ref}`)
      }
      const s = {
        en: [...new Set(clean(entry.en).map((t) => normalize(foldEnglish(t))))].filter(Boolean),
        fa: [...new Set(faTerms.map((t) => normalize(t)))].filter(Boolean),
        faJoined: [...new Set(faTerms.map((t) => normalizeJoined(t)))].filter(Boolean),
        ar: [...new Set(clean(entry.ar).map((t) => normalize(t)))].filter(Boolean),
        excludes,
      }
      if (!s.en.length && !s.fa.length && !s.ar.length) {
        fail(`concept ${entry.id} has no usable synonym in any language`)
      }
      synonymsById.set(entry.id, s)
    }
    for (const c of finglish.concepts) {
      if (!synonymsById.has(c.id)) {
        fail(`synonyms.json is missing concept: ${c.id}`)
      }
    }
  }

  const concepts = finglish.concepts.map((c) => {
    const synonyms = synonymsById.get(c.id)
    return synonyms ? { ...c, synonyms } : { ...c }
  })

  const artifact = {
    version: '1.0.0',
    notes: {
      persianNames: faFile._note,
      persianNamesReview: faFile._review,
      finglish: finglish._note,
      synonyms: synonymsFile?._note ?? null,
      synonymsReview: synonymsFile?._review ?? null,
    },
    counts: {
      surahs: surahs.length,
      concepts: concepts.length,
      conceptsWithSynonyms: synonymsById.size,
      names: finglish.names.length,
      aliasKeys: owners.size,
      overlappingKeys: overlaps.length,
    },
    surahs,
    concepts,
    names: finglish.names,
    surahAliases,
    overlappingKeys: overlaps.map(([key, ids]) => ({ key, ids })),
  }

  await mkdir(BUILD, { recursive: true })
  const body = JSON.stringify(artifact)
  await writeFile(join(BUILD, 'lexicon.json'), body, 'utf8')

  console.log('[build-lexicon] OK')
  console.log(`  surahs        ${surahs.length} (Persian names: ${faFile._review})`)
  console.log(`  concepts      ${concepts.length} (synonyms: ${synonymsById.size})`)
  console.log(`  proper names  ${finglish.names.length}`)
  console.log(`  alias keys    ${owners.size}`)
  if (overlaps.length) {
    console.log(`  overlaps      ${overlaps.length} -> ${overlaps.map(([k, ids]) => `${k} (${ids.join('/')})`).join(', ')}`)
  }
  console.log(`  output        data/build/lexicon.json (${(Buffer.byteLength(body) / 1024).toFixed(0)} KB)`)
}

await main()