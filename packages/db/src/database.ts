/**
 * SQLite connection wrapper.
 *
 * Deliberate constraints, because the whole deployment rests on them:
 *  - one process, one writer: better-sqlite3 is synchronous, so writes are
 *    serialized by the event loop. Keep transactions short and never hold one
 *    across an `await`.
 *  - WAL mode lets readers proceed during a write; `busy_timeout` absorbs the
 *    rare overlap from background index jobs.
 *  - foreign keys ON, so a tenancy cascade never leaves orphan rows.
 */
import BetterSqlite3 from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { AppError, nowIso } from '@marketing-agent/shared'
import { MIGRATIONS, type Migration } from './migrations.ts'

export type SqliteDatabase = BetterSqlite3.Database

export interface OpenDatabaseOptions {
  /** File path, or `:memory:` for tests. Parent directories are created for files. */
  readonly file: string
  readonly verbose?: boolean
}

export interface Database {
  readonly raw: SqliteDatabase
  /** One row, or undefined. Named params (`@name`) or positional (`?`) both work. */
  get<T>(sql: string, params?: ParamInput): T | undefined
  all<T>(sql: string, params?: ParamInput): T[]
  run(sql: string, params?: ParamInput): BetterSqlite3.RunResult
  /** Execute a callback inside a transaction, rolling back on throw. */
  tx<T>(fn: () => T): T
  close(): void
  /** Ids applied by this process, when it performed migrations at open time. */
  appliedMigrations?: readonly string[]
}

/**
 * Named-parameter bag, or positional argument list. `object` (not
 * `Record<string, unknown>`) is accepted so domain interfaces can be passed
 * directly — TypeScript does not give declared interfaces an index signature.
 */
export type ParamInput = object | readonly unknown[]

const MIGRATION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL,
  statements  INTEGER NOT NULL
);
`

function applyMigrations(raw: SqliteDatabase): string[] {
  raw.exec(MIGRATION_TABLE)
  const applied = new Set(
    raw.prepare<[], { id: string }>('SELECT id FROM schema_migrations').all().map((r) => r.id),
  )
  const recordMigration = raw.prepare(
    'INSERT INTO schema_migrations (id, applied_at, statements) VALUES (?, ?, ?)',
  )
  const justApplied: string[] = []

  for (const migration of MIGRATIONS as readonly Migration[]) {
    if (applied.has(migration.id)) continue
    const statements = migration.sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0).length
    raw.exec('BEGIN')
    try {
      raw.exec(migration.sql)
      recordMigration.run(migration.id, nowIso(), statements)
      raw.exec('COMMIT')
      justApplied.push(migration.id)
    } catch (cause) {
      raw.exec('ROLLBACK')
      throw new AppError('internal', `Migration ${migration.id} thất bại: ${String(cause)}`, { cause })
    }
  }
  return justApplied
}

export function openDatabase(options: OpenDatabaseOptions): Database {
  const { file } = options
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true })
  }
  const raw = new BetterSqlite3(file, options.verbose ? { verbose: console.log } : {})
  raw.pragma('journal_mode = WAL')
  raw.pragma('synchronous = NORMAL')
  raw.pragma('foreign_keys = ON')
  raw.pragma('busy_timeout = 5000')

  const applied = applyMigrations(raw)

  const db: Database = {
    raw,
    get<T>(sql: string, params?: ParamInput) {
      const statement = raw.prepare(sql)
      return (isPositional(params) ? statement.get(...params) : statement.get(params ?? {})) as T | undefined
    },
    all<T>(sql: string, params?: ParamInput) {
      const statement = raw.prepare(sql)
      return (isPositional(params) ? statement.all(...params) : statement.all(params ?? {})) as T[]
    },
    run(sql: string, params?: ParamInput) {
      const statement = raw.prepare(sql)
      return isPositional(params) ? statement.run(...params) : statement.run(params ?? {})
    },
    tx<T>(fn: () => T): T {
      return raw.transaction(fn)()
    },
    close() {
      raw.close()
    },
  }

  if (applied.length > 0) {
    // Surfaced once at boot by the caller; kept here so a misconfigured volume is obvious.
    db.appliedMigrations = applied
  }
  return db
}

function isPositional(params: ParamInput | undefined): params is readonly unknown[] {
  return Array.isArray(params)
}
