/**
 * Document-frequency probe for search terms.
 *
 * Used when authoring synonym lists: a term that never occurs in an edition is
 * a dead expansion, and a term that occurs in more than half the verses has
 * non-positive idf and cannot discriminate. Both are silent failures if the
 * list is written from intuition.
 *
 * Usage:
 *   node pipeline/tools/df.ts <ar|en|fa> <term> [<term> ...]
 *
 * Arabic is matched against the body only (never the fused basmala), English
 * through the same fold the index uses, Persian against both ZWNJ keys.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalize, normalizeJoined } from '../lib/normalize.ts'
import { foldEnglish } from '../lib/stopwords.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const lang = process.argv[2]
const terms = process.argv.slice(3)

if (!['ar', 'en', 'fa'].includes(lang) || terms.length === 0) {
  console.error('usage: node pipeline/tools/df.ts <ar|en|fa> <term> [<term> ...]')
  process.exit(2)
}

const corpus = JSON.parse(
  await readFile(join(ROOT, 'data', 'build', 'corpus.json'), 'utf8'),
) as { verses: Array<{ ref: string; bodyNorm: string; arabicNorm: string }> }

type Edition = {
  verses: Record<string, { searchText: string; searchTextJoined: string; segments: Array<{ v: string }> }>
}

let edition: Edition | null = null
if (lang !== 'ar') {
  edition = JSON.parse(
    await readFile(join(ROOT, 'data', 'build', `translations.${lang}.json`), 'utf8'),
  ) as Edition
}

function display(ref: string): string {
  if (lang === 'ar') {
    return corpus.verses.find((v) => v.ref === ref)?.bodyNorm.slice(0, 120) ?? ''
  }
  return (edition?.verses[ref]?.segments ?? []).map((s) => s.v).join(' ').slice(0, 140)
}

for (const term of terms) {
  const keys =
    lang === 'ar'
      ? [normalize(term)]
      : lang === 'en'
        ? [foldEnglish(term).toLowerCase()]
        : [...new Set([normalize(term), normalizeJoined(term)])]

  const hits: string[] = []
  for (const v of corpus.verses) {
    const ref = v.ref
    let matched = false
    if (lang === 'ar') {
      matched = keys.some((k) => v.bodyNorm.includes(k))
    } else {
      const t = edition!.verses[ref]
      matched = !!t && keys.some((k) => t.searchText.includes(k) || t.searchTextJoined.includes(k))
    }
    if (matched) hits.push(ref)
  }

  const share = hits.length / corpus.verses.length
  const flag = hits.length === 0 ? 'DEAD' : share > 0.5 ? 'TOO-COMMON' : 'ok'
  console.log(`${term}\tdf=${hits.length}\t${flag}`)
  for (const ref of hits.slice(0, 3)) console.log(`    ${ref}  ${display(ref)}`)
}