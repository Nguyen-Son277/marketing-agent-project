/**
 * Test nhiều công ty trên một tài khoản, và tính tách biệt của cài đặt theo công ty.
 *
 * Vì sao cần bộ test riêng: "một tài khoản chưa tạo được nhiều công ty" là một báo lỗi
 * người dùng, và câu trả lời đúng không phải "backend không chặn" mà là bằng chứng chạy
 * được. Đồng thời người dùng còn yêu cầu "tách cài đặt theo công ty" — điều đó chỉ được
 * chứng minh bằng cách ghi ở công ty A rồi đọc ở công ty B và thấy B vẫn mặc định.
 *
 * Bất biến quan trọng nhất là slug: nó là tên thư mục kho kiến thức trên đĩa và là khoá
 * tra tài liệu đã index, nên đổi tên hiển thị KHÔNG được đổi slug.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addMember,
  createCompany,
  createRoutesTestContext,
  errorCode,
  registerUser,
  tenant,
  type RoutesTestContext,
} from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

/** Giá trị mặc định của giới hạn vận hành (đọc từ hành vi, không import nội bộ). */
const DEFAULTS = {
  dailyCostUsd: 20,
  taskCostUsd: 2,
  maxStepsPerRun: 12,
  maxPeerRounds: 3,
  maxRevisionsPerTask: 2,
  maxParallelTasks: 3,
}

describe('đổi tên công ty', () => {
  it('chủ sở hữu đổi được tên, và SLUG KHÔNG ĐỔI', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'rename-owner@example.com', 'Công ty Ban Đầu')
    const originalSlug = company.slug

    const response = await ctx.client.request('PATCH', `/api/companies/${company.id}`, {
      headers: ownerCookie,
      body: { name: 'Công ty Đã Đổi Tên' },
    })
    expect(response.status).toBe(200)
    const body = response.json<{ company: { id: string; name: string; slug: string }; role: string }>()
    expect(body.company.name).toBe('Công ty Đã Đổi Tên')
    expect(body.role).toBe('owner')

    // Bất biến quan trọng nhất: slug là tên thư mục kho kiến thức, đổi nó sẽ mất liên kết
    // tới tài liệu đã index. Khẳng định ở cả phản hồi, trong DB lẫn danh sách công ty.
    expect(body.company.slug).toBe(originalSlug)
    expect(ctx.repos.auth.findCompanyById(company.id)?.slug).toBe(originalSlug)

    const list = await ctx.client.request('GET', '/api/companies', { headers: ownerCookie })
    const listed = list.json<{ companies: { id: string; name: string; slug: string }[] }>().companies
    const after = listed.find((item) => item.id === company.id)
    expect(after?.name).toBe('Công ty Đã Đổi Tên')
    expect(after?.slug).toBe(originalSlug)
  })

  it('cắt khoảng trắng hai đầu trước khi lưu', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'rename-trim@example.com', 'Công ty Trim')
    const response = await ctx.client.request('PATCH', `/api/companies/${company.id}`, {
      headers: ownerCookie,
      body: { name: '   Công ty Sạch   ' },
    })
    expect(response.status).toBe(200)
    expect(response.json<{ company: { name: string } }>().company.name).toBe('Công ty Sạch')
    expect(ctx.repos.auth.findCompanyById(company.id)?.name).toBe('Công ty Sạch')
  })

  it('trả 400 kèm error.code=validation khi tên rỗng hoặc quá dài', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'rename-invalid@example.com', 'Công ty Invalid')

    const empty = await ctx.client.request('PATCH', `/api/companies/${company.id}`, {
      headers: ownerCookie,
      body: { name: '   ' },
    })
    expect(empty.status).toBe(400)
    expect(errorCode(empty)).toBe('validation')

    const tooLong = await ctx.client.request('PATCH', `/api/companies/${company.id}`, {
      headers: ownerCookie,
      body: { name: 'x'.repeat(121) },
    })
    expect(tooLong.status).toBe(400)
    expect(errorCode(tooLong)).toBe('validation')

    // Tên vẫn nguyên sau hai lần từ chối.
    expect(ctx.repos.auth.findCompanyById(company.id)?.name).toBe('Công ty Invalid')
  })

  it('viewer bị chặn bằng 403', async () => {
    const { company } = await tenant(ctx, 'rename-owner2@example.com', 'Công ty Viewer')
    const viewer = await addMember(ctx, company.id, 'rename-viewer@example.com', 'viewer')
    const response = await ctx.client.request('PATCH', `/api/companies/${company.id}`, {
      headers: viewer.cookie,
      body: { name: 'Viewer thử đổi' },
    })
    expect(response.status).toBe(403)
    expect(ctx.repos.auth.findCompanyById(company.id)?.name).toBe('Công ty Viewer')
  })

  it('người ngoài công ty bị chặn, và công ty không tồn tại trả 404', async () => {
    const a = await tenant(ctx, 'rename-a@example.com', 'Công ty A')
    const b = await tenant(ctx, 'rename-b@example.com', 'Công ty B')

    // Người của B không được đổi tên công ty A. Quy ước an toàn là không lộ sự tồn tại
    // của công ty (404); middleware hiện trả 403 cho trường hợp công ty CÓ THẬT nhưng
    // người gọi không thuộc — chấp nhận cả hai ở đây và đã báo Lead.
    const outsider = await ctx.client.request('PATCH', `/api/companies/${a.company.id}`, {
      headers: b.ownerCookie,
      body: { name: 'B đổi tên A' },
    })
    expect(outsider.status).toBe(404)

    // Công ty không tồn tại thì chắc chắn 404.
    const missing = await ctx.client.request('PATCH', '/api/companies/cmp_khong_ton_tai', {
      headers: a.ownerCookie,
      body: { name: 'Không có công ty này' },
    })
    expect(missing.status).toBe(404)
    expect(ctx.repos.auth.findCompanyById(a.company.id)?.name).toBe('Công ty A')
  })
})

