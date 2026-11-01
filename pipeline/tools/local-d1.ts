/**
 * Local D1 fixture for evaluation tools.
 *
 * Node 24 bundles SQLite with FTS5, so the generated schema and seed can be
 * exercised without a Cloudflare account. This module exists so eval scripts
 * share one adapter instead of each growing a slightly different copy.
 */

import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  D1Database,
  D1Prepared,
  Lexicon,
  SurahMeta,
} from '../../worker/src/retrieve.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T

export interface LocalD1 {
  sqlite: DatabaseSync
  db: D1Database
  lexicon: Lexicon
  surahs: SurahMeta[]
}

export function d1Adapter(sqlite: DatabaseSync): D1Database {
  return {
    prepare(sql: string): D1Prepared {
      const stmt = sqlite.prepare(sql)
      let params: unknown[] = []
      const prepared: D1Prepared = {
        bind(...values: unknown[]) {
          params = values
          return prepared
        },
        async all<T = Record<string, unknown>>() {
          return { results: stmt.all(...(params as never[])).map((r) => plain<T>(r)) }
        },
        async first<T = Record<string, unknown>>() {
          const row = stmt.get(...(params as never[]))
          return row ? plain<T>(row) : null
        },
      }
      return prepared
    },
  }
}

export async function openLocalD1(): Promise<LocalD1> {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(await readFile(join(ROOT, 'data', 'build', 'd1', 'schema.sql'), 'utf8'))
  sqlite.exec(await readFile(join(ROOT, 'data', 'build', 'd1', 'seed.sql'), 'utf8'))

  const rows = sqlite
    .prepare("SELECT key, value FROM meta WHERE key IN ('lexicon','surahs')")
    .all() as Array<{ key: string; value: string }>
  const meta = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  if (!meta.lexicon || !meta.surahs) throw new Error('D1 seed is missing lexicon/surahs meta')

  return {
    sqlite,
    db: d1Adapter(sqlite),
    lexicon: JSON.parse(meta.lexicon) as Lexicon,
    surahs: JSON.parse(meta.surahs) as SurahMeta[],
  }
}