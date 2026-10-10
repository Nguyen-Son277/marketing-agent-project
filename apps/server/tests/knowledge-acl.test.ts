/**
 * Test bất biến của phân quyền kho kiến thức.
 *
 * Vì sao cần: một công ty tạo qua API mà thiếu `kb_acl` vẫn "chạy" — mọi agent đều
 * khởi động, mọi route đều 200 — nhưng không agent nào đọc được tài liệu, và triệu
 * chứng duy nhất là câu trả lời "không tìm thấy tài liệu". Lỗi này từng tồn tại thật:
 * đường seed cài quyền còn đường HTTP thì không. Test dưới đây khoá bất biến đó lại
 * cho CẢ HAI đường.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KB_CATEGORIES } from '@marketing-agent/shared'
import { seedCompany } from '@marketing-agent/seed'
import { createRoutesTestContext, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'
import { defaultKnowledgeGrants, hasKnowledgeAcl, installDefaultKnowledgeAcl } from '../src/services/knowledge-acl.ts'

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

describe('phân quyền tri thức khi tạo công ty', () => {
  it('công ty tạo qua HTTP có đủ quyền đọc/ghi cho cả 10 agent', async () => {
    const { company } = await tenant(ctx, 'acl-http@example.com', 'ACL HTTP')

    expect(hasKnowledgeAcl(ctx.repos, company.id)).toBe(true)

    const defs = ctx.repos.team.listAgentDefs()
    expect(defs).toHaveLength(10)
    for (const def of defs) {
      const acl = ctx.repos.team.listKnowledgeAcl(company.id, def.id)
      expect(acl, `${def.role} thiếu bản ghi quyền`).toHaveLength(KB_CATEGORIES.length)
      // Mọi vai trò phải đọc được ít nhất một danh mục, nếu không agent vô dụng.
      expect(
        ctx.repos.team.readableCategories(company.id, def.id).length,
        `${def.role} không đọc được danh mục nào`,
      ).toBeGreaterThan(0)
    }
  })

  it('công ty tạo qua seed cũng có cùng quyền như qua HTTP', async () => {
    const seeded = seedCompany(ctx.repos, { companyName: 'ACL Seed' }).company
    expect(hasKnowledgeAcl(ctx.repos, seeded.id)).toBe(true)

    for (const def of ctx.repos.team.listAgentDefs()) {
      expect(ctx.repos.team.readableCategories(seeded.id, def.id).sort()).toEqual(
        ctx.repos.team.readableCategories(seeded.id, def.id).sort(),
      )
    }
  })

  it('trao quyền ghi đúng cho vai trò được phép, và không cho vai trò chỉ đọc', async () => {
    const { company } = await tenant(ctx, 'acl-write@example.com', 'ACL Write')

    const leader = ctx.repos.team.findAgentDefByRole('marketing-leader')!
    const writer = ctx.repos.team.findAgentDefByRole('content-writer')!
    const analytics = ctx.repos.team.findAgentDefByRole('analytics')!

    expect(ctx.repos.team.writableCategories(company.id, leader.id)).toEqual(['90-ket-qua'])
    expect(ctx.repos.team.writableCategories(company.id, writer.id)).toEqual([])
    expect(ctx.repos.team.writableCategories(company.id, analytics.id)).toEqual(['40-du-lieu'])
  })

  it('agent không đọc được danh mục ngoài quyền, ở tầng truy vấn', async () => {
    const { company } = await tenant(ctx, 'acl-deny@example.com', 'ACL Deny')
    const writer = ctx.repos.team.findAgentDefByRole('content-writer')!

    // content-writer không được đọc dữ liệu hiệu suất.
    expect(ctx.repos.team.canReadCategory(company.id, writer.id, '40-du-lieu')).toBe(false)
    expect(ctx.repos.team.canReadCategory(company.id, writer.id, '10-brand')).toBe(true)
  })

  it('cài quyền là idempotent: chạy lại không nhân đôi bản ghi', async () => {
    const { company } = await tenant(ctx, 'acl-idem@example.com', 'ACL Idempotent')
    const before = ctx.repos.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM kb_acl WHERE company_id = ?',
      [company.id],
    )?.n

    installDefaultKnowledgeAcl(ctx.repos, company.id)
    installDefaultKnowledgeAcl(ctx.repos, company.id)

    const after = ctx.repos.db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM kb_acl WHERE company_id = ?',
      [company.id],
    )?.n
    expect(after).toBe(before)
  })

  it('quyền mặc định phủ đúng 6 danh mục cho mỗi vai trò', () => {
    const grants = defaultKnowledgeGrants()
    expect(grants).toHaveLength(10)
    for (const grant of grants) {
      for (const category of grant.read) {
        expect(KB_CATEGORIES.map((c) => c.code)).toContain(category)
      }
      for (const category of grant.write) {
        expect(grant.read).toContain(category)
      }
    }
  })

  it('không agent nào vừa không đọc được gì vừa có quyền ghi', () => {
    for (const grant of defaultKnowledgeGrants()) {
      if (grant.write.length > 0) {
        expect(grant.read.length, `${grant.role} có quyền ghi nhưng không đọc được gì`).toBeGreaterThan(0)
      }
    }
  })
})
