/**
 * Authentication, tenancy and role middleware.
 *
 * The tenancy rule is enforced in one place: any route under
 * `/api/companies/:companyId/...` runs `requireMembership`, which resolves the
 * membership from the database and never trusts a client-supplied company id.
 * Handlers below that layer receive the checked membership through
 * `ctx.state.membership`.
 */
import { AppError, forbidden, unauthorized, type CompanyRole, type MembershipRecord, type PublicUser } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import type { Middleware, RequestContext } from './router.ts'

export const SESSION_COOKIE = 'ma_session'

export interface AuthState {
  readonly user: PublicUser
  readonly sessionId: string
}

export interface TenancyState {
  readonly companyId: string
  readonly membership: MembershipRecord
  readonly role: CompanyRole
}

export function readAuth(ctx: RequestContext): AuthState | undefined {
  return ctx.state.auth as AuthState | undefined
}

/** Authenticated user, or throw 401. Use inside handlers that already passed the guard. */
export function requireAuthState(ctx: RequestContext): AuthState {
  const auth = readAuth(ctx)
  if (!auth) throw unauthorized()
  return auth
}

export function readTenancy(ctx: RequestContext): TenancyState | undefined {
  return ctx.state.tenancy as TenancyState | undefined
}

export function requireTenancyState(ctx: RequestContext): TenancyState {
  const tenancy = readTenancy(ctx)
  if (!tenancy) throw forbidden('Thiếu ngữ cảnh công ty')
  return tenancy
}

/** Resolve the session cookie into `ctx.state.auth`. Never rejects on its own. */
export function sessionMiddleware(repos: Repos): Middleware {
  return (ctx, next) => {
    const token = ctx.cookies()[SESSION_COOKIE]
    if (token) {
      const resolved = repos.auth.resolveSession(token)
      if (resolved) {
        ctx.state.auth = {
          user: {
            id: resolved.user.id,
            email: resolved.user.email,
            name: resolved.user.name,
            isAdmin: resolved.user.isAdmin,
            approvalStatus: resolved.user.approvalStatus,
            accountType: resolved.user.accountType,
            mustChangePassword: resolved.user.mustChangePassword,
          },
          sessionId: resolved.sessionId,
        } satisfies AuthState
      }
    }
    return next()
  }
}

/**
 * Hàng rào toàn API, không phụ thuộc việc từng route nhớ kiểm tra trạng thái duyệt.
 * Chỉ các route auth tối thiểu và thông tin sức khoẻ được đi qua khi user pending.
 */
export const accountAccessMiddleware: Middleware = (ctx, next) => {
  const path = ctx.url.pathname
  const publicPaths = new Set(['/healthz', '/readyz', '/api/system/status', '/api/auth/register', '/api/auth/login', '/api/auth/logout', '/api/auth/me'])
  if (!path.startsWith('/api/') || publicPaths.has(path)
    || (/^\/api\/public\/daily-reports\/[A-Za-z0-9_-]{43}$/.test(path) && (ctx.method === 'GET' || ctx.method === 'POST'))
    || (/^\/api\/public\/daily-reports\/[A-Za-z0-9_-]{43}\/members\/[A-Za-z0-9_-]+$/.test(path) && ctx.method === 'GET')
    || (/^\/api\/public\/daily-report-views\/[A-Za-z0-9_-]{43}$/.test(path) && ctx.method === 'GET')) return next()
  const auth = readAuth(ctx)
  if (!auth) throw unauthorized()
  if (auth.user.approvalStatus !== 'approved') {
    throw new AppError('forbidden', 'Tài khoản đang chờ admin duyệt.', { messageKey: 'errors.auth.accountPending' })
  }
  if (auth.user.mustChangePassword && path !== '/api/auth/change-password') {
    throw forbidden('Cần đổi mật khẩu lần đầu trước khi sử dụng')
  }
  if (auth.user.accountType === 'employee' && !path.startsWith('/api/workforce/') && path !== '/api/auth/change-password') {
    throw forbidden('Tài khoản nhân viên chỉ được xem và báo cáo việc được giao')
  }
  if (auth.user.isAdmin && !path.startsWith('/api/admin/')) {
    throw new AppError('forbidden', 'Tài khoản admin chỉ sử dụng chức năng duyệt tài khoản.', { messageKey: 'errors.auth.adminOnlyApproval' })
  }
  return next()
}

/** Admin hệ thống độc lập với vai trò admin công ty, không cho owner công ty đi qua. */
export const requireSystemAdmin: Middleware = (ctx, next) => {
  const { user } = requireAuthState(ctx)
  if (!user.isAdmin || user.approvalStatus !== 'approved') throw forbidden('Cần quyền admin hệ thống')
  return next()
}

/** Reject anonymous requests. */
export const requireAuth: Middleware = (ctx, next) => {
  if (!readAuth(ctx)) throw unauthorized()
  return next()
}

/**
 * Resolve and check membership for `:companyId`, then hand it to the handler.
 * A non-member receives 404 rather than 403 so tenants cannot enumerate each
 * other's company ids.
 */
export function requireMembership(repos: Repos): Middleware {
  return (ctx, next) => {
    const auth = readAuth(ctx)
    if (!auth) throw unauthorized()
    const companyId = ctx.params.companyId
    if (!companyId) throw new AppError('internal', 'Route thiếu tham số :companyId')
    const membership = repos.auth.membership(companyId, auth.user.id)
    if (!membership) {
      /**
       * Cả hai trường hợp đều trả 404, và đây là chủ đích bảo mật chứ không phải sơ suất.
       *
       * Trước đây nhánh "công ty có tồn tại nhưng người này không thuộc" trả 403, còn
       * "không có công ty" trả 404 — nghĩa là chỉ cần thử một id, người ngoài biết được
       * công ty đó có tồn tại hay không. Khi mỗi tài khoản có thể thuộc nhiều công ty,
       * việc dò được id công ty của người khác là thông tin không nên lộ.
       *
       * Thông điệp vẫn phân biệt được ý nghĩa cho người vận hành đọc log, nhưng mã trạng
       * thái thì không.
       */
      const exists = repos.auth.findCompanyById(companyId) !== undefined
      throw new AppError(
        'not_found',
        exists ? 'Bạn không thuộc công ty này' : 'Không tìm thấy công ty',
      )
    }
    ctx.state.tenancy = {
      companyId,
      membership,
      role: membership.role,
    } satisfies TenancyState
    return next()
  }
}

/** Require one of the given company roles. */
export function requireRole(...roles: readonly CompanyRole[]): Middleware {
  return (ctx, next) => {
    const tenancy = requireTenancyState(ctx)
    if (!roles.includes(tenancy.role)) {
      throw forbidden(`Cần quyền ${roles.join(' hoặc ')} để thực hiện thao tác này`)
    }
    return next()
  }
}

/** Owner/admin only: configuration changes. */
export const requireManage = requireRole('owner', 'admin')

/** Everyone except viewers: starting work, sending messages, approving output. */
export const requireWork = requireRole('owner', 'admin', 'member')
