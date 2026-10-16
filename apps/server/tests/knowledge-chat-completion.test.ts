import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAiCompatibleAdapter } from '@marketing-agent/llm'
import { createKbReadTool, createKbSearchTool } from '@marketing-agent/kb'
import type { ToolContext } from '@marketing-agent/shared'
import {
  classifyKnowledgeSource,
  splitKnowledgeSource,
  startKnowledgeClassificationWorker,
  type ClassifierOptions,
  type SourceSection,
} from '../src/services/knowledge-classifier.ts'
import { configureCompanyModel, createRoutesTestContext, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext
beforeEach(async () => { ctx = await createRoutesTestContext() })
afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await ctx.close()
})

const gateway = 'http://knowledge-chat-completion.invalid/v1'
const mixedSource = '# Brand\nBRANDORCHID giọng nói thương hiệu thân thiện.\n\n# KPI\nSECRETCAC chi phí khách hàng 88 đồng.\n'
type FixtureRequest = { model: string; stream: boolean; tools?: unknown; messages: { role: string; content: string }[] }

/** Only the synthetic provider is intercepted; the existing route helper still uses real loopback HTTP. */
function chatCompletionFixture(answer?: (sections: SourceSection[], call: number) => unknown) {
  const originalFetch = globalThis.fetch
  const requests: FixtureRequest[] = []
  const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(`${ctx.client.baseUrl}/`)) return originalFetch(input, init)
    if (url !== `${gateway}/chat/completions`) throw new Error(`Unexpected external request in offline fixture: ${url}`)
    const request = JSON.parse(String(init?.body)) as FixtureRequest
    requests.push(request)
    const payload = JSON.parse(request.messages.find(message => message.role === 'user')!.content) as { sections: SourceSection[] }
    const metadata = answer ? answer(payload.sections, requests.length) : {
      sections: payload.sections.map(section => ({
        id: section.id,
        category: section.text.includes('SECRETCAC') ? '40-du-lieu' : '10-brand',
        tags: ['fixture'], confidence: 0.93, title: 'Classified source section',
      })),
    }
    // A gateway may ignore stream:true and send an ordinary JSON ChatCompletion.
    // The assistant's content is prose plus a fenced JSON object, not a bare object.
    return new Response(JSON.stringify({
      id: `chatcmpl-fixture-${requests.length}`, object: 'chat.completion', created: 1,
      model: request.model,
      choices: [{ index: 0, message: { role: 'assistant', content: `Here is the classification of the supplied source.\n\n\`\`\`json\n${JSON.stringify(metadata)}\n\`\`\`\n\nAll source sections are included above.` }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 41, completion_tokens: 27, total_tokens: 68, prompt_tokens_details: { cached_tokens: 7 } },
    }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })
  })
  vi.stubGlobal('fetch', fetchFixture)
  const adapter = new OpenAiCompatibleAdapter({ baseUrl: gateway, apiKey: 'offline-fixture-key' })
  return { requests, options: { selectAdapterFor: () => ({ adapter }) } satisfies ClassifierOptions }
}

async function upload(companyId: string, headers: Record<string, string>, source: string) {
  const form = new FormData()
  form.set('file', new Blob([source]), 'chat-completion-source.txt')
  const response = await fetch(`${ctx.client.baseUrl}/api/companies/${companyId}/knowledge/upload`, { method: 'POST', headers, body: form })
  expect(response.status).toBe(202)
  return (await response.json() as { document: { id: string; path: string } }).document
}

async function runWorker(options: ClassifierOptions) {
  const worker = startKnowledgeClassificationWorker(ctx.repos, {
    intervalMs: 60_000,
    classify: (repos, companyId, source, workerOptions) => classifyKnowledgeSource(repos, companyId, source, { ...workerOptions, ...options }),
  })
  try { await worker.runOnce() } finally { await worker.close() }
}

function writerContext(companyId: string): ToolContext {
  const agent = ctx.repos.team.findAgentDefByRole('content-writer')!
  return { companyId, agentDefId: agent.id, agentRole: 'content-writer', taskId: null, conversationId: null, log: () => {} }
}

