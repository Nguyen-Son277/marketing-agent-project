import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRepos, type Repos } from '@marketing-agent/db'
import { seedCatalog, seedCompany } from '@marketing-agent/seed'
import { ToolRegistry } from '@marketing-agent/tools'
import { createCoordinationTools } from '../../tools/src/coordination.ts'
import type { LlmChunk, RuntimeObservation, ToolDefinition } from '@marketing-agent/shared'
import type { ChatAdapter } from '@marketing-agent/agent-runtime'
import { ConversationOrchestrator, DEFAULT_LIMITS, dispatchPlan, reviewOutcomes, runAgentForTask, type AppEvent, type PlanResult } from '../src/index.ts'

let repos: Repos
let companyId: string
let conversationId: string
let userId: string
let events: AppEvent[]

beforeEach(() => {
  repos = createRepos({ file: ':memory:', allowWeakSecret: true })
  seedCatalog(repos)
  companyId = seedCompany(repos, { companyName: 'Workflow events' }).company.id
  const provider = repos.llm.createProvider({ companyId, name: 'Test', kind: 'openai_compatible', baseUrl: 'http://localhost:1/v1' })
  const model = repos.llm.createModel({ providerId: provider.id, modelId: 'test-model', label: 'Test', supportsTools: true })
  for (const preset of repos.team.listPresets(companyId)) {
    repos.team.updatePreset(companyId, preset.agentDefId, { modelFk: model.id })
    repos.team.setPresetTools(preset.id, companyId, ['probe', 'agent_escalate'])
  }
  userId = repos.auth.createUser({ email: 'workflow@example.com', password: 'a-secure-test-password', name: 'Workflow' }).id
  conversationId = repos.work.createConversation({ companyId, userId, title: 'Workflow' }).id
  events = []
})
afterEach(() => vi.restoreAllMocks())

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
function text(text = 'Completed'): LlmChunk[] {
  return [{ type: 'text', text }, { type: 'done', finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 5, cachedTokens: 0 } }]
}
const probe: ToolDefinition = {
  name: 'probe', description: 'Safe test tool', parameters: { type: 'object', properties: {} },
  async handler() { return { content: 'probe complete' } },
}
function toolAdapter(name = 'probe', args = '{}'): ChatAdapter {
  return {
    async *chat(request) {
      if (!request.messages.some((message) => message.role === 'tool')) {
        yield { type: 'tool_call', call: { id: 'call-1', name, argumentsJson: args } }
        yield { type: 'done', finishReason: 'tool_calls', usage: { promptTokens: 10, completionTokens: 5, cachedTokens: 0 } }
      } else {
        for (const chunk of text()) yield chunk
      }
    },
  }
}
function makeTask(title: string, role = 'content-writer', scope: string | null = conversationId) {
  return repos.work.createTask({ companyId, conversationId: scope, title, briefMd: `Do ${title}`, status: 'assigned', assigneeAgentDefId: repos.team.findAgentDefByRole(role)!.id })
}
function planFor(titles: readonly string[]): PlanResult {
  return { tasks: titles.map((title) => ({ id: title, title, assigneeRole: 'content-writer', dependsOn: [] })), order: [...titles] }
}
function dispatch(plan: PlanResult, adapter: ChatAdapter, scope: string | null = conversationId) {
  return dispatchPlan({ repos, companyId, conversationId: scope, tools: new ToolRegistry([probe]), plan,
    limits: { ...DEFAULT_LIMITS, maxParallelTasks: 2 }, runtimeOverrides: { adapter }, publish: (appEvent) => events.push(appEvent) })
}
function payload(appEvent: AppEvent) { return appEvent.payload as Omit<RuntimeObservation, 'status'> & { status?: string; phase?: string; id?: string } }

