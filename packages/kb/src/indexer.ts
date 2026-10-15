/**
 * Nạp tài liệu Markdown của một công ty vào kho kiến thức: quét thư mục, phát
 * hiện thay đổi bằng checksum, thay chunk, rồi nhúng vector và lưu lại.
 *
 * Vì sao tách "quét hàng loạt" (indexCompany) khỏi "lưu một tài liệu"
 * (indexDocument): cùng một đường ghi nhưng khác nguồn — CLI quét đĩa theo lô và
 * bỏ qua file không đổi, còn luồng lưu qua UI/agent phải index ngay lập tức. Cả
 * hai dùng chung `indexOne` để quy tắc checksum, chunking và ghi job không lệch
 * nhau. Lỗi ở một file chỉ được ghi vào `errors` và job tương ứng, không làm
 * hỏng cả lượt index.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ChunkInput, Repos } from '@marketing-agent/db'
import { isKbCategory, notFound, sha256, type KbDocumentRecord } from '@marketing-agent/shared'
import { chunkMarkdown } from './chunker.ts'
import { resolveDocumentMetadata } from './frontmatter.ts'
import type { EmbeddingProvider } from './embeddings.ts'

export const DEFAULT_EMBED_BATCH = 32

export interface IndexFileError {
  readonly path: string
  readonly message: string
}

export interface IndexCompanyResult {
  readonly indexed: number
  readonly skipped: number
  readonly chunks: number
  readonly errors: IndexFileError[]
}

export interface IndexCompanyOptions {
  readonly companyId: string
  readonly rootDir: string
  /** Bỏ trống thì vẫn index chunk nhưng không có tìm kiếm vector. */
  readonly provider?: EmbeddingProvider
  readonly force?: boolean
  readonly batchSize?: number
}

export interface ReindexStoredDocumentsOptions {
  readonly companyId: string
  /** Optional base path to resolve imported original files; document paths are preserved. */
  readonly rootDir?: string
  readonly provider?: EmbeddingProvider | ((document: KbDocumentRecord) => EmbeddingProvider | undefined)
  readonly force?: boolean
  readonly batchSize?: number
}

export interface IndexDocumentOptions {
  readonly companyId: string
  readonly path: string
  readonly content: string
  readonly provider?: EmbeddingProvider
  readonly force?: boolean
  readonly category?: string
  readonly title?: string
  readonly tags?: readonly string[]
  readonly source?: string
  readonly userId?: string | null
  readonly mtime?: string | null
  readonly batchSize?: number
}

export interface IndexDocumentResult {
  readonly status: 'indexed' | 'skipped'
  readonly chunks: number
  readonly document: KbDocumentRecord
  readonly warning?: string
}

/** Thư mục KB chuẩn của một công ty, dùng chung giữa CLI và server. */
export function companyKbDir(slug: string, baseDir = join('data', 'companies')): string {
  return join(baseDir, slug, 'kb')
}

/** Quét đệ quy các file .md, bỏ file/thư mục ẩn; trả đường dẫn tương đối kiểu POSIX. */
export function scanMarkdownFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) throw notFound(`Không tìm thấy thư mục kiến thức: ${rootDir}`)
  const files: string[] = []
  walk(rootDir, rootDir, files)
  return files.sort()
}

/** Index toàn bộ thư mục KB; file lỗi được ghi lại và bỏ qua, không dừng lượt. */
export async function indexCompany(repos: Repos, options: IndexCompanyOptions): Promise<IndexCompanyResult> {
  const files = scanMarkdownFiles(options.rootDir)
  const batchSize = options.batchSize ?? DEFAULT_EMBED_BATCH
  const force = options.force ?? false
  const result = { indexed: 0, skipped: 0, chunks: 0, errors: [] as IndexFileError[] }

  for (const path of files) {
    try {
      const absolute = join(options.rootDir, ...path.split('/'))
      const content = readFileSync(absolute, 'utf8')
      const mtime = statSync(absolute).mtime.toISOString()
      const indexed = await indexOne(repos, {
        companyId: options.companyId,
        path,
        content,
        provider: options.provider,
        force,
        source: 'file',
        mtime,
        batchSize,
      })
      if (indexed.status === 'indexed') {
        result.indexed++
        result.chunks += indexed.chunks
      } else {
        result.skipped++
      }
      if (indexed.warning) result.errors.push({ path, message: indexed.warning })
    } catch (error) {
      result.errors.push({ path, message: errorMessage(error) })
    }
  }
  return result
}

