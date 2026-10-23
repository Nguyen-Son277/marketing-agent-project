import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { buildApp } from '../src/app.ts'
import { SESSION_COOKIE } from '../src/http/middleware.ts'
import { createRoutesTestContext, type RoutesTestContext } from './helpers/routes-helpers.ts'
import { cookieHeader, startTestServer } from './helpers/test-client.ts'

const email = 'bootstrap-admin@example.com'
const password = 'bootstrap-password-123'
let ctx: RoutesTestContext

beforeEach(async () => {
  vi.stubEnv('ADMIN_EMAIL', '  Bootstrap-Admin@Example.COM  ')
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await ctx.close()
  vi.unstubAllEnvs()
})

async function register(accountEmail = email) {
  return ctx.client.request('POST', '/api/auth/register', {
    body: { email: accountEmail, password, name: 'Administrator' },
  })
}

async function login(accountEmail = email, accountPassword = password) {
  return ctx.client.request('POST', '/api/auth/login', {
    body: { email: accountEmail, password: accountPassword },
  })
}

function promotions() {
  return ctx.repos.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'user.grant_admin'")!.n
}

describe('admin được cấu hình qua ADMIN_EMAIL', () => {
  it('chuẩn hoá email và từ chối cấu hình email không hợp lệ', () => {
    expect(ctx.app.context.config.adminEmail).toBe(email)
    expect(() => loadConfig({ appSecret: 'test-secret-123456789', adminEmail: 'invalid-email' })).toThrow('ADMIN_EMAIL')
    expect(loadConfig({ appSecret: 'test-secret-123456789', adminEmail: ' ' }).adminEmail).toBeUndefined()
  })

  it('đăng ký vẫn pending; đăng nhập đúng mật khẩu cấp admin và mở API quản trị ngay', async () => {
    const signup = await register()
    expect(signup.status).toBe(201)
    expect(signup.json<{ user: object }>().user).toMatchObject({ isAdmin: false, approvalStatus: 'pending' })
    expect((await ctx.client.request('GET', '/api/admin/users', { headers: cookieHeader(signup, SESSION_COOKIE) })).status).toBe(403)

    const hash = ctx.repos.auth.findUserByEmail(email)!.passwordHash
    const response = await login('  BOOTSTRAP-ADMIN@EXAMPLE.COM  ')
    expect(response.status).toBe(200)
    expect(response.json<{ user: object; companies: unknown[] }>()).toMatchObject({
      user: { email, isAdmin: true, approvalStatus: 'approved' },
      companies: [],
    })
    const user = ctx.repos.auth.findUserByEmail(email)!
    expect(user.passwordHash).toBe(hash)
    expect(user.approvedAt).toBeTruthy()
    expect(promotions()).toBe(1)
    const headers = cookieHeader(response, SESSION_COOKIE)
    expect((await ctx.client.request('GET', '/api/admin/users', { headers })).status).toBe(200)
    expect((await ctx.client.request('GET', '/api/auth/me', { headers })).json<{ user: object }>().user).toMatchObject({ isAdmin: true })
    expect((await ctx.client.request('GET', '/api/companies', { headers })).status).toBe(403)
  })

  it('sai mật khẩu hoặc email chưa đăng ký không cấp quyền hay tạo phiên', async () => {
    expect((await login()).status).toBe(401)
    await register()
    const response = await login(email, 'incorrect-password')
    expect(response.status).toBe(401)
    expect(response.cookie(SESSION_COOKIE)).toBeUndefined()
    expect(ctx.repos.auth.findUserByEmail(email)).toMatchObject({ isAdmin: false, approvalStatus: 'pending' })
    expect(promotions()).toBe(0)
  })

  it('email khác và quyền giả trong request không được nâng làm admin', async () => {
    const response = await ctx.client.request('POST', '/api/auth/register', {
      body: { email: 'other@example.com', password, name: 'Other', isAdmin: true, adminEmail: 'other@example.com' },
    })
    expect(response.status).toBe(201)
    expect((await login('other@example.com')).json<{ user: object }>().user).toMatchObject({ isAdmin: false, approvalStatus: 'pending' })
    expect(promotions()).toBe(0)
  })

  it('đăng ký trùng email trước và sau cấp quyền đều bị từ chối, không đổi mật khẩu', async () => {
    await register()
    const original = ctx.repos.auth.findUserByEmail(email)!
    const duplicate = () => ctx.client.request('POST', '/api/auth/register', {
      body: { email: '  BOOTSTRAP-ADMIN@EXAMPLE.COM  ', password: 'replacement-password', name: 'Replacement' },
    })
    expect((await duplicate()).status).toBe(409)
    await login()
    expect((await duplicate()).status).toBe(409)
    expect(ctx.repos.auth.findUserByEmail(email)).toMatchObject({ id: original.id, passwordHash: original.passwordHash, name: original.name, isAdmin: true })
    expect(ctx.repos.auth.authenticate(email, 'replacement-password')).toBeUndefined()
  })

  it('đăng nhập đồng thời và đăng nhập lại chỉ ghi audit cấp admin một lần', async () => {
    await register()
    const responses = await Promise.all([login(), login()])
    for (const response of responses) expect(response.status).toBe(200)
    const approvedAt = ctx.repos.auth.findUserByEmail(email)!.approvedAt
    expect((await login()).status).toBe(200)
    expect(promotions()).toBe(1)
    expect(ctx.repos.auth.findUserByEmail(email)!.approvedAt).toBe(approvedAt)
  })

  it('không cấu hình ADMIN_EMAIL thì không cấp quyền; admin đã lưu vẫn giữ quyền', async () => {
    await register()
    const app = buildApp({ context: { ...ctx.app.context, config: { ...ctx.app.context.config, adminEmail: undefined } } })
    const client = await startTestServer(app)
    try {
      const body = { email, password }
      const ordinary = await client.request('POST', '/api/auth/login', { body })
      expect(ordinary.json<{ user: object }>().user).toMatchObject({ isAdmin: false, approvalStatus: 'pending' })
      await login()
      const persisted = await client.request('POST', '/api/auth/login', { body })
      expect(persisted.json<{ user: object }>().user).toMatchObject({ isAdmin: true, approvalStatus: 'approved' })
      expect(promotions()).toBe(1)
    } finally {
      await client.close()
    }
  })

  it('lỗi audit rollback quyền admin và không trả cookie đăng nhập', async () => {
    await register()
    const sessionsBefore = ctx.repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM auth_sessions')!.n
    vi.spyOn(ctx.repos.accounting, 'audit').mockImplementation(() => { throw new Error('audit unavailable') })
    const response = await login()
    expect(response.status).toBe(500)
    expect(response.cookie(SESSION_COOKIE)).toBeUndefined()
    expect(ctx.repos.auth.findUserByEmail(email)).toMatchObject({ isAdmin: false, approvalStatus: 'pending', approvedAt: null })
    expect(ctx.repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM auth_sessions')!.n).toBe(sessionsBefore)
    expect(promotions()).toBe(0)
  })
})
