/**
 * Parse a QuranEnc translation edition into display segments.
 *
 * The licence (QuranEnc Terms and Policies, condition 1) forbids "modification,
 * addition, or deletion of the content". So this module never rewrites the
 * translation. It splits the verbatim string into typed segments and leaves
 * the original bytes intact and rejoinable:
 *
 *   "(1) Alif, Lām, Meem.[7]"
 *     -> [{t:'num', n:1}, {t:'text', v:' Alif, Lām, Meem.'}, {t:'note', n:7}]
 *
 * The renderer is then free to *use* the leading `(N)` as the verse-number
 * badge instead of displaying it twice, and to render `[N]` as a superscript
 * linked to the translator's own footnote. Nothing is deleted.
 *
 * `[ ... ]` glosses WITHOUT digits (e.g. Persian «[و سپاس‌ها]») are part of
 * the translation and stay inside text segments untouched.
 */

import { normalize } from './normalize.ts'

export type Segment =
  | { t: 'text'; v: string }
  | { t: 'num'; v: string; n: number }
  | { t: 'note'; v: string; n: number }

export interface Footnote {
  n: number
  /** Verbatim footnote body, with the leading `[n]- ` removed. */
  text: string
}

export interface ParsedTranslation {
  segments: Segment[]
  footnotes: Footnote[]
  /** Markers in the text with no matching footnote — a defect in the source. */
  unresolvedNotes: number[]
  /** Search key: translation prose only, no `(N)`, no `[N]`, normalized. */
  searchText: string
}

/**
 * Split the `footnotes` column into entries.
 *
 * Format is `[98]- text\n[99]- text`. Splitting on newline-followed-by-a-new-
 * entry keeps multi-line footnote bodies intact.
 */
export function parseFootnotes(raw: string): Footnote[] {
  if (!raw || !raw.trim()) return []
  return raw
    .split(/\n(?=\[\d+\]-)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^\[(\d+)\]\s*-\s*([\s\S]*)$/.exec(part)
      if (!m) return { n: -1, text: part }
      return { n: Number(m[1]), text: m[2].trim() }
    })
    .filter((f) => f.n >= 0)
}

export function parseTranslation(text: string, footnotesRaw: string): ParsedTranslation {
  const footnotes = parseFootnotes(footnotesRaw)
  const known = new Set(footnotes.map((f) => f.n))
  const segments: Segment[] = []
  const unresolved = new Set<number>()

  let rest = text
  // Only a number at position 0 is the edition's verse number. A parenthesised
  // number mid-sentence is prose and must not be touched.
  const lead = /^\((\d+)\)/.exec(rest)
  if (lead) {
    segments.push({ t: 'num', v: lead[0], n: Number(lead[1]) })
    rest = rest.slice(lead[0].length)
  }

  const marker = /\[(\d+)\]/g
  let pos = 0
  for (let m = marker.exec(rest); m !== null; m = marker.exec(rest)) {
    if (m.index > pos) segments.push({ t: 'text', v: rest.slice(pos, m.index) })
    const n = Number(m[1])
    segments.push({ t: 'note', v: m[0], n })
    if (!known.has(n)) unresolved.add(n)
    pos = marker.lastIndex
  }
  if (pos < rest.length) segments.push({ t: 'text', v: rest.slice(pos) })

  const searchText = normalize(
    segments.filter((s) => s.t === 'text').map((s) => (s as { v: string }).v).join(' '),
  )

  return { segments, footnotes, unresolvedNotes: [...unresolved].sort((a, b) => a - b), searchText }
}

/** Rejoin segments. Must reproduce the input byte-for-byte — the licence guard. */
export function rejoin(segments: Segment[]): string {
  return segments.map((s) => s.v).join('')
}

/** The `(N)` the edition states for itself, if present. */
export function selfNumber(segments: Segment[]): number | null {
  const first = segments[0]
  return first && first.t === 'num' ? first.n : null
}