function expectTrace(scope: string, taskId: string | null, role: string) {
  const runtimeEvents = events.filter((appEvent) => appEvent.type === 'run.started' || appEvent.type === 'run.finished' || appEvent.type.startsWith('model.') || appEvent.type.startsWith('tool.'))
  expect(runtimeEvents.map((appEvent) => appEvent.type)).toEqual(['run.started', 'model.started', 'model.finished', 'tool.started', 'tool.finished', 'model.started', 'model.finished', 'run.finished'])
  for (const appEvent of runtimeEvents) {
    const observation = payload(appEvent)
    expect(appEvent.companyId).toBe(companyId)
    expect(appEvent.at).toBe(observation.at)
    expect(observation).toMatchObject({ companyId, conversationId: scope, taskId, agentRole: role })
    expect(observation.runId).toBeTruthy()
  }
  expect(events.some((appEvent) => appEvent.type === 'tool.called')).toBe(false)
  const toolEvents = runtimeEvents.filter((appEvent) => appEvent.type.startsWith('tool.'))
  expect(payload(toolEvents[0]!).toolInvocationId).toBe(payload(toolEvents[1]!).toolInvocationId)
}

describe('live workflow publication', () => {
  it('publishes a fast task terminal state before a gated slow sibling, without changing the batch scheduler', async () => {
    const slow = makeTask('slow')
    const fast = makeTask('fast')
    const dependent = makeTask('dependent')
    const slowGate = deferred()
    const fastPublished = deferred()
    const plan = planFor(['slow', 'fast', 'dependent'])
    const withDependency = { ...plan, tasks: plan.tasks.map((task) => task.title === 'dependent' ? { ...task, dependsOn: ['fast'] } : task) }
    const started: string[] = []
    const adapter: ChatAdapter = {
      async *chat(request) {
        const brief = request.messages.find((message) => message.role === 'user')?.content ?? ''
        const title = brief.includes('### slow') ? 'slow' : brief.includes('### fast') ? 'fast' : 'dependent'
        started.push(title)
        if (title === 'slow') await slowGate.promise
        for (const chunk of text(title)) yield chunk
      },
    }
    const result = dispatchPlan({ repos, companyId, conversationId, tools: new ToolRegistry(), plan: withDependency,
      limits: { ...DEFAULT_LIMITS, maxParallelTasks: 2 }, runtimeOverrides: { adapter }, publish: (appEvent) => {
        events.push(appEvent)
        if (appEvent.type === 'task.updated' && payload(appEvent).taskId === fast.id && payload(appEvent).status === 'done') fastPublished.resolve()
      } })
    try {
      await fastPublished.promise
      expect(repos.work.findTask(fast.id, companyId)?.status).toBe('done')
      expect(repos.work.findTask(slow.id, companyId)?.status).toBe('in_progress')
      expect(started).not.toContain('dependent')
      expect(events.filter((appEvent) => appEvent.type === 'task.updated' && payload(appEvent).taskId === fast.id).map((appEvent) => payload(appEvent).status)).toEqual(['in_progress', 'done'])
    } finally { slowGate.resolve() }
    expect((await result).completed).toBe(3)
    for (const task of [slow, fast, dependent]) {
      expect(events.filter((appEvent) => appEvent.type === 'task.updated' && payload(appEvent).taskId === task.id && payload(appEvent).status === 'done')).toHaveLength(1)
    }
  })

  it('forwards scoped runtime/tool lifecycle for a directly dispatched task', async () => {
    const task = makeTask('direct')
    repos.work.addArtifact({ companyId, taskId: task.id, name: 'Output', kind: 'markdown', content: 'Result' })
    const orchestrator = new ConversationOrchestrator({ repos, tools: new ToolRegistry([probe]), runtimeOverrides: { adapter: toolAdapter() }, publish: (appEvent) => events.push(appEvent) })
    expect((await orchestrator.dispatchTask({ companyId, conversationId }, task.id)).status).toBe('done')
    expectTrace(conversationId, task.id, 'content-writer')
    expect(events.filter((appEvent) => appEvent.type === 'task.updated').map((appEvent) => payload(appEvent).status)).toEqual(['in_progress', 'done'])
    expect(events.some((appEvent) => appEvent.type === 'artifact.created')).toBe(true)
    expect(events.every((appEvent) => payload(appEvent).conversationId === conversationId)).toBe(true)
  })

  it('forwards scoped leader and peer runtime/tool lifecycle', async () => {
    const orchestrator = new ConversationOrchestrator({ repos, tools: new ToolRegistry([probe]), runtimeOverrides: { adapter: toolAdapter() }, publish: (appEvent) => events.push(appEvent) })
    repos.work.updateConversation(conversationId, companyId, { brief: { objective: 'Increase sales', kpi: '50 leads monthly', scope: 'Email marketing', deadline: '2026-12-31', budget: '10 million VND', constraints: 'No customer photos' } })
    await orchestrator.sendMessage({ companyId, conversationId, userId, content: 'Proceed with the agreed brief' })
    expectTrace(conversationId, null, 'marketing-leader')
    expect(events.filter((appEvent) => appEvent.type === 'conversation.updated').map((appEvent) => payload(appEvent).phase)).toEqual(['brief', 'plan'])
    expect(events.filter((appEvent) => appEvent.type === 'conversation.updated').every((appEvent) => payload(appEvent).id === conversationId)).toBe(true)
    events = []
    const task = makeTask('peer')
    await orchestrator.askPeer({ companyId, conversationId, taskId: task.id, fromRole: 'content-writer', toRole: 'analytics', question: 'What data exists?' })
    expectTrace(conversationId, task.id, 'analytics')
    expect(events.filter((appEvent) => appEvent.type === 'agent.message')).toHaveLength(2)
    expect(events.every((appEvent) => payload(appEvent).conversationId === conversationId)).toBe(true)
  })

  it('forwards review runtime observations through optional publish', async () => {
    await reviewOutcomes({ repos, companyId, conversationId, tools: new ToolRegistry([probe]), runtimeOverrides: { adapter: toolAdapter() }, publish: (appEvent) => events.push(appEvent),
      brief: 'Review', limits: DEFAULT_LIMITS, summary: { completed: 1, blocked: 0, failed: 0, outcomes: [{ taskId: 't', title: 'T', assigneeRole: 'analytics', status: 'done', resultMd: 'Too short', artifactIds: [], run: null }] } })
    expectTrace(conversationId, null, 'marketing-leader')
  })

  it('does not broadcast null-scoped runs, tasks or peer events', async () => {
    makeTask('unscoped', 'content-writer', null)
    await dispatch(planFor(['unscoped']), toolAdapter(), null)
    const orchestrator = new ConversationOrchestrator({ repos, tools: new ToolRegistry([probe]), runtimeOverrides: { adapter: toolAdapter() }, publish: (appEvent) => events.push(appEvent) })
    await orchestrator.askPeer({ companyId, conversationId: null, taskId: null, fromRole: 'content-writer', toRole: 'analytics', question: 'Question' })
    expect(events).toEqual([])
  })

  it('never lets a throwing event sink fail the agent', async () => {
    const result = await runAgentForTask({ repos, companyId, conversationId, taskId: null, role: 'analytics', taskBrief: 'Test', tools: new ToolRegistry([probe]), runtimeOverrides: { adapter: toolAdapter() }, publish: () => { throw new Error('sink failed') } })
    expect(result.run.status).toBe('succeeded')
  })
})

