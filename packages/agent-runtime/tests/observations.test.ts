import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError, budgetExceeded, type LlmChunk, type RuntimeObservation, type ToolDefinition } from '@marketing-agent/shared'
import { runAgent } from '../src/tool-loop.ts'
import type { AgentRunInput, AgentRuntimeDeps, ChatAdapter } from '../src/types.ts'
import { buildResolvedAgent, fakeMeter, fakeRouter, scriptedAdapter, testContext, testModel, testProvider, testTool, textTurn, toolTurn } from './fixtures.ts'

afterEach(() => vi.useRealTimers())

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function setup(adapter: ChatAdapter = scriptedAdapter([textTurn('answer')]), tools: readonly ToolDefinition[] = []) {
  const events: RuntimeObservation[] = []
  const meter = fakeMeter()
  const deps: AgentRuntimeDeps = { router: fakeRouter(), adapters: { adapterFor: () => adapter }, adapter, meterFactory: meter.factory }
  const input: AgentRunInput = { agent: buildResolvedAgent(), context: testContext({ conversationId: 'conversation', taskId: 'task' }), tools, observe: event => { events.push(event) } }
  return { events, meter, deps, input }
}
const ofType = (events: RuntimeObservation[], type: RuntimeObservation['type']) => events.filter(event => event.type === type)
const transient = () => new AppError('provider_error', 'secret provider message', { details: { status: 503, body: 'secret provider body' } })