/** Index một tài liệu từ luồng lưu (UI hoặc agent). Mặc định luôn ghi lại. */
export async function indexDocument(repos: Repos, options: IndexDocumentOptions): Promise<IndexDocumentResult> {
  return indexOne(repos, {
    companyId: options.companyId,
    path: options.path,
    content: options.content,
    provider: options.provider,
    force: options.force ?? true,
    category: options.category,
    title: options.title,
    tags: options.tags,
    source: options.source ?? 'ui',
    userId: options.userId ?? null,
    mtime: options.mtime ?? null,
    batchSize: options.batchSize ?? DEFAULT_EMBED_BATCH,
  })
}

/** Reindex persisted canonical sources without depending on a mounted legacy KB directory. */
export async function reindexStoredDocuments(
  repos: Repos,
  options: ReindexStoredDocumentsOptions,
): Promise<IndexCompanyResult> {
  const result = { indexed: 0, skipped: 0, chunks: 0, errors: [] as IndexFileError[] }
  const documents = repos.knowledge.listDocuments(options.companyId, { limit: 100_000 })
  for (const document of documents) {
    const path = document.path
    try {
      let content = repos.knowledge.documentContent(options.companyId, document.id)
      if (content === null && options.rootDir) {
        try {
          content = readFileSync(join(options.rootDir, ...path.split('/')), 'utf8')
        } catch {
          // Legacy mount may be absent; report the missing canonical source below.
        }
      }
      if (content === null) {
        result.errors.push({ path, message: 'Canonical source content is unavailable for this legacy document.' })
        continue
      }
      const provider = typeof options.provider === 'function' ? options.provider(document) : options.provider
      const indexed = await indexOne(repos, {
        companyId: options.companyId,
        path,
        content,
        provider,
        force: options.force ?? false,
        category: document.category,
        title: document.title,
        tags: (() => { try { return JSON.parse(document.tagsJson) as string[] } catch { return [] } })(),
        source: document.source,
        userId: document.createdBy,
        mtime: document.mtime,
        batchSize: options.batchSize ?? DEFAULT_EMBED_BATCH,
      })
      if (indexed.status === 'indexed') {
        result.indexed++
        result.chunks += indexed.chunks
      } else {
        result.skipped++
      }
      if (indexed.warning) result.errors.push({ path, message: indexed.warning })
    } catch (error) {
      result.errors.push({ path, message: errorMessage(error) })
    }
  }
  return result
}

/* ------------------------------------------------------------- internals */

interface IndexOneInput {
  readonly companyId: string
  readonly path: string
  readonly content: string
  readonly provider?: EmbeddingProvider
  readonly force: boolean
  readonly category?: string
  readonly title?: string
  readonly tags?: readonly string[]
  readonly source: string
  readonly userId?: string | null
  readonly mtime?: string | null
  readonly batchSize: number
}

