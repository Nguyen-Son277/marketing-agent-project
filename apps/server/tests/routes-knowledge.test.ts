/**
 * Test module kho kiến thức.
 *
 * Hai điểm quan trọng: `content` phải có ngay trong danh sách (hợp đồng mới), và
 * ghi/xoá tài liệu phải bị chặn với viewer — kho kiến thức là thứ agent đọc để
 * viết nội dung, nên ghi bừa là ghi bừa vào nguồn sự thật.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addMember,
  createRoutesTestContext,
  errorCode,
  seedDocument,
  tenant,
  writeKbFile,
  type RoutesTestContext,
} from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

describe('knowledge routes', () => {
  it('trả tài liệu kèm nội dung, đủ sáu category và thống kê (happy path)', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'kb-owner@example.com', 'KB Co')
    seedDocument(ctx, company.id, {
      path: '00-cong-ty/gioi-thieu.md',
      title: 'Giới thiệu công ty',
      category: '00-cong-ty',
      content: '# Giới thiệu\n\nChúng tôi làm phần mềm quản lý tồn kho.',
    })

    const response = await ctx.client.request('GET', `/api/companies/${company.id}/knowledge`, {
      headers: ownerCookie,
    })
    expect(response.status).toBe(200)
    const body = response.json<{
      documents: { path: string; content: string; category: string; indexed: boolean }[]
      categories: { code: string; count: number }[]
      stats: { documents: number; chunks: number }
    }>()
    expect(body.categories).toHaveLength(6)
    expect(body.documents).toHaveLength(1)
    expect(body.documents[0]?.content).toContain('quản lý tồn kho')
    expect(body.stats.documents).toBe(1)
    expect(body.categories.find((c) => c.code === '00-cong-ty')?.count).toBe(1)
  })

  it('ghi, sửa rồi xoá một tài liệu qua HTTP', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'kb-write@example.com', 'KB Write')
    const created = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge`, {
      headers: ownerCookie,
      body: {
        path: '10-brand/giong-noi.md',
        title: 'Giọng nói thương hiệu',
        category: '10-brand',
        tags: ['brand'],
        content: '# Giọng nói\n\nThân thiện, ngắn gọn, không dùng từ chuyên môn.',
      },
    })
    expect(created.status).toBe(201)
    const document = created.json<{ documents: { id: string; content: string }[] }>().documents[0]!
    expect(document.content).toContain('Thân thiện')

    const patched = await ctx.client.request(
      'PATCH',
      `/api/companies/${company.id}/knowledge/${document.id}`,
      {
        headers: ownerCookie,
        body: { title: 'Giọng nói thương hiệu (v2)', content: '# Giọng nói v2\n\nẤm áp và rõ ràng.' },
      },
    )
    expect(patched.status).toBe(200)
    expect(patched.json<{ document: { title: string; content: string } }>().document.title).toBe(
      'Giọng nói thương hiệu (v2)',
    )

    const removed = await ctx.client.request(
      'DELETE',
      `/api/companies/${company.id}/knowledge/${document.id}`,
      { headers: ownerCookie },
    )
    expect(removed.status).toBe(200)
    const after = await ctx.client.request('GET', `/api/companies/${company.id}/knowledge`, {
      headers: ownerCookie,
    })
    expect(after.json<{ documents: unknown[] }>().documents).toHaveLength(0)
  })

  it('index lại đọc file thật trong thư mục KB của công ty', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'kb-reindex@example.com', 'KB Reindex')
    writeKbFile(
      ctx.companiesRoot,
      company.slug,
      '20-thi-truong/doi-thu.md',
      '# Đối thủ\n\nĐối thủ chính là phần mềm nhập khẩu giá cao.',
    )

    const response = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge/reindex`, {
      headers: ownerCookie,
      body: { force: true },
    })
    expect(response.status).toBe(200)
    const body = response.json<{ indexed: number; errors: string[] }>()
    expect(body.indexed).toBe(1)
    expect(body.errors).toHaveLength(0)

    const jobs = await ctx.client.request('GET', `/api/companies/${company.id}/knowledge/jobs`, {
      headers: ownerCookie,
    })
    expect(jobs.status).toBe(200)
    expect(jobs.json<{ jobs: unknown[] }>().jobs.length).toBeGreaterThan(0)

    const stats = await ctx.client.request('GET', `/api/companies/${company.id}/knowledge/stats`, {
      headers: ownerCookie,
    })
    expect(stats.status).toBe(200)
    expect(stats.json<{ stats: { documents: number } }>().stats.documents).toBe(1)
  })

  it('trả 400 kèm error.code=validation khi thiếu category', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'kb-invalid@example.com', 'KB Invalid')
    const response = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge`, {
      headers: ownerCookie,
      body: { path: 'x.md', title: 'Thiếu category', tags: [], content: 'nội dung' },
    })
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('validation')
  })

  it('viewer KHÔNG ghi được tài liệu', async () => {
    const { company } = await tenant(ctx, 'kb-owner2@example.com', 'KB Viewer')
    const viewer = await addMember(ctx, company.id, 'kb-viewer@example.com', 'viewer')
    const response = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge`, {
      headers: viewer.cookie,
      body: {
        path: '00-cong-ty/viewer.md',
        title: 'Viewer thử ghi',
        category: '00-cong-ty',
        tags: [],
        content: 'không được phép',
      },
    })
    expect(response.status).toBe(403)
  })

  it('cô lập tenant: công ty B không đọc/ghi được kho công ty A', async () => {
    const a = await tenant(ctx, 'kb-a@example.com', 'KB A')
    const b = await tenant(ctx, 'kb-b@example.com', 'KB B')
    seedDocument(ctx, a.company.id, {
      path: '00-cong-ty/a.md',
      title: 'Tài liệu A',
      category: '00-cong-ty',
      content: 'bí mật của A',
    })

    const read = await ctx.client.request('GET', `/api/companies/${a.company.id}/knowledge`, {
      headers: b.ownerCookie,
    })
    expect([403, 404]).toContain(read.status)

    const write = await ctx.client.request('POST', `/api/companies/${a.company.id}/knowledge`, {
      headers: b.ownerCookie,
      body: {
        path: '00-cong-ty/b.md',
        title: 'B ghi vào A',
        category: '00-cong-ty',
        tags: [],
        content: 'x',
      },
    })
    expect([403, 404]).toContain(write.status)
  })
})