describe('runtime observations', () => {
  it('reports actual run/model start while a request is gated, and finishes after accounting', async () => {
    const entered = deferred()
    const release = deferred()
    const adapter: ChatAdapter = { async *chat() { entered.resolve(); await release.promise; yield { type: 'text', text: 'answer' }; yield { type: 'done', finishReason: 'stop', usage: { promptTokens: 2, completionTokens: 3, cachedTokens: 0 } } } }
    const s = setup(adapter)
    const chosen = testModel({ id: 'actual-model', providerId: 'actual-provider' })
    s.deps.router.chooseForAgent = () => ({ model: chosen, provider: testProvider({ id: 'actual-provider' }), tier: 'standard', source: 'test', reason: 'secret reason' })
    const originalFactory = s.deps.meterFactory
    const opened: unknown[] = []
    const deps = { ...s.deps, meterFactory: (scope: Parameters<typeof originalFactory>[0]) => {
      opened.push(scope)
      const meter = originalFactory(scope)
      return { ...meter, finish: (finish: Parameters<typeof meter.finish>[0]) => { expect(ofType(s.events, 'run.finished')).toHaveLength(0); meter.finish(finish) } }
    } }
    const running = runAgent(s.input, deps)
    await entered.promise
    expect(s.events.map(event => event.type)).toEqual(['run.started', 'model.started'])
    expect(opened[0]).toMatchObject({ modelId: 'actual-model', providerId: 'actual-provider' })
    expect(s.events[0]).toMatchObject({ modelId: 'actual-model', providerId: 'actual-provider', runId: 'run-fake', companyId: 'c1', conversationId: 'conversation', taskId: 'task', agentDefId: 'def-1', agentRole: 'content-writer' })
    release.resolve()
    await running
    expect(s.events.map(event => event.type)).toEqual(['run.started', 'model.started', 'model.finished', 'run.finished'])
    expect(s.events[2]).toMatchObject({ requestIndex: 1, attemptIndex: 1, outcome: 'succeeded', durationMs: expect.any(Number) })
    expect(s.events[3]).toMatchObject({ accountingStatus: 'recorded', requestCount: 1, toolCount: 0, status: 'succeeded', stopReason: 'completed', usage: { tokensIn: 2, tokensOut: 3, cachedTokens: 0, costUsd: 0 } })
  })

  it('pairs local invocation ids for parallel handlers, before either finishes', async () => {
    const first = deferred<{ content: string }>()
    const second = deferred<{ content: string }>()
    const entered = deferred()
    let count = 0
    const handler = (gate: typeof first) => async () => { if (++count === 2) entered.resolve(); return gate.promise }
    const s = setup(scriptedAdapter([toolTurn([{ id: 'untrusted-id', name: 'first', argumentsJson: '{}' }, { id: 'untrusted-id', name: 'second', argumentsJson: '{}' }]), textTurn('done')]), [testTool('first', handler(first)), testTool('second', handler(second))])
    const running = runAgent(s.input, s.deps)
    await entered.promise
    const starts = ofType(s.events, 'tool.started')
    expect(starts).toHaveLength(2)
    expect(ofType(s.events, 'tool.finished')).toHaveLength(0)
    expect(new Set(starts.map(event => event.toolInvocationId)).size).toBe(2)
    expect(starts.every(event => event.toolInvocationId !== 'untrusted-id')).toBe(true)
    second.resolve({ content: 'secret result' })
    first.resolve({ content: 'secret result' })
    await running
    for (const start of starts) expect(ofType(s.events, 'tool.finished').filter(event => event.toolInvocationId === start.toolInvocationId)).toEqual([expect.objectContaining({ toolName: start.toolName, outcome: 'succeeded' })])
    expect(ofType(s.events, 'run.finished')[0]?.toolCount).toBe(2)
  })

  it.each(['legacy', 'dynamic'] as const)('observes each actual retry request in the %s branch', async mode => {
    vi.useFakeTimers()
    const adapter = scriptedAdapter([{ error: transient() }, { error: transient() }, textTurn('recovered')])
    const s = setup(adapter)
    const deps = mode === 'legacy' ? s.deps : { ...s.deps, adapter: undefined, adapters: { adapterFor: () => adapter, selectAdapterFor: () => ({ adapter, keyId: 'secret-key-id', keyLabel: 'secret key label', mode: 'failover' as const }) } }
    const running = runAgent(s.input, deps)
    await vi.runAllTimersAsync()
    const result = await running
    expect(result.status).toBe('succeeded')
    expect(result.steps).toBe(mode === 'legacy' ? 1 : 3) // Preserve existing step semantics.
    expect(ofType(s.events, 'model.started').map(event => [event.requestIndex, event.attemptIndex])).toEqual([[1, 1], [2, 2], [3, 3]])
    expect(ofType(s.events, 'model.finished').map(event => event.outcome)).toEqual(['failed', 'failed', 'succeeded'])
    expect(ofType(s.events, 'run.retrying').map(event => [event.strategy, event.requestIndex])).toEqual([['retry', 2], ['retry', 3]])
    expect(ofType(s.events, 'run.finished')[0]?.requestCount).toBe(3)
  })

  it('does not guess retry or rotation when dynamic maxSteps blocks the next actual request', async () => {
    vi.useFakeTimers()
    const adapter = scriptedAdapter([{ error: transient() }])
    const s = setup(adapter)
    const resultPromise = runAgent({ ...s.input, maxSteps: 1 }, { ...s.deps, adapter: undefined, adapters: { adapterFor: () => adapter, selectAdapterFor: () => ({ adapter, keyId: 'key', keyLabel: 'label', mode: 'failover' as const }) } })
    await vi.runAllTimersAsync()
    expect((await resultPromise).stopReason).toBe('max_steps')
    expect(ofType(s.events, 'model.started')).toHaveLength(1)
    expect(ofType(s.events, 'run.retrying')).toHaveLength(0)
  })

  it('reports key rotation only when a replacement key actually makes a request', async () => {
    const bad = scriptedAdapter([{ error: new AppError('provider_error', 'secret', { details: { status: 401 } }) }])
    const good = scriptedAdapter([textTurn('done')])
    const s = setup()
    let key = 0
    const result = await runAgent(s.input, { ...s.deps, adapter: undefined, adapters: { adapterFor: () => bad, selectAdapterFor: () => ({ adapter: key++ === 0 ? bad : good, keyId: `secret-key-${key}`, keyLabel: 'secret label', mode: 'round_robin' }), skipFailedKey: () => undefined } })
    expect(result.status).toBe('succeeded')
    expect(ofType(s.events, 'run.retrying')).toEqual([expect.objectContaining({ strategy: 'key_rotation', requestIndex: 2, attemptIndex: 1 })])
  })

  it('does not claim key rotation if a custom selector returns the same key again', async () => {
    const adapter = scriptedAdapter([{ error: new AppError('provider_error', 'secret', { details: { status: 401 } }) }, textTurn('done')])
    const s = setup(adapter)
    await runAgent(s.input, { ...s.deps, adapter: undefined, adapters: { adapterFor: () => adapter, selectAdapterFor: () => ({ adapter, keyId: 'same-key', keyLabel: 'secret', mode: 'round_robin' }) } })
    expect(ofType(s.events, 'model.started')).toHaveLength(2)
    expect(ofType(s.events, 'run.retrying')).toHaveLength(0)
  })

  it('reports static key rotation and a model fallback at the actual replacement requests', async () => {
    const bad = scriptedAdapter([{ error: new AppError('provider_error', 'secret', { details: { status: 401 } }) }])
    const good = scriptedAdapter([textTurn('done')])
    const s = setup()
    const result = await runAgent(s.input, { ...s.deps, adapter: undefined, adapters: { adapterFor: () => bad, adaptersFor: model => model.id === 'model-standard' ? [bad, bad] : [good] } })
    expect(result.status).toBe('succeeded')
    expect(ofType(s.events, 'run.retrying').map(event => [event.strategy, event.requestIndex, event.modelId])).toEqual([['key_rotation', 2, 'model-standard'], ['model_fallback', 3, 'model-deep']])
  })

  it('does not emit fallback when router cannot supply a new model', async () => {
    const s = setup(scriptedAdapter([{ error: new AppError('provider_error', 'secret', { details: { status: 401 } }) }]))
    s.deps.router.escalate = () => { throw new Error('secret fallback failure') }
    await runAgent(s.input, s.deps)
    expect(ofType(s.events, 'run.retrying')).toHaveLength(0)
  })

  it('finishes denied/invalid proposals without pretending a handler started', async () => {
    const handler = vi.fn(async () => ({ content: 'secret' }))
    const s = setup(scriptedAdapter([toolTurn([{ id: 'secret-call-id', name: 'secret-denied-name', argumentsJson: '{"secret":"args"}' }, { id: 'secret-id', name: 'allowed', argumentsJson: 'secret malformed JSON' }]), textTurn('done')]), [testTool('allowed', handler)])
    await runAgent(s.input, s.deps)
    expect(handler).not.toHaveBeenCalled()
    expect(ofType(s.events, 'tool.started')).toHaveLength(0)
    expect(ofType(s.events, 'tool.finished')).toEqual([expect.objectContaining({ toolName: 'unknown_tool', outcome: 'denied', errorCode: 'not_granted' }), expect.objectContaining({ toolName: 'allowed', outcome: 'invalid_arguments', errorCode: 'invalid_arguments' })])
    expect(JSON.stringify(s.events)).not.toContain('secret')
  })

  it('reports tool exceptions and error results with enum errors, not content', async () => {
    const s = setup(scriptedAdapter([toolTurn([{ id: '1', name: 'thrower', argumentsJson: '{}' }, { id: '2', name: 'error_result', argumentsJson: '{}' }]), textTurn('done')]), [testTool('thrower', async () => { throw new Error('secret error message') }), testTool('error_result', async () => ({ isError: true, content: 'secret result' }))])
    await runAgent(s.input, s.deps)
    expect(ofType(s.events, 'tool.finished').map(event => [event.outcome, event.errorCode])).toEqual([['failed', 'internal'], ['failed', 'tool_error']])
    expect(JSON.stringify(s.events)).not.toContain('secret')
  })

  it('times out tools without implying rollback, and never emits a second finish for late completion', async () => {
    vi.useFakeTimers()
    const late = deferred<{ content: string }>()
    const s = setup(scriptedAdapter([toolTurn([{ id: 'id', name: 'slow', argumentsJson: '{}' }]), textTurn('done')]), [testTool('slow', () => late.promise)])
    const running = runAgent({ ...s.input, toolTimeoutMs: 10 }, s.deps)
    await vi.runAllTimersAsync()
    await running
    expect(ofType(s.events, 'tool.finished')).toEqual([expect.objectContaining({ outcome: 'timed_out', errorCode: 'tool_timeout' })])
    late.resolve({ content: 'late side effect' })
    await Promise.resolve()
    expect(ofType(s.events, 'tool.finished')).toHaveLength(1)
  })

  it('classifies cooperative timeout aborts as timed_out rather than cancellation', async () => {
    vi.useFakeTimers()
    const s = setup(scriptedAdapter([toolTurn([{ id: 'id', name: 'slow', argumentsJson: '{}' }]), textTurn('done')]), [testTool('slow', (_args, context) => new Promise((_resolve, reject) => {
      context.signal?.addEventListener('abort', () => { const error = new Error('secret'); error.name = 'AbortError'; reject(error) }, { once: true })
    }))])
    const running = runAgent({ ...s.input, toolTimeoutMs: 10 }, s.deps)
    await vi.runAllTimersAsync()
    await running
    expect(ofType(s.events, 'tool.finished')[0]).toMatchObject({ outcome: 'timed_out', errorCode: 'tool_timeout' })
  })

  it('pairs cancelled tool observations and emits cancelled run', async () => {
    const controller = new AbortController()
    const s = setup(scriptedAdapter([toolTurn([{ id: 'id', name: 'cancel', argumentsJson: '{}' }]), textTurn('unused')]), [testTool('cancel', async () => { controller.abort(); const error = new Error('secret cancelled'); error.name = 'AbortError'; throw error })])
    const result = await runAgent({ ...s.input, signal: controller.signal }, s.deps)
    expect(result.status).toBe('cancelled')
    expect(ofType(s.events, 'tool.started')).toHaveLength(1)
    expect(ofType(s.events, 'tool.finished')[0]?.outcome).toBe('cancelled')
    expect(ofType(s.events, 'run.finished')[0]?.status).toBe('cancelled')
  })

  it('finishes a model request cancelled midstream', async () => {
    const controller = new AbortController()
    const s = setup({ async *chat(): AsyncGenerator<LlmChunk> { controller.abort(); yield { type: 'text', text: 'secret' } } })
    await runAgent({ ...s.input, signal: controller.signal }, s.deps)
    expect(ofType(s.events, 'model.finished')[0]).toMatchObject({ outcome: 'cancelled', errorCode: 'cancelled' })
    expect(ofType(s.events, 'run.retrying')).toHaveLength(0)
  })

  it.each(['budget', 'cancelled'] as const)('does not emit model starts when %s gate blocks execution', async gate => {
    const s = setup()
    const controller = new AbortController()
    if (gate === 'cancelled') controller.abort()
    await runAgent({ ...s.input, signal: controller.signal, budget: { dailyCostUsd: 1 } }, { ...s.deps, meterFactory: gate === 'budget' ? fakeMeter({ budgetError: budgetExceeded('secret') }).factory : s.deps.meterFactory })
    expect(s.events.map(event => event.type)).toEqual(['run.started', 'run.finished'])
    expect(ofType(s.events, 'run.finished')[0]?.requestCount).toBe(0)
  })

  it('isolates throwing and rejecting observers from tools, model, and accounting', async () => {
    const handler = vi.fn(async () => ({ content: 'ok' }))
    const s = setup(scriptedAdapter([toolTurn([{ id: 'id', name: 'work', argumentsJson: '{}' }]), textTurn('done')]), [testTool('work', handler)])
    let calls = 0
    const result = await runAgent({ ...s.input, observe: () => { if (++calls % 2) throw new Error('observer'); return Promise.reject(new Error('async observer')) } }, s.deps)
    expect(result.status).toBe('succeeded')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(s.meter.state.finishCalls).toHaveLength(1)
    expect(calls).toBe(8)
  })

  it('emits exactly one finish after accounting fails, retaining the answer', async () => {
    const s = setup()
    const result = await runAgent(s.input, { ...s.deps, meterFactory: scope => ({ ...s.meter.factory(scope), finish: () => { expect(ofType(s.events, 'run.finished')).toHaveLength(0); throw new Error('secret accounting error') } }) })
    expect(result.output).toBe('answer')
    expect(result.status).toBe('succeeded')
    expect(ofType(s.events, 'run.finished')).toEqual([expect.objectContaining({ accountingStatus: 'failed' })])
    expect(JSON.stringify(s.events)).not.toContain('secret')
  })

  it('sanitizes every metadata event even with secret-filled provider/model/tool fixtures', async () => {
    vi.useFakeTimers()
    const secret = 'SECRET_FIXTURE_DO_NOT_EMIT'
    const malformedCode = new AppError('provider_error', secret, { details: { status: 503, body: secret, url: secret }, messageKey: secret })
    Object.assign(malformedCode, { code: secret })
    const adapter = scriptedAdapter([{ error: malformedCode }, { chunks: [{ type: 'reasoning', text: secret }, ...toolTurn([{ id: secret, name: 'allowed', argumentsJson: JSON.stringify({ secret }) }]).chunks!] }, textTurn(secret)])
    const s = setup(adapter, [testTool('allowed', async () => ({ content: secret }), { description: secret })])
    s.deps.router.chooseForAgent = () => ({ model: testModel({ modelId: secret, label: secret }), provider: testProvider({ baseUrl: secret, name: secret, extraJson: secret }), tier: 'standard', source: secret, reason: secret })
    const running = runAgent({ ...s.input, systemPrompt: secret, messages: [{ role: 'user', content: secret }] }, { ...s.deps, adapter: undefined, adapters: { adapterFor: () => adapter, selectAdapterFor: () => ({ adapter, keyId: secret, keyLabel: secret, mode: 'failover' as const }) } })
    await vi.runAllTimersAsync()
    await running
    expect(JSON.stringify(s.events)).not.toContain(secret)
    expect(ofType(s.events, 'model.finished')[0]?.errorCode).toBe('internal')
    expect(ofType(s.events, 'model.finished')[0]?.httpStatus).toBe(503)
    const allowedKeys = new Set(['type', 'at', 'companyId', 'conversationId', 'taskId', 'runId', 'agentDefId', 'agentRole', 'modelId', 'providerId', 'requestIndex', 'attemptIndex', 'toolInvocationId', 'toolName', 'outcome', 'status', 'stopReason', 'durationMs', 'strategy', 'errorCode', 'httpStatus', 'requestCount', 'toolCount', 'usage', 'accountingStatus'])
    expect(s.events.every(event => Object.keys(event).every(key => allowedKeys.has(key)))).toBe(true)
  })
})
