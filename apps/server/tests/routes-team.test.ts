/**
 * Test module đội agent: tenancy, phân quyền, validation và happy path.
 *
 * Trọng tâm là hàng rào: người của công ty khác không đọc/sửa được đội của công ty
 * này, viewer không sửa được cấu hình, và body sai trả 400 kèm `error.code`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  errorCode,
  tenant,
  createRoutesTestContext,
  addMember,
  configureCompanyModel,
  type RoutesTestContext,
} from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

describe('team routes', () => {
  it('trả về toàn bộ đội kèm kỹ năng, tool và model (happy path)', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'team-owner@example.com', 'Team Co')
    configureCompanyModel(ctx, company.id)
    const response = await ctx.client.request('GET', `/api/companies/${company.id}/team`, {
      headers: ownerCookie,
    })
    expect(response.status).toBe(200)
    const body = response.json<{
      members: { role: string; modelFk: string | null; fallbackModelFks: string[]; skills: unknown[]; knowledge: unknown[] }[]
      availableSkills: unknown[]
      availableTools: { name: string }[]
      models: { providerName: string; providerId: string }[]
    }>()
    expect(body.members).toHaveLength(11)
    expect(body.members.some((member) => member.role === 'marketing-leader')).toBe(true)
    expect(body.members.every((member) => member.modelFk !== null)).toBe(true)
    expect(body.members.every((member) => Array.isArray(member.fallbackModelFks))).toBe(true)
    expect(body.availableSkills.length).toBeGreaterThan(0)
    expect(body.availableTools.length).toBeGreaterThan(0)
    expect(body.models.length).toBeGreaterThan(0)
    expect(body.models[0]?.providerName).toBe('Provider test')
    expect(body.models[0]?.providerId).toBeTruthy()
  })

  it('lưu và đọc lại danh sách model dự phòng theo đúng thứ tự', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'team-fallback@example.com', 'Team Fallback')
    const { providerId, modelPk } = configureCompanyModel(ctx, company.id)
    const second = ctx.repos.llm.createModel({
      providerId,
      modelId: 'second-model',
      label: 'Second model',
      supportsTools: true,
    })
    const patch = await ctx.client.request('PATCH', `/api/companies/${company.id}/team/content-writer`, {
      headers: ownerCookie,
      body: { modelFk: modelPk, fallbackModelFks: [second.id] },
    })
    expect(patch.status).toBe(200)
    expect(patch.json<{ member: { fallbackModelFks: string[] } }>().member.fallbackModelFks).toEqual([second.id])

    const read = await ctx.client.request('GET', `/api/companies/${company.id}/team`, { headers: ownerCookie })
    const member = read
      .json<{ members: { role: string; fallbackModelFks: string[] }[] }>()
      .members.find((item) => item.role === 'content-writer')
    expect(member?.fallbackModelFks).toEqual([second.id])
  })

  it('từ chối model dự phòng không thuộc công ty', async () => {
    const a = await tenant(ctx, 'team-fb-a@example.com', 'Team FB A')
    const b = await tenant(ctx, 'team-fb-b@example.com', 'Team FB B')
    const foreign = configureCompanyModel(ctx, b.company.id)
    const response = await ctx.client.request('PATCH', `/api/companies/${a.company.id}/team/content-writer`, {
      headers: a.ownerCookie,
      body: { fallbackModelFks: [foreign.modelPk] },
    })
    expect(response.status).toBe(404)
  })

  it('cho phép owner sửa cấu hình một agent và trả lại member đã cập nhật', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'team-edit@example.com', 'Team Edit')
    const patch = await ctx.client.request('PATCH', `/api/companies/${company.id}/team/content-writer`, {
      headers: ownerCookie,
      body: { enabled: false, requireApproval: false, maxTokens: 4096 },
    })
    expect(patch.status).toBe(200)
    const member = patch.json<{ member: { enabled: boolean; maxTokens: number | null } }>().member
    expect(member.enabled).toBe(false)
    expect(member.maxTokens).toBe(4096)
  })

  it('trả 400 kèm error.code=validation khi tier không hợp lệ', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'team-invalid@example.com', 'Team Invalid')
    const response = await ctx.client.request('PATCH', `/api/companies/${company.id}/team/content-writer`, {
      headers: ownerCookie,
      body: { tier: 'khong-co-tier' },
    })
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('validation')
  })

  it('viewer KHÔNG sửa được cấu hình đội', async () => {
    const { company } = await tenant(ctx, 'team-owner2@example.com', 'Team Viewer')
    const viewer = await addMember(ctx, company.id, 'team-viewer@example.com', 'viewer')
    const response = await ctx.client.request('PATCH', `/api/companies/${company.id}/team/content-writer`, {
      headers: viewer.cookie,
      body: { enabled: false },
    })
    expect(response.status).toBe(403)
  })

  it('cô lập tenant: công ty B không đọc/sửa được đội công ty A', async () => {
    const a = await tenant(ctx, 'team-a@example.com', 'Team A')
    const b = await tenant(ctx, 'team-b@example.com', 'Team B')

    const read = await ctx.client.request('GET', `/api/companies/${a.company.id}/team`, {
      headers: b.ownerCookie,
    })
    expect(read.status).toBe(404)

    const write = await ctx.client.request('PATCH', `/api/companies/${a.company.id}/team/content-writer`, {
      headers: b.ownerCookie,
      body: { enabled: false },
    })
    expect(write.status).toBe(404)
  })

  it('trả 401 cho người chưa đăng nhập', async () => {
    const { company } = await tenant(ctx, 'team-anon@example.com', 'Team Anon')
    const response = await ctx.client.request('GET', `/api/companies/${company.id}/team`)
    expect(response.status).toBe(401)
  })
})
