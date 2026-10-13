import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRepos } from '@marketing-agent/db'
import { AppError, budgetExceeded } from '@marketing-agent/shared'
import { ModelRegistry } from '@marketing-agent/llm'
import { runAgent } from '../src/index.ts'
import type { AgentRuntimeDeps, ChatAdapter } from '../src/types.ts'
import { buildResolvedAgent, fakeMeter, fakeRouter, scriptedAdapter, testContext, testTool, textTurn, toolTurn } from './fixtures.ts'

const closers: (() => void)[] = []
afterEach(() => { for (const close of closers.splice(0)) close() })

function setup(mode: 'failover' | 'round_robin' = 'round_robin') {
  const repos = createRepos({ file: ':memory:', allowWeakSecret: true })
  closers.push(() => repos.db.close())
  const provider = repos.llm.createProvider({ companyId: null, name: 'Test', kind: 'openai_compatible', baseUrl: 'http://localhost/v1', keyUsageMode: mode })
  const keys = ['one', 'two', 'three'].map((label, i) => repos.llm.createProviderKey({ providerId: provider.id, label, apiKey: `secret-${label}`, priority: i }))
  const model = repos.llm.createModel({ providerId: provider.id, modelId: 'm', label: 'M' })
  const registry = new ModelRegistry(repos.llm)
  const router = fakeRouter(model)
  const meter = fakeMeter()
  const used: string[] = []
  const adapters = new Map<string, ChatAdapter>()
  for (const key of keys) adapters.set(key.id, scriptedAdapter([textTurn(key.label)]))
  const deps: AgentRuntimeDeps = {
    router, meterFactory: meter.factory,
    adapters: {
      adapterFor: () => { throw new Error('must select dynamically') },
      selectAdapterFor: (selectedModel, options) => {
        const selected = registry.selectAdapterFor(selectedModel, options)
        if (!selected) return undefined
        used.push(selected.keyId!)
        return { ...selected, adapter: adapters.get(selected.keyId!)! }
      },
      skipFailedKey: (selectedModel, keyId, blockId) => registry.skipFailedKey(selectedModel, keyId, blockId),
    },
  }
  const input = { agent: buildResolvedAgent({ model }), context: testContext(), tools: [] }
  return { repos, provider, keys, model, router, deps, input, used, adapters }
}

