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

  it('rejects malformed JSON from the model', () => {
    expect(() => classifySectionMetadata('{not json', [])).toThrow()
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

  it('exports injectable classification entry points for HTTP and worker fixtures', async () => {
    const service = await import('../src/services/knowledge-classifier.ts')
    expect(service.classifyKnowledgeSource).toBeTypeOf('function')
    expect(service.startKnowledgeClassificationWorker).toBeTypeOf('function')
  })
})
