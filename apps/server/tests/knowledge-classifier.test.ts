import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRepos, type Repos } from '@marketing-agent/db'
import { providerError } from '@marketing-agent/shared'
import { seedCatalog, seedCompany } from '@marketing-agent/seed'
import { classifyKnowledgeSource, classifySectionMetadata, splitKnowledgeSource, type SourceSection } from '../src/services/knowledge-classifier.ts'

describe('knowledge classifier source partitioning', () => {
  it('preserves every source character in bounded contiguous non-overlapping slices', () => {
    const source = 'Intro\n' + 'x'.repeat(8200) + '\nEnd'
    const sections = splitKnowledgeSource(source, 4000)
    expect(sections.length).toBeGreaterThan(2)
    expect(sections.map(section => section.text).join('')).toBe(source)
    expect(sections[0]!.start).toBe(0)
    expect(sections.at(-1)!.end).toBe(source.length)
    for (let index = 0; index < sections.length; index++) {
      const section = sections[index]!
      expect(section.end - section.start).toBeLessThanOrEqual(4000)
      expect(section.text).toBe(source.slice(section.start, section.end))
      if (index) expect(section.start).toBe(sections[index - 1]!.end)
    }
  })

  it('validates exact ids, category codes, tags, confidence, and title', () => {
    const expected: SourceSection[] = [{ id: 'section-0', start: 0, end: 3, text: 'abc' }]
    const valid = { sections: [{ id: 'section-0', category: '10-brand', tags: ['voice'], confidence: 0.9, title: 'Brand voice' }] }
    expect(classifySectionMetadata(valid, expected)[0]).toMatchObject({ id: 'section-0', start: 0, end: 3, text: 'abc', category: '10-brand' })
    for (const invalid of [
      { sections: [{ ...valid.sections[0], id: 'wrong' }] },
      { sections: [{ ...valid.sections[0], category: 'not-a-category' }] },
      { sections: [{ ...valid.sections[0], confidence: 2 }] },
      { sections: [{ ...valid.sections[0], tags: Array(9).fill('x') }] },
      { sections: [valid.sections[0], valid.sections[0]] },
    ]) expect(() => classifySectionMetadata(invalid, expected)).toThrow()
  })

  it('accepts strict JSON, BOM, fenced JSON with prose, and balanced extraction with escapes', () => {
    const expected = [{ id: 'section-0', start: 0, end: 3, text: 'abc' }]
    const value = { sections: [{ id: 'section-0', category: '10-brand', tags: ['brace } [ and quote " and slash \\'], confidence: 0.5, title: 'A {title}' }] }
    const json = JSON.stringify(value)
    for (const input of [json, `\uFEFF ${json}`, `Here is the result:\n\`\`\`json\n${json}\n\`\`\`\nDone.`, `Result: ${json} End.`]) {
      expect(classifySectionMetadata(input, expected)[0]!.tags).toEqual(value.sections[0]!.tags)
    }
  })

  it('rejects ambiguous, partial, assigned, reasoning-only and malformed responses without guessing', () => {
    const expected = [{ id: 'section-0', start: 0, end: 3, text: 'abc' }]
    const json = JSON.stringify({ sections: [{ id: 'section-0', category: '10-brand', tags: [], confidence: 1, title: 'Title' }] })
    for (const input of ['{not json', 'null', '[]', '42', `Result: ${json} ${json}`, `${json}\n{`, `const result = ${json}`, `Result: const x = ${json}`, `Result: } ${json} }`, `<think>${json}</think>`, JSON.stringify({ reasoning: json }), json.slice(0, -1)]) {
      expect(() => classifySectionMetadata(input, expected)).toThrow(/invalid_model_response:/)
    }
  })
})