describe('per-request provider keys in agent runtime', () => {
  it('shares 3-request blocks across concurrent runs and registries', async () => {
    const s = setup()
    const results = await Promise.all(Array.from({ length: 12 }, () => runAgent(s.input, s.deps)))
    expect(results.every(result => result.status === 'succeeded')).toBe(true)
    expect(s.used).toEqual([0,0,0,1,1,1,2,2,2,0,0,0].map(i => s.keys[i]!.id))
  })

  it('rotates inside one multi-step tool run, not just at the start of a run', async () => {
    const s = setup()
    const call = toolTurn([{ id: 't', name: 'lookup', argumentsJson: '{}' }])
    s.adapters.set(s.keys[0]!.id, scriptedAdapter([call]))
    s.adapters.set(s.keys[1]!.id, scriptedAdapter([textTurn('done')]))
    const result = await runAgent({ ...s.input, tools: [testTool('lookup', async () => ({ content: 'found' }))] }, s.deps)
    expect(result.status).toBe('succeeded')
    expect(result.steps).toBe(4)
    expect(s.used).toEqual([0,0,0,1].map(i => s.keys[i]!.id))
  })

  it('skips a broken rotating key immediately and does not execute partial-stream tools', async () => {
    const s = setup()
    const handler = vi.fn(async () => ({ content: 'no' }))
    s.adapters.set(s.keys[0]!.id, {
      async *chat() {
        yield { type: 'tool_call', call: { id: 'x', name: 'lookup', argumentsJson: '{}' } }
        throw new AppError('provider_error', 'broken', { details: { status: 429 } })
      },
    })
    const result = await runAgent({ ...s.input, tools: [testTool('lookup', handler)] }, s.deps)
    expect(result.status).toBe('succeeded')
    expect(s.used).toEqual([s.keys[0]!.id, s.keys[1]!.id])
    expect(handler).not.toHaveBeenCalled()
    expect(s.router.escalations()).toBe(0)
  })

  it('retains failover key after switching and counts failed requests', async () => {
    const s = setup('failover')
    s.adapters.set(s.keys[0]!.id, scriptedAdapter([{ error: new AppError('provider_error', 'invalid key', { details: { status: 401 } }) }]))
    s.adapters.set(s.keys[1]!.id, scriptedAdapter([toolTurn([{ id: 'a', name: 'lookup', argumentsJson: '{}' }]), textTurn('done')]))
    const result = await runAgent({ ...s.input, tools: [testTool('lookup', async () => ({ content: 'ok' }))] }, s.deps)
    expect(result.status).toBe('succeeded')
    expect(result.steps).toBe(3)
    expect(s.used).toEqual([s.keys[0]!.id, s.keys[1]!.id, s.keys[1]!.id])
  })

  it('retries failover transient errors and enforces the actual request step limit', async () => {
    const s = setup('failover')
    s.adapters.set(s.keys[0]!.id, scriptedAdapter([{ error: new AppError('provider_error', 'temporary', { details: { status: 503 } }) }]))
    const result = await runAgent({ ...s.input, maxSteps: 2 }, s.deps)
    expect(result.stopReason).toBe('max_steps')
    expect(result.steps).toBe(2)
    expect(s.used).toEqual([s.keys[0]!.id, s.keys[0]!.id])
  })

  it('does not reserve requests when cancelled or budget-blocked', async () => {
    const s = setup()
    const controller = new AbortController()
    controller.abort()
    expect((await runAgent({ ...s.input, signal: controller.signal }, s.deps)).stopReason).toBe('cancelled')
    const meter = fakeMeter({ budgetError: budgetExceeded('stop') })
    expect((await runAgent({ ...s.input, budget: { dailyCostUsd: 1, taskCostUsd: 1 } }, { ...s.deps, meterFactory: meter.factory })).stopReason).toBe('budget')
    expect(s.used).toEqual([])
  })

  it('keeps transient retries for keyless gateways even when round-robin is selected', async () => {
    const s = setup()
    for (const key of s.keys) s.repos.llm.deleteProviderKey(key.id)
    const gateway = scriptedAdapter([
      { error: new AppError('provider_error', 'temporary', { details: { status: 503 } }) },
      textTurn('recovered'),
    ])
    const registry = new ModelRegistry(s.repos.llm)
    const deps: AgentRuntimeDeps = { ...s.deps, adapters: {
      ...s.deps.adapters,
      selectAdapterFor: (model, options) => {
        const selected = registry.selectAdapterFor(model, options)
        return selected ? { ...selected, adapter: gateway } : undefined
      },
    } }
    const result = await runAgent(s.input, deps)
    expect(result.output).toBe('recovered')
    expect(result.steps).toBe(2)
    expect(gateway.requests).toHaveLength(2)
  })

  it('skips the remaining block if a key fails on the final allowed request', async () => {
    const s = setup()
    s.adapters.set(s.keys[0]!.id, scriptedAdapter([{ error: new AppError('provider_error', 'bad key', { details: { status: 401 } }) }]))
    const result = await runAgent({ ...s.input, maxSteps: 1 }, s.deps)
    expect(result.stopReason).toBe('max_steps')
    expect(s.used).toEqual([s.keys[0]!.id])
    const next = s.deps.adapters.selectAdapterFor!(s.model, {})
    expect(next?.keyId).toBe(s.keys[1]!.id)
  })

  it('uses another model on the same provider after a model-specific error', async () => {
    const s = setup()
    const sibling = s.repos.llm.createModel({ providerId: s.provider.id, modelId: 'm2', label: 'M2' })
    let chosen = false
    const router = {
      chooseForAgent: () => ({ model: s.model, provider: s.provider, tier: 'standard' as const, source: 'preset', reason: 'test' }),
      escalate: () => {
        if (chosen) throw new Error('no further model')
        chosen = true
        return { model: sibling, provider: s.provider, tier: 'deep' as const, source: 'fallback', reason: 'test' }
      },
    }
    const failing = scriptedAdapter([{ error: new AppError('provider_error', 'model missing', { details: { status: 404, body: 'model_not_found' } }) }])
    const successful = scriptedAdapter([textTurn('sibling worked')])
    const select = s.deps.adapters.selectAdapterFor!
    const deps: AgentRuntimeDeps = {
      ...s.deps, router,
      adapters: { ...s.deps.adapters, selectAdapterFor: (model, options) => {
        const candidate = select(model, options)
        return candidate ? { ...candidate, adapter: model.id === s.model.id ? failing : successful } : undefined
      } },
    }
    // Three failing requests + one successful fallback; exhaustion must not consume a call.
    const result = await runAgent({ ...s.input, maxSteps: 4 }, deps)
    expect(result.output).toContain('sibling worked')
    expect(result.status).toBe('succeeded')
    expect(result.steps).toBe(4)
    expect(chosen).toBe(true)
    expect(failing.requests).toHaveLength(3)
    expect(successful.requests).toHaveLength(1)
  })

  it('stops finitely after every key fails and attempts model fallback', async () => {
    const s = setup()
    for (const key of s.keys) s.adapters.set(key.id, scriptedAdapter([{ error: new AppError('provider_error', 'invalid', { details: { status: 401 } }) }]))
    const result = await runAgent(s.input, s.deps)
    expect(result.status).toBe('failed')
    expect(s.used).toHaveLength(3)
    expect(s.router.escalations()).toBeGreaterThan(0)
  })
})