describe('một tài khoản tạo nhiều công ty', () => {
  it('tạo 3 công ty liên tiếp và quản lý đủ cả 3', async () => {
    const owner = await registerUser(ctx, 'multi-owner@example.com', 'Nhiều công ty')

    const created = []
    for (const name of ['Công ty Một', 'Công ty Hai', 'Công ty Ba']) {
      created.push(await createCompany(ctx, owner.cookie, name))
    }
    expect(new Set(created.map((company) => company.slug)).size).toBe(3)

    const list = await ctx.client.request('GET', '/api/companies', { headers: owner.cookie })
    expect(list.status).toBe(200)
    const companies = list.json<{ companies: { id: string; name: string; role: string }[] }>().companies
    expect(companies).toHaveLength(3)
    expect(companies.map((company) => company.name).sort()).toEqual(['Công ty Ba', 'Công ty Hai', 'Công ty Một'])
    expect(companies.every((company) => company.role === 'owner')).toBe(true)

    const defs = ctx.repos.team.listAgentDefs()
    expect(defs).toHaveLength(11)
    for (const company of created) {
      // Mỗi công ty nhận đủ 11 preset như người dùng thấy trong màn Đội agent.
      expect(ctx.repos.team.listPresets(company.id)).toHaveLength(11)
      // Và đủ phân quyền kho kiến thức: mỗi agent có 6 danh mục, trong đó có danh mục đọc được.
      for (const def of defs) {
        expect(ctx.repos.team.listKnowledgeAcl(company.id, def.id)).toHaveLength(6)
        expect(ctx.repos.team.readableCategories(company.id, def.id).length).toBeGreaterThan(0)
      }
    }
  })
})