describe('knowledge classification through JSON ChatCompletion gateways', () => {
  it('classifies prose-wrapped fenced JSON through the real adapter without a repair request', async () => {
    const { company } = await tenant(ctx, 'chat-completion-direct@example.com', 'ChatCompletion direct')
    configureCompanyModel(ctx, company.id)
    const fixture = chatCompletionFixture()

    const classified = await classifyKnowledgeSource(ctx.repos, company.id, mixedSource, fixture.options)

    expect(fixture.requests).toHaveLength(1)
    expect(fixture.requests[0]).toMatchObject({ model: 'test-model', stream: true })
    expect(fixture.requests[0]!.tools).toBeUndefined()
    expect(classified.map(({ id, start, end, text }) => ({ id, start, end, text }))).toEqual(splitKnowledgeSource(mixedSource))
    expect(classified.map(section => section.text).join('')).toBe(mixedSource)
    expect(classified.map(section => section.category)).toEqual(['10-brand', '40-du-lieu'])
    expect(classified.every(section => section.confidence === 0.93 && section.tags[0] === 'fixture')).toBe(true)
  })

  it('durably commits sections and chunks, preserves original source and manual assignments, and enforces section ACL', async () => {
    const { company, ownerCookie } = await tenant(ctx, 'chat-completion-worker@example.com', 'ChatCompletion worker')
    configureCompanyModel(ctx, company.id)
    const fixture = chatCompletionFixture()
    const document = await upload(company.id, ownerCookie, mixedSource)
    expect(ctx.repos.knowledge.listChunks(document.id)).toEqual([])

    await runWorker(fixture.options)

    expect(ctx.repos.knowledge.getClassificationJob(company.id, document.id)).toMatchObject({ status: 'ready', attempts: 1, error: null })
    const sections = ctx.repos.knowledge.listSections(company.id, document.id)
    expect(sections).toHaveLength(2)
    expect(sections.map(section => mixedSource.slice(section.startOffset, section.endOffset)).join('')).toBe(mixedSource)
    expect(sections.map(section => section.category)).toEqual(['10-brand', '40-du-lieu'])
    const chunks = ctx.repos.knowledge.listChunks(document.id)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    for (const section of sections) {
      const assigned = chunks.filter(chunk => chunk.sectionId === section.id)
      expect(assigned.length).toBeGreaterThan(0)
      expect(assigned.every(chunk => chunk.category === section.category)).toBe(true)
      expect(assigned.map(chunk => chunk.text).join('\n')).toContain(section.category === '10-brand' ? 'BRANDORCHID' : 'SECRETCAC')
    }
    expect(ctx.repos.knowledge.documentContent(company.id, document.id)).toBe(mixedSource)
    const detail = await ctx.client.request('GET', `/api/companies/${company.id}/knowledge/${document.id}`, { headers: ownerCookie })
    expect(detail.json<{ document: { content: string } }>().document.content).toBe(mixedSource)
    const download = await fetch(`${ctx.client.baseUrl}/api/companies/${company.id}/knowledge/${document.id}/download`, { headers: ownerCookie })
    expect(download.status).toBe(200)
    expect(await download.text()).toBe(mixedSource)

    const toolContext = writerContext(company.id)
    const read = await createKbReadTool({ repos: ctx.repos }).handler({ path: document.path }, toolContext)
    expect(read.content).toContain('BRANDORCHID')
    expect(read.content).not.toContain('SECRETCAC')
    const search = await createKbSearchTool({ repos: ctx.repos }).handler({ query: 'SECRETCAC' }, toolContext)
    expect(search.content).not.toContain('88 đồng')

    // Restrict the formerly readable brand slice manually. A subsequent AI result
    // must not undo that category or its user-supplied tags on matching offsets.
    const patch = await ctx.client.request('PATCH', `/api/companies/${company.id}/knowledge/${document.id}/sections/${sections[0]!.id}`, {
      headers: ownerCookie, body: { category: '40-du-lieu', tags: ['manual-private'] },
    })
    expect(patch.status).toBe(200)
    const retry = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge/${document.id}/classification/retry`, { headers: ownerCookie, body: {} })
    expect(retry.status).toBe(202)
    await runWorker(fixture.options)

    expect(ctx.repos.knowledge.getClassificationJob(company.id, document.id)?.status).toBe('ready')
    const reclassified = ctx.repos.knowledge.listSections(company.id, document.id)
    expect(reclassified[0]).toMatchObject({ startOffset: sections[0]!.startOffset, endOffset: sections[0]!.endOffset, category: '40-du-lieu', assignmentSource: 'manual', tagsJson: JSON.stringify(['manual-private']) })
    expect(ctx.repos.knowledge.listChunks(document.id).every(chunk => chunk.category === '40-du-lieu')).toBe(true)
    expect(ctx.repos.knowledge.documentContent(company.id, document.id)).toBe(mixedSource)
    const restricted = await createKbReadTool({ repos: ctx.repos }).handler({ path: document.path }, toolContext)
    expect(restricted.content).not.toContain('BRANDORCHID')
    expect(restricted.content).not.toContain('SECRETCAC')
    expect(fixture.requests).toHaveLength(2)
  })

  it('fails an invalid later batch without committing the valid earlier batch or losing the uploaded source', async () => {
    const { company, ownerCookie } = await tenant(ctx, 'chat-completion-invalid@example.com', 'ChatCompletion invalid')
    configureCompanyModel(ctx, company.id)
    const source = 'ORIGINALSOURCE '.repeat(950) // More than one 12,000-character classifier batch.
    const fixture = chatCompletionFixture((sections, call) => ({
      sections: sections.map(section => ({ id: section.id, category: call === 1 ? '10-brand' : 'not-a-category', tags: [], confidence: 0.9, title: 'Source section' })),
    }))
    const document = await upload(company.id, ownerCookie, source)

    await runWorker(fixture.options)

    // One good batch, one invalid batch, and its single bounded repair attempt.
    expect(fixture.requests).toHaveLength(3)
    expect(ctx.repos.knowledge.getClassificationJob(company.id, document.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/^invalid_model_response:/) })
    expect(ctx.repos.knowledge.listSections(company.id, document.id)).toEqual([])
    expect(ctx.repos.knowledge.listChunks(document.id)).toEqual([])
    expect(ctx.repos.knowledge.documentContent(company.id, document.id)).toBe(source)
  })
})
