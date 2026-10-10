/** Test indexer: quét thư mục, phát hiện thay đổi bằng checksum, ghi job, lỗi từng file. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { indexCompany, indexDocument, scanMarkdownFiles } from '../src/indexer.ts'
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

    const second = await runIndex()

    expect(second.indexed).toBe(0)
    expect(second.skipped).toBe(2)
    expect(second.chunks).toBe(0)
    expect(fixture.repos.knowledge.stats(fixture.company.id)).toEqual(before)
    const jobs = fixture.repos.knowledge.listIndexJobs(fixture.company.id, 50)
    expect(jobs.filter((job) => job.status === 'skipped')).toHaveLength(2)
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
    expect(first.chunks).toBeGreaterThan(0)

    const unchanged = await indexDocument(fixture.repos, { ...input, force: false })
    expect(unchanged.status).toBe('skipped')
    expect(unchanged.document.version).toBe(1)

    const updated = await indexDocument(fixture.repos, { ...input, content: `${input.content}\n\nCập nhật mới.` })
    expect(updated.status).toBe('indexed')
    expect(updated.document.version).toBe(2)
  })
})