describe('task blocker precedence', () => {
  it('keeps an agent_escalate blocker even when the runtime finishes successfully', async () => {
    const task = makeTask('escalated')
    const adapter = toolAdapter('agent_escalate', JSON.stringify({ reason: 'Missing GA4', attempts: 'No integration', options: ['Connect', 'Use another source'] }))
    let orchestrator!: ConversationOrchestrator
    const host = { availableRoles: () => ['marketing-leader', 'content-writer'] as const, createTasks: async () => [], dispatchTask: async () => ({ status: 'done', resultMd: '', artifactIds: [] }), askPeer: async () => ({ answer: '', roundsUsed: 1, limitReached: false }), escalate: (input: Parameters<ConversationOrchestrator['escalate']>[0]) => orchestrator.escalate(input) }
    const tools = new ToolRegistry(Object.values(createCoordinationTools(host)))
    orchestrator = new ConversationOrchestrator({ repos, tools, runtimeOverrides: { adapter }, publish: (appEvent) => events.push(appEvent) })
    const result = await dispatchPlan({ repos, tools, companyId, conversationId, plan: planFor(['escalated']), limits: DEFAULT_LIMITS, runtimeOverrides: { adapter }, publish: (appEvent) => events.push(appEvent) })
    expect(result.outcomes[0]?.run?.status).toBe('succeeded')
    expect(result.outcomes[0]?.status).toBe('blocked')
    expect(repos.work.findTask(task.id, companyId)?.status).toBe('blocked')
    expect(result.outcomes[0]?.resultMd).toContain('Missing GA4')
    expect(events.filter((appEvent) => appEvent.type === 'task.updated').some((appEvent) => payload(appEvent).status === 'done')).toBe(false)
  })

  it('keeps DB cancellation after a successful runtime and maps runtime cancellation to cancelled', async () => {
    const task = makeTask('cancelled-in-db')
    const adapter: ChatAdapter = { async *chat() { repos.work.updateTask(task.id, companyId, { status: 'cancelled', resultMd: 'User cancelled' }); for (const chunk of text()) yield chunk } }
    const summary = await dispatch(planFor(['cancelled-in-db']), adapter)
    expect(summary.outcomes[0]?.run?.status).toBe('succeeded')
    expect(summary.outcomes[0]?.status).toBe('cancelled')
    expect(repos.work.findTask(task.id, companyId)?.status).toBe('cancelled')
    const runtimeTask = makeTask('runtime-cancelled')
    const controller = new AbortController()
    controller.abort()
    const runtimeSummary = await dispatchPlan({ repos, tools: new ToolRegistry(), companyId, conversationId, plan: planFor(['runtime-cancelled']), limits: DEFAULT_LIMITS, signal: controller.signal, runtimeOverrides: { adapter: toolAdapter() } })
    expect(runtimeSummary.outcomes[0]?.status).toBe('cancelled')
    expect(repos.work.findTask(runtimeTask.id, companyId)?.status).toBe('cancelled')
  })

  it('handles a cancelled task start transition gracefully without overwriting cancellation', async () => {
    const task = makeTask('already-cancelled')
    repos.work.updateTask(task.id, companyId, { status: 'cancelled', resultMd: 'Cancelled before start' })
    const summary = await dispatch(planFor(['already-cancelled']), toolAdapter())
    expect(summary.outcomes[0]?.status).toBe('cancelled')
    expect(summary.outcomes[0]?.run).toBeNull()
    expect(repos.work.findTask(task.id, companyId)?.status).toBe('cancelled')
    expect(events.filter((appEvent) => appEvent.type === 'task.updated').map((appEvent) => payload(appEvent).status)).toEqual(['cancelled'])
  })

  it('preserves direct task blockers and cancellation on runtime setup exceptions', async () => {
    const task = makeTask('direct-blocked')
    const adapter: ChatAdapter = { async *chat() { repos.work.updateTask(task.id, companyId, { status: 'blocked', resultMd: 'Needs approval' }); for (const chunk of text()) yield chunk } }
    const orchestrator = new ConversationOrchestrator({ repos, tools: new ToolRegistry(), runtimeOverrides: { adapter } })
    const blocked = await orchestrator.dispatchTask({ companyId, conversationId }, task.id)
    expect(blocked).toMatchObject({ status: 'blocked', resultMd: 'Needs approval' })
    expect(repos.work.findTask(task.id, companyId)?.status).toBe('blocked')
    const cancelled = makeTask('direct-cancelled')
    repos.work.updateTask(cancelled.id, companyId, { status: 'cancelled', resultMd: 'Do not run' })
    expect(await orchestrator.dispatchTask({ companyId, conversationId }, cancelled.id)).toMatchObject({ status: 'cancelled', resultMd: 'Do not run' })
    await orchestrator.escalate({ companyId, conversationId, taskId: cancelled.id, fromRole: 'analytics', reason: 'Late blocker', attempts: 'Tried' })
    expect(repos.work.findTask(cancelled.id, companyId)?.status).toBe('cancelled')
  })

  it('preserves DB cancellation when the runtime throws before opening a run', async () => {
    const task = makeTask('exception')
    const summary = await dispatchPlan({ repos, companyId, conversationId, tools: new ToolRegistry(), plan: planFor(['exception']), limits: DEFAULT_LIMITS,
      runtimeOverrides: { router: { chooseForAgent() { repos.work.updateTask(task.id, companyId, { status: 'cancelled', resultMd: 'Cancelled while starting' }); throw new Error('setup failed') }, chooseForRole() { throw new Error('unused') }, fallback() { return null } } as never } })
    expect(summary.outcomes[0]?.status).toBe('cancelled')
    expect(repos.work.findTask(task.id, companyId)?.status).toBe('cancelled')
  })
})
