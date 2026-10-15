import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RuntimeObservation, WorkflowSnapshotResponse } from '@marketing-agent/shared'
import { addMember, createRoutesTestContext, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'
import { collectSse, type SseCollector } from './helpers/sse-helpers.ts'

let ctx: RoutesTestContext
const collectors: SseCollector[] = []
beforeEach(async () => { ctx = await createRoutesTestContext() })
afterEach(async () => {
  try {
    await Promise.all(collectors.splice(0).map((collector) => collector.close()))
    expect(ctx.app.context.events.subscriberCount()).toBe(0)
  } finally {
    await ctx.close()
  }
})

async function conversation(cookie: Record<string, string>, companyId: string, title = 'Workflow') {
  const response = await ctx.client.request('POST', `/api/companies/${companyId}/conversations`, { headers: cookie, body: { title } })
  expect(response.status).toBe(201)
  return response.json<{ conversation: { id: string } }>().conversation.id
}

async function snapshot(cookie: Record<string, string>, id: string) {
  const response = await ctx.client.request('GET', `/api/conversations/${id}/workflow`, { headers: cookie })
  expect(response.status, response.body).toBe(200)
  return response.json<WorkflowSnapshotResponse>()
}

async function stream(cookie: Record<string, string>, id: string, query = '') {
  const collector = await collectSse(`${ctx.client.baseUrl}/api/conversations/${id}/stream${query}`, cookie, { events: ctx.app.context.events })
  collectors.push(collector)
  return collector
}

function payload(event: { data: { payload: unknown } }) { return event.data.payload as Record<string, unknown> }

function observation(input: {
  companyId: string; conversationId: string; runId: string; agentDefId: string; taskId?: string | null
}, type: RuntimeObservation['type'], extra: Partial<RuntimeObservation> = {}): RuntimeObservation {
  return { ...input, taskId: input.taskId ?? null, agentRole: 'market-research', type, at: new Date().toISOString(), ...extra }
}

function publish(event: RuntimeObservation) {
  ctx.app.context.events.publish({ type: event.type, companyId: event.companyId, payload: event, at: event.at })
}

function startRun(companyId: string, conversationId: string | null, taskId?: string) {
  const agentDefId = ctx.repos.team.listAgentDefs().find((def) => def.role === 'market-research')!.id
  const id = ctx.repos.accounting.startRun({ companyId, conversationId, taskId, agentDefId })
  return { id, agentDefId }
}

function finishRun(id: string, error?: string) {
  ctx.repos.accounting.finishRun(id, { status: error ? 'failed' : 'succeeded', tokensIn: 7, tokensOut: 11, costUsd: 0.012, latencyMs: 25, steps: 1, error })
}

describe('conversation workflow snapshot and scoped SSE', () => {
  it('returns an empty pre-plan schema and allows viewer reads, failing closed for outsiders and unauthenticated clients', async () => {
    const a = await tenant(ctx, 'workflow-owner@example.com', 'Workflow A')
    const b = await tenant(ctx, 'workflow-outsider@example.com', 'Workflow B')
    const viewer = await addMember(ctx, a.company.id, 'workflow-viewer@example.com', 'viewer')
    const id = await conversation(a.ownerCookie, a.company.id)
    const body = await snapshot(viewer.cookie, id)
    expect(body).toMatchObject({ schemaVersion: 1, conversation: { id, phase: 'intake' }, tasks: [], dependencies: [], runs: [], activeRuns: [], historyTruncated: false, usage: { runs: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 } })
    expect(Number.isFinite(Date.parse(body.generatedAt))).toBe(true)
    expect(Object.values(body.counts).every((count) => count === 0)).toBe(true)
    const baseline = ctx.app.context.events.subscriberCount()
    const viewerStream = await stream(viewer.cookie, id)
    expect(viewerStream.response.status).toBe(200)
    await viewerStream.close()
    expect(ctx.app.context.events.subscriberCount()).toBe(baseline)
    for (const suffix of ['workflow', 'stream']) {
      const outside = await ctx.client.request('GET', `/api/conversations/${id}/${suffix}`, { headers: b.ownerCookie })
      expect(outside.status).toBe(404)
      const anonymous = await ctx.client.request('GET', `/api/conversations/${id}/${suffix}`)
      expect(anonymous.status).toBe(401)
      const missing = await ctx.client.request('GET', `/api/conversations/not-a-conversation/${suffix}`, { headers: a.ownerCookie })
      expect(missing.status).toBe(404)
    }
    expect(ctx.app.context.events.subscriberCount()).toBe(baseline)
  })

  it('projects exact conversation IDs/dependencies despite duplicate titles and omits raw task, artifact, and run content', async () => {
    const a = await tenant(ctx, 'workflow-graph-a@example.com', 'Graph A')
    const b = await tenant(ctx, 'workflow-graph-b@example.com', 'Graph B')
    const id = await conversation(a.ownerCookie, a.company.id)
    const peerId = await conversation(a.ownerCookie, a.company.id, 'Same company peer')
    const otherId = await conversation(b.ownerCookie, b.company.id)
    const sensitive = 'RAW_PRIVATE_PROMPT_API_KEY_AND_ERROR'
    const first = ctx.repos.work.createTask({ companyId: a.company.id, conversationId: id, title: 'Duplicate title', briefMd: sensitive, status: 'done' })
    const second = ctx.repos.work.createTask({ companyId: a.company.id, conversationId: id, title: 'Duplicate title', briefMd: sensitive, status: 'assigned', parentTaskId: first.id })
    const peer = ctx.repos.work.createTask({ companyId: a.company.id, conversationId: peerId, title: 'Duplicate title', briefMd: sensitive })
    const other = ctx.repos.work.createTask({ companyId: b.company.id, conversationId: otherId, title: 'Duplicate title', briefMd: sensitive })
    ctx.repos.work.addDependency(second.id, first.id)
    // Legacy/corrupt cross-scope edges must never leak IDs through this read model.
    ctx.repos.work.addDependency(second.id, peer.id)
    ctx.repos.work.addDependency(second.id, other.id)
    ctx.repos.work.updateTask(first.id, a.company.id, { resultMd: sensitive })
    ctx.repos.work.addArtifact({ companyId: a.company.id, taskId: first.id, name: 'Private output', kind: 'markdown', content: sensitive })
    const ownRun = startRun(a.company.id, id, first.id)
    finishRun(ownRun.id, sensitive)
    const fallbackRun = startRun(a.company.id, null, second.id)
    finishRun(fallbackRun.id)
    finishRun(startRun(a.company.id, peerId, peer.id).id)
    finishRun(startRun(b.company.id, otherId, other.id).id)
    const body = await snapshot(a.ownerCookie, id)
    expect(body.tasks.map((task) => task.id).sort()).toEqual([first.id, second.id].sort())
    expect(body.tasks.map((task) => task.title)).toEqual(['Duplicate title', 'Duplicate title'])
    expect(body.tasks.find((task) => task.id === second.id)?.parentTaskId).toBe(first.id)
    expect(body.tasks.find((task) => task.id === first.id)?.artifactCount).toBe(1)
    expect(body.dependencies).toHaveLength(1)
    expect(body.dependencies[0]).toMatchObject({ sourceTaskId: first.id, targetTaskId: second.id })
    expect(body.dependencies[0]!.id).toBeTruthy()
    expect(body.runs.map((run) => run.id)).toEqual([ownRun.id])
    expect(body.runs.map((run) => run.id)).not.toContain(fallbackRun.id)
    expect(body.runs.every((run) => run.activity === 'terminal')).toBe(true)
    expect(body.counts.done).toBe(1)
    expect(body.counts.assigned).toBe(1)
    expect(body.graphEligible).toBe(true)
    const serialized = JSON.stringify(body)
    for (const forbidden of [sensitive, peer.id, other.id, peerId, otherId, 'briefMd', 'resultMd', '"error"']) expect(serialized).not.toContain(forbidden)
  })

  it('strictly scopes live and reconnect SSE: explicit scope wins, task fallback works, unscoped events are rejected', async () => {
    const a = await tenant(ctx, 'workflow-scope-a@example.com', 'Scope A')
    const b = await tenant(ctx, 'workflow-scope-b@example.com', 'Scope B')
    const id = await conversation(a.ownerCookie, a.company.id)
    const peerId = await conversation(a.ownerCookie, a.company.id)
    const otherId = await conversation(b.ownerCookie, b.company.id)
    const ownTask = ctx.repos.work.createTask({ companyId: a.company.id, conversationId: id, title: 'Own', briefMd: '' })
    const peerTask = ctx.repos.work.createTask({ companyId: a.company.id, conversationId: peerId, title: 'Peer', briefMd: '' })
    const otherTask = ctx.repos.work.createTask({ companyId: b.company.id, conversationId: otherId, title: 'Other', briefMd: '' })
    const live = await stream(a.ownerCookie, id)
    const since = '2020-01-01T00:00:00.000Z'
    const emit = (companyId: string, value: unknown) => ctx.app.context.events.publish({ type: 'warning', companyId, payload: value, at: new Date().toISOString() })
    emit(a.company.id, { conversationId: peerId, taskId: ownTask.id, marker: 'explicit-peer-rejected' })
    emit(a.company.id, { conversationId: '', taskId: ownTask.id, marker: 'invalid-explicit-rejected' })
    emit(a.company.id, { companyId: b.company.id, conversationId: id, marker: 'mismatched-payload-company-rejected' })
    emit(a.company.id, { taskId: peerTask.id, marker: 'peer-task-rejected' })
    emit(a.company.id, { taskId: otherTask.id, marker: 'foreign-task-rejected' })
    emit(a.company.id, { taskId: 'missing-task', marker: 'missing-task-rejected' })
    for (const value of [null, 'raw-unscoped', {}, { conversationId: null }, { message: 'company-only-rejected' }]) emit(a.company.id, value)
    emit(b.company.id, { conversationId: id, marker: 'other-company-rejected' })
    emit(a.company.id, { taskId: ownTask.id, marker: 'task-fallback-accepted' })
    emit(a.company.id, { conversationId: id, marker: 'explicit-accepted' })
    emit(a.company.id, { conversationId: id, marker: 'barrier' })
    await live.waitFor((event) => payload(event).marker === 'barrier')
    expect(live.events.map((event) => payload(event).marker)).toEqual(['task-fallback-accepted', 'explicit-accepted', 'barrier'])
    await live.close()
    const replay = await stream(a.ownerCookie, id, `?since=${encodeURIComponent(since)}`)
    await replay.waitFor((event) => payload(event).marker === 'barrier')
    expect(replay.events.map((event) => payload(event).marker)).toEqual(['task-fallback-accepted', 'explicit-accepted', 'barrier'])
  })

  it('only confirms active runs from lifecycle observations and clears model/tool/retry metadata at finish', async () => {
    const a = await tenant(ctx, 'workflow-live@example.com', 'Live Co')
    const id = await conversation(a.ownerCookie, a.company.id)
    const peerId = await conversation(a.ownerCookie, a.company.id)
    const task = ctx.repos.work.createTask({ companyId: a.company.id, conversationId: id, title: 'Live', briefMd: 'private' })
    const run = startRun(a.company.id, id, task.id)
    const scope = { companyId: a.company.id, conversationId: id, runId: run.id, agentDefId: run.agentDefId, taskId: task.id }
    let body = await snapshot(a.ownerCookie, id)
    expect(body.activeRuns).toEqual([])
    expect(body.runs.find((value) => value.id === run.id)?.activity).toBe('unverified')
    publish(observation(scope, 'model.started', { requestIndex: 0 }))
    expect((await snapshot(a.ownerCookie, id)).activeRuns).toEqual([])
    publish(observation(scope, 'run.started', { modelId: 'model-safe', providerId: 'provider-safe' }))
    publish(observation(scope, 'model.started', { requestIndex: 1 }))
    publish(observation(scope, 'tool.started', { toolInvocationId: 'tool-safe', toolName: 'file_read' }))
    publish(observation(scope, 'run.retrying', { strategy: 'retry', errorCode: 'rate_limited', httpStatus: 429 }))
    body = await snapshot(a.ownerCookie, id)
    expect(body.activeRuns).toHaveLength(1)
    expect(body.activeRuns[0]).toMatchObject({ runId: run.id, taskId: task.id, modelId: 'model-safe', providerId: 'provider-safe', modelRequest: { requestIndex: 1 }, tools: [{ id: 'tool-safe', name: 'file_read' }], retry: { strategy: 'retry' } })
    expect(body.runs.find((value) => value.id === run.id)?.activity).toBe('active')
    expect((await snapshot(a.ownerCookie, peerId)).activeRuns).toEqual([])
    publish(observation(scope, 'tool.finished', { toolInvocationId: 'tool-safe', toolName: 'file_read', outcome: 'succeeded' }))
    publish(observation(scope, 'model.finished', { requestIndex: 1, outcome: 'succeeded' }))
    body = await snapshot(a.ownerCookie, id)
    expect(body.activeRuns[0]?.tools).toEqual([])
    expect(body.activeRuns[0]?.modelRequest).toBeNull()
    finishRun(run.id)
    publish(observation(scope, 'run.finished', { status: 'succeeded' }))
    // Late hints must not resurrect a terminal run.
    publish(observation(scope, 'tool.started', { toolInvocationId: 'late', toolName: 'file_read' }))
    publish(observation(scope, 'run.started'))
    body = await snapshot(a.ownerCookie, id)
    expect(body.activeRuns).toEqual([])
    expect(body.runs.find((value) => value.id === run.id)?.activity).toBe('terminal')
  })

  it('supports exactly 500 tasks, caps repeated run history, and fails closed instead of returning a partial graph above the task cap', async () => {
    const a = await tenant(ctx, 'workflow-cap@example.com', 'Cap Co')
    const id = await conversation(a.ownerCookie, a.company.id)
    ctx.repos.db.tx(() => {
      for (let index = 0; index < 500; index++) {
        ctx.repos.work.createTask({ companyId: a.company.id, conversationId: id, title: `Task ${index}`, briefMd: '', status: 'assigned' })
      }
      for (let index = 0; index < 501; index++) finishRun(startRun(a.company.id, id).id)
    })
    const body = await snapshot(a.ownerCookie, id)
    expect(body.tasks).toHaveLength(500)
    expect(body.runs).toHaveLength(50)
    expect(body.historyTruncated).toBe(true)
    expect(body.graphEligible).toBe(false)
    expect(body.counts.assigned).toBe(500)
    expect(body.usage.runs).toBe(501)
    expect(body.usage.tokensIn).toBe(501 * 7)
    expect(body.usage.tokensOut).toBe(501 * 11)
    ctx.repos.work.createTask({ companyId: a.company.id, conversationId: id, title: 'Over cap', briefMd: '' })
    const over = await ctx.client.request('GET', `/api/conversations/${id}/workflow`, { headers: a.ownerCookie })
    expect(over.status).toBe(409)
    expect(over.json<{ error: { code: string } }>().error.code).toBe('conflict')
  })
})
