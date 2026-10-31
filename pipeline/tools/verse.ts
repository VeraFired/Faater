/**
 * Print one verse across all three editions, by reference.
 *
 * Used when authoring and reviewing eval gold refs: the reviewer must read the
 * actual verse, not trust a ref number. Also the building block of the scholar
 * review packet.
 *
 * Usage:
 *   node pipeline/tools/verse.ts 2:153 [2:155 ...]
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const refs = process.argv.slice(2)

if (refs.length === 0) {
  console.error('usage: node pipeline/tools/verse.ts <surah:ayah> [...]')
  process.exit(2)
}

type Corpus = {
  verses: Array<{
    ref: string
    surah: number
    ayah: number
    arabic: string
    body: string
    bodyNorm: string
    basmala: string | null
  }>
  surahs: Array<{ index: number; nameAr: string; nameEn: string; nameFa: string }>
}
type Edition = {
  edition: { key: string; title: string; translator?: string }
  verses: Record<string, { segments: Array<{ v: string }>; footnotes: Array<{ n: number; text: string }> }>
}

const corpus = JSON.parse(
  await readFile(join(ROOT, 'data', 'build', 'corpus.json'), 'utf8'),
) as Corpus
const en = JSON.parse(
  await readFile(join(ROOT, 'data', 'build', 'translations.en.json'), 'utf8'),
) as Edition
const fa = JSON.parse(
  await readFile(join(ROOT, 'data', 'build', 'translations.fa.json'), 'utf8'),
) as Edition

const byRef = new Map(corpus.verses.map((v) => [v.ref, v]))
const joinSegments = (e: Edition, ref: string) =>
  (e.verses[ref]?.segments ?? []).map((s) => s.v).join(' ')

let missing = 0
for (const ref of refs) {
  const v = byRef.get(ref)
  if (!v) {
    console.error(`NOT FOUND: ${ref}`)
    missing++
    continue
  }
  const surah = corpus.surahs.find((s) => s.index === v.surah)
  console.log(`\n=== ${ref} — ${surah?.nameEn ?? ''} (${surah?.nameAr ?? ''} / ${surah?.nameFa ?? ''}) ===`)
  if (v.basmala) console.log(`[basmala] ${v.basmala}`)
  console.log(`AR: ${v.body}`)
  console.log(`EN: ${joinSegments(en, ref)}`)
  console.log(`FA: ${joinSegments(fa, ref)}`)
  const notes = [...(en.verses[ref]?.footnotes ?? []), ...(fa.verses[ref]?.footnotes ?? [])]
  for (const n of notes) console.log(`  [${n.n}] ${n.text}`)
}

process.exitCode = missing ? 1 : 0