/** Test qua HTTP thật: UI không phải hàng rào bảo mật cho tài khoản chưa được duyệt. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoutesTestContext, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'
import { SESSION_COOKIE } from '../src/http/middleware.ts'
import { cookieHeader } from './helpers/test-client.ts'

let ctx: RoutesTestContext
const password = 'approval-password-123'
beforeEach(async () => { ctx = await createRoutesTestContext() })
afterEach(async () => { await ctx.close() })

async function signup(email = 'pending@example.com', extras = {}) {
  const response = await ctx.client.request('POST', '/api/auth/register', { body: { email, password, name: 'Pending user', ...extras } })
  expect(response.status).toBe(201)
  return { response, cookie: cookieHeader(response, SESSION_COOKIE), user: ctx.repos.auth.findUserByEmail(email)! }
}
async function adminCookie() {
  const admin = ctx.repos.auth.createUser({ email: 'system-admin@example.com', password, name: 'Admin', isAdmin: true, approvalStatus: 'approved' })
  const session = ctx.repos.auth.createSession(admin.id)
  return { admin, cookie: { Cookie: `${SESSION_COOKIE}=${session.token}` } }
}

describe('đăng ký chờ duyệt và hàng rào API', () => {
  it('user mới pending, đăng nhập/me được nhưng không lấy dữ liệu công ty', async () => {
    const { response, cookie, user } = await signup()
    expect(response.json<{ user: { approvalStatus: string }; companies: unknown[] }>().user.approvalStatus).toBe('pending')
    expect(user.isAdmin).toBe(false)
    const me = await ctx.client.request('GET', '/api/auth/me', { headers: cookie })
    expect(me.status).toBe(200)
    expect(me.json<{ companies: unknown[] }>().companies).toEqual([])
    const login = await ctx.client.request('POST', '/api/auth/login', { body: { email: user.email, password } })
    expect(login.status).toBe(200)
    expect(login.json<{ user: { approvalStatus: string } }>().user.approvalStatus).toBe('pending')
  })

  it('không tin quyền admin/trạng thái client gửi khi đăng ký', async () => {
    const { user } = await signup('forged@example.com', { isAdmin: true, approvalStatus: 'approved' })
    expect(user.isAdmin).toBe(false)
    expect(user.approvalStatus).toBe('pending')
  })

  it('pending bị chặn tất cả API nghiệp vụ và SSE kể cả có membership hợp lệ', async () => {
    const { cookie, user } = await signup()
    const owner = await tenant(ctx, 'owner@example.com', 'Company')
    ctx.repos.auth.addMembership(owner.company.id, user.id, 'owner')
    const conv = ctx.repos.work.createConversation({ companyId: owner.company.id, userId: user.id, title: 'Existing' })
    for (const path of ['/api/companies', `/api/companies/${owner.company.id}/dashboard`, `/api/companies/${owner.company.id}/providers`, `/api/companies/${owner.company.id}/tasks`, `/api/companies/${owner.company.id}/knowledge`, `/api/conversations/${conv.id}`, `/api/conversations/${conv.id}/stream`]) {
      const r = await ctx.client.request('GET', path, { headers: { ...cookie, 'Accept-Language': 'en' } })
      expect(r.status, path).toBe(403)
      expect(r.json<{ error: { messageKey: string; message: string } }>().error.messageKey).toBe('errors.auth.accountPending')
      expect(r.json<{ error: { message: string } }>().error.message).toContain('awaiting')
    }
    const create = await ctx.client.request('POST', '/api/companies', { headers: cookie, body: { name: 'Forbidden' } })
    expect(create.status).toBe(403)
    expect((await ctx.client.request('POST', '/api/auth/logout', { headers: cookie })).status).toBe(200)
  })
})

describe('duyệt chỉ dành cho admin hệ thống', () => {
  it('anonymous 401, owner và admin công ty 403', async () => {
    const { user } = await signup()
    const owner = await tenant(ctx, 'owner@example.com', 'Company')
    ctx.repos.db.run("UPDATE memberships SET role = 'admin' WHERE company_id = ?", [owner.company.id])
    expect((await ctx.client.request('GET', '/api/admin/users')).status).toBe(401)
    expect((await ctx.client.request('GET', '/api/admin/users', { headers: owner.ownerCookie })).status).toBe(403)
    expect((await ctx.client.request('POST', `/api/admin/users/${user.id}/approve`, { headers: owner.ownerCookie, body: {} })).status).toBe(403)
  })

  it('duyệt có audit đúng một lần; cùng phiên user lập tức dùng được', async () => {
    const { cookie, user } = await signup()
    const { admin, cookie: adminHeaders } = await adminCookie()
    const route = `/api/admin/users/${user.id}/approve`
    const first = await ctx.client.request('POST', route, { headers: adminHeaders, body: {} })
    expect(first.status).toBe(200)
    expect(first.json<{ changed: boolean }>().changed).toBe(true)
    const approved = ctx.repos.auth.findUserById(user.id)!
    expect(approved.approvalStatus).toBe('approved')
    expect(approved.approvedBy).toBe(admin.id)
    expect(approved.approvedAt).toBeTruthy()
    const second = await ctx.client.request('POST', route, { headers: adminHeaders, body: {} })
    expect(second.json<{ changed: boolean }>().changed).toBe(false)
    expect(ctx.repos.auth.findUserById(user.id)?.approvedAt).toBe(approved.approvedAt)
    expect(ctx.repos.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'user.approve' AND target = ?", [user.id])?.n).toBe(1)
    expect((await ctx.client.request('POST', '/api/companies', { headers: cookie, body: { name: 'Now allowed' } })).status).toBe(201)
    const other = await signup('other@example.com')
    expect((await ctx.client.request('GET', '/api/companies', { headers: other.cookie })).status).toBe(403)
  })

  it('danh sách phân trang, tìm kiếm, không lộ hash/token', async () => {
    await signup('first@example.com')
    await signup('second@example.com')
    const { cookie } = await adminCookie()
    const r = await ctx.client.request('GET', '/api/admin/users?status=pending&q=example.com&page=1&pageSize=1', { headers: cookie })
    const data = r.json<{ users: { email: string }[]; total: number }>()
    expect(data.total).toBe(2)
    expect(data.users).toHaveLength(1)
    expect(r.body).not.toMatch(/password|token|scrypt/)
    const literal = await ctx.client.request('GET', '/api/admin/users?q=%25', { headers: cookie })
    expect(literal.json<{ total: number }>().total).toBe(0)
    expect((await ctx.client.request('GET', '/api/admin/users?pageSize=999', { headers: cookie })).status).toBe(400)
    expect((await ctx.client.request('POST', '/api/admin/users/unknown/approve', { headers: cookie, body: {} })).status).toBe(404)
  })

  it('admin pending cũng bị chặn, không dùng isAdmin để vượt trạng thái duyệt', async () => {
    const user = ctx.repos.auth.createUser({ email: 'admin-pending@example.com', password, name: 'Admin pending', isAdmin: true })
    const session = ctx.repos.auth.createSession(user.id)
    const result = await ctx.client.request('GET', '/api/admin/users', { headers: { Cookie: `${SESSION_COOKIE}=${session.token}` } })
    expect(result.status).toBe(403)
    expect(result.json<{ error: { messageKey: string } }>().error.messageKey).toBe('errors.auth.accountPending')
  })

  it('lỗi ghi audit rollback cả trạng thái duyệt', async () => {
    const { user } = await signup()
    const { admin } = await adminCookie()
    expect(() => ctx.repos.db.tx(() => {
      ctx.repos.auth.approveUser(user.id, admin.id)
      throw new Error('audit failed')
    })).toThrow('audit failed')
    expect(ctx.repos.auth.findUserById(user.id)?.approvalStatus).toBe('pending')
    expect(ctx.repos.auth.findUserById(user.id)?.approvedAt).toBeNull()
  })

  it('admin không cần công ty, không dùng API marketing; Origin lạ bị từ chối', async () => {
    const { user } = await signup()
    const { cookie } = await adminCookie()
    expect((await ctx.client.request('GET', '/api/auth/me', { headers: cookie })).json<{ companies: unknown[] }>().companies).toEqual([])
    expect((await ctx.client.request('GET', '/api/companies', { headers: cookie })).status).toBe(403)
    const result = await ctx.client.request('POST', `/api/admin/users/${user.id}/approve`, { headers: { ...cookie, Origin: 'https://evil.example' }, body: {} })
    expect(result.status).toBe(403)
    expect(ctx.repos.auth.findUserById(user.id)?.approvalStatus).toBe('pending')
  })
})
