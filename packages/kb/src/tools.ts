/**
 * Ba công cụ để agent làm việc với kho kiến thức công ty: tìm (`kb.search`),
 * đọc một tài liệu (`kb.read`), và ghi/cập nhật (`kb.write`).
 *
 * Vì sao quyền được kiểm tra ở đây chứ không ở tầng gọi: model chỉ điều khiển
 * tham số, không điều khiển danh tính. Mọi kiểm tra đọc/ghi đều lấy `companyId`
 * và `agentDefId` từ `ToolContext` do runtime cấp, và tham số `categories` của
 * model chỉ được phép THU HẸP quyền đã có — không bao giờ mở rộng. Kết quả trả
 * về luôn kèm path/title/headingPath để agent trích dẫn nguồn thay vì bịa.
 */
import { z } from 'zod'
import {
  KB_CATEGORY_CODES,
  isKbCategory,
  truncate,
  type ToolContext,
  type ToolDefinition,
  type ToolParameterSchema,
  type ToolResult,
} from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { indexDocument } from './indexer.ts'
import { categoryFromPath, parseFrontmatter } from './frontmatter.ts'
import { retrieve } from './retriever.ts'
import type { EmbeddingProvider } from './embeddings.ts'

export const KB_TOOL_NAMES = ['kb.search', 'kb.read', 'kb.write'] as const

export interface KbToolDeps {
  readonly repos: Repos
  /** Bỏ trống thì kb.search vẫn chạy nhưng chỉ tìm theo từ khoá. */
  readonly embeddingProvider?: EmbeddingProvider
}

const EXCERPT_CHARS = 1_500

/* -------------------------------------------------------------- schemas */

const searchArgsSchema = z.object({
  query: z.string().min(1),
  categories: z.array(z.string()).optional(),
  k: z.coerce.number().int().min(1).max(20).optional(),
})

const readArgsSchema = z.object({ path: z.string().min(1) })

const writeArgsSchema = z.object({
  path: z.string().min(1),
  content: z.string().min(1),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

const SEARCH_PARAMETERS: ToolParameterSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Câu hỏi hoặc từ khoá tiếng Việt cần tìm trong kho kiến thức.' },
    categories: {
      type: 'array',
      items: { type: 'string', enum: [...KB_CATEGORY_CODES] },
      description: 'Chỉ tìm trong các danh mục này (phải nằm trong quyền đọc; bỏ trống để tìm mọi danh mục được phép).',
    },
    k: { type: 'number', description: 'Số đoạn tối đa, 1–20 (mặc định 8).' },
  },
  required: ['query'],
  additionalProperties: false,
}

const READ_PARAMETERS: ToolParameterSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Đường dẫn tài liệu trong kho, ví dụ "10-brand/guidelines.md".' },
  },
  required: ['path'],
  additionalProperties: false,
}

const WRITE_PARAMETERS: ToolParameterSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Đường dẫn tài liệu cần ghi, ví dụ "90-ket-qua/bao-cao-tuan.md".' },
    content: { type: 'string', description: 'Toàn bộ nội dung Markdown của tài liệu (có thể kèm frontmatter).' },
    category: {
      type: 'string',
      enum: [...KB_CATEGORY_CODES],
      description: 'Danh mục; bỏ trống thì suy ra từ thư mục hoặc frontmatter.',
    },
    tags: { type: 'array', items: { type: 'string' }, description: 'Nhãn tìm kiếm của tài liệu.' },
  },
  required: ['path', 'content'],
  additionalProperties: false,
}

/* ----------------------------------------------------------------- tools */

export function createKbSearchTool(deps: KbToolDeps): ToolDefinition {
  return {
    name: 'kb.search',
    description:
      'Tìm trong kho kiến thức của công ty theo câu hỏi tiếng Việt. Chỉ trả về tài liệu thuộc danh mục ' +
      'mà agent này được phép đọc. Mỗi kết quả kèm path, title và headingPath để trích dẫn nguồn.',
    parameters: SEARCH_PARAMETERS,
    handler: async (args, ctx) => searchHandler(deps, args, ctx),
  }
}

export function createKbReadTool(deps: KbToolDeps): ToolDefinition {
  return {
    name: 'kb.read',
    description:
      'Đọc toàn bộ nội dung một tài liệu trong kho kiến thức theo đường dẫn. Từ chối nếu tài liệu thuộc ' +
      'danh mục agent không được phép đọc.',
    parameters: READ_PARAMETERS,
    handler: async (args, ctx) => readHandler(deps, args, ctx),
  }
}

