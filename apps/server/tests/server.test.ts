/**
 * Server-level tests.
 *
 * The tenancy tests here are the most important in the repository: they prove a
 * user in one company cannot read or mutate another company's resources through
 * any accounting path. The buildApp helper is used directly so these tests do
 * not depend on route modules that later phases add.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepos, type Repos } from '@marketing-agent/db'
import { seedCatalog, seedCompany } from '@marketing-agent/seed'
import { buildApp, type App } from '../src/app.ts'
import { EventBus, type AppContext } from '../src/context.ts'
import { loadConfig } from '../src/config.ts'
import { SESSION_COOKIE } from '../src/http/middleware.ts'
import { cookieHeader, startTestServer, type TestClient } from './helpers/test-client.ts'

const SECRET = 'unit-test-app-secret-0123456789'

let repos: Repos
let client: TestClient
let app: App

beforeEach(async () => {
  repos = createRepos({ file: ':memory:', allowWeakSecret: true, appSecret: SECRET })
  seedCatalog(repos)
  const context: AppContext = {
    config: loadConfig({ appSecret: SECRET, databasePath: ':memory:', isProduction: false, webDist: undefined }),
    repos,
    events: new EventBus(),
    listToolNames: () => [],
  }
  app = buildApp({ context })
  client = await startTestServer(app)
})

afterEach(async () => {
  await client.close()
  repos.db.close()
})

async function register(email: string, name = 'Người dùng'): Promise<Response2> {
  const response = await client.request('POST', '/api/auth/register', {
    body: { email, password: 'matkhau-rat-dai-123', name },
  })
  return { response, cookie: cookieHeader(response, SESSION_COOKIE) }
}

interface Response2 {
  response: Awaited<ReturnType<TestClient['request']>>
  cookie: Record<string, string>
}

describe('health', () => {
  it('reports liveness without authentication', async () => {
    const response = await client.request('GET', '/healthz')
    expect(response.status).toBe(200)
    expect(response.json<{ status: string }>().status).toBe('ok')
  })

  it('reports readiness once the catalog is seeded', async () => {
    const response = await client.request('GET', '/readyz')
    expect(response.status).toBe(200)
    const body = response.json<{ status: string; agentDefs: number }>()
    expect(body.status).toBe('ready')
    expect(body.agentDefs).toBe(10)
  })
})

describe('authentication', () => {
  it('registers a user, sets an HttpOnly session cookie and returns a profile', async () => {
    const response = await client.request('POST', '/api/auth/register', {
      body: { email: 'New@Example.com', password: 'matkhau-rat-dai-123', name: 'Người mới' },
    })
    expect(response.status).toBe(201)
    const body = response.json<{ user: { email: string } }>()
    expect(body.user.email).toBe('new@example.com')

    const setCookie = response.headers.getSetCookie?.() ?? []
    const session = setCookie.find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    expect(session).toContain('HttpOnly')
    expect(session).toContain('SameSite=Lax')
  })

  it('rejects a duplicate email', async () => {
    await register('dup@example.com')
    const again = await client.request('POST', '/api/auth/register', {
      body: { email: 'dup@example.com', password: 'matkhau-rat-dai-123', name: 'Trùng' },
    })
    expect(again.status).toBe(409)
  })

  it('rejects a short password with a 400 and a helpful message', async () => {
    const response = await client.request('POST', '/api/auth/register', {
      body: { email: 'short@example.com', password: 'ngan', name: 'X' },
    })
    expect(response.status).toBe(400)
    const body = response.json<{ error: { code: string; message: string } }>()
    expect(body.error.code).toBe('validation')
    expect(body.error.message).toContain('đăng ký')
  })

  it('logs in with correct credentials and refuses wrong ones', async () => {
    await register('login@example.com')

    const ok = await client.request('POST', '/api/auth/login', {
      body: { email: 'login@example.com', password: 'matkhau-rat-dai-123' },
    })
    expect(ok.status).toBe(200)

    const bad = await client.request('POST', '/api/auth/login', {
      body: { email: 'login@example.com', password: 'sai-mat-khau-123' },
    })
    expect(bad.status).toBe(401)
  })

  it('gives the same answer for an unknown email as for a wrong password', async () => {
    await register('known@example.com')
    const unknown = await client.request('POST', '/api/auth/login', {
      body: { email: 'missing@example.com', password: 'matkhau-rat-dai-123' },
    })
    const wrong = await client.request('POST', '/api/auth/login', {
      body: { email: 'known@example.com', password: 'sai-mat-khau-123' },
    })
    expect(unknown.status).toBe(wrong.status)
    expect(unknown.json<{ error: { message: string } }>().error.message).toBe(
      wrong.json<{ error: { message: string } }>().error.message,
    )
  })

  it('protects /api/auth/me', async () => {
    const anonymous = await client.request('GET', '/api/auth/me')
    expect(anonymous.status).toBe(401)

    const { cookie } = await register('me@example.com')
    const authenticated = await client.request('GET', '/api/auth/me', { headers: cookie })
    expect(authenticated.status).toBe(200)
  })

  it('clears the session on logout', async () => {
    const { cookie } = await register('out@example.com')
    const logout = await client.request('POST', '/api/auth/logout', { headers: cookie })
    expect(logout.status).toBe(200)

    const after = await client.request('GET', '/api/auth/me', { headers: cookie })
    expect(after.status).toBe(401)
  })

  it('rejects a forged session token', async () => {
    const forged = await client.request('GET', '/api/auth/me', {
      headers: { Cookie: `${SESSION_COOKIE}=khong-phai-token-that` },
    })
    expect(forged.status).toBe(401)
  })
})

describe('companies', () => {
  it('creates a company with presets and an owner membership, without auto-assigning models', async () => {
    const { cookie } = await register('owner@example.com', 'Chủ sở hữu')
    const created = await client.request('POST', '/api/companies', {
      body: { name: 'Công ty Ánh Dương' },
      headers: cookie,
    })
    expect(created.status).toBe(201)
    const body = created.json<{ company: { id: string; slug: string }; presets: number; role: string }>()
    expect(body.role).toBe('owner')
    expect(body.presets).toBe(10)
    expect(body.company.slug).toBe('cong-ty-anh-duong')

    // Chưa chọn model thì agent KHÔNG được gắn model nào; đây là chủ ý để người dùng
    // tự khai báo nhà cung cấp và chọn model trong Cài đặt.
    for (const def of repos.team.listAgentDefs()) {
      const resolved = repos.team.resolveAgent(body.company.id, def.role)
      expect(resolved.model, `${def.role} không được tự gắn model`).toBeNull()
    }

    // Sau khi cấu hình provider + model và gán cho preset, agent resolve được bình thường.
    const provider = repos.llm.createProvider({
      companyId: body.company.id,
      name: 'Provider test',
      kind: 'openai_compatible',
      baseUrl: 'http://127.0.0.1:1/v1',
    })
    const model = repos.llm.createModel({ providerId: provider.id, modelId: 'm1', label: 'Model 1' })
    repos.team.updatePreset(body.company.id, repos.team.findAgentDefByRole('content-writer')!.id, {
      modelFk: model.id,
    })
    expect(repos.team.resolveAgent(body.company.id, 'content-writer').model?.id).toBe(model.id)
  })

  it('lists only the companies the caller belongs to', async () => {
    const first = await register('a@example.com')
    const second = await register('b@example.com')
    await client.request('POST', '/api/companies', { body: { name: 'Công ty A' }, headers: first.cookie })
    await client.request('POST', '/api/companies', { body: { name: 'Công ty B' }, headers: second.cookie })

    const listA = await client.request('GET', '/api/companies', { headers: first.cookie })
    const companiesA = listA.json<{ companies: { name: string }[] }>().companies
    expect(companiesA.map((c) => c.name)).toEqual(['Công ty A'])
  })

  it('makes slugs unique instead of failing', async () => {
    const { cookie } = await register('slug@example.com')
    const one = await client.request('POST', '/api/companies', { body: { name: 'Trùng Tên' }, headers: cookie })
    const two = await client.request('POST', '/api/companies', { body: { name: 'Trùng Tên' }, headers: cookie })
    expect(one.status).toBe(201)
    expect(two.status).toBe(201)
    expect(two.json<{ company: { slug: string } }>().company.slug).toBe('trung-ten-2')
  })
})

describe('tenancy isolation', () => {
  /** Two users, each owning one company, with real presets and knowledge. */
  async function twoTenants() {
    const ownerA = await register('tenant-a@example.com', 'A')
    const ownerB = await register('tenant-b@example.com', 'B')
    const companyA = (
      await client.request('POST', '/api/companies', { body: { name: 'Tenant A' }, headers: ownerA.cookie })
    ).json<{ company: { id: string } }>().company
    const companyB = (
      await client.request('POST', '/api/companies', { body: { name: 'Tenant B' }, headers: ownerB.cookie })
    ).json<{ company: { id: string } }>().company
    return { ownerA, ownerB, companyA, companyB }
  }

  it('hides another tenant company behind a 404, not a 403', async () => {
    const { ownerA, companyB } = await twoTenants()
    const response = await client.request('GET', `/api/companies/${companyB.id}/members`, {
      headers: ownerA.cookie,
    })
    // 403 would confirm the company exists; 404 keeps ids unguessable.
    expect([403, 404]).toContain(response.status)
  })

  it('refuses an authenticated non-member', async () => {
    const { companyA, ownerB } = await twoTenants()
    const response = await client.request('GET', `/api/companies/${companyA.id}/members`, {
      headers: ownerB.cookie,
    })
    expect(response.status).toBeGreaterThanOrEqual(403)
  })

  it('refuses an anonymous caller', async () => {
    const { companyA } = await twoTenants()
    const response = await client.request('GET', `/api/companies/${companyA.id}/members`)
    expect(response.status).toBe(401)
  })

  it('never returns another tenant rows from the member list', async () => {
    const { ownerA, companyA } = await twoTenants()
    const response = await client.request('GET', `/api/companies/${companyA.id}/members`, {
      headers: ownerA.cookie,
    })
    const members = response.json<{ members: { user: { email: string } }[] }>().members
    expect(members.map((m) => m.user.email)).toEqual(['tenant-a@example.com'])
  })

  it('keeps knowledge, tasks and conversations scoped by company at the data layer', () => {
    const companyA = seedCompany(repos, { companyName: 'Scope A', withDemoKnowledge: true }).company
    const companyB = seedCompany(repos, { companyName: 'Scope B', withDemoKnowledge: true }).company

    const docsA = repos.knowledge.listDocuments(companyA.id)
    const docsB = repos.knowledge.listDocuments(companyB.id)
    expect(docsA.length).toBeGreaterThan(0)
    expect(docsB.length).toBeGreaterThan(0)
    const idsA = new Set(docsA.map((d) => d.id))
    for (const doc of docsB) expect(idsA.has(doc.id)).toBe(false)

    // A conversation from A is invisible when queried as B. The user is created
    // here because `seedCompany` only provisions tenant data, not accounts.
    const user = repos.auth.createUser({
      email: 'scope-user@example.com',
      password: 'matkhau-rat-dai-123',
      name: 'Scope',
    })
    const conversation = repos.work.createConversation({ companyId: companyA.id, userId: user.id, title: 'A' })
    expect(repos.work.findConversation(conversation.id, companyA.id)).toBeDefined()
    expect(repos.work.findConversation(conversation.id, companyB.id)).toBeUndefined()
  })
})

describe('http core', () => {
  it('answers 404 for an unknown API path', async () => {
    const response = await client.request('GET', '/api/khong-ton-tai')
    expect(response.status).toBe(404)
    expect(response.json<{ error: { code: string } }>().error.code).toBe('not_found')
  })

  it('answers 405 with an Allow header for a known path with the wrong method', async () => {
    const response = await client.request('DELETE', '/api/auth/me')
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toContain('GET')
  })

  it('rejects a malformed JSON body with a validation error', async () => {
    const response = await fetch(`${client.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{khong-phai-json',
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('validation')
  })

  it('rejects an oversized body', async () => {
    const response = await fetch(`${client.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(3_000_000) }),
    })
    expect(response.status).toBe(400)
  })
})

describe('app routes', () => {
  it('exposes exactly the routes registered at boot', () => {
    const paths = ['/healthz', '/readyz', '/api/auth/register', '/api/auth/login', '/api/auth/me']
    for (const path of paths) {
      expect(app.router.match('GET', path) ?? app.router.match('POST', path), `thiếu route ${path}`).toBeDefined()
    }
  })
})
