import BetterSqlite3 from 'better-sqlite3'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProviderKeyUsageMode } from '@marketing-agent/shared'
import { createRepos, MIGRATIONS, type Repos } from '../src/index.ts'

const APP_SECRET = 'key-rotation-tests-only-secret-32-characters'
const ROTATION_MIGRATION = '0011_provider_key_rotation'
let repos: Repos
let connections: Repos[]
let temporaryDirectories: string[]

function openRepos(file = ':memory:'): Repos {
  const opened = createRepos({ file, appSecret: APP_SECRET })
  connections.push(opened)
  return opened
}

function temporaryFile(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'ma-key-rotation-')))
  temporaryDirectories.push(directory)
  return join(directory, 'marketing.db')
}

function provider(mode: ProviderKeyUsageMode = 'round_robin', target = repos) {
  return target.llm.createProvider({
    companyId: null,
    name: `Provider ${mode}`,
    kind: 'openai_compatible',
    baseUrl: 'https://example.test/v1',
    keyUsageMode: mode,
  })
}

function key(providerId: string, priority: number, target = repos, enabled = true) {
  return target.llm.createProviderKey({
    providerId,
    label: `Key ${priority}`,
    apiKey: `sk-provider-${providerId}-${priority}`,
    priority,
    enabled,
  })
}

function state(providerId: string, target = repos) {
  return target.db.get<{ key_id: string | null; calls_used: number }>(
    'SELECT key_id, calls_used FROM llm_provider_key_rotation WHERE provider_id = ?',
    [providerId],
  )
}

function selectIds(providerId: string, count: number, target = repos): (string | undefined)[] {
  return Array.from({ length: count }, () => target.llm.selectProviderKey(providerId)?.key?.id)
}

beforeEach(() => {
  connections = []
  temporaryDirectories = []
  repos = openRepos()
})

afterEach(() => {
  for (const connection of connections) {
    if (connection.db.raw.open) connection.db.close()
  }
  for (const directory of temporaryDirectories) {
    // Resolve and verify the generated target before deleting test fixtures.
    const resolved = realpathSync(directory)
    if (resolved !== directory || !resolved.startsWith(join(realpathSync(tmpdir()), 'ma-key-rotation-'))) {
      throw new Error(`Unexpected test cleanup target: ${resolved}`)
    }
    rmSync(resolved, { recursive: true, force: true })
  }
})