export function createKbWriteTool(deps: KbToolDeps): ToolDefinition {
  return {
    name: 'kb.write',
    description:
      'Ghi mới hoặc cập nhật một tài liệu Markdown trong kho kiến thức. Chỉ ghi được vào danh mục agent ' +
      'được phép ghi; nội dung được phân đoạn và nhúng lại ngay sau khi lưu.',
    parameters: WRITE_PARAMETERS,
    handler: async (args, ctx) => writeHandler(deps, args, ctx),
  }
}

export function createKbTools(deps: KbToolDeps): ToolDefinition[] {
  return [createKbSearchTool(deps), createKbReadTool(deps), createKbWriteTool(deps)]
}

/* -------------------------------------------------------------- handlers */

async function searchHandler(deps: KbToolDeps, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const parsed = searchArgsSchema.safeParse(args)
  if (!parsed.success) return invalidArguments('kb.search', parsed.error.issues.map((issue) => issue.message))

  const readable = deps.repos.team.readableCategories(ctx.companyId, ctx.agentDefId)
  if (readable.length === 0) {
    return {
      content: 'Agent này chưa được cấp quyền đọc danh mục kiến thức nào, nên không thể tìm kiếm.',
      isError: true,
    }
  }

  const requested = parsed.data.categories?.filter((category) => readable.includes(category))
  if (parsed.data.categories && parsed.data.categories.length > 0 && (!requested || requested.length === 0)) {
    return {
      content: `Không có quyền đọc các danh mục được yêu cầu. Danh mục được phép: ${readable.join(', ')}.`,
      isError: true,
    }
  }
  const categories = requested && requested.length > 0 ? requested : readable

  try {
    const hits = await retrieve(deps.repos, {
      companyId: ctx.companyId,
      agentDefId: ctx.agentDefId,
      query: parsed.data.query,
      ...(parsed.data.k === undefined ? {} : { k: parsed.data.k }),
      ...(deps.embeddingProvider ? { embeddingProvider: deps.embeddingProvider } : {}),
      categories,
    })
    ctx.log('kb.search', { query: parsed.data.query, hits: hits.length, categories })

    if (hits.length === 0) {
      return {
        content: `Không tìm thấy đoạn kiến thức phù hợp cho "${parsed.data.query}" trong các danh mục: ${categories.join(', ')}.`,
        data: { hits: [] },
      }
    }
    return {
      content: hits.map((hit, index) => formatHit(hit, index)).join('\n\n---\n\n'),
      data: {
        hits: hits.map((hit) => ({
          chunkId: hit.chunkId,
          path: hit.path,
          title: hit.title,
          category: hit.category,
          headingPath: hit.headingPath,
          headingUrl: hit.headingUrl,
          score: hit.score,
          lexicalRank: hit.lexicalRank,
          vectorRank: hit.vectorRank,
        })),
      },
    }
  } catch (error) {
    return { content: `Lỗi khi tìm kiếm kiến thức: ${errorMessage(error)}`, isError: true }
  }
}

async function readHandler(deps: KbToolDeps, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const parsed = readArgsSchema.safeParse(args)
  if (!parsed.success) return invalidArguments('kb.read', parsed.error.issues.map((issue) => issue.message))

  try {
    const path = normalizeDocPath(parsed.data.path)
    const document = deps.repos.knowledge.findDocument(ctx.companyId, path)
    if (!document) {
      return { content: `Không tìm thấy tài liệu "${path}" trong kho kiến thức của công ty.`, isError: true }
    }
    if (!deps.repos.team.canReadCategory(ctx.companyId, ctx.agentDefId, document.category)) {
      return {
        content: `Bị từ chối: tài liệu "${path}" thuộc danh mục "${document.category}" mà agent này không được phép đọc.`,
        isError: true,
      }
    }

    const chunks = deps.repos.knowledge.listChunks(document.id)
    const body = chunks.map((chunk) => (chunk.headingPath ? `<!-- ${chunk.headingPath} -->\n${chunk.text}` : chunk.text))
    ctx.log('kb.read', { path, chunks: chunks.length })
    return {
      content: [
        `# ${document.title}`,
        `- Đường dẫn: ${document.path}`,
        `- Danh mục: ${document.category}`,
        `- Phiên bản: ${document.version}`,
        '',
        body.join('\n\n'),
      ].join('\n'),
      data: {
        path: document.path,
        title: document.title,
        category: document.category,
        version: document.version,
        chunks: chunks.length,
      },
    }
  } catch (error) {
    return { content: `Lỗi khi đọc tài liệu: ${errorMessage(error)}`, isError: true }
  }
}

