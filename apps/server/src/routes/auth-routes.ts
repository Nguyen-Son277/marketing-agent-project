/**
 * Authentication and company directory routes.
 *
 * Registration is open (a self-hosted instance has no invitation flow), so
 * registration and login both apply the same defenses: constant-shape error
 * responses, a session cookie that is HttpOnly and Secure in production, and
 * audit records for the security-relevant actions.
 */
import {
  AppError,
  parseOrThrow,
  slugify,
  unauthorized,
  createCompanySchema,
  loginSchema,
  registerSchema,
  updateCompanySchema,
} from '@marketing-agent/shared'
import { toPublicUser, type Repos } from '@marketing-agent/db'
import { changePasswordSchema, forbidden } from '@marketing-agent/shared'
import { SESSION_COOKIE, requireAuthState, requireManage, requireMembership } from '../http/middleware.ts'
import type { RequestContext, Router } from '../http/router.ts'
import { createCompanyForUser, deleteCompany, preflight } from '../services/company-service.ts'

export function registerAuthRoutes(router: Router, repos: Repos, sessionTtlDays: number, adminEmail?: string): void {
  const auth = repos.auth

  router.post('/api/auth/register', async (ctx) => {
    const input = parseOrThrow(registerSchema, await ctx.body(), 'thông tin đăng ký')
    const user = auth.createUser({ email: input.email, password: input.password, name: input.name })
    const session = auth.createSession(user.id, sessionTtlDays)
    setSessionCookie(ctx, session.token, session.expiresAt)
    repos.accounting.audit({ userId: user.id, action: 'auth.register', target: user.email })
    ctx.json(201, {
      user: toPublicUser(user),
      companies: [],
    })
  })

  router.post('/api/auth/login', async (ctx) => {
    const input = parseOrThrow(loginSchema, await ctx.body(), 'thông tin đăng nhập')
    const authenticated = auth.authenticate(input.email, input.password)
    if (!authenticated) {
      // Same message for unknown email and wrong password: no account enumeration.
      repos.accounting.audit({ action: 'auth.login_failed', target: input.email })
      throw new AppError('unauthorized', 'Email hoặc mật khẩu không đúng', { messageKey: 'errors.auth.invalidCredentials' })
    }
    const { user, session } = repos.db.tx(() => {
      let user = authenticated
      if (adminEmail && user.email === adminEmail) {
        const promotion = auth.grantSystemAdmin(user.email)
        user = promotion.user
        if (promotion.changed) {
          repos.accounting.audit({ userId: user.id, action: 'user.grant_admin', target: user.id, payload: { source: 'ADMIN_EMAIL' } })
        }
      }
      const session = auth.createSession(user.id, sessionTtlDays)
      repos.accounting.audit({ userId: user.id, action: 'auth.login' })
      return { user, session }
    })
    setSessionCookie(ctx, session.token, session.expiresAt)
    ctx.json(200, {
      user: toPublicUser(user),
      companies: user.approvalStatus === 'approved' && !user.isAdmin && user.accountType === 'user' && !user.mustChangePassword ? auth.listCompaniesForUser(user.id) : [],
    })
  })

  router.post('/api/auth/change-password', async (ctx) => {
    const { user } = requireAuthState(ctx)
    if(user.approvalStatus !== 'approved') throw forbidden('Tài khoản chưa được duyệt')
    if(ctx.req.headers.origin && new URL(ctx.req.headers.origin).host !== ctx.req.headers.host) throw forbidden('Origin không hợp lệ')
    const input = parseOrThrow(changePasswordSchema, await ctx.body(), 'đổi mật khẩu')
    repos.db.tx(() => {
      auth.changePassword(user.id, input.currentPassword, input.newPassword)
      const session = auth.createSession(user.id, sessionTtlDays)
      setSessionCookie(ctx, session.token, session.expiresAt)
      repos.accounting.audit({userId:user.id,action:'auth.password_changed'})
    })
    ctx.json(200, {user:toPublicUser(auth.findUserById(user.id)!),companies:[]})
  })

  router.post('/api/auth/logout', async (ctx) => {
    const token = ctx.cookies()[SESSION_COOKIE]
    if (token) {
      const resolved = auth.resolveSession(token)
      if (resolved) repos.accounting.audit({ userId: resolved.user.id, action: 'auth.logout' })
      auth.deleteSessionByToken(token)
    }
    ctx.clearCookie(SESSION_COOKIE)
    ctx.json(200, { ok: true })
  })

  router.get('/api/auth/me', async (ctx) => {
    const { user } = requireAuthState(ctx)
    ctx.json(200, {
      user,
      companies: user.approvalStatus === 'approved' && !user.isAdmin && user.accountType === 'user' && !user.mustChangePassword ? auth.listCompaniesForUser(user.id) : [],
    })
  })

  router.get('/api/companies', async (ctx) => {
    const { user } = requireAuthState(ctx)
    ctx.json(200, { companies: auth.listCompaniesForUser(user.id) })
  })

  router.post('/api/companies', async (ctx) => {
    const { user } = requireAuthState(ctx)
    const input = parseOrThrow(createCompanySchema, await ctx.body(), 'thông tin công ty')
    const slug = ensureUniqueSlug(repos, input.name)
    const result = createCompanyForUser(repos, { name: input.name, slug, user })
    repos.accounting.audit({
      companyId: result.company.id,
      userId: user.id,
      action: 'company.create',
      target: input.name,
    })
    ctx.json(201, {
      company: result.company,
      role: result.role,
      presets: result.presets,
      aclEntries: result.aclEntries,
    })
  })

  /**
   * Đổi tên hiển thị công ty.
   *
   * `requireMembership` trả 404 cho người không thuộc công ty (giữ nguyên quy ước chung:
   * không lộ sự tồn tại của công ty). `requireManage` chặn `viewer`.
   *
   * Chỉ nhận `name`; slug giữ nguyên có chủ đích — xem `updateCompanyName` trong repo.
   */
  router.patch(
    '/api/companies/:companyId',
    async (ctx) => {
      const { user } = requireAuthState(ctx)
      const companyId = ctx.params.companyId!
      const input = parseOrThrow(updateCompanySchema, await ctx.body(), 'tên công ty')
      const updated = repos.auth.updateCompanyName(companyId, input.name)
      // Chỉ xảy ra khi công ty bị xoá giữa lúc kiểm quyền và lúc ghi — hiếm nhưng phải
      // trả lỗi rõ thay vì trả `company: undefined`.
      if (!updated) throw notFoundCompany()
      repos.accounting.audit({ companyId, userId: user.id, action: 'company.rename', target: input.name })
      const role = repos.auth.membership(companyId, user.id)?.role ?? 'member'
      ctx.json(200, { company: updated, role })
    },
    [requireMembership(repos), requireManage],
  )

  router.delete(
    '/api/companies/:companyId',
    async (ctx) => {
      const { user } = requireAuthState(ctx)
      const companyId = ctx.params.companyId!
      deleteCompany(repos, companyId)
      repos.accounting.audit({ userId: user.id, action: 'company.delete', target: companyId })
      ctx.json(200, { deleted: true })
    },
    [requireMembership(repos), requireManage],
  )

  /** Catalog readiness, used by the UI to guide a first-time operator. */
  router.get('/api/system/status', async (ctx) => {
    ctx.json(200, {
      ready: preflight(repos).ready,
      catalog: preflight(repos),
      appliedMigrations: repos.db.appliedMigrations ?? [],
    })
  })
}

/** Register a company membership for an existing user (owner/admin only). */
export function registerMemberRoutes(router: Router, repos: Repos): void {
  router.get(
    '/api/companies/:companyId/members',
    async (ctx) => {
      ctx.json(200, { members: repos.auth.listMembers(ctx.params.companyId!) })
    },
    [requireMembership(repos)],
  )
}

function setSessionCookie(ctx: RequestContext, token: string, expiresAt: string): void {
  const maxAgeSeconds = Math.max(60, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  ctx.setCookie(SESSION_COOKIE, token, { maxAgeSeconds, httpOnly: true, sameSite: 'Lax', path: '/' })
}

/** Append a numeric suffix when the slug is taken, so creation never collides. */
/** Lỗi dùng khi công ty biến mất giữa lúc kiểm quyền và lúc ghi. */
function notFoundCompany(): AppError {
  return new AppError('not_found', 'Không tìm thấy công ty')
}

export function ensureUniqueSlug(repos: Repos, name: string): string {
  const base = slugify(name) || 'cong-ty'
  let candidate = base
  let counter = 2
  while (repos.auth.findCompanyBySlug(candidate)) {
    candidate = `${base}-${counter}`
    counter++
    if (counter > 500) break
  }
  return candidate
}
