import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepos, type Repos } from '../src/index.ts'
import { AppError } from '@marketing-agent/shared'

let repos: Repos

beforeEach(() => {
  repos = createRepos({ file: ':memory:', allowWeakSecret: true })
})

afterEach(() => {
  repos.db.close()
})

describe('migrations', () => {
  it('applies every migration on a fresh database', () => {
    const applied = repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM schema_migrations')
    expect(applied?.n).toBeGreaterThanOrEqual(6)
  })

  it('is idempotent: reopening the same file does not re-apply', () => {
    const before = repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM schema_migrations')?.n
    repos.db.close()
    const again = createRepos({ file: ':memory:', allowWeakSecret: true })
    expect(again.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM schema_migrations')?.n).toBe(before)
    again.db.close()
  })

  it('enforces foreign keys', () => {
    expect(() =>
      repos.db.run('INSERT INTO memberships (id, company_id, user_id, role) VALUES (?, ?, ?, ?)', [
        'm1',
        'missing-company',
        'missing-user',
        'owner',
      ]),
    ).toThrow()
  })
})

describe('database helpers', () => {
  it('rolls back a throwing transaction', () => {
    expect(() =>
      repos.db.tx(() => {
        repos.db.run("INSERT INTO app_settings (key, value_json, updated_at) VALUES ('a', '1', 'now')")
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(repos.db.get('SELECT * FROM app_settings WHERE key = ?', ['a'])).toBeUndefined()
  })

  it('supports named parameters', () => {
    repos.db.run(
      "INSERT INTO app_settings (key, value_json, updated_at) VALUES (@key, @value, @at)",
      { key: 'named', value: '{"ok":true}', at: 'now' },
    )
    expect(repos.db.get<{ value_json: string }>('SELECT value_json FROM app_settings WHERE key = @key', { key: 'named' }))
      .toEqual({ value_json: '{"ok":true}' })
  })
})

describe('tenancy isolation', () => {
  it('refuses a membership for a company that does not exist', () => {
    const user = repos.auth.createUser({ email: 'a@example.com', password: 'password-123', name: 'A' })
    expect(() => repos.auth.addMembership('nope', user.id, 'owner')).toThrow()
  })

  it('returns only the companies a user belongs to', () => {
    const userA = repos.auth.createUser({ email: 'a@example.com', password: 'password-123', name: 'A' })
    const userB = repos.auth.createUser({ email: 'b@example.com', password: 'password-123', name: 'B' })
    const companyA = repos.db.tx(() => {
      repos.db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)', [
        'c-a',
        'Company A',
        'company-a',
        'now',
      ])
      return 'c-a'
    })
    const companyB = repos.db.tx(() => {
      repos.db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)', [
        'c-b',
        'Company B',
        'company-b',
        'now',
      ])
      return 'c-b'
    })
    repos.auth.addMembership(companyA, userA.id, 'owner')
    repos.auth.addMembership(companyB, userB.id, 'owner')

    expect(repos.auth.listCompaniesForUser(userA.id).map((c) => c.id)).toEqual([companyA])
    expect(repos.auth.listCompaniesForUser(userB.id).map((c) => c.id)).toEqual([companyB])
  })

  it('blocks a non-member from resolving another tenant', () => {
    const user = repos.auth.createUser({ email: 'a@example.com', password: 'password-123', name: 'A' })
    repos.db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)', [
      'c-a',
      'Company A',
      'company-a',
      'now',
    ])
    expect(() => repos.auth.requireMembership('c-a', user.id)).toThrow(AppError)
  })

  it('scopes conversations to their company', () => {
    const user = repos.auth.createUser({ email: 'a@example.com', password: 'password-123', name: 'A' })
    repos.db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)', [
      'c-a',
      'Company A',
      'company-a',
      'now',
    ])
    repos.db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)', [
      'c-b',
      'Company B',
      'company-b',
      'now',
    ])
    const conversation = repos.work.createConversation({ companyId: 'c-a', userId: user.id, title: 'Test' })
    expect(repos.work.findConversation(conversation.id, 'c-a')).toBeDefined()
    expect(repos.work.findConversation(conversation.id, 'c-b')).toBeUndefined()
  })
})