describe('cài đặt tách theo công ty', () => {
  it('ghi limits ở công ty A thì công ty B vẫn mặc định', async () => {
    // Cố ý dùng CÙNG một tài khoản cho cả hai công ty: đây đúng tình huống người dùng
    // báo (một tài khoản, nhiều công ty), nên tách biệt phải đúng ngay cả khi cùng người.
    const owner = await registerUser(ctx, 'limits-owner@example.com')
    const a = await createCompany(ctx, owner.cookie, 'Công ty Limits A')
    const b = await createCompany(ctx, owner.cookie, 'Công ty Limits B')

    const beforeB = await ctx.client.request('GET', `/api/companies/${b.id}/limits`, {
      headers: owner.cookie,
    })
    expect(beforeB.status).toBe(200)
    expect(beforeB.json<typeof DEFAULTS>()).toMatchObject(DEFAULTS)

    const patched = await ctx.client.request('PATCH', `/api/companies/${a.id}/limits`, {
      headers: owner.cookie,
      body: { dailyCostUsd: 7, maxStepsPerRun: 9 },
    })
    expect(patched.status).toBe(200)
    expect(patched.json<{ dailyCostUsd: number; maxStepsPerRun: number }>()).toMatchObject({
      dailyCostUsd: 7,
      maxStepsPerRun: 9,
    })

    const afterA = await ctx.client.request('GET', `/api/companies/${a.id}/limits`, { headers: owner.cookie })
    expect(afterA.json<{ dailyCostUsd: number; maxStepsPerRun: number }>()).toMatchObject({
      dailyCostUsd: 7,
      maxStepsPerRun: 9,
    })

    const afterB = await ctx.client.request('GET', `/api/companies/${b.id}/limits`, { headers: owner.cookie })
    expect(afterB.json<typeof DEFAULTS>()).toMatchObject(DEFAULTS)

    // Bằng chứng độc lập ở tầng lưu trữ: mỗi công ty một khoá app_settings riêng.
    expect(ctx.repos.accounting.getSetting(`limits:${a.id}`)).toMatchObject({ dailyCostUsd: 7, maxStepsPerRun: 9 })
    expect(ctx.repos.accounting.getSetting(`limits:${b.id}`)).toBeUndefined()
  })

  it('đổi lại ở A: A đổi theo, B vẫn không đổi', async () => {
    const owner = await registerUser(ctx, 'limits-owner2@example.com')
    const a = await createCompany(ctx, owner.cookie, 'Công ty Đổi A')
    const b = await createCompany(ctx, owner.cookie, 'Công ty Đổi B')

    await ctx.client.request('PATCH', `/api/companies/${a.id}/limits`, {
      headers: owner.cookie,
      body: { dailyCostUsd: 7 },
    })
    const second = await ctx.client.request('PATCH', `/api/companies/${a.id}/limits`, {
      headers: owner.cookie,
      body: { dailyCostUsd: 3, maxParallelTasks: 5 },
    })
    expect(second.status).toBe(200)

    const afterA = await ctx.client.request('GET', `/api/companies/${a.id}/limits`, { headers: owner.cookie })
    expect(afterA.json<{ dailyCostUsd: number; maxParallelTasks: number }>()).toMatchObject({
      dailyCostUsd: 3,
      maxParallelTasks: 5,
    })

    const afterB = await ctx.client.request('GET', `/api/companies/${b.id}/limits`, { headers: owner.cookie })
    expect(afterB.json<typeof DEFAULTS>()).toMatchObject(DEFAULTS)
    expect(ctx.repos.accounting.getSetting(`limits:${b.id}`)).toBeUndefined()
  })

  it('người của công ty khác không đọc được limits', async () => {
    const a = await tenant(ctx, 'limits-a@example.com', 'Limits A')
    const b = await tenant(ctx, 'limits-b@example.com', 'Limits B')
    await ctx.client.request('PATCH', `/api/companies/${a.company.id}/limits`, {
      headers: a.ownerCookie,
      body: { dailyCostUsd: 6 },
    })
    const response = await ctx.client.request('GET', `/api/companies/${a.company.id}/limits`, {
      headers: b.ownerCookie,
    })
    expect(response.status).toBe(404)
  })
})

describe('cô lập dữ liệu sau khi chuyển công ty', () => {
  it('cuộc trao đổi của công ty A không xuất hiện ở công ty B', async () => {
    const owner = await registerUser(ctx, 'switch-owner@example.com')
    const a = await createCompany(ctx, owner.cookie, 'Công ty Switch A')
    const b = await createCompany(ctx, owner.cookie, 'Công ty Switch B')

    const created = await ctx.client.request('POST', `/api/companies/${a.id}/conversations`, {
      headers: owner.cookie,
      body: { title: 'Phiên chỉ thuộc A' },
    })
    expect(created.status).toBe(201)
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id

    const listB = await ctx.client.request('GET', `/api/companies/${b.id}/conversations`, {
      headers: owner.cookie,
    })
    expect(listB.status).toBe(200)
    expect(listB.json<{ conversations: { id: string }[] }>().conversations).toHaveLength(0)

    const listA = await ctx.client.request('GET', `/api/companies/${a.id}/conversations`, {
      headers: owner.cookie,
    })
    expect(listA.json<{ conversations: { id: string }[] }>().conversations.map((item) => item.id)).toContain(
      conversationId,
    )
    // Khẳng định thêm ở tầng repo để không phụ thuộc vào route.
    expect(ctx.repos.work.listConversations(b.id)).toHaveLength(0)
    expect(ctx.repos.work.listConversations(a.id)).toHaveLength(1)
  })
})