async function indexOne(repos: Repos, input: IndexOneInput): Promise<IndexDocumentResult> {
  const path = normalizePath(input.path)
  const existing = repos.knowledge.findDocument(input.companyId, path)
  // Mở job trước khi bóc metadata để lỗi frontmatter/đường dẫn cũng được ghi
  // nhận là 'failed' thay vì biến mất khỏi nhật ký index.
  const jobId = repos.knowledge.startIndexJob(input.companyId, existing?.id ?? null)

  try {
    // Classified uploads are immutable canonical sources. Reindex only their existing
    // chunk embeddings; never parse, re-chunk, or overwrite their section assignments.
    if (existing?.source === 'upload-auto') {
      const sections = repos.knowledge.listSections(input.companyId, existing.id)
      if (sections.length === 0) {
        const classification=repos.knowledge.getClassificationJob(input.companyId,existing.id)
        const message=classification?.status==='failed'
          ? `Phân loại tài liệu chưa hoàn tất: ${classification.error ?? 'Hãy thử xử lý lại tài liệu'}`
          : undefined
        repos.knowledge.finishIndexJob(jobId, 'skipped', { chunks: 0, ...(message ? {error:message} : {}) })
        return { status: 'skipped', chunks: 0, document: existing, ...(message ? {warning:message} : {}) }
      }
      const storedChunks = repos.knowledge.listChunks(existing.id)
      const embeddingsReady = !input.provider || repos.knowledge.countDocumentEmbeddings(existing.id, input.provider.name) >= storedChunks.length
      if (!input.force && embeddingsReady) {
        repos.knowledge.finishIndexJob(jobId, 'skipped', { chunks: storedChunks.length })
        return { status: 'skipped', chunks: storedChunks.length, document: existing }
      }
      let warning: string | undefined
      try {
        await embedChunks(repos, {
          companyId: input.companyId,
          documentId: existing.id,
          provider: input.provider,
          batchSize: input.batchSize,
        })
      } catch (error) {
        warning = `Vector embedding unavailable; existing classified chunks retained: ${errorMessage(error)}`
      }
      repos.knowledge.finishIndexJob(jobId, 'indexed', { chunks: storedChunks.length, ...(warning ? { error: warning } : {}) })
      return { status: 'indexed', chunks: storedChunks.length, document: existing, ...(warning ? { warning } : {}) }
    }

    const meta = input.source === 'upload-auto' && !existing
      ? {
          content: input.content,
          title: input.title?.trim() || path.split('/').at(-1)?.replace(/\.md$/i, '') || path,
          category: input.category && isKbCategory(input.category) ? input.category : resolveDocumentMetadata(path, input.content).category,
          tags: input.tags ? [...input.tags] : [],
        }
      : resolveDocumentMetadata(path, input.content, {
          ...(input.category && isKbCategory(input.category) ? { defaultCategory: input.category } : {}),
        })
    const title = input.title?.trim() || meta.title
    const category = input.category && isKbCategory(input.category) ? input.category : meta.category
    const tags = input.tags ? [...input.tags] : [...meta.tags]

    const checksum = sha256(input.content)
    if (input.source === 'upload-auto' && !existing) {
      const document = repos.knowledge.upsertDocumentAndChunks(
        {
          companyId: input.companyId,
          path,
          title,
          category,
          tags,
          content: input.content,
          source: input.source,
          userId: input.userId ?? null,
          mtime: input.mtime ?? null,
        },
        [],
      )
      repos.knowledge.finishIndexJob(jobId, 'indexed', { chunks: 0 })
      return { status: 'indexed', chunks: 0, document }
    }
    if (existing && existing.checksum === checksum && !input.force) {
      const chunks = repos.knowledge.listChunks(existing.id).length
      const embeddingsReady = !input.provider || repos.knowledge.countDocumentEmbeddings(existing.id, input.provider.name) >= chunks
      if (embeddingsReady && existing.content != null) {
        repos.knowledge.finishIndexJob(jobId, 'skipped', { chunks })
        return { status: 'skipped', chunks, document: existing }
      }
    }

    const inputs: ChunkInput[] = chunkMarkdown(meta.content)
    const document = repos.knowledge.upsertDocumentAndChunks(
      {
        companyId: input.companyId,
        path,
        title,
        category,
        tags,
        content: input.content,
        source: input.source,
        userId: input.userId ?? null,
        mtime: input.mtime ?? null,
      },
      inputs,
    )
    let warning: string | undefined
    try {
      await embedChunks(repos, {
        companyId: input.companyId,
        documentId: document.id,
        provider: input.provider,
        batchSize: input.batchSize,
      })
    } catch (error) {
      warning = `Vector embedding unavailable; lexical index retained: ${errorMessage(error)}`
    }
    repos.knowledge.finishIndexJob(jobId, 'indexed', { chunks: inputs.length, ...(warning ? { error: warning } : {}) })
    return { status: 'indexed', chunks: inputs.length, document, ...(warning ? { warning } : {}) }
  } catch (error) {
    repos.knowledge.finishIndexJob(jobId, 'failed', { error: errorMessage(error) })
    throw error
  }
}

async function embedChunks(
  repos: Repos,
  input: { companyId: string; documentId: string; provider?: EmbeddingProvider; batchSize: number },
): Promise<number> {
  const provider = input.provider
  if (!provider) return 0
  const stored = repos.knowledge.listChunks(input.documentId)
  if (stored.length === 0) return 0

  let embedded = 0
  for (let offset = 0; offset < stored.length; offset += input.batchSize) {
    const slice = stored.slice(offset, offset + input.batchSize)
    const vectors = await provider.embed(slice.map((chunk) => chunk.text))
    if (vectors.length !== slice.length) {
      throw new Error(`Nhà cung cấp nhúng trả về ${vectors.length} vector cho ${slice.length} đoạn`)
    }
    for (let i = 0; i < slice.length; i++) {
      const chunk = slice[i]
      const vector = vectors[i]
      if (!chunk || !vector) continue
      if (provider.dim > 0 && vector.length !== provider.dim) {
        throw new Error(`Vector có ${vector.length} chiều, lệch với provider ${provider.name} (${provider.dim} chiều)`)
      }
      repos.knowledge.saveEmbedding(chunk.id, input.companyId, vector, provider.name)
      embedded++
    }
  }
  return embedded
}

function walk(dir: string, root: string, out: string[]): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(absolute, root, out)
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(relative(root, absolute).split(/[\\/]/).join('/'))
    }
  }
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
