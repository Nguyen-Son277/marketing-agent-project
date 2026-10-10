/**
 * Kho kiến thức của công ty: đọc, ghi, xoá tài liệu, index lại từ đĩa, và theo dõi
 * tiến trình index.
 *
 * Vì sao route này không tự bóc chunk hay tính vector: đó là việc của `packages/kb`
 * (frontmatter, chunker, embedding, ghi job). Ở đây chỉ làm ba việc của tầng HTTP —
 * kiểm quyền, kiểm dữ liệu vào, và trả về đúng hình dạng `KnowledgeResponse`.
 */
import {
  KB_CATEGORIES,
  notFound,
  parseOrThrow,
  reindexSchema,
  upsertKnowledgeSchema,
} from '@marketing-agent/shared'
import type { KnowledgeResponse, ReindexResponse } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import type { AppContext } from '../context.ts'
import { readAuth, requireMembership, requireWork } from '../http/middleware.ts'
import type { Router } from '../http/router.ts'
import { embeddingFor } from '../services/agent-services.ts'
import {
  documentContent,
  documentContentMap,
  documentHasEmbedding,
  embeddedDocumentIds,
  toKnowledgeDocumentView,
} from '../services/view-mappers.ts'

export function knowledgeRoutes() {
  return {
    name: 'knowledge',
    register(router: Router, ctx: AppContext): void {
      const repos = ctx.repos

      router.get(
        '/api/companies/:companyId/knowledge',
        async (request) => {
          const companyId = request.params.companyId!
          request.json(200, buildKnowledgeResponse(repos, companyId, {
            category: request.query('category'),
            query: request.query('q'),
          }))
        },
        [requireMembership(repos)],
      )

      router.post(
        '/api/companies/:companyId/knowledge',
        async (request) => {
          const companyId = request.params.companyId!
          const input = parseOrThrow(upsertKnowledgeSchema, await request.body(), 'tài liệu')
          const { indexDocument } = await loadKb()
          const provider = await embeddingFor(ctx)
          await indexDocument(repos, {
            companyId,
            path: input.path,
            title: input.title,
            category: input.category,
            tags: input.tags,
            content: input.content,
            source: 'ui',
            userId: readAuth(request)?.user.id ?? null,
            ...(provider ? { provider } : {}),
          })
          repos.accounting.audit({
            companyId,
            userId: readAuth(request)?.user.id,
            action: 'knowledge.upsert',
            target: input.path,
          })
          request.json(201, buildKnowledgeResponse(repos, companyId, {}))
        },
        [requireMembership(repos), requireWork],
      )

      router.patch(
        '/api/companies/:companyId/knowledge/:docId',
        async (request) => {
          const companyId = request.params.companyId!
          const document = repos.knowledge.findDocumentById(request.params.docId!, companyId)
          if (!document) throw notFound('Không tìm thấy tài liệu')
          const patch = parseOrThrow(
            upsertKnowledgeSchema.partial(),
            await request.body(),
            'nội dung cập nhật tài liệu',
          )
          const { indexDocument } = await loadKb()
          const provider = await embeddingFor(ctx)
          const result = await indexDocument(repos, {
            companyId,
            path: patch.path ?? document.path,
            title: patch.title ?? document.title,
            category: patch.category ?? document.category,
            tags: patch.tags ?? parseTags(document.tagsJson),
            content: patch.content ?? documentContent(repos, document.id),
            source: document.source,
            userId: readAuth(request)?.user.id ?? null,
            ...(provider ? { provider } : {}),
          })
          request.json(200, {
            document: toKnowledgeDocumentView(
              result.document,
              documentHasEmbedding(repos, result.document.id),
              documentContent(repos, result.document.id),
            ),
          })
        },
        [requireMembership(repos), requireWork],
      )

      router.delete(
        '/api/companies/:companyId/knowledge/:docId',
        async (request) => {
          const companyId = request.params.companyId!
          const document = repos.knowledge.findDocumentById(request.params.docId!, companyId)
          if (!document) throw notFound('Không tìm thấy tài liệu')
          repos.knowledge.deleteDocument(companyId, document.path)
          repos.accounting.audit({
            companyId,
            userId: readAuth(request)?.user.id,
            action: 'knowledge.delete',
            target: document.path,
          })
          request.json(200, { deleted: true })
        },
        [requireMembership(repos), requireWork],
      )

      router.post(
        '/api/companies/:companyId/knowledge/reindex',
        async (request) => {
          const companyId = request.params.companyId!
          const input = parseOrThrow(reindexSchema, await request.body(), 'yêu cầu index lại')
          const company = repos.auth.findCompanyById(companyId)
          if (!company) throw notFound('Không tìm thấy công ty')
          const { indexCompany, companyKbDir } = await loadKb()
          const provider = await embeddingFor(ctx)
          let response: ReindexResponse = { indexed: 0, skipped: 0, chunks: 0, errors: [] }
          try {
            const result = await indexCompany(repos, {
              companyId,
              rootDir: companyKbDir(company.slug, ctx.config.companiesRoot),
              force: input.force,
              ...(provider ? { provider } : {}),
            })
            response = {
              indexed: result.indexed,
              skipped: result.skipped,
              chunks: result.chunks,
              errors: result.errors.map((error) => `${error.path}: ${error.message}`),
            }
          } catch (error) {
            // Thư mục chưa tồn tại là trạng thái bình thường của công ty mới: trả
            // về danh sách lỗi rỗng thay vì 500, để giao diện giải thích được.
            response = {
              indexed: 0,
              skipped: 0,
              chunks: 0,
              errors: [error instanceof Error ? error.message : String(error)],
            }
          }
          repos.accounting.audit({
            companyId,
            userId: readAuth(request)?.user.id,
            action: 'knowledge.reindex',
            payload: { force: input.force, indexed: response.indexed },
          })
          request.json(200, response)
        },
        [requireMembership(repos), requireWork],
      )

      router.get(
        '/api/companies/:companyId/knowledge/jobs',
        async (request) => {
          request.json(200, { jobs: repos.knowledge.listIndexJobs(request.params.companyId!) })
        },
        [requireMembership(repos)],
      )

      router.get(
        '/api/companies/:companyId/knowledge/stats',
        async (request) => {
          request.json(200, { stats: repos.knowledge.stats(request.params.companyId!) })
        },
        [requireMembership(repos)],
      )
    },
  }
}

