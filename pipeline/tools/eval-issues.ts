/**
 * Issue-set evaluation for targeted retrieval defects.
 *
 * The pilot set measures general retrieval quality. This tool measures a
 * named bug and its controls in BOTH retrieval implementations, so "fixed in
 * memory" cannot hide a D1 regression. It writes no report file — the pilot
 * owns eval/report.*, and overwriting it here would destroy the baseline.
 *
 * Usage:
 *   node pipeline/tools/eval-issues.ts [set.json] [--phase v0.1.1]
 *
 * Exit code is nonzero if any selected item fails in either path, or if the
 * two paths disagree by more than one rank on the best expected verse.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadData } from '../eval.ts'
import { Retriever } from '../lib/retrieve.ts'
import { searchD1 } from '../../worker/src/retrieve.ts'
import { openLocalD1 } from './local-d1.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

interface IssueItem {
  id: string
  phase: string
  lang: 'en' | 'fa'
  q: string
  expect_refs: string[]
  /** Require every expected ref (default: at least one). */
  require_all?: boolean
  top_k: number
  reject_refs?: string[]
  /** Set false when the two paths legitimately rank the head differently. */
  parity?: boolean
  note?: string
}

interface PathCheck {
  ok: boolean
  ranks: Array<number | null>
  rejected: string[]
  top5: string[]
  bestRank: number | null
}

const parseArgs = (): { setPath: string; phase?: string; conceptWeight?: number } => {
  const args = process.argv.slice(2)
  let setPath = join(ROOT, 'eval', 'issues', 'bug-001.json')
  let phase: string | undefined
  let conceptWeight: number | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--phase') {
      phase = args[++i]
      if (!phase) throw new Error('--phase requires a value')
    } else if (args[i] === '--concept-weight') {
      const raw = args[++i]
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('--concept-weight requires a non-negative number')
      }
      conceptWeight = value
    } else if (!args[i].startsWith('--')) {
      setPath = args[i]
    }
  }
  return { setPath, phase, conceptWeight }
}

const check = (item: IssueItem, hits: Array<{ ref: string }>): PathCheck => {
  const refs = hits.map((h) => h.ref)
  const ranks = item.expect_refs.map((ref) => {
    const index = refs.indexOf(ref)
    return index >= 0 ? index + 1 : null
  })
  const within = ranks.map((rank) => rank !== null && rank <= item.top_k)
  const ok = item.require_all ? within.every(Boolean) : within.some(Boolean)
  const rejected = (item.reject_refs ?? []).filter((ref) =>
    refs.slice(0, item.top_k).includes(ref),
  )
  const present = ranks.filter((rank): rank is number => rank !== null)
  return {
    ok: ok && rejected.length === 0,
    ranks,
    rejected,
    top5: refs.slice(0, 5),
    bestRank: present.length ? Math.min(...present) : null,
  }
}

const formatRanks = (item: IssueItem, result: PathCheck): string =>
  item.expect_refs
    .map((ref, i) => `${ref}=${result.ranks[i] === null ? 'MISS' : `#${result.ranks[i]}`}`)
    .join(' ')

const { setPath, phase, conceptWeight } = parseArgs()
const all: IssueItem[] = JSON.parse(await readFile(setPath, 'utf8'))
const items = phase ? all.filter((item) => item.phase === phase) : all
if (!items.length) {
  console.error(`No items${phase ? ` for phase ${phase}` : ''} in ${setPath}`)
  process.exit(1)
}

const data = await loadData()
const retriever = new Retriever(data)
const { db, lexicon, surahs } = await openLocalD1()

console.log(`Issue eval — ${phase ?? 'all phases'} — ${items.length} items — ${setPath}\n`)

let failed = 0
for (const item of items) {
  const memoryHits = retriever.search(item.q, {
    limit: 50,
    language: item.lang,
    conceptWeight,
  })
  const d1Hits = await searchD1(db, lexicon, surahs, item.q, {
    limit: 50,
    language: item.lang,
    conceptWeight,
  })

  const memory = check(item, memoryHits)
  const d1 = check(item, d1Hits)

  // The two implementations are allowed to differ at the margins, not by a
  // ranking tier. A larger gap means one path is not actually fixed.
  const parity =
    memory.bestRank !== null && d1.bestRank !== null
      ? Math.abs(memory.bestRank - d1.bestRank)
      : null
  const parityOk = item.parity === false || parity === null || parity <= 1

  const ok = memory.ok && d1.ok && parityOk
  if (!ok) failed++

  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${item.id}  (${item.lang})  «${item.q}»`,
  )
  console.log(`      memory  ${memory.ok ? 'PASS' : 'FAIL'}  ${formatRanks(item, memory)}  top5 ${memory.top5.join(', ') || '(none)'}`)
  console.log(`      d1      ${d1.ok ? 'PASS' : 'FAIL'}  ${formatRanks(item, d1)}  top5 ${d1.top5.join(', ') || '(none)'}`)
  if (memory.rejected.length) console.log(`      memory rejected false friends: ${memory.rejected.join(', ')}`)
  if (d1.rejected.length) console.log(`      d1 rejected false friends: ${d1.rejected.join(', ')}`)
  if (!parityOk) console.log(`      parity FAIL: best rank gap ${parity} (> 1)`)
  if (item.note) console.log(`      note: ${item.note}`)
  console.log('')
}

console.log(`RESULT: ${failed ? 'FAIL' : 'PASS'} (${items.length - failed}/${items.length} items)`)
process.exitCode = failed ? 1 : 0