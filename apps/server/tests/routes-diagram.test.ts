/**
 * Test module sơ đồ đội và tổng quan/tài sản.
 *
 * Sơ đồ được dựng từ cấu hình thật, nên test khẳng định nó phản ánh đúng số agent
 * và các category ACL; dashboard phải đếm được công việc và chi phí.
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

describe('diagram routes', () => {
  it('dựng sơ đồ từ cấu hình thật của công ty (happy path)', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'diagram-owner@example.com', 'Diagram Co')
    const response = await ctx.client.request('GET', `/api/companies/${company.id}/diagram`, {
      headers: ownerCookie,
    })
    expect(response.status).toBe(200)
    const body = response.json<{
      nodes: { role: string; layer: string; knowledgeRead: string[] }[]
      edges: { kind: string }[]
      workflow: unknown[]
      knowledge: { code: string; owners: string[] }[]
    }>()
    expect(body.nodes).toHaveLength(10)
    expect(body.nodes.find((node) => node.role === 'marketing-leader')?.layer).toBe('leader')
    expect(body.edges.some((edge) => edge.kind === 'delegates')).toBe(true)
    expect(body.workflow).toHaveLength(7)
    expect(body.knowledge).toHaveLength(6)
    expect(body.knowledge.every((category) => category.owners.length > 0)).toBe(true)
  })

  it('trả tổng quan công ty, chi phí và hoạt động gần đây', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'dash-owner@example.com', 'Dash Co')
    const def = ctx.repos.team.findAgentDefByRole('content-writer')!
    ctx.repos.work.createTask({
      companyId: company.id,
      title: 'Việc cho dashboard',
      briefMd: 'Mô tả đủ dài cho công việc này.',
      assigneeAgentDefId: def.id,
      status: 'assigned',
    })

    const response = await ctx.client.request('GET', `/api/companies/${company.id}/dashboard`, {
      headers: ownerCookie,
    })
    expect(response.status).toBe(200)
    const body = response.json<{
      company: { id: string; role: string }
      counts: { tasks: Record<string, number>; agentsEnabled: number; agentsTotal: number; documents: number }
      cost: { today: number; limitPerDay: number }
      recentActivity: { kind: string }[]
    }>()
    expect(body.company.id).toBe(company.id)
    expect(body.company.role).toBe('owner')
    expect(body.counts.tasks['assigned']).toBe(1)
    expect(body.counts.agentsEnabled).toBe(10)
    expect(body.counts.agentsTotal).toBe(10)
    expect(typeof body.cost.today).toBe('number')
    expect(body.cost.limitPerDay).toBeGreaterThan(0)
    expect(body.recentActivity.some((entry) => entry.kind === 'company.create')).toBe(true)
  })

  it('liệt kê tài sản đầu ra và trả một tài sản theo id', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'artifact-owner@example.com', 'Artifact Co')
    const artifact = ctx.repos.work.addArtifact({
      companyId: company.id,
      name: 'Kế hoạch nội dung',
      kind: 'markdown',
      content: '# Kế hoạch',
    })

    const list = await ctx.client.request('GET', `/api/companies/${company.id}/artifacts`, {
      headers: ownerCookie,
    })
    expect(list.status).toBe(200)
    expect(list.json<{ artifacts: { id: string }[] }>().artifacts.map((item) => item.id)).toContain(artifact.id)

    const single = await ctx.client.request('GET', `/api/artifacts/${artifact.id}`, { headers: ownerCookie })
    expect(single.status).toBe(200)
    expect(single.json<{ name: string; content: string | null }>().name).toBe('Kế hoạch nội dung')
  })

  it('cô lập tenant: công ty B không xem được sơ đồ, dashboard hay tài sản của A', async () => {
    const a = await tenant(ctx, 'diagram-a@example.com', 'Diagram A')
    const b = await tenant(ctx, 'diagram-b@example.com', 'Diagram B')
    const artifact = ctx.repos.work.addArtifact({
      companyId: a.company.id,
      name: 'Tài sản A',
      kind: 'markdown',
      content: 'bí mật',
    })

    const diagram = await ctx.client.request('GET', `/api/companies/${a.company.id}/diagram`, {
      headers: b.ownerCookie,
    })
    expect(diagram.status).toBe(404)

    const dashboard = await ctx.client.request('GET', `/api/companies/${a.company.id}/dashboard`, {
      headers: b.ownerCookie,
    })
    expect(dashboard.status).toBe(404)

    const single = await ctx.client.request('GET', `/api/artifacts/${artifact.id}`, {
      headers: b.ownerCookie,
    })
    expect(single.status).toBe(404)
  })
})
