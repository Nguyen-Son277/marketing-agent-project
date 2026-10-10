/**
 * Kiểm tra quyền cho những đường dẫn KHÔNG chứa `companyId`.
 *
 * Vì sao cần lớp trung gian này: `/api/conversations/:id`, `/api/tasks/:taskId`,
 * `/api/artifacts/:artifactId` được giao diện gọi trực tiếp (id đã biết sau khi
 * tạo), nên không thể dùng `requireMembership` — middleware đó đọc `:companyId`
 * từ đường dẫn. Cách duy nhất an toàn là tra ngược bản ghi ra công ty rồi mới
 * kiểm membership, và làm đúng ở MỘT chỗ để không route nào quên.
 *
 * Nguyên tắc "fail closed": không tìm thấy bản ghi, hoặc tìm thấy nhưng người gọi
 * không thuộc công ty sở hữu, đều trả 404 thay vì 403. 403 sẽ xác nhận tài nguyên
 * tồn tại và cho phép dò id giữa các tenant.
 */
import { notFound, unauthorized } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import type { Middleware, RequestContext } from '../http/router.ts'
import type { TenancyState } from '../http/middleware.ts'
import { readAuth } from '../http/middleware.ts'

/** Tra công ty sở hữu một bản ghi theo khoá chính. `table` luôn là hằng nội bộ. */
function ownerCompanyId(repos: Repos, table: 'conversations' | 'tasks' | 'artifacts', id: string): string | undefined {
  const row = repos.db.get<{ company_id: string }>(`SELECT company_id FROM ${table} WHERE id = ?`, [id])
  return row?.company_id
}

function buildMembershipMiddleware(
  repos: Repos,
  table: 'conversations' | 'tasks' | 'artifacts',
  param: string,
  missingMessage: string,
): Middleware {
  return (ctx: RequestContext, next) => {
    const id = ctx.params[param]
    if (!id) throw notFound(missingMessage)
    const auth = readAuth(ctx)
    if (!auth) throw unauthorized()
    const companyId = ownerCompanyId(repos, table, id)
    if (!companyId) throw notFound(missingMessage)
    const membership = repos.auth.membership(companyId, auth.user.id)
    if (!membership) throw notFound(missingMessage)
    ctx.state.tenancy = { companyId, membership, role: membership.role } satisfies TenancyState
    return next()
  }
}

/** Membership cho `/api/conversations/:id/...`, đặt `ctx.state.tenancy` như requireMembership. */
export function conversationMembership(repos: Repos): Middleware {
  return buildMembershipMiddleware(repos, 'conversations', 'id', 'Không tìm thấy cuộc trao đổi')
}

/** Membership cho `/api/tasks/:taskId/...`. */
export function taskMembership(repos: Repos): Middleware {
  return buildMembershipMiddleware(repos, 'tasks', 'taskId', 'Không tìm thấy công việc')
}

/** Membership cho `/api/artifacts/:artifactId`. */
export function artifactMembership(repos: Repos): Middleware {
  return buildMembershipMiddleware(repos, 'artifacts', 'artifactId', 'Không tìm thấy tài sản đầu ra')
}
