import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoutesTestContext, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'
import { dispatchOfficeTask, getAgentDeskDetail, getOfficeOverview, OFFICE_ROOMS, pingAgentDesk } from '../src/services/office-service.ts'

let ctx: RoutesTestContext
let companyId: string

beforeEach(async () => {
  ctx = await createRoutesTestContext()
  const fixture = await tenant(ctx, `office-${Date.now()}@example.com`, 'AI Office Test')
  companyId = fixture.company.id
})

afterEach(async () => {
  await ctx.close()
})

describe('AI Office service', () => {
  it('returns one room and office state for each of the ten seeded agent roles', () => {
    const overview = getOfficeOverview(companyId, ctx.repos)
    const roles = ctx.repos.team.listAgentDefs().map((agent) => agent.role)

    expect(OFFICE_ROOMS).toHaveLength(11)
    expect(OFFICE_ROOMS.map((room) => room.department).sort()).toEqual(roles.sort())
    expect(OFFICE_ROOMS.every((room) => room.width >= 280 && room.height >= 200)).toBe(true)

    expect(overview.agents).toHaveLength(11)
    expect(overview.agents.map((agent) => agent.role).sort()).toEqual(roles.sort())
    expect(overview.agents.map((agent) => agent.department).sort()).toEqual(roles.sort())
    for (const agent of overview.agents) {
      expect(agent.role).toBeTruthy()
      expect(agent.department).toBeTruthy()
      expect(agent.name).toBeTruthy()
      expect(agent.status).toBeTruthy()
      expect(agent.deskPosition).toMatchObject({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) })
    }
    expect(overview.campus?.rooms).toHaveLength(11)
    expect(overview.rooms).toHaveLength(11)
  })

  it('marks an agent working when it has an in-progress task', () => {
    const agent = ctx.repos.team.findAgentDefByRole('content-writer')!
    ctx.repos.work.createTask({ companyId, title: 'Write a launch brief', briefMd: 'Draft the launch brief', assigneeAgentDefId: agent.id, status: 'in_progress' })

    const state = getOfficeOverview(companyId, ctx.repos).agents.find((item) => item.role === agent.role)
    expect(state?.status).toBe('working')
    expect(state?.currentActionEn).toContain('Write a launch brief')
  })

  it('marks an agent blocked when it has a blocked task', () => {
    const agent = ctx.repos.team.findAgentDefByRole('content-writer')!
    ctx.repos.work.createTask({ companyId, title: 'Waiting for approval', briefMd: 'Approval is required', assigneeAgentDefId: agent.id, status: 'blocked' })

    const state = getOfficeOverview(companyId, ctx.repos).agents.find((item) => item.role === agent.role)
    expect(state?.status).toBe('blocked')
    expect(state?.currentActionEn).toContain('Waiting for approval')
  })

  it('marks an agent offline when its company preset is disabled', () => {
    const agent = ctx.repos.team.findAgentDefByRole('content-writer')!
    ctx.repos.team.updatePreset(companyId, agent.id, { enabled: false })

    expect(getOfficeOverview(companyId, ctx.repos).agents.find((item) => item.role === agent.role)?.status).toBe('offline')
  })

  it('calculates agent and task counts accurately', () => {
    const defs = ctx.repos.team.listAgentDefs()
    const first = defs[0]!
    const second = defs[1]!
    ctx.repos.team.updatePreset(companyId, second.id, { enabled: false })
    ctx.repos.work.createTask({ companyId, title: 'Completed A', briefMd: '', assigneeAgentDefId: first.id, status: 'done' })
    ctx.repos.work.createTask({ companyId, title: 'Completed B', briefMd: '', assigneeAgentDefId: second.id, status: 'done' })
    ctx.repos.work.createTask({ companyId, title: 'Still working', briefMd: '', assigneeAgentDefId: first.id, status: 'in_progress' })

    const overview = getOfficeOverview(companyId, ctx.repos)
    expect(overview.stats).toMatchObject({ totalAgents: 11, enabledAgents: 10, busyAgents: 1, tasksCompletedToday: 2 })
    expect(overview.agents.find((agent) => agent.agentDefId === first.id)?.today.completedTasks).toBe(1)
    expect(overview.agents.find((agent) => agent.agentDefId === second.id)?.today.completedTasks).toBe(1)
  })

  it('returns complete desk configuration including preset, model tier, skills and tools', () => {
    const agent = ctx.repos.team.findAgentDefByRole('content-writer')!
    const preset = ctx.repos.team.findPreset(companyId, agent.id)!
    const desk = getAgentDeskDetail(companyId, agent.role, ctx.repos)

    expect(desk.agent).toMatchObject({ id: agent.id, role: agent.role })
    expect(desk.preset).toMatchObject({ id: preset.id, tier: preset.tier, enabled: true })
    expect(desk.skills.length).toBeGreaterThan(0)
    expect(desk.tools.length).toBeGreaterThan(0)
    expect(Array.isArray(desk.knowledgeAccess)).toBe(true)
  })

  it('throws notFound for a role that does not exist', () => {
    expect(() => getAgentDeskDetail(companyId, 'not-a-real-role', ctx.repos)).toThrow(/agent/i)
    try {
      getAgentDeskDetail(companyId, 'not-a-real-role', ctx.repos)
    } catch (error) {
      expect(error).toMatchObject({ code: 'not_found', status: 404 })
    }
  })

  it('returns a friendly personalized ping response for each agent role', () => {
    const agents = ctx.repos.team.listAgentDefs()
    const responses = agents.map((agent) => pingAgentDesk(companyId, agent.role, {}, ctx.repos))

    expect(responses).toHaveLength(11)
    for (const [index, agent] of agents.entries()) {
      const response = responses[index]!
      expect(response).toMatchObject({ role: agent.role, agentName: agent.name })
      expect(response.message).toContain(agent.name)
      expect(response.message).toMatch(/đang/i)
    }
    expect(new Set(responses.map((response) => response.message)).size).toBe(11)
  })

  it('dispatches a task to the matching agent and returns task and office state', async () => {
    const agent = ctx.repos.team.findAgentDefByRole('content-writer')!
    const result = await dispatchOfficeTask(companyId, {
      assigneeRole: 'content-writer',
      title: 'Write product launch copy',
      briefMd: 'Create launch copy for the new product.',
    }, ctx.repos)
    const persisted = ctx.repos.work.findTask(result.task.id, companyId)

    expect(persisted).toMatchObject({
      title: 'Write product launch copy',
      briefMd: 'Create launch copy for the new product.',
      assigneeAgentDefId: agent.id,
    })
    expect(result.task).toMatchObject({ id: persisted?.id, title: 'Write product launch copy', assigneeAgentDefId: agent.id })
    expect(result.agentState).toMatchObject({ status: 'assigned', taskId: persisted?.id })
  })
})


