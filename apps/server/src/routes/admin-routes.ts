/**
 * Admin hệ thống chỉ duyệt user, không quản trị dữ liệu của công ty.
 * Ghi duyệt và audit cùng transaction để không có quyền đã đổi nhưng thiếu dấu vết.
 */
import { toPublicUser, type Repos } from '@marketing-agent/db'
import { forbidden, validation, type ApprovalStatus } from '@marketing-agent/shared'
import { requireAuthState, requireSystemAdmin } from '../http/middleware.ts'
import type { Router } from '../http/router.ts'

export function registerAdminRoutes(router: Router, repos: Repos): void {
  router.get('/api/admin/users', (ctx) => {
    const status = ctx.query('status') ?? 'pending'
    if (status !== 'pending' && status !== 'approved') throw validation('Trạng thái không hợp lệ')
    const page = Number(ctx.query('page') ?? 1)
    const pageSize = Number(ctx.query('pageSize') ?? 20)
    const q = (ctx.query('q') ?? '').trim()
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 || q.length > 120) {
      throw validation('Phân trang hoặc từ khoá không hợp lệ')
    }
    const result = repos.auth.listUsersForApproval({ status: status as ApprovalStatus, q, page, pageSize })
    ctx.json(200, { ...result, page, pageSize })
  }, [requireSystemAdmin])

  router.post('/api/admin/users/:userId/approve', (ctx) => {
    // SameSite cookie có sẵn; kiểm Origin bổ sung cho thao tác thay quyền này.
    const origin = ctx.req.headers.origin
    if (origin) {
      let host: string
      try { host = new URL(origin).host } catch { throw forbidden('Origin không hợp lệ') }
      if (host !== ctx.req.headers.host) throw forbidden('Không chấp nhận thao tác từ trang khác')
    }
    const { user: admin } = requireAuthState(ctx)
    const result = repos.db.tx(() => {
      const result = repos.auth.approveUser(ctx.params.userId!, admin.id)
      if (result.changed) {
        repos.accounting.audit({ userId: admin.id, action: 'user.approve', target: result.user.id })
      }
      return result
    })
    ctx.json(200, { user: toPublicUser(result.user), changed: result.changed })
  }, [requireSystemAdmin])
}
