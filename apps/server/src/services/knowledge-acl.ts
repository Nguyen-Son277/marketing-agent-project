/**
 * Cài phân quyền kho kiến thức (kb_acl) cho một công ty.
 *
 * Vì sao cần hàm riêng thay vì để nơi tạo công ty tự làm: quyền tri thức là thứ
 * quyết định agent có đọc được tài liệu hay không. Một công ty tạo qua API mà thiếu
 * bước này sẽ có 0 grant, nghĩa là mọi agent chạy nhưng không đọc được gì — hệ thống
 * trông vẫn hoạt động nên lỗi này rất dễ lọt. Tập trung một chỗ để cả đường seed lẫn
 * đường HTTP dùng chung, và để test có thể khẳng định bất biến.
 *
 * Đây là điểm giao thoa duy nhất giữa catalog seed (nguồn sự thật về vai trò nào đọc
 * danh mục nào) và tầng server. `apps/server` được phép phụ thuộc package seed vì cả
 * hai đều là mã triển khai, không phải thư viện dùng chung.
 */
import { KB_CATEGORIES, type AgentRole } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { AGENT_DEF_SEEDS, expandKnowledgeRead } from '@marketing-agent/seed'

const ALL_CATEGORIES: readonly string[] = KB_CATEGORIES.map((category) => category.code)

/** Quyền đọc/ghi mong đợi của một vai trò, suy từ định nghĩa agent toàn cục. */
export interface KnowledgeGrant {
  readonly role: AgentRole
  readonly read: readonly string[]
  readonly write: readonly string[]
}

/** Quyền mặc định của mọi vai trò. Dùng cho test và cho giao diện giải thích. */
export function defaultKnowledgeGrants(): KnowledgeGrant[] {
  return AGENT_DEF_SEEDS.map((def) => ({
    role: def.role,
    read: expandKnowledgeRead(def.knowledgeRead, ALL_CATEGORIES),
    write: [...def.knowledgeWrite],
  }))
}

/**
 * Ghi kb_acl cho mọi agent của công ty. Idempotent: chạy lại ghi đè bằng đúng quyền
 * mặc định, nên gọi được ở cả lúc tạo công ty lẫn lúc sửa lỗi cấu hình.
 *
 * @returns số bản ghi quyền đã ghi.
 */
export function installDefaultKnowledgeAcl(repos: Repos, companyId: string): number {
  let written = 0
  for (const grant of defaultKnowledgeGrants()) {
    const agentDef = repos.team.findAgentDefByRole(grant.role)
    if (!agentDef) continue
    const readable = new Set(grant.read)
    const writable = new Set(grant.write)
    repos.team.setKnowledgeAcl(
      companyId,
      agentDef.id,
      ALL_CATEGORIES.map((category) => ({
        category,
        canRead: readable.has(category),
        canWrite: writable.has(category),
      })),
    )
    written += ALL_CATEGORIES.length
  }
  return written
}

/**
 * Kiểm tra một công ty đã có phân quyền tri thức chưa.
 *
 * Dùng ở `/readyz` và ở test để phát hiện sớm công ty được tạo mà thiếu quyền — nếu
 * không, triệu chứng duy nhất là agent trả lời "không tìm thấy tài liệu".
 */
export function hasKnowledgeAcl(repos: Repos, companyId: string): boolean {
  const row = repos.db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM kb_acl WHERE company_id = ?',
    [companyId],
  )
  return (row?.n ?? 0) > 0
}