describe('provider key round-robin reservations', () => {
  it('uses priority order in three-call blocks: 111222333111', () => {
    const p = provider()
    // Deliberately insert out of priority order, not relying on creation timestamps.
    const k3 = key(p.id, 30)
    const k1 = key(p.id, 10)
    const k2 = key(p.id, 20)
    expect(selectIds(p.id, 12)).toEqual([
      k1.id, k1.id, k1.id, k2.id, k2.id, k2.id,
      k3.id, k3.id, k3.id, k1.id, k1.id, k1.id,
    ])
    expect(state(p.id)).toEqual({ key_id: k1.id, calls_used: 3 })
    expect(repos.llm.selectProviderKey(p.id)).toEqual({
      mode: 'round_robin',
      blockId: expect.any(String),
      key: { id: k2.id, label: k2.label, apiKey: `sk-provider-${p.id}-20` },
    })
  })

  it('does not let preferredKeyId override the round-robin cursor', () => {
    const p = provider()
    const k1 = key(p.id, 1)
    const k2 = key(p.id, 2)
    expect(repos.llm.selectProviderKey(p.id, { preferredKeyId: k2.id })?.key?.id).toBe(k1.id)
    expect(state(p.id)).toEqual({ key_id: k1.id, calls_used: 1 })
  })

  it('skips failed current and intermediate keys and counts the selected key request', () => {
    const p = provider()
    const k1 = key(p.id, 1)
    const k2 = key(p.id, 2)
    const k3 = key(p.id, 3)
    expect(selectIds(p.id, 1)).toEqual([k1.id])
    expect(repos.llm.selectProviderKey(p.id, { excludeKeyIds: [k1.id, k2.id] })?.key?.id).toBe(k3.id)
    expect(state(p.id)).toEqual({ key_id: k3.id, calls_used: 1 })
    expect(selectIds(p.id, 3)).toEqual([k3.id, k3.id, k1.id])
  })

  it('isolates reservations and key mutations between providers', () => {
    const a = provider()
    const a1 = key(a.id, 1)
    const a2 = key(a.id, 2)
    const b = provider()
    const b1 = key(b.id, 1)
    const b2 = key(b.id, 2)
    expect(selectIds(a.id, 2)).toEqual([a1.id, a1.id])
    expect(selectIds(b.id, 3)).toEqual([b1.id, b1.id, b1.id])
    repos.llm.updateProviderKey(a1.id, { label: 'Renamed A' })
    expect(state(a.id)).toBeUndefined()
    expect(state(b.id)).toEqual({ key_id: b1.id, calls_used: 3 })
    expect(selectIds(a.id, 4)).toEqual([a1.id, a1.id, a1.id, a2.id])
    expect(selectIds(b.id, 1)).toEqual([b2.id])
  })

  it('never selects disabled keys and resets when a key is disabled or re-enabled', () => {
    const p = provider()
    const disabled = key(p.id, 0, repos, false)
    const k1 = key(p.id, 1)
    const k2 = key(p.id, 2)
    expect(selectIds(p.id, 4)).toEqual([k1.id, k1.id, k1.id, k2.id])
    repos.llm.updateProviderKey(k1.id, { enabled: false })
    expect(state(p.id)).toBeUndefined()
    expect(selectIds(p.id, 4)).toEqual([k2.id, k2.id, k2.id, k2.id])
    repos.llm.updateProviderKey(disabled.id, { enabled: true })
    expect(state(p.id)).toBeUndefined()
    expect(selectIds(p.id, 1)).toEqual([disabled.id])
  })

  it.each(['create', 'delete', 'priority', 'apiKey', 'label'] as const)(
    'resets reservations after a %s key mutation',
    (mutation) => {
      const p = provider()
      const k1 = key(p.id, 10)
      const k2 = key(p.id, 20)
      selectIds(p.id, 4)
      expect(state(p.id)).toEqual({ key_id: k2.id, calls_used: 1 })
      let expectedFirst = k1.id
      if (mutation === 'create') expectedFirst = key(p.id, 5).id
      else if (mutation === 'delete') {
        repos.llm.deleteProviderKey(k1.id)
        expectedFirst = k2.id
      } else if (mutation === 'priority') {
        repos.llm.updateProviderKey(k2.id, { priority: 5 })
        expectedFirst = k2.id
      } else if (mutation === 'apiKey') repos.llm.updateProviderKey(k1.id, { apiKey: 'sk-replaced' })
      else repos.llm.updateProviderKey(k1.id, { label: 'Renamed' })
      expect(state(p.id)).toBeUndefined()
      const selected = repos.llm.selectProviderKey(p.id)
      expect(selected?.key?.id).toBe(expectedFirst)
      expect(state(p.id)).toEqual({ key_id: expectedFirst, calls_used: 1 })
      if (mutation === 'apiKey') expect(selected?.key?.apiKey).toBe('sk-replaced')
      if (mutation === 'label') expect(selected?.key?.label).toBe('Renamed')
    },
  )

  it('resets on mode changes, but preserves state for the same mode or unrelated provider updates', () => {
    const p = provider()
    const k1 = key(p.id, 1)
    const k2 = key(p.id, 2)
    selectIds(p.id, 4)
    repos.llm.updateProvider(p.id, { keyUsageMode: 'round_robin', name: 'Renamed provider' })
    expect(state(p.id)).toEqual({ key_id: k2.id, calls_used: 1 })
    repos.llm.updateProvider(p.id, { keyUsageMode: 'failover' })
    expect(state(p.id)).toBeUndefined()
    expect(selectIds(p.id, 4)).toEqual([k1.id, k1.id, k1.id, k1.id])
    expect(state(p.id)).toBeUndefined()
    repos.llm.updateProvider(p.id, { keyUsageMode: 'round_robin' })
    expect(selectIds(p.id, 4)).toEqual([k1.id, k1.id, k1.id, k2.id])
  })
})

