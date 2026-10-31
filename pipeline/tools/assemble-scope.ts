/**
 * Assemble the generated scope-training data into eval/scope-train.json.
 *
 * The generation workflow returns raw items plus audit issues and Persian
 * fixes. This tool applies those corrections deterministically, drops what the
 * audit marked unsalvageable, and records the provenance and before/after
 * counts in `_meta` so the training set is reproducible from the raw result.
 *
 * Usage:
 *   node pipeline/tools/assemble-scope.ts [data/build/scope-workflow.json]
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const argv = process.argv.slice(2)
const keepDuplicates = argv.includes('--keep-duplicates')
const srcPath =
  argv.find((a) => !a.startsWith('--')) ?? join(ROOT, 'data', 'build', 'scope-workflow.json')
const outPath = join(ROOT, 'eval', 'scope-train.json')

type Class = 'quran' | 'fiqh' | 'history' | 'other_islamic' | 'ood'
type Item = { class: Class; topic: string; q_en: string; q_fa: string }
type Issue = {
  q_en: string
  problem: 'wrong_label' | 'duplicate' | 'unnatural' | 'untranslated' | 'sensitive' | 'other'
  fix_class?: Class | 'drop'
  note: string
}
type Fix = { q_en: string; q_fa: string; problem: string }
type Raw = {
  items: Item[]
  issues: Issue[]
  persianFixes: Fix[]
  counts: Record<string, number>
}

const raw = JSON.parse(await readFile(srcPath, 'utf8')) as Raw
const CLASSES: Class[] = ['quran', 'fiqh', 'history', 'other_islamic', 'ood']
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const warnings: string[] = []
const drops = new Set<string>()
const relabel = new Map<string, Class>()

for (const issue of raw.issues ?? []) {
  const key = norm(issue.q_en)
  if (!key) {
    warnings.push('audit issue without q_en')
    continue
  }
  if (issue.problem === 'sensitive') {
    // Always dropped: the project forbids sensitive material in this set.
    drops.add(key)
  } else if (issue.problem === 'duplicate') {
    // Near-duplicates are useful lexical variation when the trainer groups them
    // into one split cluster; they are dropped only in the conservative mode.
    if (!keepDuplicates) drops.add(key)
  } else if (issue.fix_class === 'drop') {
    drops.add(key)
  } else if (issue.fix_class) {
    relabel.set(key, issue.fix_class)
  } else if (issue.problem === 'wrong_label' || issue.problem === 'untranslated') {
    warnings.push(`unfixed ${issue.problem}: ${issue.q_en} — ${issue.note}`)
  }
}

const faFix = new Map<string, string>()
for (const fix of raw.persianFixes ?? []) {
  faFix.set(norm(fix.q_en), fix.q_fa)
}

const seen = new Set<string>()
const items: Item[] = []
const applied = { dropped: 0, relabelled: 0, persianFixed: 0 }
const unresolvedDrops = new Set(drops)

for (const it of raw.items) {
  const key = norm(it.q_en)
  if (seen.has(key)) {
    applied.dropped++
    unresolvedDrops.delete(key)
    continue
  }
  seen.add(key)
  if (drops.has(key)) {
    applied.dropped++
    unresolvedDrops.delete(key)
    continue
  }
  const cls = relabel.get(key) ?? it.class
  if (relabel.has(key)) applied.relabelled++
  const q_fa = faFix.get(key) ?? it.q_fa
  if (faFix.has(key)) applied.persianFixed++
  items.push({ ...it, class: cls, q_fa })
}

for (const key of unresolvedDrops) warnings.push(`audit drop did not match an item: ${key}`)

const counts: Record<string, number> = {}
for (const cls of CLASSES) counts[cls] = items.filter((i) => i.class === cls).length
const total = items.length

const out = {
  _meta: {
    name: 'G1 scope classifier — training set',
    status: 'GENERATED + AUDITED (AI), no human review',
    source: 'workflow generate-scope-training-data, 2026-10-31',
    applied,
    keptDuplicates: keepDuplicates,
    rawCounts: raw.counts,
    counts,
    warnings,
    limits: [
      'AI-generated questions, audited by a separate AI pass — not human-written or human-reviewed.',
      'The Persian review sampled every fourth item; unexampled items were not read by the reviewer.',
      'No Finglish inputs are included; the classifier will treat them as out-of-domain.',
      'The model is a scope gate, not an answerability gate: quran-class questions may still lack a Quranic answer (G2/G3 remain unimplemented).',
    ],
  },
  items,
}

await writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8')

console.log(`[assemble-scope] ${total} items -> ${outPath}`)
console.log('  counts:', counts)
console.log('  applied:', applied)
console.log(`  issues ${raw.issues?.length ?? 0}, persian fixes ${raw.persianFixes?.length ?? 0}`)
for (const w of warnings) console.log(`  WARN ${w}`)