/**
 * Core tools every agent may use: reading and writing files inside its task
 * workspace, and publishing an artifact.
 *
 * Path handling is the security boundary here. Every path is resolved against a
 * per-company root and rejected if it escapes — otherwise a model-authored path
 * like `../../.env` would read the deployment's secrets.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, normalize, resolve, sep } from 'node:path'
import { sha256, toolError, truncate, type ArtifactKind, type ToolResult } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { defineTool, optionalNumberArg, optionalStringArg, requireStringArg } from './registry.ts'

export interface CoreToolOptions {
  /** Absolute root under which every company's file workspace lives. */
  readonly companiesRoot: string
  readonly maxReadBytes?: number
  readonly maxWriteBytes?: number
  readonly maxListEntries?: number
}

const DEFAULT_MAX_READ_BYTES = 400_000
const DEFAULT_MAX_WRITE_BYTES = 2_000_000
const DEFAULT_MAX_LIST_ENTRIES = 200

export function createCoreTools(repos: Repos, options: CoreToolOptions) {
  const maxReadBytes = options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES
  const maxWriteBytes = options.maxWriteBytes ?? DEFAULT_MAX_WRITE_BYTES
  const maxListEntries = options.maxListEntries ?? DEFAULT_MAX_LIST_ENTRIES

  /**
   * Resolve a company-relative path.
   *
   * `..` is rejected outright rather than normalized away. Normalizing first
   * would turn `../../etc/passwd` into `etc/passwd` inside the workspace — a
   * harmless-looking path that silently ignores the escape attempt. Failing
   * loudly is the only response that tells us a model or user tried to leave.
   */
  function resolveSafe(companyId: string, inputPath: string): string {
    const trimmed = inputPath.trim()
    if (trimmed.length === 0) throw toolError('Đường dẫn rỗng')
    if (trimmed.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
      throw toolError('Chỉ dùng đường dẫn tương đối, không dùng đường dẫn tuyệt đối')
    }
    const segments = trimmed.split(/[/\\]+/).filter((segment) => segment.length > 0)
    if (segments.includes('..')) {
      throw toolError(`Đường dẫn "${inputPath}" chứa ".." và bị từ chối vì có thể thoát khỏi vùng làm việc`)
    }
    const companyRoot = resolve(options.companiesRoot, companyId)
    const normalized = normalize(segments.join('/'))
    const target = resolve(companyRoot, normalized)
    // Defence in depth: the join above cannot escape now, but verify anyway so a
    // future change to the segment rules cannot silently open a hole.
    if (target !== companyRoot && !target.startsWith(companyRoot + sep)) {
      throw toolError(`Đường dẫn "${inputPath}" nằm ngoài vùng làm việc của công ty`)
    }
    return target
  }

  function toRelative(companyId: string, absolute: string): string {
    const companyRoot = resolve(options.companiesRoot, companyId)
    return absolute.slice(companyRoot.length + 1).split(sep).join('/')
  }

  const filesRead = defineTool({
    name: 'files_read',
    description:
      'Đọc một file trong vùng làm việc của công ty (báo cáo cũ, dữ liệu, ghi chú). Dùng đường dẫn tương đối, ví dụ "reports/2026-10/seo-audit.md".',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Đường dẫn tương đối trong vùng làm việc' },
        maxChars: { type: 'number', description: 'Giới hạn ký tự trả về, mặc định 12000' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    roles: [],
    async handler(args, ctx): Promise<ToolResult> {
      const target = resolveSafe(ctx.companyId, requireStringArg(args, 'path'))
      let stat
      try {
        stat = statSync(target)
      } catch {
        throw toolError(`Không tìm thấy file "${requireStringArg(args, 'path')}" trong vùng làm việc`)
      }
      if (stat.isDirectory()) {
        throw toolError('Đường dẫn trỏ tới thư mục. Dùng files_list để liệt kê nội dung.')
      }
      if (stat.size > maxReadBytes) {
        throw toolError(`File quá lớn (${stat.size} byte > giới hạn ${maxReadBytes} byte)`)
      }
      const content = readFileSync(target, 'utf8')
      const maxChars = optionalNumberArg(args, 'maxChars', 12_000)
      return {
        content: `Nội dung ${toRelative(ctx.companyId, target)} (${stat.size} byte):\n\n${truncate(content, maxChars)}`,
        data: { path: toRelative(ctx.companyId, target), bytes: stat.size, truncated: content.length > maxChars },
      }
    },
  })

  const filesWrite = defineTool({
    name: 'files_write',
    description:
      'Ghi file vào vùng làm việc của công ty để lưu kết quả và dùng lại về sau. Dùng đường dẫn tương đối có ý nghĩa, ví dụ "reports/2026-10/content-plan.md".',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Đường dẫn tương đối, nên có thư mục và đuôi .md/.json/.csv' },
        content: { type: 'string', description: 'Nội dung file' },
        mode: { type: 'string', enum: ['overwrite', 'append'], description: 'Mặc định overwrite' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    roles: [],
    async handler(args, ctx): Promise<ToolResult> {
      const rawPath = requireStringArg(args, 'path')
      const content = String(args['content'] ?? '')
      if (Buffer.byteLength(content, 'utf8') > maxWriteBytes) {
        throw toolError(`Nội dung vượt giới hạn ${maxWriteBytes} byte`)
      }
      const target = resolveSafe(ctx.companyId, rawPath)
      const append = optionalStringArg(args, 'mode') === 'append'
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, content, append ? { flag: 'a', encoding: 'utf8' } : { encoding: 'utf8' })
      const relative = toRelative(ctx.companyId, target)
      return {
        content: `Đã ${append ? 'ghi thêm' : 'ghi'} ${Buffer.byteLength(content, 'utf8')} byte vào ${relative}.`,
        data: { path: relative, bytes: Buffer.byteLength(content, 'utf8'), checksum: sha256(content) },
      }
    },
  })

  const filesList = defineTool({
    name: 'files_list',
    description: 'Liệt kê file trong vùng làm việc của công ty để biết đã có những tài liệu gì.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Thư mục tương đối; bỏ trống để liệt kê gốc' },
      },
      required: [],
      additionalProperties: false,
    },
    roles: [],
    async handler(args, ctx): Promise<ToolResult> {
      const relative = optionalStringArg(args, 'path') ?? '.'
      const target = resolveSafe(ctx.companyId, relative)
      let entries: string[]
      try {
        entries = readdirSync(target, { withFileTypes: true })
          .filter((entry) => !entry.name.startsWith('.'))
          .slice(0, maxListEntries)
          .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
          .sort()
      } catch {
        throw toolError(`Không tìm thấy thư mục "${relative}" trong vùng làm việc`)
      }
      if (entries.length === 0) {
        return { content: `Thư mục "${relative}" đang trống.`, data: { path: relative, entries: [] } }
      }
      return {
        content: `Nội dung "${relative}":\n${entries.map((e) => `- ${e}`).join('\n')}`,
        data: { path: relative, entries },
      }
    },
  })

  const artifactPublish = defineTool({
    name: 'artifact_publish',
    description:
      'Công bố một tài sản đầu ra (báo cáo, kế hoạch, lịch nội dung, bảng số liệu) để Leader và người dùng xem. Đây là cách bàn giao kết quả chính thức.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tên tài sản, ví dụ "Kế hoạch nội dung tháng 11"' },
        kind: {
          type: 'string',
          enum: ['markdown', 'json', 'csv', 'html', 'link'],
          description: 'Định dạng; mặc định markdown',
        },
        content: { type: 'string', description: 'Nội dung đầy đủ (với kind = link thì để trống)' },
        path: { type: 'string', description: 'Đường dẫn file tương ứng trong vùng làm việc (tuỳ chọn)' },
        summary: { type: 'string', description: 'Tóm tắt 2–3 câu cho Leader' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    roles: [],
    async handler(args, ctx): Promise<ToolResult> {
      const name = requireStringArg(args, 'name')
      const kindRaw = optionalStringArg(args, 'kind') ?? 'markdown'
      const kind = kindRaw as ArtifactKind
      const content = typeof args['content'] === 'string' ? args['content'] : null
      const path = optionalStringArg(args, 'path')
      const summary = optionalStringArg(args, 'summary')
      if (kind !== 'link' && (!content || content.trim().length === 0)) {
        throw toolError('Cần "content" cho tài sản không phải loại link')
      }
      if (kind === 'link' && !path) {
        throw toolError('Tài sản loại link cần "path" chứa URL')
      }

      const artifact = repos.work.addArtifact({
        companyId: ctx.companyId,
        taskId: ctx.taskId,
        name,
        kind,
        content,
        path,
        meta: { summary, agentRole: ctx.agentRole, checksum: content ? sha256(content) : undefined },
      })
      return {
        content:
          `Đã công bố tài sản "${name}" (${kind}, id ${artifact.id}).` +
          (summary ? `\nTóm tắt: ${summary}` : ''),
        data: { artifactId: artifact.id, name, kind, bytes: content ? Buffer.byteLength(content, 'utf8') : 0 },
      }
    },
  })

  return { filesRead, filesWrite, filesList, artifactPublish }
}
