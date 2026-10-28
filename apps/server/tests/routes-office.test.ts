import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoutesTestContext, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext
let ownerCookie: Record<string, string>
let companyId: string

beforeEach(async () => {
  ctx = await createRoutesTestContext()
  const fixture = await tenant(ctx, `office-routes-${Date.now()}@example.com`, 'AI Office Routes')
  ownerCookie = fixture.ownerCookie
  companyId = fixture.company.id
})

afterEach(async () => {
  await ctx.close()
})

const officePath = () => `/api/companies/${companyId}/office`

describe('AI Office routes', () => {
  it('returns office overview', async () => {
    const response = await ctx.client.request('GET', `${officePath()}/overview`, { headers: ownerCookie })
    expect(response.status).toBe(200)
    const overview = response.json<{
      agents: unknown[]
      campus: { rooms: Array<{ department: string }> }
      rooms: Array<{ department: string }>
    }>()
    expect(overview.agents).toHaveLength(11)
    expect(overview.campus.rooms).toHaveLength(11)
    expect(overview.rooms).toHaveLength(11)
    expect(new Set(overview.rooms.map((room) => room.department)).size).toBe(11)
    expect(new Set(overview.campus.rooms.map((room) => room.department)).size).toBe(11)
  })

  it('returns a valid desk and 404 for an unknown role', async () => {
    const valid = await ctx.client.request('GET', `${officePath()}/desks/content-writer`, { headers: ownerCookie })
    expect(valid.status).toBe(200)
    expect(valid.json<{ agent: { role: string } }>().agent.role).toBe('content-writer')

    const leader = await ctx.client.request('GET', `${officePath()}/desks/marketing-leader`, { headers: ownerCookie })
    expect(leader.status).toBe(200)
    expect(leader.json<{ agent: { role: string } }>().agent.role).toBe('marketing-leader')

    const missing = await ctx.client.request('GET', `${officePath()}/desks/not-a-role`, { headers: ownerCookie })
    expect(missing.status).toBe(404)
  })

  it('lists office tasks with counts and filters by role and status', async () => {
    const writer = ctx.repos.team.findAgentDefByRole('content-writer')!
    const leader = ctx.repos.team.findAgentDefByRole('marketing-leader')!
    ctx.repos.work.createTask({
      companyId,
      title: 'Writer task assigned',
      briefMd: 'Write a campaign',
      assigneeAgentDefId: writer.id,
      status: 'assigned',
    })
    ctx.repos.work.createTask({
      companyId,
      title: 'Writer task done',
      briefMd: 'Finish the campaign',
      assigneeAgentDefId: writer.id,
      status: 'done',
    })
    ctx.repos.work.createTask({
      companyId,
      title: 'Leader task assigned',
      briefMd: 'Review the campaign',
      assigneeAgentDefId: leader.id,
      status: 'assigned',
    })

    const response = await ctx.client.request('GET', `${officePath()}/tasks`, { headers: ownerCookie })
    expect(response.status).toBe(200)
    const result = response.json<{ tasks: Array<{ title: string }>; counts: Record<string, number> }>()
    expect(result.tasks).toHaveLength(3)
    expect(result.counts.assigned).toBe(2)
    expect(result.counts.done).toBe(1)

    const byRole = await ctx.client.request('GET', `${officePath()}/tasks?role=content-writer`, { headers: ownerCookie })
    expect(byRole.status).toBe(200)
    const roleResult = byRole.json<{ tasks: Array<{ title: string }>; counts: Record<string, number> }>()
    expect(roleResult.tasks.map((task) => task.title)).toEqual(['Writer task assigned', 'Writer task done'])
    expect(roleResult.counts.assigned).toBe(1)
    expect(roleResult.counts.done).toBe(1)

    const byStatus = await ctx.client.request('GET', `${officePath()}/tasks?status=done`, { headers: ownerCookie })
    expect(byStatus.status).toBe(200)
    const statusResult = byStatus.json<{ tasks: Array<{ title: string }>; counts: Record<string, number> }>()
    expect(statusResult.tasks.map((task) => task.title)).toEqual(['Writer task done'])
    expect(statusResult.counts.done).toBe(1)

    const byRoleAndStatus = await ctx.client.request('GET', `${officePath()}/tasks?role=content-writer&status=assigned`, { headers: ownerCookie })
    expect(byRoleAndStatus.status).toBe(200)
    const combinedResult = byRoleAndStatus.json<{ tasks: Array<{ title: string }>; counts: Record<string, number> }>()
    expect(combinedResult.tasks.map((task) => task.title)).toEqual(['Writer task assigned'])
    expect(combinedResult.counts.assigned).toBe(1)
    expect(combinedResult.counts.done).toBe(0)
  })

  it('dispatches valid tasks and validates required title and role', async () => {
    const valid = await ctx.client.request('POST', `${officePath()}/dispatch`, {
      headers: ownerCookie,
      body: { title: 'Prepare campaign brief', assigneeRole: 'content-writer', briefMd: 'Draft a launch campaign brief' },
    })
    expect(valid.status).toBe(201)
    expect(valid.json<{ task: { title: string; assigneeAgentDefId: string } }>().task.title).toBe('Prepare campaign brief')

    const noTitle = await ctx.client.request('POST', `${officePath()}/dispatch`, {
      headers: ownerCookie,
      body: { assigneeRole: 'content-writer', briefMd: 'Missing title' },
    })
    expect(noTitle.status).toBe(400)

    const noRole = await ctx.client.request('POST', `${officePath()}/dispatch`, {
      headers: ownerCookie,
      body: { title: 'Missing role', briefMd: 'No assignee role' },
    })
    expect(noRole.status).toBe(400)
  })

  it('pings an agent desk', async () => {
    const response = await ctx.client.request('POST', `${officePath()}/desks/content-writer/ping`, {
      headers: ownerCookie,
      body: { message: 'What are you working on?' },
    })
    expect(response.status).toBe(200)
    const result = response.json<{ role: string; agentName: string; message: string }>()
    expect(result.role).toBe('content-writer')
    expect(result.message).toBeTruthy()
  })

  it('opens the office event stream with event-stream content type', async () => {
    const response = await fetch(`${ctx.client.baseUrl}${officePath()}/stream`, { headers: ownerCookie })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    await response.body?.cancel()
  })
})

