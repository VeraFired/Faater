/**
 * Assemble the authored blind set into eval/blind.json and freeze it.
 *
 * The authoring workflow returns answerable items with verified gold refs and
 * should-refuse items, plus a Persian review and an audit. This tool:
 *   - applies Persian fixes by topic;
 *   - drops topics named with --drop (audit corrections are deliberate, manual
 *     decisions, never automatic relabels);
 *   - assigns stable pair ids and EN/FA item ids;
 *   - refuses to freeze while the audit reports a blocker;
 *   - computes _meta.freeze_sha256 over the canonical item array.
 *
 * It runs no retrieval. Metrics on the set remain single-shot after the scholar
 * review.
 *
 * Usage:
 *   node pipeline/tools/assemble-blind.ts <raw.json> [--drop <topic>]...
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const srcPath = args.find((a) => !a.startsWith('--'))
if (!srcPath) {
  console.error('usage: node pipeline/tools/assemble-blind.ts <raw.json> [--drop <topic>]...')
  process.exit(1)
}
const drops = new Set<string>()
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--drop' && args[i + 1]) drops.add(args[i + 1].toLowerCase())
}

type Category =
  | 'answerable_direct'
  | 'answerable_paraphrase'
  | 'unanswerable_indomain'
  | 'ood'
  | 'adversarial'
type Answerable = {
  topic: string
  category: Category
  q_en: string
  q_fa: string
  refs: Array<{ ref: string; why: string }>
}
type Refuse = { topic: string; category: Category; q_en: string; q_fa: string; why_unanswerable: string }
type Raw = {
  answerable: Answerable[]
  refuse: Refuse[]
  persianFixes: Array<{ topic: string; q_fa: string; problem: string }>
  audit: { issues: Array<{ topic: string; severity: 'blocker' | 'major' | 'minor'; issue: string }>; summary: string }
  counts: Record<string, number>
}

const raw = JSON.parse(await readFile(srcPath, 'utf8')) as Raw
const fixes = new Map(raw.persianFixes.map((f) => [f.topic.toLowerCase(), f.q_fa]))

const COPY: Array<[Category, string]> = [
  ['answerable_direct', 'a', 'answerable_direct'],
  ['answerable_paraphrase', 'p', 'answerable_paraphrase'],
  ['unanswerable_indomain', 'u', 'unanswerable_indomain'],
  ['ood', 'o', 'ood'],
  ['adversarial', 'x', 'adversarial'],
]
const EXPECTED: Record<Category, number> = {
  answerable_direct: 25,
  answerable_paraphrase: 8,
  unanswerable_indomain: 9,
  ood: 6,
  adversarial: 2,
}

const blockers = (raw.audit?.issues ?? []).filter((i) => i.severity === 'blocker')
if (blockers.length) {
  console.error('audit reports blockers; resolve them before freezing:')
  for (const b of blockers) console.error(`  - ${b.topic}: ${b.issue}`)
  process.exit(1)
}

const all = [
  ...raw.answerable.map((a) => ({ ...a, expect: 'answer' as const })),
  ...raw.refuse.map((r) => ({ ...r, refs: [], expect: 'refuse' as const })),
].filter((i) => !drops.has(i.topic.toLowerCase()))

const items: Array<Record<string, unknown>> = []
const errors: string[] = []
for (const [category, prefix] of COPY) {
  const slice = all.filter((i) => i.category === category)
  if (slice.length !== EXPECTED[category]) {
    errors.push(`${category}: expected ${EXPECTED[category]}, got ${slice.length}`)
  }
  slice.forEach((it, i) => {
    const pair = `${prefix}${String(i + 1).padStart(2, '0')}`
    const q_fa = fixes.get(it.topic.toLowerCase()) ?? it.q_fa
    const common = {
      pair_id: pair,
      category,
      expect: it.expect,
      ...(it.expect === 'answer' ? { expect_refs: it.refs.map((r) => r.ref) } : {}),
    }
    items.push({ id: `en-${pair}`, lang: 'en', q: it.q_en, ...common })
    items.push({ id: `fa-${pair}`, lang: 'fa', q: q_fa, ...common })
  })
}
if (errors.length) {
  console.error('cannot freeze:')
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

const freeze_sha256 = createHash('sha256').update(JSON.stringify(items)).digest('hex')
const out = {
  _meta: {
    name: 'M0 blind evaluation set — 50 bilingual pairs, EN+FA',
    status: 'FROZEN — AI-AUTHORED, PENDING SCHOLAR REVIEW',
    created: '2026-10-31',
    composition: EXPECTED,
    authoring:
      'Authored independently of the retriever and pilot by a multi-agent workflow: drafted from fresh topics, gold refs found with pipeline/tools/find.ts, adversarially verified, Persian reviewed, completeness audited. Not used to tune retrieval.',
    corrections: {
      persianFixesApplied: raw.persianFixes.length,
      droppedTopics: [...drops],
    },
    audit: raw.audit,
    freeze_sha256,
    limits: [
      'AI-authored. Refusal and retrieval metrics on this set are valid only after the scholar review, and only until the next change to retrieval, the concept layer, the scope model or the translations.',
      'expect_refs is not exhaustive: a miss is a lower bound on recall, not proof of failure.',
      'EN and FA items are paired translations and must never be pooled.',
      'Sensitive verses are deliberately absent; they need the sensitivity path, not the plain answer path.',
    ],
  },
  items,
}

await writeFile(join(ROOT, 'eval', 'blind.json'), JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`[assemble-blind] wrote eval/blind.json — ${items.length} items, 50 pairs`)
console.log(`  freeze_sha256 ${freeze_sha256}`)
console.log(`  persian fixes applied (by topic): ${raw.persianFixes.length}`)
console.log(`  audit: ${raw.audit?.summary ?? 'none'}`)
for (const issue of raw.audit?.issues ?? []) {
  console.log(`  ${issue.severity.toUpperCase()} ${issue.topic}: ${issue.issue}`)
}