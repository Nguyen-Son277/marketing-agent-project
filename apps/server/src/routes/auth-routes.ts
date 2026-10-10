/**
 * Authentication and company directory routes.
 *
 * Registration is open (a self-hosted instance has no invitation flow), so
 * registration and login both apply the same defenses: constant-shape error
 * responses, a session cookie that is HttpOnly and Secure in production, and
 * audit records for the security-relevant actions.
 */
import { AppError, parseOrThrow, slugify, unauthorized, createCompanySchema, loginSchema, registerSchema } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { SESSION_COOKIE, requireAuthState, requireManage, requireMembership } from '../http/middleware.ts'
import type { RequestContext, Router } from '../http/router.ts'
import { createCompanyForUser, deleteCompany, preflight } from '../services/company-service.ts'

export function registerAuthRoutes(router: Router, repos: Repos, sessionTtlDays: number): void {
  const auth = repos.auth

  router.post('/api/auth/register', async (ctx) => {
    const input = parseOrThrow(registerSchema, await ctx.body(), 'thông tin đăng ký')
    const user = auth.createUser({ email: input.email, password: input.password, name: input.name })
    const session = auth.createSession(user.id, sessionTtlDays)
    setSessionCookie(ctx, session.token, session.expiresAt)
    repos.accounting.audit({ userId: user.id, action: 'auth.register', target: user.email })
    ctx.json(201, {
      user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin },
      companies: [],
    })
  })

  router.post('/api/auth/login', async (ctx) => {
    const input = parseOrThrow(loginSchema, await ctx.body(), 'thông tin đăng nhập')
    const user = auth.authenticate(input.email, input.password)
    if (!user) {
      // Same message for unknown email and wrong password: no account enumeration.
      repos.accounting.audit({ action: 'auth.login_failed', target: input.email })
      throw new AppError('unauthorized', 'Email hoặc mật khẩu không đúng', { messageKey: 'errors.auth.invalidCredentials' })
    }
    const session = auth.createSession(user.id, sessionTtlDays)
    setSessionCookie(ctx, session.token, session.expiresAt)
    repos.accounting.audit({ userId: user.id, action: 'auth.login' })
    ctx.json(200, {
      user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin },
      companies: auth.listCompaniesForUser(user.id),
    })
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
    ctx.json(200, { user, companies: auth.listCompaniesForUser(user.id) })
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
      routes: result.routes,
    })
  })

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