describe('knowledge classification model and durable worker contracts', () => {
  let repos: Repos | undefined
  afterEach(() => { repos?.db.close(); repos = undefined })

  function configuredModels() {
    repos = createRepos({ file: ':memory:', allowWeakSecret: true, appSecret: 'knowledge-classifier-test-secret-123456' })
    seedCatalog(repos)
    const company = seedCompany(repos, { companyName: 'Classifier fixture', withDemoKnowledge: false }).company
    const def = repos.team.listAgentDefs().find(item => item.isLeader)!
    const primaryProvider = repos.llm.createProvider({ companyId: company.id, name: 'Primary company model', kind: 'openai_compatible', baseUrl: 'http://primary.invalid/v1' })
    const primary = repos.llm.createModel({ providerId: primaryProvider.id, modelId: 'primary', label: 'Primary' })
    repos.team.updatePreset(company.id, def.id, { modelFk: primary.id })
    const fallbackProvider = repos.llm.createProvider({ companyId: company.id, name: 'Fallback company model', kind: 'openai_compatible', baseUrl: 'http://fallback.invalid/v1' })
    const fallback = repos.llm.createModel({ providerId: fallbackProvider.id, modelId: 'fallback', label: 'Fallback' })
    repos.llm.setModelFallbacks(company.id, def.id, [fallback.id])
    return { company, primary, fallback }
  }

  const answer = (id: string) => JSON.stringify({ sections: [{ id, category: '10-brand', tags: ['voice'], confidence: 0.9, title: 'Brand voice' }] })
  const adapter = (run: (request: Parameters<NonNullable<import('@marketing-agent/llm').ProviderAdapter['chat']>>[0]) => AsyncIterable<import('@marketing-agent/shared').LlmChunk>) => ({ kind: 'openai_compatible' as const, chat: run })
  const chunks = async function* (text: string) { yield { type: 'text' as const, text }; yield { type: 'done' as const, finishReason: 'stop', usage: { promptTokens: 10, completionTokens: 10, cachedTokens: 0 } } }

  it('uses the configured company fallback after a transient 530 transport response', async () => {
    const { company, primary, fallback } = configuredModels()
    const selected: string[] = []
    const result = await classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor(model) {
      selected.push(model.id)
      if (model.id === primary.id) return { adapter: adapter(async function* () { throw providerError('upstream failure', { details: { status: 530 } }) }) }
      return { adapter: adapter(async function* () { yield* chunks(answer('section-0')) }) }
    } })
    expect(selected).toEqual([primary.id, fallback.id])
    expect(result[0]).toMatchObject({ start: 0, end: 5, text: 'hello', category: '10-brand' })
  })

  it('repairs malformed model JSON at most once and reports metadata before each request', async () => {
    const { company, primary } = configuredModels()
    let calls = 0
    const used: Array<{ id: string; modelId: string; label: string; providerId: string; providerName: string }> = []
    const result = await classifyKnowledgeSource(repos!, company.id, 'hello', { onModelUsed: metadata => used.push(metadata), selectAdapterFor() {
      return { adapter: adapter(async function* () { calls++; yield* chunks(calls === 1 ? '{bad json' : answer('section-0')) }) }
    } })
    expect(calls).toBe(2)
    expect(used).toHaveLength(2)
    expect(used[0]).toMatchObject({ id: primary.id, modelId: 'primary', label: 'Primary', providerName: 'Primary company model' })
    expect(result[0]).toMatchObject({ start: 0, end: 5, text: 'hello' })
  })

  it('preserves needs-configuration and malformed-response error codes safely', async () => {
    const { company } = configuredModels()
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor() { return undefined } }))
      .rejects.toThrow(/^needs_configuration:/)
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor() {
      return { adapter: adapter(async function* () { yield* chunks('{bad json') }) }
    } })).rejects.toThrow(/^invalid_model_response:/)
  })

  it('does not call a fallback for authorization failures', async () => {
    const { company, primary, fallback } = configuredModels()
    const selected: string[] = []
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor(model) {
      selected.push(model.id)
      return { adapter: adapter(async function* () { throw providerError('bad key', { details: { status: 401 } }) }) }
    } })).rejects.toThrow('authorization failed')
    expect(selected).toEqual([primary.id])
    expect(selected).not.toContain(fallback.id)
  })

  it('bounds malformed-response repairs to four sent requests across two configured models and retains usage', async () => {
    const { company, primary, fallback } = configuredModels()
    const selected: string[] = []
    const finish = vi.spyOn(repos!.accounting, 'finishRun')
    const secret = 'PRIVATE_RAW_RESPONSE'
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor(model) {
      selected.push(model.id)
      return { adapter: adapter(async function* () { yield* chunks(secret) }) }
    } })).rejects.toThrow('invalid_model_response: invalid_json')
    expect(selected).toEqual([primary.id, primary.id, fallback.id, fallback.id])
    expect(finish).toHaveBeenCalledTimes(4)
    for (const call of finish.mock.calls) {
      expect(call[1]).toMatchObject({ status: 'failed', tokensIn: 10, tokensOut: 10 })
      expect(JSON.stringify(call)).not.toContain(secret)
    }
  })

  it('includes a bounded previous output and a safe concrete validation issue in repair', async () => {
    const { company } = configuredModels()
    const requests: Parameters<import('@marketing-agent/llm').ProviderAdapter['chat']>[0][] = []
    const invalid = JSON.stringify({ sections: [{ id: 'section-0', category: 'PRIVATE_BAD_CATEGORY', tags: [], confidence: 1, title: 'Title' }] })
    await classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor() {
      return { adapter: adapter(async function* (request) {
        requests.push(request)
        yield* chunks(requests.length === 1 ? invalid : answer('section-0'))
      }) }
    } })
    expect(requests[0]!.maxTokens).toBe(2048)
    expect(requests[1]!.messages.at(-1)!.content).toContain('invalid_category')
    expect(requests[1]!.messages.at(-1)!.content).toContain(JSON.stringify(invalid))
    expect(requests[1]!.messages.at(-1)!.content.length).toBeLessThan(17_000)
  })

  it('repairs truncation with bounded token growth, retaining usage from truncated requests', async () => {
    const { company, primary } = configuredModels()
    repos!.llm.updateModel(primary.id, { maxOutput: 3000 })
    const caps: number[] = []
    const finish = vi.spyOn(repos!.accounting, 'finishRun')
    await classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor() {
      return { adapter: adapter(async function* (request) {
        caps.push(request.maxTokens!)
        if (caps.length === 1) {
          yield { type: 'text', text: '{"sections":[' }
          yield { type: 'done', finishReason: 'length', usage: { promptTokens: 21, completionTokens: 30, cachedTokens: 0 } }
        } else yield* chunks(answer('section-0'))
      }) }
    } })
    expect(caps).toEqual([2048, 3000])
    expect(finish.mock.calls[0]![1]).toMatchObject({ tokensIn: 21, tokensOut: 30, status: 'failed' })
  })

  it.each([401, 403])('does not repair or fallback after HTTP %s during repair', async status => {
    const { company, primary } = configuredModels()
    const selected: string[] = []
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor(model) {
      selected.push(model.id)
      return { adapter: adapter(async function* () {
        if (selected.length === 1) yield* chunks('null')
        else throw providerError('PRIVATE_KEY', { details: { status } })
      }) }
    } })).rejects.toThrow('authorization failed')
    expect(selected).toEqual([primary.id, primary.id])
  })

  it('does not send requests when already cancelled, or fallback after cancellation in flight', async () => {
    const { company, primary } = configuredModels()
    const controller = new AbortController()
    controller.abort()
    const select = vi.fn()
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { signal: controller.signal, selectAdapterFor: select })).rejects.toThrow('cancelled')
    expect(select).not.toHaveBeenCalled()
    const active = new AbortController()
    const selected: string[] = []
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { signal: active.signal, selectAdapterFor(model) {
      selected.push(model.id)
      return { adapter: adapter(async function* () { active.abort(); yield* chunks(answer('section-0')) }) }
    } })).rejects.toThrow('cancelled')
    expect(selected).toEqual([primary.id])
  })

  it('uses token context estimates and rejects repair context growth before another request', async () => {
    const { company, primary } = configuredModels()
    repos!.llm.updateModel(primary.id, { contextWindow: 3100 })
    let calls = 0
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor() {
      return { adapter: adapter(async function* () { calls++; yield* chunks('x'.repeat(8000)) }) }
    } })).rejects.toThrow(/^needs_configuration:/)
    expect(calls).toBe(1)
  })

  it('checks accumulated task cost before repair and blocks initial unaffordable requests', async () => {
    const { company, primary } = configuredModels()
    repos!.llm.updateModel(primary.id, { costInPerMtok: 0, costOutPerMtok: 1000 })
    repos!.accounting.setSetting(`limits:${company.id}`, { taskCostUsd: 2.5, dailyCostUsd: 20 })
    let calls = 0
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor() {
      return { adapter: adapter(async function* () {
        calls++
        yield { type: 'text', text: 'null' }
        yield { type: 'done', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1000, cachedTokens: 0 } }
      }) }
    } })).rejects.toThrow(/^budget_exceeded:/)
    expect(calls).toBe(1)
    repos!.accounting.setSetting(`limits:${company.id}`, { taskCostUsd: 0.1, dailyCostUsd: 20 })
    const select = vi.fn()
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor: select })).rejects.toThrow(/^budget_exceeded:/)
    expect(select).not.toHaveBeenCalled()
  })

  it.each(['content_filter', 'error', 'tool_calls'])('rejects unsuccessful completion %s without committing valid-looking output', async finishReason => {
    const { company } = configuredModels()
    let calls = 0
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor() {
      return { adapter: adapter(async function* () {
        calls++
        yield { type: 'text', text: answer('section-0') }
        yield { type: 'done', finishReason, usage: { promptTokens: 10, completionTokens: 10, cachedTokens: 0 } }
      }) }
    } })).rejects.toThrow('invalid_model_response: unsuccessful_completion')
    expect(calls).toBe(4)
  })

  it('treats adapter protocol failures as terminal and preserves attached provider usage', async () => {
    const { company, primary } = configuredModels()
    const selected: string[] = []
    const finish = vi.spyOn(repos!.accounting, 'finishRun')
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor(model) {
      selected.push(model.id)
      return { adapter: adapter(async function* () {
        throw providerError('PRIVATE_INVALID_ENVELOPE', { details: { reason: 'invalid_response', usage: { promptTokens: 30, completionTokens: 40, cachedTokens: 0 } } })
      }) }
    } })).rejects.toThrow('provider_error: Invalid provider response protocol')
    expect(selected).toEqual([primary.id])
    expect(finish.mock.calls[0]![1]).toMatchObject({ status: 'failed', tokensIn: 30, tokensOut: 40 })
    expect(JSON.stringify(finish.mock.calls)).not.toContain('PRIVATE_INVALID_ENVELOPE')
  })

  it.each(['missing_completion', 'response_too_large'])('repairs %s within request and previous-output bounds', async reason => {
    const { company, primary, fallback } = configuredModels()
    const selected: string[] = []
    const repairs: string[] = []
    const finish = vi.spyOn(repos!.accounting, 'finishRun')
    await expect(classifyKnowledgeSource(repos!, company.id, 'hello', { selectAdapterFor(model) {
      selected.push(model.id)
      return { adapter: adapter(async function* (request) {
        if (request.messages.length > 2) repairs.push(request.messages.at(-1)!.content)
        if (reason === 'missing_completion') yield { type: 'text', text: answer('section-0') }
        else yield* chunks('x'.repeat(80_001))
      }) }
    } })).rejects.toThrow(`invalid_model_response: ${reason}`)
    expect(selected).toEqual([primary.id, primary.id, fallback.id, fallback.id])
    expect(repairs).toHaveLength(2)
    expect(repairs.every(repair => repair.length < 17_000)).toBe(true)
    expect(finish).toHaveBeenCalledTimes(4)
    if (reason === 'response_too_large') expect(finish.mock.calls[0]![1]).toMatchObject({ tokensIn: 10, tokensOut: 10 })
  })

  it('exports injectable classification entry points for HTTP and worker fixtures', async () => {
    const service = await import('../src/services/knowledge-classifier.ts')
    expect(service.classifyKnowledgeSource).toBeTypeOf('function')
    expect(service.startKnowledgeClassificationWorker).toBeTypeOf('function')
  })
})
