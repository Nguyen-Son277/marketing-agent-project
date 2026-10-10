/** Test chunker: cắt theo heading, giữ headingPath, overlap, không cắt code fence. */
import { describe, expect, it } from 'vitest'
import { chunkMarkdown } from '../src/chunker.ts'

const buildParagraph = (n: number): string =>
  `Đoạn ${n}: ${'nội dung kiểm thử overlap cho tìm kiếm ngữ nghĩa '.repeat(7)}kết thúc đoạn ${n}.`

describe('chunkMarkdown', () => {
  it('cắt theo heading và giữ headingPath phân cấp', () => {
    const markdown = [
      '# Brand guidelines',
      '',
      'Giới thiệu ngắn.',
      '',
      '## Màu sắc',
      '',
      'Xanh rêu là màu chính.',
      '',
      '## Typography',
      '',
      'Be Vietnam Pro.',
    ].join('\n')

    const chunks = chunkMarkdown(markdown)
    const paths = chunks.map((chunk) => chunk.headingPath)
    expect(paths).toContain('Brand guidelines')
    expect(paths).toContain('Brand guidelines > Màu sắc')
    expect(paths).toContain('Brand guidelines > Typography')

    const colorChunk = chunks.find((chunk) => chunk.headingPath === 'Brand guidelines > Màu sắc')
    expect(colorChunk?.text).toContain('## Màu sắc')
    expect(colorChunk?.text).toContain('Xanh rêu là màu chính.')
    // ordinal phải liên tục và tokens phải được ước lượng dương.
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index))
    for (const chunk of chunks) expect(chunk.tokens).toBeGreaterThan(0)
  })

  it('lặp lại phần đuôi (overlap) giữa hai đoạn liền kề', () => {
    const markdown = ['# Tài liệu', '', '## Phần dài', '', ...Array.from({ length: 6 }, (_, i) => buildParagraph(i + 1)).flatMap((p) => [p, ''])].join('\n')
    const chunks = chunkMarkdown(markdown)

    expect(chunks.length).toBeGreaterThanOrEqual(3)
    for (const chunk of chunks) {
      expect(chunk.headingPath).toBe('Tài liệu > Phần dài')
      // Một đoạn không vượt quá maxChars + overlap (800 + 120) cộng dung sai nhỏ.
      expect(chunk.text.length).toBeLessThanOrEqual(800 + 120 + 20)
    }

    // Mỗi đoạn sau mở đầu bằng phần đuôi của đoạn trước (block thứ hai sau heading).
    for (let i = 1; i < chunks.length; i++) {
      const block = chunks[i]!.text.split('\n\n')[1] ?? ''
      expect(block.length).toBeGreaterThanOrEqual(40)
      expect(chunks[i - 1]!.text).toContain(block)
    }
  })

  it('không cắt giữa code fence dù fence dài hơn maxChars', () => {
    const codeLines = Array.from({ length: 30 }, (_, i) => `const dong${i} = "gia tri ${i} cua vi du ZXMARK"`)
    const markdown = [
      '# Hướng dẫn',
      '',
      '## Ví dụ dài',
      '',
      '```ts',
      ...codeLines,
      '```',
      '',
      '## Kết thúc',
      '',
      'Nội dung sau ví dụ.',
    ].join('\n')

    const chunks = chunkMarkdown(markdown, { maxChars: 400, overlapChars: 80 })
    const fenceChunks = chunks.filter((chunk) => chunk.text.includes('ZXMARK'))
    expect(fenceChunks).toHaveLength(1)
    const fenceChunk = fenceChunks[0]!.text
    expect(fenceChunk).toContain('const dong0 =')
    expect(fenceChunk).toContain('const dong29 =')
    // Số dấu fence phải chẵn: fence được giữ nguyên khối, không bị cắt đôi.
    expect((fenceChunk.match(/```/g) ?? []).length % 2).toBe(0)
  })

  it('trả mảng rỗng cho tài liệu rỗng', () => {
    expect(chunkMarkdown('\n\n')).toEqual([])
  })
})