describe('failover selection', () => {
  it('defaults to the first key and keeps a caller-preferred eligible key without a rotation counter', () => {
    const p = provider('failover')
    const k1 = key(p.id, 1)
    const k2 = key(p.id, 2)
    expect(selectIds(p.id, 5)).toEqual(Array(5).fill(k1.id))
    for (let i = 0; i < 5; i += 1) {
      expect(repos.llm.selectProviderKey(p.id, { preferredKeyId: k2.id })?.key?.id).toBe(k2.id)
    }
    expect(state(p.id)).toBeUndefined()
    // Stickiness is supplied by the caller, not persisted as round-robin state.
    expect(repos.llm.selectProviderKey(p.id)?.key?.id).toBe(k1.id)
  })

  it('honors exclusions over preference and ignores foreign, missing or disabled preferred keys', () => {
    const p = provider('failover')
    const k1 = key(p.id, 1)
    const k2 = key(p.id, 2)
    const disabled = key(p.id, 0, repos, false)
    const foreign = key(provider('failover').id, 1)
    expect(repos.llm.selectProviderKey(p.id, { preferredKeyId: k1.id, excludeKeyIds: [k1.id] })?.key?.id).toBe(k2.id)
    for (const preferredKeyId of [foreign.id, disabled.id, 'missing-key']) {
      expect(repos.llm.selectProviderKey(p.id, { preferredKeyId })?.key?.id).toBe(k1.id)
    }
    expect(state(p.id)).toBeUndefined()
  })
})

describe.each(['failover', 'round_robin'] as const)('%s selection edge cases', (mode) => {
  it('keeps selecting the sole enabled key', () => {
    const p = provider(mode)
    const only = key(p.id, 1)
    expect(selectIds(p.id, 8)).toEqual(Array(8).fill(only.id))
    expect(state(p.id)).toEqual(mode === 'round_robin' ? { key_id: only.id, calls_used: 2 } : undefined)
  })

  it('retains keyless gateway behavior for no keys or only disabled keys', () => {
    const p = provider(mode)
    expect(repos.llm.selectProviderKey(p.id)).toEqual({ mode, key: null })
    key(p.id, 1, repos, false)
    expect(repos.llm.selectProviderKey(p.id)).toEqual({ mode, key: null })
    expect(state(p.id)).toBeUndefined()
  })

  it('returns undefined when every enabled key is excluded without consuming a reservation', () => {
    const p = provider(mode)
    const k1 = key(p.id, 1)
    const k2 = key(p.id, 2)
    const excludeKeyIds = [k1.id, k2.id]
    expect(repos.llm.selectProviderKey(p.id, { excludeKeyIds })).toBeUndefined()
    expect(state(p.id)).toBeUndefined()
    repos.llm.selectProviderKey(p.id)
    const before = state(p.id)
    expect(repos.llm.selectProviderKey(p.id, { preferredKeyId: k1.id, excludeKeyIds })).toBeUndefined()
    expect(state(p.id)).toEqual(before)
    expect(repos.llm.selectProviderKey(p.id)?.key?.id).toBe(k1.id)
  })
})

describe('failed key skips', () => {
  it('drops the remainder of the current block only when the provider and key both match', () => {
    const a = provider()
    const a1 = key(a.id, 1)
    const a2 = key(a.id, 2)
    const b = provider()
    const b1 = key(b.id, 1)
    const a1First = repos.llm.selectProviderKey(a.id)!
    repos.llm.selectProviderKey(b.id)
    repos.llm.skipFailedProviderKey(a.id, b1.id, 'wrong-block')
    repos.llm.skipFailedProviderKey('missing-provider', a1.id, a1First.blockId!)
    expect(state(a.id)).toEqual({ key_id: a1.id, calls_used: 1 })
    repos.llm.skipFailedProviderKey(a.id, a1.id, a1First.blockId!)
    expect(state(a.id)).toEqual({ key_id: a1.id, calls_used: 3 })
    expect(repos.llm.selectProviderKey(a.id)?.key?.id).toBe(a2.id)
    repos.llm.skipFailedProviderKey(a.id, a1.id, a1First.blockId!)
    expect(state(a.id)).toEqual({ key_id: a2.id, calls_used: 1 })
    expect(selectIds(a.id, 2)).toEqual([a2.id, a2.id])
    // A late failure must not exhaust a new block after wrapping back to the same key.
    const wrapped = repos.llm.selectProviderKey(a.id)!
    expect(wrapped.key?.id).toBe(a1.id)
    expect(wrapped.blockId).not.toBe(a1First.blockId)
    repos.llm.skipFailedProviderKey(a.id, a1.id, a1First.blockId!)
    expect(state(a.id)).toEqual({ key_id: a1.id, calls_used: 1 })
    expect(state(b.id)).toEqual({ key_id: b1.id, calls_used: 1 })
  })

  it('does not create a cursor when none exists, including in failover mode', () => {
    for (const mode of ['failover', 'round_robin'] as const) {
      const p = provider(mode)
      const k = key(p.id, 1)
      repos.llm.skipFailedProviderKey(p.id, k.id, 'no-block')
      expect(state(p.id)).toBeUndefined()
    }
  })
})

