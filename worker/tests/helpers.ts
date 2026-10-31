/**
 * Local SQLite adapter for the Worker's D1 surface.
 *
 * Node 24 bundles SQLite with FTS5, so the same schema and seed D1 will run can
 * be exercised in tests without a Cloudflare account.
 */

import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { D1Database, D1Prepared, Lexicon, SurahMeta } from '../src/retrieve.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const plain = <T>(row: unknown): T => ({ ...(row as object) }) as T

export function openDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  return db
}

export async function loadSchemaAndSeed(db: DatabaseSync): Promise<void> {
  db.exec(await readFile(join(ROOT, 'data', 'build', 'd1', 'schema.sql'), 'utf8'))
  db.exec(await readFile(join(ROOT, 'data', 'build', 'd1', 'seed.sql'), 'utf8'))
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

export async function loadMeta(sqlite: DatabaseSync): Promise<{
  lexicon: Lexicon
  surahs: SurahMeta[]
}> {
  const rows = sqlite
    .prepare("SELECT key, value FROM meta WHERE key IN ('lexicon','surahs')")
    .all() as Array<{ key: string; value: string }>
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    lexicon: JSON.parse(map.lexicon) as Lexicon,
    surahs: JSON.parse(map.surahs) as SurahMeta[],
  }
}