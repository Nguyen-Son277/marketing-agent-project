/**
 * Bóc khối frontmatter YAML "vừa đủ dùng" ở đầu tài liệu Markdown và suy ra
 * metadata chuẩn hoá (title, category, tags, owner) cho kho kiến thức.
 *
 * Vì sao tự viết parser thay vì thêm thư viện YAML: kho kiến thức chỉ cần bốn
 * khoá do người dùng nhập tay, nên một parser nhỏ, không phụ thuộc, dễ kiểm
 * chứng sẽ ít rủi ro hơn một dependency mới. Khi frontmatter thiếu, metadata
 * được suy ra từ chính tài liệu (H1 đầu tiên, prefix thư mục) để người dùng chỉ
 * cần thả file .md vào đúng thư mục là index được ngay.
 */
import { basename } from 'node:path'
import { KB_CATEGORY_CODES, isKbCategory, validation } from '@marketing-agent/shared'

export interface FrontmatterData {
  readonly title?: string
  readonly category?: string
  readonly tags: readonly string[]
  readonly owner?: string
  /** Các khoá khác ngoài title/category/tags/owner, giữ nguyên dạng chuỗi. */
  readonly extra: Readonly<Record<string, string>>
}

export interface ParsedFrontmatter {
  readonly data: FrontmatterData
  readonly content: string
}

export interface DocumentMetadata {
  readonly title: string
  readonly category: string
  readonly tags: readonly string[]
  readonly owner: string | null
  /** Phần nội dung đã bỏ frontmatter. */
  readonly content: string
  readonly frontmatter: FrontmatterData
}

const EMPTY_DATA: FrontmatterData = { tags: [], extra: {} }
const FRONTMATTER_FENCE = /^(-{3,}|\.{3})\s*$/
const KNOWN_KEYS = new Set(['title', 'category', 'tags', 'owner'])

/**
 * Tách frontmatter khỏi nội dung. Khối mở đầu không hợp lệ hoặc chưa đóng được
 * coi là nội dung thường, tránh làm mất chữ của người dùng.
 */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const text = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  if (!FRONTMATTER_FENCE.test((lines[0] ?? '').trim())) {
    return { data: EMPTY_DATA, content: text }
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER_FENCE.test((lines[i] ?? '').trim())) {
      end = i
      break
    }
  }
  if (end === -1) return { data: EMPTY_DATA, content: text }
  const data = parseSimpleYaml(lines.slice(1, end))
  const content = lines
    .slice(end + 1)
    .join('\n')
    .replace(/^\n+/, '')
  return { data, content }
}

/** H1 đầu tiên ngoài code fence; dùng làm title dự phòng. */
export function firstHeading(content: string): string | null {
  let fence: string | null = null
  for (const raw of content.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    const fenceMatch = /^(```|~~~)/.exec(line)
    if (fenceMatch) {
      fence = fence ? null : (fenceMatch[1] ?? null)
      continue
    }
    if (fence) continue
    const heading = /^#\s+(.+?)\s*#*$/.exec(line)
    if (heading) return heading[1]!.trim()
  }
  return null
}

/** Danh mục suy ra từ đoạn đường dẫn: thư mục mang mã danh mục chuẩn. */
export function categoryFromPath(path: string): string | null {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  for (const segment of segments.slice(0, -1)) {
    if (isKbCategory(segment)) return segment
  }
  // Một số người đặt mã danh mục ngay trong tên file: "10-brand__guidelines.md".
  const leaf = segments.at(-1) ?? ''
  const prefix = /^(\d{2}-[a-z0-9-]+)/i.exec(leaf)?.[1]?.toLowerCase()
  return prefix && isKbCategory(prefix) ? prefix : null
}

export interface ResolveMetadataOptions {
  /** Dùng khi cả frontmatter lẫn đường dẫn đều không cho biết danh mục. */
  readonly defaultCategory?: string
}

/**
 * Metadata cuối cùng của một tài liệu. Ném lỗi validation khi không xác định
 * được danh mục, vì danh mục chính là đơn vị phân quyền — đoán bừa sẽ mở sai
 * quyền đọc cho agent.
 */
export function resolveDocumentMetadata(
  path: string,
  markdown: string,
  options: ResolveMetadataOptions = {},
): DocumentMetadata {
  const { data, content } = parseFrontmatter(markdown)
  const fallbackTitle =
    firstHeading(content) ?? firstMeaningfulLine(content) ?? basename(path).replace(/\.md$/i, '')
  return {
    title: data.title?.trim() || fallbackTitle,
    category: resolveCategory(data.category, path, options.defaultCategory),
    tags: data.tags,
    owner: data.owner && data.owner.trim() ? data.owner.trim() : null,
    content,
    frontmatter: data,
  }
}

function resolveCategory(explicit: string | undefined, path: string, fallback: string | undefined): string {
  if (explicit && isKbCategory(explicit.trim())) return explicit.trim()
  const fromPath = categoryFromPath(path)
  if (fromPath) return fromPath
  if (fallback && isKbCategory(fallback)) return fallback
  throw validation(
    `Không xác định được danh mục cho tài liệu "${path}". ` +
      `Hãy khai báo "category" trong frontmatter hoặc đặt file trong thư mục thuộc một trong: ${KB_CATEGORY_CODES.join(', ')}.`,
  )
}

/* ------------------------------------------------------- YAML tối giản */

function parseSimpleYaml(lines: readonly string[]): FrontmatterData {
  const scalars = new Map<string, string>()
  const arrays = new Map<string, string[]>()
  let listKey: string | null = null

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const listItem = /^\s*-\s+(.*)$/.exec(line)
    if (listItem && listKey) {
      const value = unquote(listItem[1]!.trim())
      if (value) arrays.get(listKey)?.push(value)
      continue
    }

    const pair = /^([\w.-]+)\s*:\s*(.*)$/.exec(line)
    if (!pair) {
      listKey = null
      continue
    }
    const key = pair[1]!.toLowerCase()
    const value = pair[2]!.trim()
    if (!value) {
      // Khoá không có giá trị: có thể là mảng gạch đầu dòng ở các dòng sau.
      arrays.set(key, [])
      listKey = key
      continue
    }
    listKey = null
    if (value.startsWith('[')) {
      arrays.set(key, splitInlineArray(value))
      continue
    }
    scalars.set(key, unquote(value))
  }

  const extra: Record<string, string> = {}
  for (const [key, value] of scalars) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value
  }
  const title = scalars.get('title')
  const category = scalars.get('category')
  const owner = scalars.get('owner')
  return {
    ...(title ? { title } : {}),
    ...(category ? { category } : {}),
    ...(owner ? { owner } : {}),
    tags: arrays.get('tags') ?? [],
    extra,
  }
}

/** Tách `[a, b, "c, d"]` mà không cắt nhầm dấu phẩy nằm trong chuỗi. */
function splitInlineArray(value: string): string[] {
  const inner = value.replace(/^\[/, '').replace(/\].*$/, '')
  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  for (const char of inner) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ',') {
      parts.push(current)
      current = ''
      continue
    }
    current += char
  }
  parts.push(current)
  return parts.map((part) => unquote(part.trim())).filter(Boolean)
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1).trim()
  }
  return value.trim()
}

function firstMeaningfulLine(content: string): string | null {
  for (const raw of content.split('\n')) {
    const line = raw.replace(/^#+\s*/, '').trim()
    if (line) return line.slice(0, 120)
  }
  return null
}
