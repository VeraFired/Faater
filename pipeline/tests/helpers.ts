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
  surahs: Array<{ index: number; ayahs: number; nameAr: string; nameEn: string; nameFa: string | null }>
  verses: CorpusVerse[]
}

export async function loadCorpus(): Promise<Corpus> {
  const raw = await readFile(join(ROOT, 'data', 'build', 'corpus.json'), 'utf8')
  return JSON.parse(raw) as Corpus
}