import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addMember, createRoutesTestContext, errorCode, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

async function createModel(companyId: string, ownerCookie: Record<string, string>) {
  const base = `/api/companies/${companyId}`
  const providerResponse = await ctx.client.request('POST', `${base}/providers`, {
    headers: ownerCookie,
    body: { name: 'Pricing provider', kind: 'openai_compatible', baseUrl: 'http://127.0.0.1:1/v1' },
  })
  expect(providerResponse.status).toBe(201)
  const providerId = providerResponse.json<{ provider: { id: string } }>().provider.id
  const modelResponse = await ctx.client.request('POST', `${base}/models`, {
    headers: ownerCookie,
    body: {
      providerId,
      modelId: 'pricing-model',
      label: 'Pricing model',
      contextWindow: 32_000,
      maxOutput: 4_000,
      supportsTools: false,
      supportsVision: true,
      costInPerMtok: 1.25,
      costOutPerMtok: 9.5,
      enabled: false,
    },
  })
  expect(modelResponse.status).toBe(201)
  return {
    base,
    providerId,
    model: modelResponse.json<{ model: { id: string } }>().model,
  }
}

describe('model pricing PATCH route', () => {
  it('updates both prices including tiny decimal values and preserves other model fields', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'pricing-owner@example.com', 'Pricing company')
    const { base, model } = await createModel(company.id, ownerCookie)

    const response = await ctx.client.request('PATCH', `${base}/models/${model.id}`, {
      headers: ownerCookie,
      body: { costInPerMtok: 0.000001, costOutPerMtok: 0.0000001 },
    })

    expect(response.status).toBe(200)
    expect(response.json<{ model: { costInPerMtok: number; costOutPerMtok: number } }>().model)
      .toMatchObject({ costInPerMtok: 0.000001, costOutPerMtok: 0.0000001 })
    const listed = await ctx.client.request('GET', `${base}/models`, { headers: ownerCookie })
    expect(listed.status).toBe(200)
    expect(listed.json<{ models: Array<Record<string, unknown>> }>().models.find((item) => item.id === model.id))
      .toMatchObject({
        modelId: 'pricing-model',
        label: 'Pricing model',
        contextWindow: 32_000,
        supportsTools: false,
        enabled: false,
        costInPerMtok: 0.000001,
        costOutPerMtok: 0.0000001,
      })
    expect(ctx.repos.llm.requireModel(model.id)).toMatchObject({
      modelId: 'pricing-model',
      label: 'Pricing model',
      contextWindow: 32_000,
      maxOutput: 4_000,
      supportsTools: false,
      supportsVision: true,
      enabled: false,
      costInPerMtok: 0.000001,
      costOutPerMtok: 0.0000001,
    })
  })

  it('resets prices to zero and allows editing a model used by an agent route', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'pricing-used@example.com', 'Used pricing company')
    const { base, model } = await createModel(company.id, ownerCookie)
    const route = await ctx.client.request('POST', `${base}/routes`, {
      headers: ownerCookie,
      body: {
        agentDefId: ctx.repos.team.findAgentDefByRole('content-writer')!.id,
        tier: 'light',
        modelFk: model.id,
      },
    })
    expect(route.status).toBe(201)

    const response = await ctx.client.request('PATCH', `${base}/models/${model.id}`, {
      headers: ownerCookie,
      body: { costInPerMtok: 0, costOutPerMtok: 0 },
    })

    expect(response.status).toBe(200)
    expect(response.json<{ model: { costInPerMtok: number; costOutPerMtok: number; usedByAgentCount: number } }>().model)
      .toMatchObject({ costInPerMtok: 0, costOutPerMtok: 0, usedByAgentCount: 1 })
  })

  it('rejects a negative price without changing stored pricing', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'pricing-negative@example.com', 'Negative pricing company')
    const { base, model } = await createModel(company.id, ownerCookie)

    const response = await ctx.client.request('PATCH', `${base}/models/${model.id}`, {
      headers: ownerCookie,
      body: { costInPerMtok: -0.01 },
    })

    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('validation')
    const stored = ctx.repos.llm.requireModel(model.id)
    expect(stored.costInPerMtok).toBe(1.25)
    expect(stored.costOutPerMtok).toBe(9.5)
  })

  it('requires authentication and manage permission, and blocks cross-company model edits', async () => {
    const a = await tenant(ctx, 'pricing-a@example.com', 'Pricing A')
    const b = await tenant(ctx, 'pricing-b@example.com', 'Pricing B')
    const { base, model } = await createModel(a.company.id, a.ownerCookie)

    const unauthenticated = await ctx.client.request('PATCH', `${base}/models/${model.id}`, {
      body: { costInPerMtok: 2 },
    })
    expect(unauthenticated.status).toBe(401)

    const crossCompany = await ctx.client.request('PATCH', `/api/companies/${b.company.id}/models/${model.id}`, {
      headers: b.ownerCookie,
      body: { costInPerMtok: 2 },
    })
    expect(crossCompany.status).toBe(404)

    const member = await addMember(ctx, a.company.id, 'pricing-member@example.com', 'viewer')
    const forbidden = await ctx.client.request('PATCH', `${base}/models/${model.id}`, {
      headers: member.cookie,
      body: { costInPerMtok: 2 },
    })
    expect(forbidden.status).toBe(403)
    expect(ctx.repos.llm.requireModel(model.id).costInPerMtok).toBe(1.25)
  })
})
