/**
 * Test module cài đặt: provider, model, route tier, kết nối và giới hạn.
 *
 * Trọng tâm là bảo mật: khoá API là write-only, và tài nguyên toàn cục của hệ thống
 * không được sửa từ route của một công ty. Đây là hai lỗi có thể làm rò bí mật hoặc
 * phá cấu hình dùng chung của mọi tenant.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addMember, createRoutesTestContext, errorCode, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

describe('settings routes', () => {
  it('quản lý provider, model, route, kết nối và giới hạn (happy path)', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'set-owner@example.com', 'Settings Co')
    const base = `/api/companies/${company.id}`

    const created = await ctx.client.request('POST', `${base}/providers`, {
      headers: ownerCookie,
      body: {
        name: 'Provider riêng',
        kind: 'openai_compatible',
        baseUrl: 'http://127.0.0.1:1/v1',
        apiKey: 'sk-test-1234567890',
        extra: { note: 'thử nghiệm' },
        enabled: true,
      },
    })
    expect(created.status).toBe(201)
    const provider = created.json<{
      provider: { id: string; apiKeyConfigured: boolean; apiKeyHint: string | null; isGlobal: boolean; models: unknown[] }
    }>().provider
    expect(provider.apiKeyConfigured).toBe(true)
    expect(provider.apiKeyHint).not.toBeNull()
    expect(provider.isGlobal).toBe(false)

    // Test kết nối tới cổng không có dịch vụ: phải trả 200 với ok=false, không phải 500.
    const probe = await ctx.client.request('POST', `${base}/providers/${provider.id}/test`, {
      headers: ownerCookie,
      body: {},
    })
    expect(probe.status).toBe(200)
    expect(probe.json<{ ok: boolean; latencyMs: number }>().ok).toBe(false)

    const modelResponse = await ctx.client.request('POST', `${base}/models`, {
      headers: ownerCookie,
      body: {
        providerId: provider.id,
        modelId: 'model-thu-nghiem',
        label: 'Model thử nghiệm',
        contextWindow: 32_000,
        costInPerMtok: 0.1,
      },
    })
    expect(modelResponse.status).toBe(201)
    const model = modelResponse.json<{ model: { id: string; label: string } }>().model

    const routeResponse = await ctx.client.request('POST', `${base}/routes`, {
      headers: ownerCookie,
      body: { agentDefId: ctx.repos.team.findAgentDefByRole('content-writer')!.id, tier: 'light', modelFk: model.id },
    })
    expect(routeResponse.status).toBe(201)
    expect(routeResponse.json<{ route: { tier: string; modelLabel: string } }>().route.tier).toBe('light')

    const routes = await ctx.client.request('GET', `${base}/routes`, { headers: ownerCookie })
    expect(routes.status).toBe(200)
    expect(routes.json<{ routes: { modelFk: string }[] }>().routes.some((route) => route.modelFk === model.id)).toBe(true)

    const integration = await ctx.client.request('POST', `${base}/integrations`, {
      headers: ownerCookie,
      body: { kind: 'firecrawl', name: 'Firecrawl', config: { apiKey: 'fc-123' } },
    })
    expect(integration.status).toBe(201)
    const integrationId = integration.json<{ integration: { id: string } }>().integration.id

    const integrationTest = await ctx.client.request('POST', `${base}/integrations/${integrationId}/test`, {
      headers: ownerCookie,
      body: {},
    })
    expect(integrationTest.status).toBe(200)
    expect(integrationTest.json<{ ok: boolean; status: string }>().ok).toBe(true)

    const limits = await ctx.client.request('PATCH', `${base}/limits`, {
      headers: ownerCookie,
      body: { dailyCostUsd: 7, maxStepsPerRun: 8 },
    })
    expect(limits.status).toBe(200)
    expect(limits.json<{ dailyCostUsd: number }>().dailyCostUsd).toBe(7)

    const readLimits = await ctx.client.request('GET', `${base}/limits`, { headers: ownerCookie })
    expect(readLimits.json<{ maxStepsPerRun: number }>().maxStepsPerRun).toBe(8)
  })

  it('không bao giờ trả khoá API đã mã hoá', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'set-secret@example.com', 'Settings Secret')
    await ctx.client.request('POST', `/api/companies/${company.id}/providers`, {
      headers: ownerCookie,
      body: {
        name: 'Provider có khoá',
        kind: 'openai_compatible',
        baseUrl: 'http://127.0.0.1:1/v1',
        apiKey: 'sk-tuyet-mat-0987654321',
      },
    })
    const response = await ctx.client.request('GET', `/api/companies/${company.id}/providers`, {
      headers: ownerCookie,
    })
    expect(response.status).toBe(200)
    expect(response.body).not.toContain('apiKeyEnc')
    expect(response.body).not.toContain('apiKeyIv')
    expect(response.body).not.toContain('sk-tuyet-mat-0987654321')
  })

  it('từ chối sửa provider toàn cục từ route của công ty (fail closed)', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'set-global@example.com', 'Settings Global')
    const list = await ctx.client.request('GET', `/api/companies/${company.id}/providers`, { headers: ownerCookie })
    const global = list.json<{ providers: { id: string; isGlobal: boolean }[] }>().providers.find((p) => p.isGlobal)
    expect(global).toBeDefined()

    const response = await ctx.client.request(
      'PATCH',
      `/api/companies/${company.id}/providers/${global!.id}`,
      { headers: ownerCookie, body: { enabled: false } },
    )
    expect(response.status).toBe(404)

    // Tạo model cho provider toàn cục cũng bị chặn.
    const model = await ctx.client.request('POST', `/api/companies/${company.id}/models`, {
      headers: ownerCookie,
      body: { providerId: global!.id, modelId: 'x', label: 'X' },
    })
    expect(model.status).toBe(404)
  })

  it('trả 400 kèm error.code=validation khi baseUrl không hợp lệ', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'set-invalid@example.com', 'Settings Invalid')
    const response = await ctx.client.request('POST', `/api/companies/${company.id}/providers`, {
      headers: ownerCookie,
      body: { name: 'Sai URL', kind: 'openai_compatible', baseUrl: 'khong-phai-url' },
    })
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('validation')
  })

  it('viewer KHÔNG đổi được cài đặt', async () => {
    const { company } = await tenant(ctx, 'set-owner2@example.com', 'Settings Viewer')
    const viewer = await addMember(ctx, company.id, 'set-viewer@example.com', 'viewer')
    const response = await ctx.client.request('POST', `/api/companies/${company.id}/providers`, {
      headers: viewer.cookie,
      body: { name: 'Viewer thử', kind: 'openai_compatible', baseUrl: 'http://127.0.0.1:1/v1' },
    })
    expect(response.status).toBe(403)
    const limits = await ctx.client.request('PATCH', `/api/companies/${company.id}/limits`, {
      headers: viewer.cookie,
      body: { dailyCostUsd: 999 },
    })
    expect(limits.status).toBe(403)
  })

  it('cô lập tenant: công ty B không xem/ghi được cài đặt công ty A', async () => {
    const a = await tenant(ctx, 'set-a@example.com', 'Set A')
    const b = await tenant(ctx, 'set-b@example.com', 'Set B')

    const read = await ctx.client.request('GET', `/api/companies/${a.company.id}/providers`, {
      headers: b.ownerCookie,
    })
    expect([403, 404]).toContain(read.status)

    const write = await ctx.client.request('POST', `/api/companies/${a.company.id}/providers`, {
      headers: b.ownerCookie,
      body: { name: 'B ghi vào A', kind: 'openai_compatible', baseUrl: 'http://127.0.0.1:1/v1' },
    })
    expect([403, 404]).toContain(write.status)
  })
})
