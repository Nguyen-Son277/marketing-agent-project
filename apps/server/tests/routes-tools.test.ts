/**
 * Test module danh mục tool.
 *
 * Module này không có thao tác ghi, nên trọng tâm là: chỉ thành viên công ty mới
 * đọc được, và danh mục phản ánh đúng registry thật của tiến trình.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoutesTestContext, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

describe('tool routes', () => {
  it('trả danh mục tool của bản triển khai (happy path)', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'tool-owner@example.com', 'Tool Co')
    const response = await ctx.client.request('GET', `/api/companies/${company.id}/tools`, {
      headers: ownerCookie,
    })
    expect(response.status).toBe(200)
    const tools = response.json<{ tools: { name: string; requiresApproval: boolean }[] }>().tools
    expect(tools.length).toBeGreaterThan(0)
    expect(tools.some((tool) => tool.name === 'http_fetch')).toBe(true)
    expect(tools.some((tool) => tool.name === 'task_create')).toBe(true)
    expect(tools.every((tool) => typeof tool.requiresApproval === 'boolean')).toBe(true)
  })

  it('cô lập tenant: công ty B không đọc được danh mục qua đường dẫn công ty A', async () => {
    const a = await tenant(ctx, 'tool-a@example.com', 'Tool A')
    const b = await tenant(ctx, 'tool-b@example.com', 'Tool B')
    const response = await ctx.client.request('GET', `/api/companies/${a.company.id}/tools`, {
      headers: b.ownerCookie,
    })
    expect([403, 404]).toContain(response.status)
  })

  it('trả 401 cho người chưa đăng nhập', async () => {
    const { company } = await tenant(ctx, 'tool-anon@example.com', 'Tool Anon')
    const response = await ctx.client.request('GET', `/api/companies/${company.id}/tools`)
    expect(response.status).toBe(401)
  })
})