async function writeHandler(deps: KbToolDeps, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const parsed = writeArgsSchema.safeParse(args)
  if (!parsed.success) return invalidArguments('kb.write', parsed.error.issues.map((issue) => issue.message))

  try {
    const path = normalizeDocPath(parsed.data.path)
    const explicit = parsed.data.category?.trim()
    if (explicit && !isKbCategory(explicit)) {
      return { content: `Danh mục "${explicit}" không hợp lệ. Chỉ chấp nhận: ${KB_CATEGORY_CODES.join(', ')}.`, isError: true }
    }

    const writable = deps.repos.team.writableCategories(ctx.companyId, ctx.agentDefId)
    if (writable.length === 0) {
      return { content: 'Agent này không được cấp quyền ghi vào bất kỳ danh mục kiến thức nào.', isError: true }
    }

    const category = explicit ?? categoryFromPath(path) ?? parseFrontmatter(parsed.data.content).data.category ?? null
    if (!category) {
      return {
        content:
          'Không xác định được danh mục cho tài liệu. Hãy đặt đường dẫn theo danh mục (ví dụ "90-ket-qua/bao-cao.md"), ' +
          'khai báo "category" trong frontmatter, hoặc truyền tham số category.',
        isError: true,
      }
    }
    if (!writable.includes(category)) {
      return {
        content: `Bị từ chối: agent này không có quyền ghi vào danh mục "${category}". Danh mục được ghi: ${writable.join(', ')}.`,
        isError: true,
      }
    }

    const existing = deps.repos.knowledge.findDocument(ctx.companyId, path)
    if (existing && !writable.includes(existing.category)) {
      return {
        content: `Bị từ chối: tài liệu "${path}" đang thuộc danh mục "${existing.category}" mà agent này không có quyền ghi.`,
        isError: true,
      }
    }

    const result = await indexDocument(deps.repos, {
      companyId: ctx.companyId,
      path,
      content: parsed.data.content,
      category,
      ...(parsed.data.tags ? { tags: parsed.data.tags } : {}),
      ...(deps.embeddingProvider ? { provider: deps.embeddingProvider } : {}),
      source: 'agent',
      force: true,
    })
    ctx.log('kb.write', { path, category, chunks: result.chunks })
    return {
      content: `Đã ghi tài liệu "${result.document.path}" (danh mục ${category}, phiên bản ${result.document.version}, ${result.chunks} đoạn).`,
      data: {
        path: result.document.path,
        title: result.document.title,
        category: result.document.category,
        version: result.document.version,
        chunks: result.chunks,
      },
    }
  } catch (error) {
    return { content: `Lỗi khi ghi tài liệu: ${errorMessage(error)}`, isError: true }
  }
}

/* --------------------------------------------------------------- helpers */

/** Định dạng một hit cho model: đủ provenance để trích dẫn, phần thân được cắt bớt. */
export function formatHit(hit: { title: string; path: string; category: string; headingPath: string | null; headingUrl: string | null; text: string }, index: number): string {
  const lines = [
    `### [${index + 1}] ${hit.title}`,
    `- Tài liệu: ${hit.path}`,
    `- Danh mục: ${hit.category}`,
    `- Mục: ${hit.headingPath ?? '(toàn tài liệu)'}`,
  ]
  if (hit.headingUrl) lines.push(`- Liên kết: ${hit.path}${hit.headingUrl}`)
  lines.push('', truncate(hit.text, EXCERPT_CHARS))
  return lines.join('\n')
}

/** Chuẩn hoá đường dẫn do model cung cấp; chặn đường dẫn tuyệt đối và `..`. */
export function normalizeDocPath(raw: string): string {
  const path = raw.trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!path || path.startsWith('/') || path.split('/').includes('..')) {
    throw new Error(`Đường dẫn tài liệu không hợp lệ: "${raw}"`)
  }
  return path.toLowerCase().endsWith('.md') ? path : `${path}.md`
}

function invalidArguments(tool: string, issues: readonly string[]): ToolResult {
  return { content: `Tham số không hợp lệ cho ${tool}: ${issues.join('; ')}`, isError: true }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
