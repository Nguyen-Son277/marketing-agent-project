import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatAdapter } from '@marketing-agent/agent-runtime'
import type { RuntimeObservation, WorkflowSnapshotResponse } from '@marketing-agent/shared'
import { configureCompanyModel, createRoutesTestContext, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'
import { setAgentRuntimeOverrides, toolRegistryFor } from '../src/services/agent-services.ts'
import { collectSse, deferred, withTimeout, type SseCollector } from './helpers/sse-helpers.ts'

const PRIVATE_PROMPT = 'PRIVATE_BRIEF_sk-test-secret-never-stream'
const PRIVATE_ARGUMENT = 'PRIVATE_TOOL_ARGUMENT_customer-export.csv'
const PRIVATE_OUTPUT = 'PRIVATE_MODEL_AND_TOOL_OUTPUT'
const RESULT = `${PRIVATE_OUTPUT}\nKết quả công việc hoàn thành với phân tích rõ ràng, giả định được nêu và đề xuất khả thi. Đây là nội dung riêng tư của tài sản đầu ra, không phải metadata cho đồ thị. Nguồn: https://example.com/research`

let ctx: RoutesTestContext
const collectors: SseCollector[] = []
beforeEach(async () => { ctx = await createRoutesTestContext() })
afterEach(async () => {
  vi.restoreAllMocks()
  try {
    await Promise.all(collectors.splice(0).map((collector) => collector.close()))
    expect(ctx.app.context.events.subscriberCount()).toBe(0)
  } finally {
    await ctx.close()
  }
})

async function createConversation(cookie: Record<string, string>, companyId: string, title: string) {
  const response = await ctx.client.request('POST', `/api/companies/${companyId}/conversations`, { headers: cookie, body: { title } })
  expect(response.status).toBe(201)
  return response.json<{ conversation: { id: string } }>().conversation.id
}

async function snapshot(cookie: Record<string, string>, id: string) {
  const response = await ctx.client.request('GET', `/api/conversations/${id}/workflow`, { headers: cookie })
  expect(response.status, response.body).toBe(200)
  return response.json<WorkflowSnapshotResponse>()
}

async function stream(cookie: Record<string, string>, id: string) {
  const collector = await collectSse(`${ctx.client.baseUrl}/api/conversations/${id}/stream`, cookie, { events: ctx.app.context.events })
  collectors.push(collector)
  return collector
}

function runtimeEvents(collector: SseCollector) {
  const types = new Set(['run.started', 'run.finished', 'model.started', 'model.finished', 'run.retrying', 'tool.started', 'tool.finished'])
  return collector.events.filter((event) => types.has(event.event))
}

describe('workflow actual HTTP runPlan lifecycle', () => {
  it('publishes a fast task completion before its gated slow peer finishes, exposes a live tool, and converges after reconnect', async () => {
    const a = await tenant(ctx, 'workflow-e2e-a@example.com', 'Workflow E2E A')
    const b = await tenant(ctx, 'workflow-e2e-b@example.com', 'Workflow E2E B')
    const id = await createConversation(a.ownerCookie, a.company.id, 'Actual runPlan')
    const peerId = await createConversation(a.ownerCookie, a.company.id, 'Same company isolation')
    const otherId = await createConversation(b.ownerCookie, b.company.id, 'Other company isolation')
    const model = configureCompanyModel(ctx, a.company.id)
    const agent = ctx.repos.team.listAgentDefs().find((def) => def.role === 'market-research')!
    const preset = ctx.repos.team.findPreset(a.company.id, agent.id)!
    ctx.repos.team.setPresetTools(preset.id, a.company.id, ['files_read'])
    const fast = ctx.repos.work.createTask({ companyId: a.company.id, conversationId: id, title: 'FAST_WORKFLOW_TASK', briefMd: PRIVATE_PROMPT, assigneeAgentDefId: agent.id, status: 'assigned' })
    const slow = ctx.repos.work.createTask({ companyId: a.company.id, conversationId: id, title: 'SLOW_WORKFLOW_TASK', briefMd: PRIVATE_PROMPT, assigneeAgentDefId: agent.id, status: 'assigned' })
    ctx.repos.work.updateConversation(id, a.company.id, { phase: 'assign' })

    const entered = deferred()
    const release = deferred()
    let toolResolved = false
    const registry = await toolRegistryFor(ctx.app.context)
    const tool = registry?.get('files_read')
    expect(tool).toBeDefined()
    const toolSpy = vi.spyOn(tool!, 'handler').mockImplementation(async (args, scope) => {
      expect(scope.companyId).toBe(a.company.id)
      expect(scope.conversationId).toBe(id)
      expect(scope.taskId).toBe(slow.id)
      expect(args.path).toBe(PRIVATE_ARGUMENT)
      entered.resolve()
      await release.promise
      toolResolved = true
      return { content: PRIVATE_OUTPUT }
    })
    const adapter: ChatAdapter = {
      async *chat(request) {
        const prompt = request.messages.map((message) => message.content).join('\n')
        if (prompt.includes('SLOW_WORKFLOW_TASK') && !request.messages.some((message) => message.role === 'tool')) {
          yield { type: 'tool_call', call: { id: 'workflow-tool-call', name: 'files_read', argumentsJson: JSON.stringify({ path: PRIVATE_ARGUMENT }) } }
          yield { type: 'done', finishReason: 'tool_calls', usage: { promptTokens: 31, completionTokens: 13, cachedTokens: 0 } }
          return
        }
        // This guarantees that the second batch member really started before the
        // fast member finishes; it is not a timing-dependent sleep assertion.
        if (prompt.includes('FAST_WORKFLOW_TASK')) await entered.promise
        yield { type: 'text', text: RESULT }
        yield { type: 'done', finishReason: 'stop', usage: { promptTokens: 37, completionTokens: 19, cachedTokens: 0 } }
      },
    }
    setAgentRuntimeOverrides(ctx.repos, { adapter })
    const baseline = ctx.app.context.events.subscriberCount()
    const live = await stream(a.ownerCookie, id)
    const peer = await stream(a.ownerCookie, peerId)
    const other = await stream(b.ownerCookie, otherId)
    expect(ctx.app.context.events.subscriberCount()).toBe(baseline + 3)
    let runSettled = false
    const runRequest = ctx.client.request('POST', `/api/conversations/${id}/run`, { headers: a.ownerCookie, body: {} }).then((response) => {
      runSettled = true
      return response
    })

    try {
      await withTimeout(entered.promise, 'actual tool handler entered')
      const startedTool = await live.waitFor((event) => event.event === 'tool.started' && (event.data.payload as RuntimeObservation).taskId === slow.id)
      expect(toolResolved).toBe(false)
      expect(runSettled).toBe(false)
      const toolPayload = startedTool.data.payload as RuntimeObservation
      expect(toolPayload).toMatchObject({ conversationId: id, companyId: a.company.id, taskId: slow.id, toolName: 'files_read', agentDefId: agent.id, agentRole: 'market-research' })
      expect(toolPayload.runId).toBeTruthy()
      expect(toolPayload.toolInvocationId).toBeTruthy()

      const done = await live.waitFor((event) => {
        const value = event.data.payload as Record<string, unknown>
        return event.event === 'task.updated' && value.taskId === fast.id && value.status === 'done'
      })
      expect(done.data.companyId).toBe(a.company.id)
      expect(toolResolved).toBe(false)
      expect(runSettled).toBe(false)
      const during = await snapshot(a.ownerCookie, id)
      expect(during.tasks.find((task) => task.id === fast.id)?.status).toBe('done')
      expect(during.tasks.find((task) => task.id === slow.id)?.status).toBe('in_progress')
      const active = during.activeRuns.find((run) => run.runId === toolPayload.runId)
      expect(active).toMatchObject({ taskId: slow.id, agentDefId: agent.id, agentRole: 'market-research', modelId: model.modelPk, providerId: model.providerId })
      expect(active?.tools).toEqual([expect.objectContaining({ id: toolPayload.toolInvocationId, name: 'files_read' })])
      expect(during.runs.find((run) => run.id === toolPayload.runId)?.activity).toBe('active')
      expect(during.runs.find((run) => run.taskId === fast.id)?.activity).toBe('terminal')
      const fastFinish = runtimeEvents(live).find((event) => event.event === 'run.finished' && (event.data.payload as RuntimeObservation).taskId === fast.id)
      expect(fastFinish?.data.payload).toMatchObject({ status: 'succeeded', conversationId: id, taskId: fast.id, requestCount: 1, toolCount: 0, usage: { tokensIn: 37, tokensOut: 19 } })
      expect((await snapshot(a.ownerCookie, peerId)).activeRuns).toEqual([])
      expect((await snapshot(b.ownerCookie, otherId)).activeRuns).toEqual([])

      for (const event of runtimeEvents(live)) {
        const value = event.data.payload as RuntimeObservation
        expect(value.companyId).toBe(a.company.id)
        expect(value.conversationId).toBe(id)
        expect([fast.id, slow.id]).toContain(value.taskId)
        expect(value.runId).toBeTruthy()
      }
      for (const value of [JSON.stringify(during), JSON.stringify(runtimeEvents(live))]) {
        for (const privateContent of [PRIVATE_PROMPT, PRIVATE_ARGUMENT, PRIVATE_OUTPUT, 'argumentsJson', '"error"']) expect(value).not.toContain(privateContent)
      }

      // Drop the subscriber before slow completion: a new stream has no complete
      // history, and must reconcile from the durable snapshot rather than infer.
      await live.close()
      expect(live.events.some((event) => event.event === 'task.updated' && (event.data.payload as Record<string, unknown>).taskId === slow.id && (event.data.payload as Record<string, unknown>).status === 'done')).toBe(false)
      release.resolve()
      const response = await withTimeout(runRequest, 'runPlan HTTP completion')
      expect(response.status, response.body).toBe(200)
      expect(response.json<{ summary: { completed: number; failed: number } }>().summary).toMatchObject({ completed: 2, failed: 0 })
      expect(toolSpy).toHaveBeenCalledTimes(1)
      expect(toolResolved).toBe(true)
      const reconnect = await stream(a.ownerCookie, id)
      const after = await snapshot(a.ownerCookie, id)
      expect(after.activeRuns).toEqual([])
      expect(after.tasks.map((task) => ({ id: task.id, status: task.status })).sort((x, y) => x.id.localeCompare(y.id))).toEqual([
        { id: fast.id, status: 'done' }, { id: slow.id, status: 'done' },
      ].sort((x, y) => x.id.localeCompare(y.id)))
      expect(after.runs.filter((run) => run.taskId === fast.id || run.taskId === slow.id)).toHaveLength(2)
      expect(after.runs.every((run) => run.activity === 'terminal' && run.status === 'succeeded')).toBe(true)
      expect(after.usage.runs).toBe(2)
      expect(after.usage.tokensIn).toBe(31 + 37 + 37)
      expect(after.counts.done).toBe(2)
      expect(after.conversation.phase).toBe('review')
      ctx.app.context.events.publish({ type: 'warning', companyId: a.company.id, payload: { conversationId: id, marker: 'reconnect-barrier' }, at: new Date().toISOString() })
      await reconnect.waitFor((event) => (event.data.payload as Record<string, unknown>).marker === 'reconnect-barrier')
      expect(reconnect.events.map((event) => event.event)).toEqual(['warning'])
      expect(peer.events).toEqual([])
      expect(other.events).toEqual([])
      await Promise.all([peer.close(), other.close(), reconnect.close()])
      expect(ctx.app.context.events.subscriberCount()).toBe(baseline)
    } finally {
      // Even a failed assertion cannot strand the HTTP run or an open SSE socket.
      release.resolve()
      await withTimeout(runRequest, 'runPlan cleanup')
      await Promise.all([live.close(), peer.close(), other.close()])
      toolSpy.mockRestore()
    }
  })
})