describe('file-backed rotation and migration compatibility', () => {
  it('continues the partially used block after closing and reopening SQLite', () => {
    const file = temporaryFile()
    const first = openRepos(file)
    const p = provider('round_robin', first)
    const k1 = key(p.id, 1, first)
    const k2 = key(p.id, 2, first)
    expect(selectIds(p.id, 2, first)).toEqual([k1.id, k1.id])
    first.db.close()
    const reopened = openRepos(file)
    expect(state(p.id, reopened)).toEqual({ key_id: k1.id, calls_used: 2 })
    expect(reopened.llm.requireProvider(p.id).keyUsageMode).toBe('round_robin')
    expect(selectIds(p.id, 4, reopened)).toEqual([k1.id, k2.id, k2.id, k2.id])
    reopened.db.close()
    const again = openRepos(file)
    expect(again.llm.selectProviderKey(p.id)?.key).toEqual({
      id: k1.id, label: k1.label, apiKey: `sk-provider-${p.id}-1`,
    })
  })

  it('migrates a pre-rotation database to failover without losing existing keys', () => {
    const file = temporaryFile()
    const legacy = new BetterSqlite3(file)
    try {
      legacy.exec('CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, statements INTEGER NOT NULL)')
      const migrationIndex = MIGRATIONS.findIndex((migration) => migration.id === ROTATION_MIGRATION)
      expect(migrationIndex).toBeGreaterThan(0)
      for (const migration of MIGRATIONS.slice(0, migrationIndex)) {
        legacy.transaction(() => {
          legacy.exec(migration.sql)
          legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(migration.id, '2026-01-01', 1)
        })()
      }
      legacy.prepare(`INSERT INTO llm_providers (id, company_id, name, kind, base_url, enabled, created_at)
        VALUES ('legacy-provider', NULL, 'Legacy', 'openai_compatible', 'https://example.test/v1', 1, '2026-01-01')`).run()
      const encrypted = repos.secrets.encrypt('sk-legacy-secret')
      legacy.prepare(`INSERT INTO llm_provider_keys
        (id, provider_id, label, api_key_enc, api_key_iv, priority, enabled, created_at)
        VALUES ('legacy-key', 'legacy-provider', 'Legacy key', ?, ?, 1, 1, '2026-01-01')`).run(encrypted.enc, encrypted.iv)
    } finally {
      legacy.close()
    }
    const migrated = openRepos(file)
    expect(migrated.db.appliedMigrations).toContain(ROTATION_MIGRATION)
    expect(migrated.llm.requireProvider('legacy-provider').keyUsageMode).toBe('failover')
    expect(migrated.llm.selectProviderKey('legacy-provider')).toEqual({
      mode: 'failover', key: { id: 'legacy-key', label: 'Legacy key', apiKey: 'sk-legacy-secret' },
    })
    expect(state('legacy-provider', migrated)).toBeUndefined()
    migrated.db.close()
    const again = openRepos(file)
    expect(again.db.appliedMigrations).toBeUndefined()
    expect(again.llm.requireProvider('legacy-provider').keyUsageMode).toBe('failover')
  })
})
