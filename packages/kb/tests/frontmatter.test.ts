/** Test bóc frontmatter và suy metadata tài liệu. */
import { describe, expect, it } from 'vitest'
import { categoryFromPath, firstHeading, parseFrontmatter, resolveDocumentMetadata } from '../src/frontmatter.ts'

describe('parseFrontmatter', () => {
  it('đọc key: value, mảng inline và owner', () => {
    const markdown = [
      '---',
      'title: Chính sách giá',
      'category: 00-cong-ty',
      'tags: [giá, "chính sách, khuyến mãi"]',
      'owner: marketing',
      '---',
      '',
      '# Nội dung thật',
    ].join('\n')
    const { data, content } = parseFrontmatter(markdown)
    expect(data.title).toBe('Chính sách giá')
    expect(data.category).toBe('00-cong-ty')
    expect(data.tags).toEqual(['giá', 'chính sách, khuyến mãi'])
    expect(data.owner).toBe('marketing')
    expect(content.startsWith('# Nội dung thật')).toBe(true)
  })

  it('đọc mảng gạch đầu dòng và giữ khoá lạ trong extra', () => {
    const markdown = ['---', 'tags:', '  - seo', '  - keyword', 'reviewed: 2026-10-01', '---', 'Nội dung'].join('\n')
    const { data, content } = parseFrontmatter(markdown)
    expect(data.tags).toEqual(['seo', 'keyword'])
    expect(data.extra.reviewed).toBe('2026-10-01')
    expect(content).toBe('Nội dung')
  })

  it('coi khối chưa đóng là nội dung thường', () => {
    const markdown = '---\ntitle: chưa đóng\n\n# Tiêu đề'
    const { data, content } = parseFrontmatter(markdown)
    expect(data.title).toBeUndefined()
    expect(content).toContain('# Tiêu đề')
  })
})

describe('resolveDocumentMetadata', () => {
  it('suy title từ H1 và category từ prefix thư mục khi thiếu frontmatter', () => {
    const meta = resolveDocumentMetadata('10-brand/guidelines.md', '# Brand guidelines\n\nNội dung')
    expect(meta.title).toBe('Brand guidelines')
    expect(meta.category).toBe('10-brand')
    expect(meta.owner).toBeNull()
    expect(meta.content).toBe('# Brand guidelines\n\nNội dung')
  })

  it('ưu tiên frontmatter hơn suy đoán', () => {
    const markdown = '---\ntitle: Tên riêng\ncategory: 20-thi-truong\n---\n# Bị bỏ qua'
    const meta = resolveDocumentMetadata('00-cong-ty/abc.md', markdown)
    expect(meta.title).toBe('Tên riêng')
    expect(meta.category).toBe('20-thi-truong')
  })

  it('ném lỗi rõ ràng khi không xác định được danh mục', () => {
    expect(() => resolveDocumentMetadata('tai-lieu.md', '# Không danh mục')).toThrow(/danh mục/i)
  })
})

describe('helpers', () => {
  it('bỏ qua heading bên trong code fence', () => {
    const content = '```md\n# Không phải tiêu đề\n```\n\n# Tiêu đề thật'
    expect(firstHeading(content)).toBe('Tiêu đề thật')
  })

  it('nhận diện mã danh mục từ thư mục và từ tên file', () => {
    expect(categoryFromPath('00-cong-ty/tong-quan.md')).toBe('00-cong-ty')
    expect(categoryFromPath('40-du-lieu__kpi.md')).toBe('40-du-lieu')
    expect(categoryFromPath('tai-lieu/khac.md')).toBeNull()
  })
})
