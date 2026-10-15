/** End-to-end upload and retrieval through the real HTTP route and KB tools. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolContext } from '@marketing-agent/shared'
import { createKbReadTool, createKbSearchTool } from '@marketing-agent/kb'
import { createRoutesTestContext, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

async function uploadText(companyId: string, cookie: Record<string, string>, category: string, filename: string, text: string) {
  const form = new FormData()
  form.set('file', new Blob([text], { type: 'text/plain' }), filename)
  form.set('category', category)
  const response = await fetch(`${ctx.client.baseUrl}/api/companies/${companyId}/knowledge/upload`, {
    method: 'POST',
    headers: cookie,
    body: form,
  })
  const body = await response.json() as { document?: { path: string; category: string; content?: string }; error?: unknown }
  return { status: response.status, body }
}

describe('upload-to-agent knowledge retrieval', () => {
  it('retrieves uploaded text through real KB tools with company ACL and source provenance', async () => {
    const first = await tenant(ctx, 'knowledge-first@example.com', 'Knowledge First')
    const second = await tenant(ctx, 'knowledge-second@example.com', 'Knowledge Second')
    const fact = 'ORCHID-FACT: công ty triển khai bảo hành 27 tháng cho thiết bị Orchid.'
    const uploaded = await uploadText(first.company.id, first.ownerCookie, '10-brand', 'orchid.txt', fact)

    expect(uploaded.status).toBe(201)
    expect(uploaded.body.document?.category).toBe('10-brand')
    const path = uploaded.body.document?.path
    expect(path).toMatch(/^10-brand\/uploads\/.+\/orchid\.txt$/)
    if (!path) throw new Error('Upload did not return a document path')

    const agent = ctx.repos.team.findAgentDefByRole('content-writer')
    if (!agent) throw new Error('Missing content-writer agent definition')
    const context: ToolContext = {
      companyId: first.company.id,
      agentDefId: agent.id,
      agentRole: 'content-writer',
      taskId: null,
      conversationId: null,
      log: () => {},
    }
    const deps = { repos: ctx.repos }
    const search = createKbSearchTool(deps)
    const read = createKbReadTool(deps)

    const found = await search.handler({ query: 'ORCHID-FACT Orchid bảo hành 27 tháng' }, context)
    expect(found.isError).toBeFalsy()
    expect(found.content).toContain('ORCHID-FACT')
    expect(found.content).toContain(path)
    expect((found.data as { hits: { path: string; category: string }[] }).hits[0]).toMatchObject({ path, category: '10-brand' })

    const source = await read.handler({ path }, context)
    expect(source.isError).toBeFalsy()
    expect(source.content).toContain('Đường dẫn: ' + path)
    expect(source.content).toContain(fact)
    expect(source.data).toMatchObject({ path, category: '10-brand' })

    const isolated = await search.handler(
      { query: 'ORCHID-FACT Orchid bảo hành 27 tháng' },
      { ...context, companyId: second.company.id },
    )
    expect((isolated.data as { hits: unknown[] }).hits).toHaveLength(0)
    const crossCompanyRead = await read.handler({ path }, { ...context, companyId: second.company.id })
    expect(crossCompanyRead.isError).toBe(true)

    const deniedUpload = await uploadText(first.company.id, first.ownerCookie, '40-du-lieu', 'private.txt', 'PRIVATE-KPI: CAC 88.')
    expect(deniedUpload.status).toBe(201)
    const deniedPath = deniedUpload.body.document?.path
    if (!deniedPath) throw new Error('Denied-category upload did not return a document path')
    const deniedSearch = await search.handler({ query: 'PRIVATE-KPI CAC 88' }, context)
    expect((deniedSearch.data as { hits: { category: string }[] }).hits.every((hit) => hit.category !== '40-du-lieu')).toBe(true)
    const deniedRead = await read.handler({ path: deniedPath }, context)
    expect(deniedRead.isError).toBe(true)
    expect(deniedRead.content).toContain('không được phép đọc')
  })
})
