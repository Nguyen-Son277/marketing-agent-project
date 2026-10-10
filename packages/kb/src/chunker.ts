/**
 * Chia Markdown thành các đoạn (chunk) theo heading để tìm kiếm và trích dẫn.
 *
 * Vì sao cắt theo heading thay vì theo độ dài thuần: agent phải trích dẫn được
 * nguồn (ví dụ "Brand guidelines > Màu sắc"), và một đoạn cắt ngang giữa hai mục
 * sẽ trộn hai chủ đề, làm hỏng cả tìm kiếm từ khoá lẫn tìm kiếm vector. Phần
 * overlap giữa hai đoạn liền kề bảo toàn ngữ cảnh ở ranh giới, còn code fence
 * tuyệt đối không bị cắt để ví dụ/dữ liệu mẫu không vỡ khi agent đọc lại.
 */
import type { ChunkInput } from '@marketing-agent/db'
import { estimateTokens } from '@marketing-agent/shared'

export interface ChunkOptions {
  /** Kích thước mục tiêu của một đoạn, tính bằng ký tự. */
  readonly maxChars?: number
  /** Số ký tự lặp lại giữa hai đoạn liền kề để giữ ngữ cảnh. */
  readonly overlapChars?: number
}

export const DEFAULT_CHUNK_CHARS = 800
export const DEFAULT_CHUNK_OVERLAP = 120
/** Kích thước tối thiểu, tránh cấu hình sai biến mọi câu thành một chunk. */
const MIN_CHUNK_CHARS = 200

interface Section {
  readonly headingPath: string | null
  readonly headingLine: string | null
  readonly body: string
}

interface RawChunk {
  readonly text: string
  readonly headingPath: string | null
}

/** Chia tài liệu thành `ChunkInput[]` sẵn sàng cho `KnowledgeRepo.replaceChunks`. */
export function chunkMarkdown(markdown: string, options: ChunkOptions = {}): ChunkInput[] {
  const maxChars = Math.max(MIN_CHUNK_CHARS, options.maxChars ?? DEFAULT_CHUNK_CHARS)
  const overlapChars = Math.max(0, Math.min(options.overlapChars ?? DEFAULT_CHUNK_OVERLAP, Math.floor(maxChars / 2)))

  const chunks: RawChunk[] = []
  for (const section of splitSections(markdown)) {
    const body = section.body.trim()
    if (!body) continue

    const emit = (text: string): void => {
      const trimmed = text.trim()
      if (!trimmed) return
      // Lặp lại dòng heading trong từng đoạn để tìm kiếm từ khoá bắt được tiêu đề mục.
      const withHeading = section.headingLine ? `${section.headingLine}\n\n${trimmed}` : trimmed
      chunks.push({ text: withHeading, headingPath: section.headingPath })
    }

    const units = expandUnits(splitUnits(body), maxChars)
    let buffer = ''
    let hasContent = false

    for (const unit of units) {
      if (isFence(unit) && unit.length > maxChars) {
        if (hasContent) {
          emit(buffer)
          buffer = ''
          hasContent = false
        }
        emit(unit)
        continue
      }
      if (hasContent && buffer.length + unit.length + 2 > maxChars) {
        emit(buffer)
        // Bắt đầu đoạn mới bằng phần đuôi của đoạn vừa rồi; bỏ overlap nếu đuôi
        // rơi vào code fence, vì dán nửa fence sẽ tạo Markdown hỏng.
        buffer = overlapTail(buffer, overlapChars)
        hasContent = false
      }
      buffer = buffer ? `${buffer}\n\n${unit}` : unit
      hasContent = true
    }
    if (hasContent) emit(buffer)
  }

  return chunks.map((chunk, ordinal) => ({
    ordinal,
    text: chunk.text,
    headingPath: chunk.headingPath,
    tokens: estimateTokens(chunk.text),
  }))
}

/* ------------------------------------------------------------ headings */

function splitSections(markdown: string): Section[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const sections: Section[] = []
  const stack: string[] = []
  let headingLine: string | null = null
  let headingPath: string | null = null
  let body: string[] = []
  let fence: string | null = null

  const flush = (): void => {
    sections.push({ headingPath, headingLine, body: body.join('\n') })
    body = []
  }

  for (const line of lines) {
    const fenceMatch = /^\s*(```|~~~)/.exec(line)
    if (fenceMatch) {
      fence = fence ? null : (fenceMatch[1] ?? null)
      body.push(line)
      continue
    }
    const heading = fence ? null : /^(#{1,6})\s+(.*\S)\s*$/.exec(line)
    if (!heading) {
      body.push(line)
      continue
    }
    flush()
    const level = heading[1]!.length
    stack.length = level - 1
    stack[level - 1] = heading[2]!.trim()
    headingLine = line.trim()
    headingPath = stack.filter(Boolean).slice(0, level).join(' > ') || null
  }
  flush()
  return sections
}

/* -------------------------------------------------------------- blocks */

/** Tách section thành các khối ngăn cách bởi dòng trống; fence luôn nguyên khối. */
function splitUnits(body: string): string[] {
  const units: string[] = []
  let current: string[] = []
  let fence: string | null = null

  const flush = (): void => {
    const text = current.join('\n').trim()
    if (text) units.push(text)
    current = []
  }

  for (const line of body.split('\n')) {
    const fenceMatch = /^\s*(```|~~~)/.exec(line)
    if (fenceMatch) fence = fence ? null : (fenceMatch[1] ?? null)
    if (!fence && !fenceMatch && line.trim() === '') {
      flush()
      continue
    }
    current.push(line)
  }
  flush()
  return units
}

/** Cắt khối quá dài thành các mảnh vừa `maxChars`; fence giữ nguyên. */
function expandUnits(units: readonly string[], maxChars: number): string[] {
  const out: string[] = []
  for (const unit of units) {
    if (unit.length <= maxChars || isFence(unit)) {
      out.push(unit)
      continue
    }
    let current = ''
    for (const line of unit.split('\n')) {
      const pieces = line.length > maxChars ? splitLongLine(line, maxChars) : [line]
      for (const piece of pieces) {
        if (current && current.length + piece.length + 1 > maxChars) {
          out.push(current)
          current = piece
        } else {
          current = current ? `${current}\n${piece}` : piece
        }
      }
    }
    if (current) out.push(current)
  }
  return out
}

/** Cắt một dòng quá dài ưu tiên theo câu, cuối cùng mới cắt cứng. */
function splitLongLine(line: string, maxChars: number): string[] {
  const sentences = line.split(/(?<=[.!?…])\s+/)
  const out: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        out.push(current)
        current = ''
      }
      for (let i = 0; i < sentence.length; i += maxChars) out.push(sentence.slice(i, i + maxChars))
      continue
    }
    if (current && current.length + sentence.length + 1 > maxChars) {
      out.push(current)
      current = sentence
    } else {
      current = current ? `${current} ${sentence}` : sentence
    }
  }
  if (current) out.push(current)
  return out
}

function isFence(text: string): boolean {
  return /^\s*(```|~~~)/.test(text)
}

/** Lấy phần đuôi của đoạn trước làm overlap, cắt ở ranh giới từ. */
function overlapTail(text: string, overlapChars: number): string {
  if (overlapChars <= 0 || text.length <= overlapChars) return ''
  const tail = text.slice(text.length - overlapChars)
  if (/(```|~~~)/.test(tail)) return ''
  const firstSpace = tail.search(/\s/)
  return (firstSpace >= 0 ? tail.slice(firstSpace + 1) : tail).trim()
}
