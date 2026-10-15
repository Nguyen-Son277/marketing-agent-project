/** Test tool kb_search / kb_read / kb_write: quyền đọc, quyền ghi và provenance. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentRole, ToolContext, ToolDefinition } from '@marketing-agent/shared'
import { indexCompany, indexDocument } from '../src/indexer.ts'
import { createKbTools, KB_TOOL_NAMES } from '../src/tools.ts'
import { makeFixture, writeDocs, type KbFixture } from './support.ts'

let fixture: KbFixture
let tools: ToolDefinition[]

const DOCS = [
  { path: '00-cong-ty/tong-quan.md', content: '# Tổng quan công ty\n\nSapa Digital bán phần mềm quản lý bán hàng.\n' },
  {
    path: '10-brand/guidelines.md',
    content: '# Brand guidelines\n\n## Màu sắc\n\nMàu chính là xanh rêu #1B5E4A, màu nhấn là vàng #F2B705.\n',
  },
  {
    path: '40-du-lieu/kpi.md',
    content: '# Định nghĩa KPI\n\n## Phễu\n\nCAC và tỉ lệ chuyển đổi trial sang paid là chỉ số trọng tâm.\n',
  },
]

beforeEach(async () => {
  fixture = makeFixture()
  writeDocs(fixture.rootDir, DOCS)
  const result = await indexCompany(fixture.repos, {
    companyId: fixture.company.id,
    rootDir: fixture.rootDir,
    provider: fixture.provider,
  })
  expect(result.errors).toEqual([])
  tools = createKbTools({ repos: fixture.repos, embeddingProvider: fixture.provider })
})

afterEach(() => {
  fixture.cleanup()
})

const tool = (name: string): ToolDefinition => {
  const found = tools.find((entry) => entry.name === name)
  if (!found) throw new Error(`Thiếu tool ${name}`)
  return found
}

const defId = (role: AgentRole): string => {
  const def = fixture.repos.team.findAgentDefByRole(role)
  if (!def) throw new Error(`Thiếu agent ${role}`)
  return def.id
}

const ctxFor = (role: AgentRole, agentDefId = defId(role)): ToolContext => ({
  companyId: fixture.company.id,
  agentDefId,
  agentRole: role,
  taskId: null,
  conversationId: null,
  log: () => {},
})

describe('uploaded sources', () => {
  it('does not let agents overwrite the original uploaded knowledge', async () => {
    const doc = await indexDocument(fixture.repos, {companyId:fixture.company.id,path:'30-kenh/uploads/original.txt',content:'Nguồn gốc bất biến.',category:'30-kenh',source:'upload'})
    const result = await tool('kb_write').handler({path:doc.document.path,content:'Nội dung giả',category:'30-kenh'},ctxFor('social-media'))
    expect(result.isError).toBe(true)
    expect(fixture.repos.knowledge.documentContent(fixture.company.id,doc.document.id)).toBe('Nguồn gốc bất biến.')
    const read = await tool('kb_read').handler({path:doc.document.path},ctxFor('social-media'))
    expect(read.isError).toBeFalsy()
    expect(read.content).toContain('Nguồn gốc bất biến.')
  })
})

describe('metadata', () => {
  it('đăng ký đủ ba tool với tham số bắt buộc', () => {
    expect(tools.map((entry) => entry.name)).toEqual([...KB_TOOL_NAMES])
    expect(tool('kb_search').parameters.required).toEqual(['query'])
    expect(tool('kb_read').parameters.required).toEqual(['path'])
    expect(tool('kb_write').parameters.required).toEqual(['path', 'content'])
  })
})

describe('kb_search', () => {
  it('trả nội dung kèm path, title, headingPath để trích dẫn', async () => {
    const result = await tool('kb_search').handler({ query: 'màu sắc thương hiệu', k: 5 }, ctxFor('content-writer'))
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('10-brand/guidelines.md')
    expect(result.content).toContain('Màu sắc')
    expect(result.content).toContain('- Tài liệu:')
    const data = result.data as { hits: { path: string; title: string }[] }
    expect(data.hits[0]?.path).toBe('10-brand/guidelines.md')
    expect(data.hits[0]?.title).toBe('Brand guidelines')
  })

  it('không bao giờ trả về danh mục agent không được đọc', async () => {
    const result = await tool('kb_search').handler({ query: 'KPI CAC chuyển đổi phễu', k: 20 }, ctxFor('content-writer'))
    const data = result.data as { hits: { category: string }[] }
    expect(data.hits.every((hit) => hit.category !== '40-du-lieu')).toBe(true)
    const broad = await tool('kb_search').handler({ query: 'chỉ số', k: 20 }, ctxFor('content-writer'))
    const broadData = broad.data as { hits: { category: string }[] }
    expect(broadData.hits.every((hit) => hit.category !== '40-du-lieu')).toBe(true)
  })

  it('từ chối yêu cầu tìm trong danh mục không có quyền', async () => {
    const result = await tool('kb_search').handler(
      { query: 'KPI', categories: ['40-du-lieu'] },
      ctxFor('content-writer'),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/Không có quyền đọc/)
  })

  it('từ chối khi agent không có danh mục đọc nào', async () => {
    const result = await tool('kb_search').handler({ query: 'giá' }, ctxFor('content-writer', 'agent-khong-ton-tai'))
    expect(result.isError).toBe(true)
  })

  it('báo lỗi tham số không hợp lệ', async () => {
    const result = await tool('kb_search').handler({ query: '' }, ctxFor('content-writer'))
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/Tham số không hợp lệ/)
  })
})

describe('kb_read', () => {
  it('returns only ACL-readable classified sections from upload-auto sources', async () => {
    const content = '# Company upload\n\nPublic brand guidance.\n\nSecret analytics KPI and revenue.\n'
    const indexed = await indexDocument(fixture.repos, {
      companyId: fixture.company.id, path: '10-brand/classified.md', content,
      category: '10-brand', source: 'upload-auto',
    })
    const visibleStart = content.indexOf('Public brand guidance.')
    const hiddenStart = content.indexOf('Secret analytics KPI')
    fixture.repos.knowledge.replaceSectionsAndChunks(fixture.company.id, indexed.document.id, [
      { ordinal: 0, startOffset: visibleStart, endOffset: hiddenStart, title: 'Brand', category: '10-brand', tags: [], confidence: 1, assignmentSource: 'auto' },
      { ordinal: 1, startOffset: hiddenStart, endOffset: content.length, title: 'Analytics', category: '40-du-lieu', tags: [], confidence: 1, assignmentSource: 'auto' },
    ], [
      { ordinal: 0, sectionOrdinal: 0, text: content.slice(visibleStart, hiddenStart), headingPath: 'Brand', tokens: 4, category: '10-brand' },
      { ordinal: 1, sectionOrdinal: 1, text: content.slice(hiddenStart), headingPath: 'Analytics', tokens: 5, category: '40-du-lieu' },
    ])

    const result = await tool('kb_read').handler({ path: indexed.document.path }, ctxFor('content-writer'))
    expect(result.isError).toBeFalsy()
    expect(result.content).toContain('Public brand guidance.')
    expect(result.content).not.toContain('Secret analytics KPI')
    expect(result.content).toContain('section:')
    expect(result.content).toContain('Chỉ hiển thị các mục đã phân loại')
    expect((result.data as { sectionIds: string[] }).sectionIds).toHaveLength(1)
  })

  it('does not reveal canonical upload-auto content before sections are classified', async () => {
    const secret = 'Unclassified source ZQSECRET.'
    const indexed = await indexDocument(fixture.repos, {
      companyId: fixture.company.id, path: '10-brand/pending.md', content: secret,
      category: '10-brand', source: 'upload-auto',
    })
    const result = await tool('kb_read').handler({ path: indexed.document.path }, ctxFor('content-writer'))
    expect(result.content).not.toContain(secret)
    expect(result.content).toMatch(/không có dữ liệu đã phân loại/i)
  })

  it('từ chối đọc tài liệu thuộc danh mục không có quyền', async () => {
    const denied = await tool('kb_read').handler({ path: '40-du-lieu/kpi.md' }, ctxFor('content-writer'))
    expect(denied.isError).toBe(true)
    expect(denied.content).toMatch(/không được phép đọc/)

    const allowed = await tool('kb_read').handler({ path: '40-du-lieu/kpi.md' }, ctxFor('analytics'))
    expect(allowed.isError).toBeFalsy()
    expect(allowed.content).toContain('Định nghĩa KPI')
    expect(allowed.content).toContain('CAC')
  })

  it('báo lỗi khi tài liệu không tồn tại', async () => {
    const result = await tool('kb_read').handler({ path: '00-cong-ty/khong-co.md' }, ctxFor('content-writer'))
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/Không tìm thấy tài liệu/)
  })
})

describe('kb_write', () => {
  it('từ chối khi agent không có quyền ghi danh mục nào', async () => {
    const result = await tool('kb_write').handler(
      { path: '90-ket-qua/bao-cao.md', content: '# Báo cáo\n\nNội dung.' },
      ctxFor('content-writer'),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/không được cấp quyền ghi/)
    expect(fixture.repos.knowledge.findDocument(fixture.company.id, '90-ket-qua/bao-cao.md')).toBeUndefined()
  })

  it('từ chối khi danh mục không nằm trong quyền ghi', async () => {
    const result = await tool('kb_write').handler(
      { path: '00-cong-ty/tai-lieu-moi.md', content: '# Tài liệu mới\n\nNội dung.' },
      ctxFor('social-media'),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/không có quyền ghi vào danh mục "00-cong-ty"/)
  })

  it('cho phép ghi vào danh mục được cấp và tìm lại được ngay', async () => {
    const written = await tool('kb_write').handler(
      { path: '30-kenh/playbook-moi.md', content: '# Playbook mới\n\n## Bước một\n\nNội dung SEO nội bộ ZQPLAYBOOK.' },
      ctxFor('social-media'),
    )
    expect(written.isError).toBeFalsy()
    expect(fixture.repos.knowledge.findDocument(fixture.company.id, '30-kenh/playbook-moi.md')).toBeTruthy()

    const found = await tool('kb_search').handler({ query: 'ZQPLAYBOOK SEO' }, ctxFor('content-writer'))
    expect(found.content).toContain('30-kenh/playbook-moi.md')
  })

  it('từ chối đường dẫn không hợp lệ', async () => {
    const result = await tool('kb_write').handler(
      { path: '../../etc/passwd.md', content: '# X' },
      ctxFor('social-media'),
    )
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/không hợp lệ/)
  })
})
