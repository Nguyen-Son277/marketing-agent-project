/**
 * Tool registry tests.
 *
 * The security-relevant cases are the point here: a tool the preset did not grant
 * must not run, a path must not escape the company workspace, and a failing tool
 * must return a result the model can read rather than throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepos, type Repos } from '@marketing-agent/db'
import type { ToolContext } from '@marketing-agent/shared'
import { seedCatalog, seedCompany } from '@marketing-agent/seed'
import { ToolRegistry, defineTool } from '../src/registry.ts'
import { createCoreTools } from '../src/core.ts'
import { buildToolRegistry, listToolNames } from '../src/index.ts'
import { hasCycle, topologicalOrder } from '../src/coordination.ts'
import { htmlToText, isBlockedHost, isHostAllowed } from '../src/http-tools.ts'

let repos: Repos
let root: string

beforeEach(() => {
  repos = createRepos({ file: ':memory:', allowWeakSecret: true })
  seedCatalog(repos)
  root = mkdtempSync(join(tmpdir(), 'ma-tools-'))
})

afterEach(() => {
  repos.db.close()
  rmSync(root, { recursive: true, force: true })
})

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    companyId: 'company-1',
    agentRole: 'content-writer',
    agentDefId: 'def-1',
    taskId: null,
    conversationId: null,
    log: () => {},
    ...overrides,
  }
}

describe('ToolRegistry gating', () => {
  it('refuses a tool that was not granted to the agent', async () => {
    const registry = new ToolRegistry([
      defineTool({
        name: 'secret.read',
        description: 'x',
        parameters: { type: 'object', properties: {} },
        handler: async () => ({ content: 'BÍ MẬT' }),
      }),
    ])
    const result = await registry.execute('secret.read', {}, makeContext(), [])
    expect(result.isError).toBe(true)
    expect(result.content).toContain('không được cấp quyền')
    expect(result.content).not.toContain('BÍ MẬT')
  })

  it('never runs the handler of a non-granted tool', async () => {
    const handler = vi.fn(async () => ({ content: 'ok' }))
    const registry = new ToolRegistry([
      defineTool({ name: 'x.danger', description: 'x', parameters: { type: 'object', properties: {} }, handler }),
    ])
    await registry.execute('x.danger', {}, makeContext(), [])
    expect(handler).not.toHaveBeenCalled()
  })

  it('reports an unknown tool without throwing', async () => {
    const registry = new ToolRegistry([])
    const result = await registry.execute('khong.ton.tai', {}, makeContext(), ['khong.ton.tai'])
    expect(result.isError).toBe(true)
    expect(result.content).toContain('không tồn tại')
  })

  it('enforces the tool own role list even when granted', async () => {
    const registry = new ToolRegistry([
      defineTool({
        name: 'leader.only',
        description: 'x',
        parameters: { type: 'object', properties: {} },
        roles: ['marketing-leader'],
        handler: async () => ({ content: 'chạy rồi' }),
      }),
    ])
    const result = await registry.execute('leader.only', {}, makeContext({ agentRole: 'content-writer' }), [
      'leader.only',
    ])
    expect(result.isError).toBe(true)
    expect(result.content).toContain('không được phép')

    const allowed = await registry.execute('leader.only', {}, makeContext({ agentRole: 'marketing-leader' }), [
      'leader.only',
    ])
    expect(allowed.isError).toBeFalsy()
  })

  it('turns a thrown handler error into a readable result', async () => {
    const registry = new ToolRegistry([
      defineTool({
        name: 'boom',
        description: 'x',
        parameters: { type: 'object', properties: {} },
        handler: async () => {
          throw new Error('dịch vụ ngoài sập')
        },
      }),
    ])
    const result = await registry.execute('boom', {}, makeContext(), ['boom'])
    expect(result.isError).toBe(true)
    expect(result.content).toContain('dịch vụ ngoài sập')
  })

  it('computes the granted set as an intersection, never a union', () => {
    const registry = new ToolRegistry([
      defineTool({ name: 'a', description: '', parameters: { type: 'object', properties: {} }, handler: async () => ({ content: '' }) }),
      defineTool({ name: 'b', description: '', parameters: { type: 'object', properties: {} }, handler: async () => ({ content: '' }) }),
      defineTool({
        name: 'c',
        description: '',
        parameters: { type: 'object', properties: {} },
        roles: ['marketing-leader'],
        handler: async () => ({ content: '' }),
      }),
    ])
    // Granted a and b and c, but c excludes the content writer role.
    const granted = registry.grantedFor('content-writer', ['a', 'b', 'c', 'khong-ton-tai'])
    expect(granted.map((t) => t.name)).toEqual(['a', 'b'])
  })

  it('rejects duplicate tool names at construction', () => {
    const tool = defineTool({
      name: 'dup',
      description: '',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ content: '' }),
    })
    expect(() => new ToolRegistry([tool, tool])).toThrow(/trùng tên/)
  })
})

describe('core file tools', () => {
  function coreTools(_companyId = 'company-1') {
    return createCoreTools(repos, { companiesRoot: root })
  }

  it('writes and reads a file inside the company workspace', async () => {
    const tools = coreTools()
    const written = await tools.filesWrite.handler(
      { path: 'reports/thang-11.md', content: '# Kế hoạch' },
      makeContext(),
    )
    expect(written.isError).toBeFalsy()
    expect(readFileSync(join(root, 'company-1', 'reports', 'thang-11.md'), 'utf8')).toBe('# Kế hoạch')

    const read = await tools.filesRead.handler({ path: 'reports/thang-11.md' }, makeContext())
    expect(read.content).toContain('# Kế hoạch')
  })

  it('refuses to escape the company workspace', async () => {
    const tools = coreTools()
    // Handler-level rejection is a throw; the registry turns it into an isError
    // result for the model, which is asserted separately below.
    for (const path of ['../../etc/passwd', '../other-company/secret.md', 'a/../../outside.md']) {
      await expect(tools.filesRead.handler({ path }, makeContext()), path).rejects.toThrow(/vùng làm việc/)
    }
  })

  it('refuses an absolute path', async () => {
    const tools = coreTools()
    await expect(
      tools.filesWrite.handler({ path: '/etc/passwd', content: 'x' }, makeContext()),
    ).rejects.toThrow(/tương đối/)
  })

  it('surfaces a path violation to the model as an isError result, not a crash', async () => {
    const company = seedCompany(repos, { companyName: 'Path Co' }).company
    const { registry } = buildToolRegistry({ repos, coreOptions: { companiesRoot: root } })
    const result = await registry.execute(
      'files_read',
      { path: '../../etc/passwd' },
      makeContext({ companyId: company.id }),
      ['files_read'],
    )
    expect(result.isError).toBe(true)
    expect(result.content).toContain('vùng làm việc')
  })

  it('keeps one company out of another company directory', async () => {
    const tools = coreTools()
    await tools.filesWrite.handler({ path: 'note.md', content: 'của A' }, makeContext({ companyId: 'company-A' }))
    await expect(
      tools.filesRead.handler({ path: 'note.md' }, makeContext({ companyId: 'company-B' })),
    ).rejects.toThrow(/Không tìm thấy file/)
  })

  it('appends when asked', async () => {
    const tools = coreTools()
    await tools.filesWrite.handler({ path: 'log.md', content: 'dòng 1\n' }, makeContext())
    await tools.filesWrite.handler({ path: 'log.md', content: 'dòng 2\n', mode: 'append' }, makeContext())
    expect(readFileSync(join(root, 'company-1', 'log.md'), 'utf8')).toBe('dòng 1\ndòng 2\n')
  })

  it('lists the workspace without hidden files', async () => {
    const tools = coreTools()
    await tools.filesWrite.handler({ path: 'visible.md', content: 'x' }, makeContext())
    await tools.filesWrite.handler({ path: '.hidden', content: 'x' }, makeContext())
    const listing = await tools.filesList.handler({}, makeContext())
    expect(listing.content).toContain('visible.md')
    expect(listing.content).not.toContain('.hidden')
  })

  it('publishes an artifact against the run task', async () => {
    const company = seedCompany(repos, { companyName: 'Artifact Co' }).company
    const task = repos.work.createTask({
      companyId: company.id,
      title: 'Việc thử',
      briefMd: 'brief',
    })
    const tools = coreTools()
    const published = await tools.artifactPublish.handler(
      { name: 'Báo cáo thử', kind: 'markdown', content: '# Nội dung', summary: 'Tóm tắt' },
      makeContext({ companyId: company.id, taskId: task.id }),
    )
    expect(published.isError).toBeFalsy()
    const artifacts = repos.work.listArtifacts(company.id, { taskId: task.id })
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.name).toBe('Báo cáo thử')
    expect(artifacts[0]?.companyId).toBe(company.id)
  })
})

describe('coordination graph helpers', () => {
  const task = (title: string, dependsOnTitles: string[] = []) => ({
    title,
    briefMd: 'b',
    assigneeRole: 'content-writer',
    dependsOnTitles,
  })

  it('accepts an acyclic plan', () => {
    expect(hasCycle([task('a'), task('b', ['a']), task('c', ['a'])])).toBe(false)
  })

  it('detects a cycle', () => {
    expect(hasCycle([task('a', ['b']), task('b', ['a'])])).toBe(true)
    expect(hasCycle([task('a', ['a'])])).toBe(true)
  })

  it('orders dependencies before dependents', () => {
    const ordered = topologicalOrder([task('c', ['b']), task('b', ['a']), task('a')])
    expect(ordered?.map((t) => t.title)).toEqual(['a', 'b', 'c'])
  })

  it('returns undefined for a cyclic plan', () => {
    expect(topologicalOrder([task('a', ['b']), task('b', ['a'])])).toBeUndefined()
  })
})

describe('http fetch host guard', () => {
  it('blocks loopback and private ranges', () => {
    for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254']) {
      expect(isBlockedHost(host), host).toBe(true)
    }
  })

  it('allows a public host', () => {
    expect(isBlockedHost('example.com')).toBe(false)
    expect(isHostAllowed(new URL('https://example.com/x'), undefined)).toBe(true)
  })

  it('honours an allowlist, including wildcards', () => {
    expect(isHostAllowed(new URL('https://api.example.com'), ['*.example.com'])).toBe(true)
    expect(isHostAllowed(new URL('https://example.com'), ['*.example.com'])).toBe(false)
    expect(isHostAllowed(new URL('https://other.com'), ['example.com'])).toBe(false)
  })

  it('keeps the allowlist from overriding the private-range block', () => {
    expect(isHostAllowed(new URL('http://127.0.0.1:8080'), ['127.0.0.1'])).toBe(false)
  })
})

describe('htmlToText', () => {
  it('strips scripts, styles and tags but keeps the text', () => {
    const html =
      '<html><head><style>p{color:red}</style><script>evil()</script></head>' +
      '<body><h1>Tiêu đề</h1><p>Đoạn một</p><p>Đoạn hai &amp; hơn</p></body></html>'
    const text = htmlToText(html)
    expect(text).toContain('Tiêu đề')
    expect(text).toContain('Đoạn một')
    expect(text).toContain('Đoạn hai & hơn')
    expect(text).not.toContain('evil')
    expect(text).not.toContain('color:red')
  })
})

describe('buildToolRegistry', () => {
  it('exposes the core and integration tools for a company', () => {
    const company = seedCompany(repos, { companyName: 'Tools Co' }).company
    const { registry } = buildToolRegistry({
      repos,
      coreOptions: { companiesRoot: root },
      integrations: true,
    })
    const names = registry.list().map((t) => t.name)
    expect(names).toContain('files_write')
    expect(names).toContain('artifact_publish')
    expect(names).toContain('http_fetch')
    expect(names).toContain('web_search')
    expect(names).toContain('gsc_query')
    expect(names).toContain('ga4_report')
    expect(names).toContain('meta_publish')
    expect(names).toContain('linkedin_publish')
    expect(company.id).toBeTruthy()
  })

  it('marks outward-facing publishing tools as needing approval', () => {
    const { registry } = buildToolRegistry({ repos, coreOptions: { companiesRoot: root } })
    const publishing = registry.list().filter((t) => t.name === 'meta_publish' || t.name === 'linkedin_publish')
    expect(publishing).toHaveLength(2)
    for (const tool of publishing) expect(tool.requiresApproval).toBe(true)
  })

  it('only grants each agent the tools its preset lists', () => {
    const company = seedCompany(repos, { companyName: 'Grants Co' }).company
    const { registry } = buildToolRegistry({ repos, coreOptions: { companiesRoot: root } })

    const writer = repos.team.resolveAgent(company.id, 'content-writer')
    const granted = registry
      .grantedFor(writer.role, writer.toolNames)
      .map((t) => t.name)
      .sort()
    // The writer's preset grants exactly these; the registry must not widen it.
    // `kb.*` tools live in packages/kb and are injected at composition time, so
    // they are absent from a registry built without `extraTools`.
    expect(granted).toEqual(['artifact_publish', 'files_write'].sort())
    for (const kbTool of ['kb_read', 'kb_search']) {
      expect(writer.toolNames).toContain(kbTool)
      expect(granted).not.toContain(kbTool)
    }
  })

  it('exposes every seeded agent tool as a known or externally provided tool', () => {
    // Knowledge tools come from packages/kb and coordination tools from the
    // orchestrator host, so a registry built here legitimately lacks both.
    const externallyProvided = new Set([
      'kb_search',
      'kb_read',
      'kb_write',
      'task_create',
      'task_assign',
      'agent_ask',
      'agent_escalate',
      'blocker_report',
    ])
    const known = new Set(listToolNames({ repos, coreOptions: { companiesRoot: root } }))
    const missing: string[] = []
    for (const def of repos.team.listAgentDefs()) {
      for (const tool of JSON.parse(def.defaultToolsJson) as string[]) {
        if (externallyProvided.has(tool)) continue
        if (!known.has(tool)) missing.push(`${def.role} → ${tool}`)
      }
    }
    expect(missing, `Tool chưa được cài đặt: ${missing.join(', ')}`).toEqual([])
  })
})

describe('integration gating', () => {
  it('fails an integration tool with an actionable message when unconfigured', async () => {
    const company = seedCompany(repos, { companyName: 'No Integrations' }).company
    const { registry } = buildToolRegistry({ repos, coreOptions: { companiesRoot: root } })
    const result = await registry.execute(
      'gsc_query',
      {},
      makeContext({ companyId: company.id, agentRole: 'seo-technical' }),
      ['gsc_query'],
    )
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/Chưa kết nối|Cài đặt/)
  })

  it('refuses a publishing tool when the integration is missing, not publishing silently', async () => {
    const company = seedCompany(repos, { companyName: 'No Meta' }).company
    const { registry } = buildToolRegistry({ repos, coreOptions: { companiesRoot: root } })
    const result = await registry.execute(
      'meta_publish',
      { message: 'Xin chào', published: true },
      makeContext({ companyId: company.id, agentRole: 'social-media' }),
      ['meta_publish'],
    )
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/Chưa kết nối/)
  })
})
