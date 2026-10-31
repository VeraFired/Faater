/**
 * Merge a workflow's verified synonym draft into the lexicon source.
 *
 * Input  : a JSON file with { concepts: [{ id, en[], fa[], ar[] }], dropped?: [] }
 *          (the shape the draft/verify workflow returns)
 * Output : data/lexicon/synonyms.json, ordered by the finglish concept list
 *
 * The merge is mechanical on purpose: the synonym lists are authored by an
 * agent pass and must not be hand-edited in a way that cannot be reproduced.
 * Validation here is the guard against a draft that silently lost a concept.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LEX = join(ROOT, 'data', 'lexicon')

interface Draft {
  concepts: Array<{ id: string; en: string[]; fa: string[]; ar: string[] }>
  dropped?: Array<{ id: string; lang: string; term: string; reason: string }>
}

const inputPath = process.argv[2]
if (!inputPath) {
  console.error('usage: node pipeline/tools/merge-synonyms.ts <draft.json>')
  process.exit(2)
}

const finglish = JSON.parse(await readFile(join(LEX, 'finglish.json'), 'utf8')) as {
  concepts: Array<{ id: string; en: string; fa: string }>
}
const draft = JSON.parse(await readFile(inputPath, 'utf8')) as Draft

const byId = new Map(draft.concepts.map((c) => [c.id, c]))
const known = new Set(finglish.concepts.map((c) => c.id))

for (const c of draft.concepts) {
  if (!known.has(c.id)) throw new Error(`draft has unknown concept: ${c.id}`)
}
if (byId.size !== draft.concepts.length) throw new Error('draft has duplicate concept ids')

const clean = (terms: string[]) =>
  [...new Set(terms.map((t) => t.trim()).filter(Boolean))]

const merged = finglish.concepts.map((c) => {
  const d = byId.get(c.id)
  if (!d) throw new Error(`draft is missing concept: ${c.id}`)
  const out = { id: c.id, en: clean(d.en), fa: clean(d.fa), ar: clean(d.ar) }
  // A concept with no surviving verified term still needs an entry: its own
  // label is a valid search key and keeps the expansion from silently
  // dropping the concept.
  if (!out.en.length && !out.fa.length && !out.ar.length) {
    out.en = [c.en]
    out.fa = [c.fa]
  }
  return out
})

const emptyLangs = merged.flatMap((c) =>
  ['en', 'fa', 'ar'].filter((l) => c[l as 'en' | 'fa' | 'ar'].length === 0).map((l) => `${c.id}:${l}`),
)

const artifact = {
  _note:
    'SEARCH-ONLY synonyms for the concept layer, drafted by an agent pass and corpus-verified ' +
    'with pipeline/tools/df.ts (no term with df=0 or df > half the corpus survives). These ' +
    'strings are never displayed: a wrong term costs recall, it cannot put a word in front of a user.',
  _review:
    'UNREVIEWED — machine-drafted, corpus-verified only. Human review is required before this ' +
    'layer is treated as editorial content; it does not affect display text, only retrieval.',
  _source: 'synonym draft/verify workflow, 2026-10-31',
  concepts: merged,
}

await writeFile(join(LEX, 'synonyms.json'), JSON.stringify(artifact, null, 2) + '\n', 'utf8')

console.log('[merge-synonyms] OK')
console.log(`  concepts      ${merged.length}`)
console.log(
  `  terms         en ${merged.reduce((n, c) => n + c.en.length, 0)} · ` +
    `fa ${merged.reduce((n, c) => n + c.fa.length, 0)} · ` +
    `ar ${merged.reduce((n, c) => n + c.ar.length, 0)}`,
)
if (draft.dropped?.length) console.log(`  dropped       ${draft.dropped.length} (see draft)`)
if (emptyLangs.length) console.log(`  empty langs   ${emptyLangs.join(', ')}`)
console.log(`  output        ${join(LEX, 'synonyms.json')}`)