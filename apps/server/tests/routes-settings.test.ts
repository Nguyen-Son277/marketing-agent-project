/**
 * Test module cài đặt: provider, khoá API, model, route tier, kết nối và giới hạn.
 *
 * Trọng tâm là bảo mật và luồng khai báo mới: khoá API là write-only, một URL có
 * nhiều khoá, model lấy về từ `/models` rồi chọn, xoá model đang dùng bị chặn, và tài
 * nguyên toàn cục không được sửa từ route của một công ty.
 */
import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addMember, createRoutesTestContext, errorCode, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext
let extraClosers: (() => Promise<void>)[]

beforeEach(async () => {
  ctx = await createRoutesTestContext()
  extraClosers = []
})

afterEach(async () => {
  for (const close of extraClosers) await close()
  await ctx.close()
})

/** Máy chủ giả trả `GET /v1/models` giống một gateway OpenAI-compatible. */
async function startModelsServer(models: string[]): Promise<string> {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ data: models.map((id) => ({ id, name: `Model ${id}` })) }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  extraClosers.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return `http://127.0.0.1:${port}/v1`
}

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
        apiKeyLabel: 'Key chính',
        extra: { note: 'thử nghiệm' },
        enabled: true,
      },
    })
    expect(created.status).toBe(201)
    const provider = created.json<{
      provider: {
        id: string
        apiKeyConfigured: boolean
        apiKeyHint: string | null
        isGlobal: boolean
        models: unknown[]
        keys: { id: string; label: string; hint: string | null }[]
      }
    }>().provider
    expect(provider.apiKeyConfigured).toBe(true)
    expect(provider.apiKeyHint).not.toBeNull()
    expect(provider.isGlobal).toBe(false)
    // Khoá đầu tiên gửi kèm lúc tạo provider cũng thành một bản ghi khoá có nhãn.
    expect(provider.keys).toHaveLength(1)
    expect(provider.keys[0]?.label).toBe('Key chính')

    // Thêm khoá thứ hai cho cùng URL: đây là cơ chế dự phòng khi khoá 1 hỏng.
    const secondKey = await ctx.client.request('POST', `${base}/providers/${provider.id}/keys`, {
      headers: ownerCookie,
      body: { label: 'Key dự phòng', apiKey: 'sk-du-phong-0987654321', priority: 200 },
    })
    expect(secondKey.status).toBe(201)

    const listed = await ctx.client.request('GET', `${base}/providers`, { headers: ownerCookie })
    const reloaded = listed
      .json<{ providers: { id: string; keys: { label: string; hint: string | null }[] }[] }>()
      .providers.find((item) => item.id === provider.id)
    expect(reloaded?.keys.map((key) => key.label)).toEqual(['Key chính', 'Key dự phòng'])

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
    const model = modelResponse.json<{ model: { id: string; label: string; usedByAgentCount: number } }>().model
    expect(model.usedByAgentCount).toBe(0)

    const routeResponse = await ctx.client.request('POST', `${base}/routes`, {
      headers: ownerCookie,
      body: { agentDefId: ctx.repos.team.findAgentDefByRole('content-writer')!.id, tier: 'light', modelFk: model.id },
    })
    expect(routeResponse.status).toBe(201)
    expect(routeResponse.json<{ route: { tier: string; modelLabel: string } }>().route.tier).toBe('light')

    const routes = await ctx.client.request('GET', `${base}/routes`, { headers: ownerCookie })
    expect(routes.status).toBe(200)
    expect(routes.json<{ routes: { modelFk: string }[] }>().routes.some((route) => route.modelFk === model.id)).toBe(true)

    // Model đã được route dùng thì không xoá được.
    const deleteUsed = await ctx.client.request('DELETE', `${base}/models/${model.id}`, { headers: ownerCookie })
    expect(deleteUsed.status).toBe(409)
    expect(errorCode(deleteUsed)).toBe('conflict')

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

  it('fetch model rồi nhập các model đã chọn, và xoá model không dùng', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'set-fetch@example.com', 'Settings Fetch')
    const base = `/api/companies/${company.id}`
    const baseUrl = await startModelsServer(['alpha', 'beta', 'gamma'])

    const created = await ctx.client.request('POST', `${base}/providers`, {
      headers: ownerCookie,
      body: { name: 'Gateway thật', kind: 'openai_compatible', baseUrl, apiKey: 'sk-abc-123456' },
    })
    const providerId = created.json<{ provider: { id: string } }>().provider.id

    const fetched = await ctx.client.request('POST', `${base}/providers/${providerId}/fetch-models`, {
      headers: ownerCookie,
      body: {},
    })
    expect(fetched.status).toBe(200)
    const fetchBody = fetched.json<{
      ok: boolean
      models: { modelId: string; alreadyAdded: boolean }[]
    }>()
    expect(fetchBody.ok).toBe(true)
    expect(fetchBody.models.map((model) => model.modelId)).toEqual(['alpha', 'beta', 'gamma'])
    expect(fetchBody.models.every((model) => model.alreadyAdded === false)).toBe(true)

    const imported = await ctx.client.request('POST', `${base}/providers/${providerId}/import-models`, {
      headers: ownerCookie,
      body: { models: [{ modelId: 'alpha', label: 'Alpha' }, { modelId: 'beta', label: 'Beta' }] },
    })
    expect(imported.status).toBe(201)
    const importBody = imported.json<{ created: { id: string; modelId: string }[]; skipped: string[] }>()
    expect(importBody.created.map((model) => model.modelId)).toEqual(['alpha', 'beta'])
    expect(importBody.skipped).toEqual([])

    // Nhập lại đúng các model đó thì bỏ qua, không tạo trùng.
    const again = await ctx.client.request('POST', `${base}/providers/${providerId}/import-models`, {
      headers: ownerCookie,
      body: { models: [{ modelId: 'alpha' }] },
    })
    expect(again.json<{ created: unknown[]; skipped: string[] }>().skipped).toEqual(['alpha'])

    // Gán "alpha" cho một agent rồi purge: chỉ "beta" bị xoá.
    const alphaId = importBody.created.find((model) => model.modelId === 'alpha')!.id
    await ctx.client.request('PATCH', `${base}/team/content-writer`, {
      headers: ownerCookie,
      body: { modelFk: alphaId },
    })
    const purged = await ctx.client.request('POST', `${base}/providers/${providerId}/purge-models`, {
      headers: ownerCookie,
      body: {},
    })
    expect(purged.status).toBe(200)
    expect(purged.json<{ deleted: number }>().deleted).toBe(1)

    const remaining = await ctx.client.request('GET', `${base}/models`, { headers: ownerCookie })
    expect(
      remaining.json<{ models: { modelId: string }[] }>().models.map((model) => model.modelId),
    ).toEqual(['alpha'])
  })

  it('không cho dùng khoá của provider khác để fetch model', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'set-key-scope@example.com', 'Settings Key Scope')
    const base = `/api/companies/${company.id}`
    const first = await ctx.client.request('POST', `${base}/providers`, {
      headers: ownerCookie,
      body: {
        name: 'Provider A',
        kind: 'openai_compatible',
        baseUrl: 'http://127.0.0.1:1/v1',
        apiKey: 'sk-a-1234567890',
      },
    })
    const firstProvider = first.json<{ provider: { keys: { id: string }[] } }>().provider
    const second = await ctx.client.request('POST', `${base}/providers`, {
      headers: ownerCookie,
      body: { name: 'Provider B', kind: 'openai_compatible', baseUrl: 'http://127.0.0.1:1/v1' },
    })
    const secondId = second.json<{ provider: { id: string } }>().provider.id

    const crossed = await ctx.client.request('POST', `${base}/providers/${secondId}/fetch-models`, {
      headers: ownerCookie,
      body: { keyId: firstProvider.keys[0]!.id },
    })
    expect(crossed.status).toBe(404)
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
    // Provider `company_id IS NULL` là tài nguyên toàn hệ thống. Từ migration 0008
    // không còn seed sẵn, nên test tự tạo một hàng như vậy.
    const global = ctx.repos.llm.createProvider({
      companyId: null,
      name: 'Provider toàn cục',
      kind: 'openai_compatible',
      baseUrl: 'http://127.0.0.1:9/v1',
    })

    const response = await ctx.client.request(
      'PATCH',
      `/api/companies/${company.id}/providers/${global.id}`,
      { headers: ownerCookie, body: { enabled: false } },
    )
    expect(response.status).toBe(404)

    // Tạo model cho provider toàn cục cũng bị chặn.
    const model = await ctx.client.request('POST', `/api/companies/${company.id}/models`, {
      headers: ownerCookie,
      body: { providerId: global.id, modelId: 'x', label: 'X' },
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
    expect(read.status).toBe(404)

    const write = await ctx.client.request('POST', `/api/companies/${a.company.id}/providers`, {
      headers: b.ownerCookie,
      body: { name: 'B ghi vào A', kind: 'openai_compatible', baseUrl: 'http://127.0.0.1:1/v1' },
    })
    expect(write.status).toBe(404)
  })
})
