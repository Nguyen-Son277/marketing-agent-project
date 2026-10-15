/** Test indexer: quét thư mục, phát hiện thay đổi bằng checksum, ghi job, lỗi từng file. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { indexCompany, indexDocument, reindexStoredDocuments, scanMarkdownFiles } from '../src/indexer.ts'
import { makeFixture, writeDocs, type KbFixture } from './support.ts'

let fixture: KbFixture

beforeEach(() => {
  fixture = makeFixture()
})

afterEach(() => {
  fixture.cleanup()
})

const DOCS = [
  {
    path: '00-cong-ty/tong-quan.md',
    content:
      '# Tổng quan công ty\n\nSapa Digital cung cấp phần mềm bán hàng.\n\n## Mô hình giá\n\nGói Khởi nghiệp 299.000đ, gói Chuyên nghiệp 699.000đ.\n',
  },
  {
    path: '10-brand/guidelines.md',
    content: '# Brand guidelines\n\n## Màu sắc\n\nMàu chính là xanh rêu #1B5E4A, màu nhấn là vàng #F2B705.\n',
  },
]

const runIndex = (options: { force?: boolean } = {}) =>
  indexCompany(fixture.repos, {
    companyId: fixture.company.id,
    rootDir: fixture.rootDir,
    provider: fixture.provider,
    ...(options.force === undefined ? {} : { force: options.force }),
  })

describe('indexCompany', () => {
  it('index toàn bộ thư mục và ghi chunk, embedding, job', async () => {
    writeDocs(fixture.rootDir, DOCS)
    const result = await runIndex()

    expect(result.errors).toEqual([])
    expect(result.indexed).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.chunks).toBeGreaterThanOrEqual(2)

    const stats = fixture.repos.knowledge.stats(fixture.company.id)
    expect(stats.documents).toBe(2)
    expect(stats.chunks).toBe(result.chunks)
    expect(stats.embedded).toBe(result.chunks)

    const doc = fixture.repos.knowledge.findDocument(fixture.company.id, '10-brand/guidelines.md')
    expect(doc?.title).toBe('Brand guidelines')
    expect(doc?.category).toBe('10-brand')
    expect(doc?.source).toBe('file')

    const jobs = fixture.repos.knowledge.listIndexJobs(fixture.company.id, 50)
    expect(jobs.filter((job) => job.status === 'indexed')).toHaveLength(2)
  })

  it('index lại nội dung không đổi là no-op (skipped) và không tạo thêm chunk', async () => {
    writeDocs(fixture.rootDir, DOCS)
    await runIndex()
    const before = fixture.repos.knowledge.stats(fixture.company.id)
    const document = fixture.repos.knowledge.findDocument(fixture.company.id, DOCS[0]!.path)!
    fixture.repos.db.run('DELETE FROM kb_embeddings WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE document_id = ?)', [document.id])

    const second = await runIndex()

    expect(second.indexed).toBe(1)
    expect(second.skipped).toBe(1)
    expect(second.chunks).toBeGreaterThan(0)
    expect(fixture.repos.knowledge.stats(fixture.company.id).embedded).toBe(before.embedded)
    const jobs = fixture.repos.knowledge.listIndexJobs(fixture.company.id, 50)
    expect(jobs.filter((job) => job.status === 'skipped')).toHaveLength(1)
  })

  it('chỉ index lại file đã đổi; --force index tất cả', async () => {
    writeDocs(fixture.rootDir, DOCS)
    await runIndex()

    writeDocs(fixture.rootDir, [
      {
        path: '10-brand/guidelines.md',
        content: '# Brand guidelines\n\n## Màu sắc\n\nĐổi sang xanh dương #0B5FFF và vàng #FFD400.\n',
      },
    ])

    const changed = await runIndex()
    expect(changed.indexed).toBe(1)
    expect(changed.skipped).toBe(1)

    const forced = await runIndex({ force: true })
    expect(forced.indexed).toBe(2)
    expect(forced.skipped).toBe(0)
  })

  it('một file lỗi không làm chết cả lượt; file ẩn bị bỏ qua', async () => {
    writeDocs(fixture.rootDir, [
      ...DOCS,
      { path: 'khong-ro-danh-muc.md', content: '# Không có danh mục hợp lệ' },
      { path: '.an.md', content: '# Tài liệu ẩn' },
      { path: '00-cong-ty/.an-con.md', content: '# Ẩn trong thư mục con' },
    ])

    const result = await runIndex()

    expect(result.indexed).toBe(2)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.path).toBe('khong-ro-danh-muc.md')
    expect(result.errors[0]?.message).toMatch(/danh mục/i)
    expect(scanMarkdownFiles(fixture.rootDir)).toHaveLength(3)

    const jobs = fixture.repos.knowledge.listIndexJobs(fixture.company.id, 50)
    expect(jobs.some((job) => job.status === 'failed')).toBe(true)
    expect(fixture.repos.knowledge.findDocument(fixture.company.id, 'khong-ro-danh-muc.md')).toBeUndefined()
  })
})

describe('indexDocument', () => {
  it('ghi tài liệu, tăng version khi nội dung đổi, và skip khi force=false + không đổi', async () => {
    const input = {
      companyId: fixture.company.id,
      path: '90-ket-qua/bao-cao-tuan.md',
      content: '# Báo cáo tuần\n\n## Kết quả\n\nDoanh thu tăng 12%.',
      provider: fixture.provider,
    }

    const first = await indexDocument(fixture.repos, input)
    expect(first.status).toBe('indexed')
    expect(first.document.category).toBe('90-ket-qua')
    expect(first.document.version).toBe(1)
    expect(first.document.content).toBe(input.content)
    expect(fixture.repos.knowledge.documentContent(fixture.company.id, first.document.id)).toBe(input.content)
    expect(first.chunks).toBeGreaterThan(0)

    const unchanged = await indexDocument(fixture.repos, { ...input, force: false })
    expect(unchanged.status).toBe('skipped')
    expect(unchanged.document.version).toBe(1)

    const updated = await indexDocument(fixture.repos, { ...input, content: `${input.content}\n\nCập nhật mới.` })
    expect(updated.status).toBe('indexed')
    expect(updated.document.version).toBe(2)
    expect(updated.document.content).toBe(`${input.content}\n\nCập nhật mới.`)
  })

  it('can reindex canonical sources without the original content directory and preserves upload metadata', async () => {
    const content = '# Bản gốc\n\nMột đoạn có dấu tiếng Việt và định dạng nguyên bản.\n'
    const indexed = await indexDocument(fixture.repos, {
      companyId: fixture.company.id,
      path: '10-brand/uploaded.md',
      content,
      provider: fixture.provider,
      source: 'upload',
    })
    fixture.repos.knowledge.setUploadMetadata(fixture.company.id, indexed.document.id, {
      originalName: 'guide.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 1024,
      storageKey: 'uploads/company/guide.docx',
      originalChecksum: 'original-sha256',
    })
    const before = fixture.repos.knowledge.findDocument(fixture.company.id, '10-brand/uploaded.md')!
    const reindexed = await reindexStoredDocuments(fixture.repos, {
      companyId: fixture.company.id,
      provider: fixture.provider,
      force: true,
    })
    const after = fixture.repos.knowledge.findDocument(fixture.company.id, '10-brand/uploaded.md')!
    expect(reindexed.errors).toEqual([])
    expect(after.content).toBe(content)
    expect(after.originalName).toBe(before.originalName)
    expect(after.storageKey).toBe(before.storageKey)
  })

  it('reindexes upload-auto embeddings without changing sections, categories, or canonical source', async () => {
    const content = '# Mixed upload\n\nBrand-only source.\n\nAnalytics-only source.\n'
    const indexed = await indexDocument(fixture.repos, {
      companyId: fixture.company.id, path: '10-brand/mixed.md', content,
      category: '10-brand', source: 'upload-auto', provider: fixture.provider,
    })
    const startA = content.indexOf('Brand-only')
    const startB = content.indexOf('Analytics-only')
    fixture.repos.knowledge.replaceSectionsAndChunks(fixture.company.id, indexed.document.id, [
      { ordinal: 0, startOffset: startA, endOffset: startB, title: 'Brand section', category: '10-brand', tags: ['brand'], confidence: 0.9, assignmentSource: 'auto' },
      { ordinal: 1, startOffset: startB, endOffset: content.length, title: 'Analytics section', category: '40-du-lieu', tags: ['analytics'], confidence: 0.8, assignmentSource: 'manual' },
    ], [
      { ordinal: 0, sectionOrdinal: 0, text: 'Brand-only source.', headingPath: 'Brand section', tokens: 3, category: '10-brand' },
      { ordinal: 1, sectionOrdinal: 1, text: 'Analytics-only source.', headingPath: 'Analytics section', tokens: 3, category: '40-du-lieu' },
    ])
    const beforeSections = fixture.repos.knowledge.listSections(fixture.company.id, indexed.document.id)
    const beforeChunks = fixture.repos.knowledge.listChunks(indexed.document.id)
    const before = fixture.repos.knowledge.findDocument(fixture.company.id, indexed.document.path)!

    const result = await reindexStoredDocuments(fixture.repos, { companyId: fixture.company.id, provider: fixture.provider, force: true })
    const after = fixture.repos.knowledge.findDocument(fixture.company.id, indexed.document.path)!
    const afterSections = fixture.repos.knowledge.listSections(fixture.company.id, indexed.document.id)
    const afterChunks = fixture.repos.knowledge.listChunks(indexed.document.id)

    expect(result.errors).toEqual([])
    expect(after.content).toBe(before.content)
    expect(after.version).toBe(before.version)
    expect(afterSections).toEqual(beforeSections)
    expect(afterChunks.map(({ text, category }) => ({ text, category }))).toEqual(beforeChunks.map(({ text, category }) => ({ text, category })))
    expect(fixture.repos.knowledge.countDocumentEmbeddings(indexed.document.id, fixture.provider.name)).toBe(2)
  })

  it('leaves pending upload-auto source without sections and chunks untouched', async () => {
    const content = 'Pending classified data.'
    const indexed = await indexDocument(fixture.repos, {
      companyId: fixture.company.id, path: '10-brand/pending-auto.md', content,
      category: '10-brand', source: 'upload-auto',
    })
    fixture.repos.knowledge.replaceChunks(indexed.document.id, fixture.company.id, [])
    const before = fixture.repos.knowledge.findDocument(fixture.company.id, indexed.document.path)!
    const result = await reindexStoredDocuments(fixture.repos, { companyId: fixture.company.id, force: true })
    const after = fixture.repos.knowledge.findDocument(fixture.company.id, indexed.document.path)!
    expect(after.content).toBe(before.content)
    expect(after.version).toBe(before.version)
    expect(fixture.repos.knowledge.listChunks(indexed.document.id)).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('skips unchanged lexical-only documents without rewriting source', async () => {
    const input = { companyId: fixture.company.id, path: '10-brand/lexical.md', content: '# Nguồn\n\nVăn bản tìm theo từ khóa.', force: false }
    const first = await indexDocument(fixture.repos, input)
    const second = await indexDocument(fixture.repos, input)
    expect(second.status).toBe('skipped')
    expect(second.document.version).toBe(first.document.version)
  })

  it('retains lexical index and reports embedding provider failures as warnings', async () => {
    const result = await indexDocument(fixture.repos, {
      companyId: fixture.company.id,
      path: '10-brand/no-vector.md',
      content: '# Lexical only\n\nThis text remains searchable lexically.',
      provider: { name: 'broken', dim: 4, embed: async () => { throw new Error('provider offline') } },
    })
    expect(result.warning).toMatch(/provider offline/)
    expect(fixture.repos.knowledge.listChunks(result.document.id).length).toBeGreaterThan(0)
    expect(fixture.repos.knowledge.countDocumentEmbeddings(result.document.id)).toBe(0)
  })
})
