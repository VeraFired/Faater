/** Shared test fixtures. Tests read the built artifact, never the raw source. */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export interface CorpusVerse {
  ref: string
  surah: number
  ayah: number
  arabic: string
  arabicNorm: string
  bodyNorm: string
  arabicVariants: string[]
  basmala: string | null
  body: string
  basmalaIsWholeVerse: boolean
}

export interface Corpus {
  counts: {
    verses: number
    surahs: number
    basmalaVerses: number
    basmalaPrefixes: number
  }
  basmalaDocument: { id: string; ref: string; text: string; norm: string; variants: string[] }
  surahs: Array<{
    index: number
    ayahs: number
    nameAr: string
    nameEn: string
    nameTranslit: string
    nameFa: string
    nameFaAlt: string | null
  }>
  verses: CorpusVerse[]
}

export async function loadCorpus(): Promise<Corpus> {
  const raw = await readFile(join(ROOT, 'data', 'build', 'corpus.json'), 'utf8')
  return JSON.parse(raw) as Corpus
}

/**
 * Load everything the retriever needs, from the built artifacts only.
 *
 * Shared by every test that exercises ranking: a second copy of this loader in
 * one test file is how the two drift and start testing different corpora.
 */
export async function loadRetrieverData(): Promise<import('../lib/retrieve.ts').RetrieverData> {
  const [corpus, en, fa, lexicon] = await Promise.all([
    readFile(join(ROOT, 'data', 'build', 'corpus.json'), 'utf8').then((s) => JSON.parse(s)),
    readFile(join(ROOT, 'data', 'build', 'translations.en.json'), 'utf8').then((s) => JSON.parse(s)),
    readFile(join(ROOT, 'data', 'build', 'translations.fa.json'), 'utf8').then((s) => JSON.parse(s)),
    readFile(join(ROOT, 'data', 'build', 'lexicon.json'), 'utf8').then((s) => JSON.parse(s)),
  ])
  return {
    verses: corpus.verses,
    basmala: corpus.basmalaDocument,
    surahs: corpus.surahs,
    en: en.verses,
    fa: fa.verses,
    lexicon: {
      concepts: lexicon.concepts,
      names: lexicon.names,
      surahAliases: lexicon.surahAliases,
    },
  }
}