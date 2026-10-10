/**
 * Test module chi phí/lượt chạy/kiểm toán.
 *
 * Số liệu phải đến từ sổ đã ghi, không phải tính lại từ hội thoại: test ghi một
 * lượt chạy thật vào `runs` rồi kiểm tra tổng và bảng theo ngày/agent.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoutesTestContext, errorCode, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

describe('cost routes', () => {
  it('tổng hợp chi phí từ sổ đã ghi (happy path)', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'cost-owner@example.com', 'Cost Co')
    const def = ctx.repos.team.findAgentDefByRole('content-writer')!
    const runId = ctx.repos.accounting.startRun({
      companyId: company.id,
      agentDefId: def.id,
      modelId: 'deepseek-v4-flash',
    })
    ctx.repos.accounting.finishRun(runId, {
      status: 'succeeded',
      tokensIn: 1_000,
      tokensOut: 500,
      costUsd: 0.25,
      latencyMs: 1_200,
      steps: 3,
    })

    const response = await ctx.client.request('GET', `/api/companies/${company.id}/costs`, {
      headers: ownerCookie,
    })
    expect(response.status).toBe(200)
    const body = response.json<{
      totals: { tokensIn: number; tokensOut: number; costUsd: number; runs: number }
      daily: unknown[]
      byAgent: unknown[]
      runs: { id: string }[]
    }>()
    expect(body.totals.runs).toBe(1)
    expect(body.totals.tokensIn).toBe(1_000)
    expect(body.totals.tokensOut).toBe(500)
    expect(body.totals.costUsd).toBeCloseTo(0.25, 6)
    expect(body.daily.length).toBeGreaterThan(0)
    expect(body.byAgent.length).toBeGreaterThan(0)
    expect(body.runs.map((run) => run.id)).toContain(runId)
  })

  it('trả danh sách lượt chạy và nhật ký kiểm toán', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'cost-list@example.com', 'Cost List')
    const runs = await ctx.client.request('GET', `/api/companies/${company.id}/runs`, { headers: ownerCookie })
    expect(runs.status).toBe(200)
    expect(Array.isArray(runs.json<{ runs: unknown[] }>().runs)).toBe(true)

    const audit = await ctx.client.request('GET', `/api/companies/${company.id}/audit`, { headers: ownerCookie })
    expect(audit.status).toBe(200)
    const entries = audit.json<{ entries: { action: string }[] }>().entries
    expect(entries.some((entry) => entry.action === 'company.create')).toBe(true)
  })

  it('trả 400 kèm error.code=validation khi tham số ngày sai', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'cost-invalid@example.com', 'Cost Invalid')
    const response = await ctx.client.request('GET', `/api/companies/${company.id}/costs?from=khong-phai-ngay`, {
      headers: ownerCookie,
    })
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('validation')
  })

  it('cô lập tenant: công ty B không đọc được chi phí công ty A', async () => {
    const a = await tenant(ctx, 'cost-a@example.com', 'Cost A')
    const b = await tenant(ctx, 'cost-b@example.com', 'Cost B')
    const costs = await ctx.client.request('GET', `/api/companies/${a.company.id}/costs`, {
      headers: b.ownerCookie,
    })
    expect(costs.status).toBe(404)
    const audit = await ctx.client.request('GET', `/api/companies/${a.company.id}/audit`, {
      headers: b.ownerCookie,
    })
    expect(audit.status).toBe(404)
  })
})
