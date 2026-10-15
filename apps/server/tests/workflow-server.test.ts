import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeObservation, WorkflowSnapshotResponse } from '@marketing-agent/shared'
import { EventBus } from '../src/context.ts'
import { createRequestContext } from '../src/http/router.ts'
import { SESSION_COOKIE } from '../src/http/middleware.ts'
import { eventMatchesConversation, streamAccessStillValid } from '../src/routes/chat-routes.ts'
import { workflowSnapshot } from '../src/services/workflow-snapshot.ts'
import { createRoutesTestContext, registerUser, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'

const at = '2026-10-14T03:00:00.000Z'
function observation(overrides: Partial<RuntimeObservation> = {}): RuntimeObservation {
  return {
    type: 'run.started', at, companyId: 'company-a', conversationId: 'conversation-a',
    taskId: null, runId: 'run-a', agentDefId: 'agent-a', agentRole: 'content-writer',
    ...overrides,
  }
}
function publish(bus: EventBus, event: RuntimeObservation) {
  bus.publish({ type: event.type, companyId: event.companyId, payload: event, at: event.at })
}

describe('workflow live registry', () => {
  it('tracks exact scopes, model/tool pairs, retry and finish without retaining content', () => {
    const bus = new EventBus()
    const other = new EventBus()
    publish(bus, observation())
    publish(bus, observation({ type: 'model.started', requestIndex: 2, modelId: 'm', providerId: 'p' }))
    publish(bus, observation({ type: 'tool.started', toolInvocationId: 'tool-1', toolName: 'search' }))
    publish(bus, observation({ type: 'run.retrying', strategy: 'key_rotation' }))
    expect(bus.workflowActivity('company-a', 'conversation-b')).toEqual([])
    expect(bus.workflowActivity('company-b', 'conversation-a')).toEqual([])
    expect(other.workflowActivity('company-a', 'conversation-a')).toEqual([])
    let live = bus.workflowActivity('company-a', 'conversation-a')[0]!
    expect(live.modelRequest?.requestIndex).toBe(2)
    expect(live.tools).toHaveLength(1)
    expect(live.retry?.strategy).toBe('key_rotation')
    live.tools = []
    expect(bus.workflowActivity('company-a', 'conversation-a')[0]!.tools).toHaveLength(1)
    publish(bus, observation({ type: 'model.finished', requestIndex: 1 }))
    expect(bus.workflowActivity('company-a', 'conversation-a')[0]!.modelRequest).not.toBeNull()
    publish(bus, observation({ type: 'model.finished', requestIndex: 2 }))
    publish(bus, observation({ type: 'tool.finished', toolInvocationId: 'tool-1' }))
    live = bus.workflowActivity('company-a', 'conversation-a')[0]!
    expect(live.modelRequest).toBeNull()
    expect(live.tools).toEqual([])
    publish(bus, observation({ type: 'run.finished', status: 'failed' }))
    publish(bus, observation({ type: 'run.started' }))
    expect(bus.workflowActivity('company-a', 'conversation-a')).toEqual([])
  })

  it('requires a start, rejects mismatched scope, and isolates failing listeners', () => {
    const bus = new EventBus()
    publish(bus, observation({ type: 'tool.started', toolInvocationId: 't', toolName: 'search' }))
    bus.publish({ type: 'run.started', companyId: 'company-b', payload: observation(), at })
    expect(bus.workflowActivity('company-a', 'conversation-a')).toEqual([])
    bus.subscribe('company-a', () => { throw new Error('bad observer') })
    const listener = vi.fn()
    bus.subscribe('company-a', listener)
    expect(() => publish(bus, { ...observation(), prompt: 'secret', error: 'secret' } as RuntimeObservation)).not.toThrow()
    expect(listener).toHaveBeenCalledOnce()
    expect(JSON.stringify(bus.workflowActivity('company-a', 'conversation-a'))).not.toContain('secret')
  })
})

describe('SSE writer lifecycle', () => {
  function writerFixture(slow = false) {
    const res = new EventEmitter() as EventEmitter & { writeHead: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
    res.writeHead = vi.fn()
    res.write = vi.fn(() => !slow)
    res.end = vi.fn()
    const req = { url: '/', headers: {}, method: 'GET' } as IncomingMessage
    const request = createRequestContext(req, res as unknown as ServerResponse, {}, { maxBodyBytes: 1000, secureCookies: false })
    return { res, writer: request.sse() }
  }
  it('runs every cleanup exactly once on explicit end followed by close', () => {
    const { res, writer } = writerFixture()
    const cleanup = vi.fn()
    writer.onClose(() => { throw new Error('cleanup') })
    writer.onClose(cleanup)
    writer.end()
    writer.end()
    res.emit('close')
    expect(writer.closed).toBe(true)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(res.end).toHaveBeenCalledOnce()
    const late = vi.fn()
    writer.onClose(late)
    expect(late).toHaveBeenCalledOnce()
  })
  it('ends instead of accumulating buffers when write returns false', () => {
    const { res, writer } = writerFixture(true)
    const cleanup = vi.fn()
    writer.onClose(cleanup)
    writer.send('run.started', {})
    expect(writer.closed).toBe(true)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(res.end).toHaveBeenCalledOnce()
    expect(res.write).toHaveBeenCalledOnce()
  })
})

describe('workflow read and conversation isolation', () => {
  let ctx: RoutesTestContext
  beforeEach(async () => { ctx = await createRoutesTestContext() })
  afterEach(async () => { await ctx.close() })

  async function fixture() {
    const owner = await tenant(ctx, 'workflow-owner@example.com', 'Workflow')
    const userId = ctx.repos.auth.findUserByEmail('workflow-owner@example.com')!.id
    const first = ctx.repos.work.createConversation({ companyId: owner.company.id, userId, title: 'First' })
    const second = ctx.repos.work.createConversation({ companyId: owner.company.id, userId, title: 'Second' })
    return { ...owner, first, second }
  }

  it('returns a zero-task snapshot without requiring models, and fails closed for nonmembers', async () => {
    const { company, ownerCookie, first } = await fixture()
    const response = await ctx.client.request('GET', `/api/conversations/${first.id}/workflow`, { headers: ownerCookie })
    expect(response.status).toBe(200)
    const body = response.json<WorkflowSnapshotResponse>()
    expect(body.schemaVersion).toBe(1)
    expect(body.tasks).toEqual([])
    expect(body.dependencies).toEqual([])
    expect(Object.values(body.counts)).toEqual(Array(8).fill(0))
    expect(body.usage).toEqual({ tokensIn: 0, tokensOut: 0, costUsd: 0, runs: 0 })
    expect(body.graphEligible).toBe(true)
    expect(ctx.repos.llm.listProviders(company.id)).toEqual([])
    const stranger = await registerUser(ctx, 'workflow-stranger@example.com')
    const hidden = await ctx.client.request('GET', `/api/conversations/${first.id}/workflow`, { headers: stranger.cookie })
    expect(hidden.status).toBe(404)
  })

  it('marks persisted running unverified, confirms live activity, removes it on finish', async () => {
    const { company, first, second } = await fixture()
    const agent = ctx.repos.team.listAgentDefs()[0]!
    const runId = ctx.repos.accounting.startRun({ companyId: company.id, conversationId: first.id, agentDefId: agent.id })
    const snapshot = () => workflowSnapshot(ctx.app.context, company.id, first.id)
    expect(snapshot().runs[0]!.activity).toBe('unverified')
    const event = observation({ companyId: company.id, conversationId: first.id, agentDefId: agent.id, runId })
    publish(ctx.app.context.events, event)
    publish(ctx.app.context.events, { ...event, runId: 'runtime-only' })
    publish(ctx.app.context.events, { ...event, conversationId: second.id, runId: 'other-conversation' })
    expect(snapshot().runs[0]!.activity).toBe('active')
    expect(snapshot().activeRuns.map((run) => run.runId)).toEqual(['runtime-only', runId].sort())
    expect(snapshot().runs.map((run) => run.id)).toEqual([runId])
    ctx.repos.accounting.finishRun(runId, { status: 'failed', tokensIn: 10, tokensOut: 2, costUsd: 0.01, latencyMs: 20, steps: 1, error: 'raw-error-secret' })
    publish(ctx.app.context.events, { ...event, type: 'run.finished', status: 'failed' })
    expect(snapshot().runs[0]!.activity).toBe('terminal')
    expect(snapshot().usage.tokensIn).toBe(10)
    expect(JSON.stringify(snapshot())).not.toContain('raw-error-secret')
  })

  it('returns 101 tasks as a non-graph snapshot and rejects more than 500 instead of truncating', async () => {
    const { company, ownerCookie, first } = await fixture()
    for (let i = 0; i < 101; i++) ctx.repos.work.createTask({ companyId: company.id, conversationId: first.id, title: `Task ${i}`, briefMd: 'prompt-secret' })
    let response = await ctx.client.request('GET', `/api/conversations/${first.id}/workflow`, { headers: ownerCookie })
    expect(response.status).toBe(200)
    let body = response.json<WorkflowSnapshotResponse>()
    expect(body.tasks).toHaveLength(101)
    expect(body.graphEligible).toBe(false)
    expect(response.body).not.toContain('prompt-secret')
    for (let i = 101; i < 501; i++) ctx.repos.work.createTask({ companyId: company.id, conversationId: first.id, title: `Task ${i}`, briefMd: '' })
    response = await ctx.client.request('GET', `/api/conversations/${first.id}/workflow`, { headers: ownerCookie })
    expect(response.status).toBe(409)
  })

  it('rejects unscoped events and resolves legacy task scope only inside the company', async () => {
    const { company, first, second } = await fixture()
    const task = ctx.repos.work.createTask({ companyId: company.id, conversationId: first.id, title: 'Scoped', briefMd: '' })
    const matches = (payload: unknown, scope = company.id) => eventMatchesConversation(ctx.app.context, payload, scope, first.id)
    expect(matches(undefined)).toBe(false)
    expect(matches({ status: 'done' })).toBe(false)
    expect(matches({ conversationId: second.id, taskId: task.id })).toBe(false)
    expect(matches({ conversationId: first.id })).toBe(true)
    expect(matches({ taskId: task.id })).toBe(true)
    expect(matches({ taskId: task.id }, 'another-company')).toBe(false)
    expect(matches({ conversationId: first.id, companyId: 'another-company' })).toBe(false)
  })

  it('revalidates live auth and account restrictions without relying on cached user state', async () => {
    const { company, ownerCookie, first } = await fixture()
    const token = decodeURIComponent(ownerCookie.Cookie!.slice(`${SESSION_COOKIE}=`.length))
    const auth = ctx.repos.auth.resolveSession(token)!
    const request = {
      state: { auth: { user: auth.user, sessionId: auth.sessionId } },
      cookies: () => ({ [SESSION_COOKIE]: token }),
    } as unknown as ReturnType<typeof createRequestContext>
    expect(streamAccessStillValid(ctx.app.context, request, company.id, first.id)).toBe(true)
    ctx.repos.db.run('UPDATE users SET must_change_password = 1 WHERE id = ?', [auth.user.id])
    expect(streamAccessStillValid(ctx.app.context, request, company.id, first.id)).toBe(false)
    ctx.repos.db.run('UPDATE users SET must_change_password = 0 WHERE id = ?', [auth.user.id])
    ctx.repos.auth.deleteSessionByToken(token)
    expect(streamAccessStillValid(ctx.app.context, request, company.id, first.id)).toBe(false)
  })

  it('filters a live stream and tears down its subscription and heartbeat after session loss', async () => {
    const { company, ownerCookie, first, second } = await fixture()
    const token = decodeURIComponent(ownerCookie.Cookie!.slice(`${SESSION_COOKIE}=`.length))
    const auth = ctx.repos.auth.resolveSession(token)!
    const cleanups: (() => void)[] = []
    const writer = {
      closed: false,
      send: vi.fn(),
      comment: vi.fn(),
      end: vi.fn(() => {
        if (writer.closed) return
        writer.closed = true
        for (const cleanup of cleanups.splice(0)) cleanup()
      }),
      onClose: (cleanup: () => void) => { cleanups.push(cleanup) },
    }
    const request = {
      params: { id: first.id }, req: { headers: {} },
      state: { auth: { user: auth.user, sessionId: auth.sessionId }, tenancy: { companyId: company.id } },
      cookies: () => ({ [SESSION_COOKIE]: token }), query: () => undefined, sse: () => writer,
    } as unknown as ReturnType<typeof createRequestContext>
    const route = ctx.app.router.match('GET', `/api/conversations/${first.id}/stream`)!
    vi.useFakeTimers()
    try {
      await route.route.handler(request)
      expect(ctx.app.context.events.subscriberCount(company.id)).toBe(1)
      for (const payload of [{ conversationId: second.id }, { status: 'done' }, { conversationId: first.id }]) {
        ctx.app.context.events.publish({ type: 'task.updated', companyId: company.id, payload, at })
      }
      expect(writer.send).toHaveBeenCalledOnce()
      vi.advanceTimersByTime(25_000)
      expect(writer.comment).toHaveBeenCalledOnce()
      ctx.repos.auth.deleteSessionByToken(token)
      vi.advanceTimersByTime(25_000)
      expect(writer.end).toHaveBeenCalledOnce()
      expect(ctx.app.context.events.subscriberCount(company.id)).toBe(0)
      vi.advanceTimersByTime(50_000)
      expect(writer.comment).toHaveBeenCalledOnce()
    } finally {
      writer.end()
      vi.useRealTimers()
    }
  })

  it('publishes a metadata-only scoped task.updated after review', async () => {
    const { company, ownerCookie, first } = await fixture()
    const task = ctx.repos.work.createTask({ companyId: company.id, conversationId: first.id, title: 'Review', briefMd: '', status: 'review' })
    const listener = vi.fn()
    const unsubscribe = ctx.app.context.events.subscribe(company.id, listener)
    const response = await ctx.client.request('POST', `/api/tasks/${task.id}/review`, { headers: ownerCookie, body: { decision: 'approve', note: 'review-note-secret' } })
    unsubscribe()
    expect(response.status).toBe(200)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: 'task.updated', companyId: company.id,
      payload: { conversationId: first.id, taskId: task.id, status: 'done', revisionCount: 0 },
    }))
    expect(JSON.stringify(listener.mock.calls)).not.toContain('review-note-secret')
  })
})