/** Dựng `KnowledgeResponse` từ danh sách tài liệu, có lọc theo category/từ khoá. */
function buildKnowledgeResponse(
  repos: Repos,
  companyId: string,
  filter: { category?: string | undefined; query?: string | undefined },
): KnowledgeResponse {
  const all = repos.knowledge.listDocuments(companyId, { limit: 500 })
  const contentByDocument = documentContentMap(repos, companyId)
  const embedded = embeddedDocumentIds(repos, companyId)
  const query = filter.query?.toLowerCase()

  const documents = all
    .filter((doc) => (filter.category ? doc.category === filter.category : true))
    .filter((doc) =>
      query ? doc.title.toLowerCase().includes(query) || doc.path.toLowerCase().includes(query) : true,
    )
    .map((doc) => toKnowledgeDocumentView(doc, embedded.has(doc.id), contentByDocument.get(doc.id) ?? ''))

  const stats = repos.knowledge.stats(companyId)
  return {
    documents,
    categories: KB_CATEGORIES.map((category) => ({
      code: category.code,
      label: category.label,
      count: all.filter((doc) => doc.category === category.code).length,
    })),
    stats: { documents: stats.documents, chunks: stats.chunks, embedded: stats.embedded },
  }
}

function parseTags(tagsJson: string): string[] {
  try {
    const value = JSON.parse(tagsJson) as unknown
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

/**
 * Nạp `@marketing-agent/kb` bằng import động: gói này kéo theo model nhúng, và
 * server phải khởi động được kể cả khi nó chưa cài xong.
 */
async function loadKb(): Promise<typeof import('@marketing-agent/kb')> {
  return import('@marketing-agent/kb')
}
