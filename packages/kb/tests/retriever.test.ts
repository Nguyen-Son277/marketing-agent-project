/** Test retrieval lai (lexical + vector + RRF) và cách ly ACL. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentRole } from '@marketing-agent/shared'
import { indexCompany } from '../src/indexer.ts'
import { retrieve } from '../src/retriever.ts'
import { makeFixture, writeDemoDocs, writeDocs, type KbFixture } from './support.ts'

let fixture: KbFixture

const SECRET_DOC = {
  path: '40-du-lieu/ga4-noi-bo.md',
  content:
    '# Số liệu GA4 nội bộ\n\n## Chỉ số riêng tư\n\nDoanh thu ZQXSECRET tăng 42 phần trăm trong quý này.\n',
}

beforeEach(async () => {
  fixture = makeFixture()
  writeDemoDocs(fixture.rootDir)
  writeDocs(fixture.rootDir, [SECRET_DOC])
  const result = await indexCompany(fixture.repos, {
    companyId: fixture.company.id,
    rootDir: fixture.rootDir,
    provider: fixture.provider,
  })
  expect(result.errors).toEqual([])
  expect(result.indexed).toBe(12)
})

afterEach(() => {
  fixture.cleanup()
})

const defId = (role: AgentRole): string => {
  const def = fixture.repos.team.findAgentDefByRole(role)
  if (!def) throw new Error(`Thiếu agent ${role}`)
  return def.id
}

const search = async (role: AgentRole, query: string, k = 8) =>
  retrieve(fixture.repos, {
    companyId: fixture.company.id,
    agentDefId: defId(role),
    query,
    k,
    embeddingProvider: fixture.provider,
    model: fixture.provider.name,
  })

describe('retrieve', () => {
  it('trả đúng tài liệu cho câu hỏi tiếng Việt về giá (top-3)', async () => {
    const hits = await search('content-writer', 'chính sách giá của chúng tôi là gì')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.slice(0, 3).map((hit) => hit.path)).toContain('00-cong-ty/tong-quan.md')
  })

  it('trả đúng tài liệu cho câu hỏi về màu thương hiệu (top-3)', async () => {
    const hits = await search('content-writer', 'màu sắc thương hiệu của chúng ta là gì')
    expect(hits.slice(0, 3).map((hit) => hit.path)).toContain('10-brand/guidelines.md')
  })

  it('mọi hit đều kèm provenance để trích dẫn', async () => {
    const hits = await search('content-writer', 'màu thương hiệu')
    const hit = hits[0]
    expect(hit).toBeTruthy()
    expect(hit!.path.length).toBeGreaterThan(0)
    expect(hit!.title.length).toBeGreaterThan(0)
    expect(hit!.category.length).toBeGreaterThan(0)
    expect(hit!.text.length).toBeGreaterThan(0)
    expect(hit!.score).toBeGreaterThan(0)
  })

  it('vẫn tìm được theo từ khoá khi không có embedding provider', async () => {
    const hits = await retrieve(fixture.repos, {
      companyId: fixture.company.id,
      agentDefId: defId('content-writer'),
      query: 'màu thương hiệu',
    })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.vectorRank === null)).toBe(true)
  })

  it('CÁCH LY ACL: agent không đọc 40-du-lieu không bao giờ nhận chunk từ đó', async () => {
    const blocked = await search('content-writer', 'ZQXSECRET GA4 doanh thu chỉ số')
    expect(blocked.every((hit) => hit.category !== '40-du-lieu')).toBe(true)
    expect(blocked.some((hit) => hit.text.includes('ZQXSECRET'))).toBe(false)

    const broad = await search('content-writer', 'GA4 KPI chuyển đổi chỉ số phễu', 20)
    expect(broad.length).toBeGreaterThan(0)
    expect(broad.every((hit) => hit.category !== '40-du-lieu')).toBe(true)

    // Cùng câu hỏi nhưng agent có quyền đọc thì tìm thấy, chứng minh dữ liệu có tồn tại.
    const allowed = await search('analytics', 'ZQXSECRET')
    expect(allowed.some((hit) => hit.path === SECRET_DOC.path)).toBe(true)
  })

  it('agent không có danh mục đọc nào trả về rỗng ngay', async () => {
    const hits = await retrieve(fixture.repos, {
      companyId: fixture.company.id,
      agentDefId: 'agent-khong-ton-tai',
      query: 'giá',
      embeddingProvider: fixture.provider,
    })
    expect(hits).toEqual([])
  })

  it('truy vấn rỗng trả về rỗng', async () => {
    expect(await search('content-writer', '   ')).toEqual([])
  })
})
