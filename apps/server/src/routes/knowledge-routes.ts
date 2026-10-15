/**
 * Kho kiến thức của công ty: đọc, ghi, xoá tài liệu, index lại từ đĩa, và theo dõi
 * tiến trình index.
 *
 * Vì sao route này không tự bóc chunk hay tính vector: đó là việc của `packages/kb`
 * (frontmatter, chunker, embedding, ghi job). Ở đây chỉ làm ba việc của tầng HTTP —
 * kiểm quyền, kiểm dữ liệu vào, và trả về đúng hình dạng `KnowledgeResponse`.
 */
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  KB_CATEGORIES,
  sha256,
  validation,
  notFound,
  parseOrThrow,
  reindexSchema,
  upsertKnowledgeSchema,
} from '@marketing-agent/shared'
import type { KbDocumentRecord, KnowledgeResponse } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import type { AppContext } from '../context.ts'
import { readAuth, requireManage, requireMembership, requireWork } from '../http/middleware.ts'
import type { Router } from '../http/router.ts'
import { readKnowledgeModelSettings, saveKnowledgeModelSettings } from '../services/knowledge-model-settings.ts'
import { classifyKnowledgeSource } from '../services/knowledge-classifier.ts'
import { embeddingFor } from '../services/agent-services.ts'
import { extractKnowledgeFile, parseKnowledgeUpload } from '../services/knowledge-upload.ts'
import { readKnowledgeOriginal, removeKnowledgeOriginal, removeLegacyKnowledgeFile, storeKnowledgeOriginal } from '../services/knowledge-storage.ts'
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

      router.get('/api/companies/:companyId/knowledge/classification/settings',async(request)=>{
        const companyId=request.params.companyId!
        request.json(200,{...readKnowledgeModelSettings(repos,companyId),lastUsed:repos.accounting.getSetting(`knowledge-classification-last:${companyId}`) ?? null})
      },[requireMembership(repos)])
      router.put('/api/companies/:companyId/knowledge/classification/settings',async(request)=>{
        const companyId=request.params.companyId!
        saveKnowledgeModelSettings(repos,companyId,await request.body())
        const result=readKnowledgeModelSettings(repos,companyId)
        repos.accounting.audit({companyId,userId:readAuth(request)?.user.id,action:'knowledge.classification.settings.save'})
        request.json(200,result)
      },[requireMembership(repos),requireManage])
      router.post('/api/companies/:companyId/knowledge/classification/settings/test',async(request)=>{
        const companyId=request.params.companyId!
        const settings=readKnowledgeModelSettings(repos,companyId)
        if(!settings.valid) {request.json(200,{ok:false,message:settings.issues.join('; ')});return}
        let usedModel:unknown
        try {
          const result=await classifyKnowledgeSource(repos,companyId,'Company brand guidelines: use a friendly, clear and consistent tone of voice.',{timeoutMs:20000,signal:AbortSignal.timeout(30000),onModelUsed:(model)=>{usedModel=model}})
          if(result.length===0) throw validation('Model không trả kết quả phân loại')
          repos.accounting.audit({companyId,userId:readAuth(request)?.user.id,action:'knowledge.classification.settings.test',payload:{ok:true}})
          request.json(200,{ok:true,message:'Model đã phân loại mẫu kiểm tra thành công.',model:usedModel})
        } catch(error) {
          repos.accounting.audit({companyId,userId:readAuth(request)?.user.id,action:'knowledge.classification.settings.test',payload:{ok:false}})
          request.json(200,{ok:false,message:error instanceof Error ? error.message : 'Không kiểm tra được model phân loại',model:usedModel})
        }
      },[requireMembership(repos),requireManage])

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
          const existing = repos.knowledge.findDocument(companyId, input.path)
          if (existing?.source === 'upload' || existing?.source === 'upload-auto') throw validation('Không thể ghi đè nội dung file tải lên bằng tài liệu soạn tay')
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

      router.post(
        '/api/companies/:companyId/knowledge/upload',
        async (request) => {
          const companyId = request.params.companyId!
          const input = await parseKnowledgeUpload(request.req)
          const category = KB_CATEGORIES.find((entry) => entry.code === input.category)?.code
          if (input.category && !category) throw validation('Danh mục kiến thức không hợp lệ')
          const checksum = sha256(input.bytes)
          const duplicate = repos.knowledge.findUploadByChecksum(companyId, checksum, category)
          if (duplicate) {
            request.json(200, { document: knowledgeDocumentView(repos, duplicate),
              job: repos.knowledge.getClassificationJob(companyId, duplicate.id), duplicate: true })
            return
          }
          const extracted = await extractKnowledgeFile(input.filename, input.bytes)
          const { chunkMarkdown } = await loadKb()
          if (chunkMarkdown(extracted.content).length === 0) throw validation('File không chứa nội dung văn bản có thể tìm kiếm')
          const title = input.title?.trim() || input.filename.replace(/\.[^.]+$/, '')
          // The legacy category column is only a compatibility placeholder for auto
          // documents. No chunks are exposed until section categories are assigned.
          const checked = parseOrThrow(upsertKnowledgeSchema, {
            path: category ? `${category}/uploads/${randomUUID()}/${input.filename}` : `uploads/${randomUUID()}/${input.filename}`,
            title, category: category ?? '00-cong-ty', tags: input.tags, content: extracted.content,
          }, 'tài liệu tải lên')
          const key = await storeKnowledgeOriginal(ctx.config.kbRoot, companyId, input.bytes)
          let saved = false
          let createdDocumentId: string | undefined
          try {
            if (!category) {
              const document = repos.db.tx(() => {
                const doc = repos.knowledge.upsertDocumentAndChunks({companyId,...checked,source:'upload-auto',userId:readAuth(request)?.user.id ?? null}, [])
                repos.knowledge.setUploadMetadata(companyId,doc.id,{originalName:input.filename,mimeType:extracted.mimeType,sizeBytes:input.bytes.length,storageKey:key,originalChecksum:checksum})
                repos.knowledge.enqueueClassification(companyId,doc.id)
                return doc
              })
              createdDocumentId = document.id
              saved = true
              repos.accounting.audit({companyId,userId:readAuth(request)?.user.id,action:'knowledge.upload.auto',target:document.path})
              request.json(202,{document:knowledgeDocumentView(repos,repos.knowledge.findDocumentById(document.id,companyId)!),job:repos.knowledge.getClassificationJob(companyId,document.id)})
              return
            }
            const { indexDocument } = await loadKb()
            const provider = await embeddingFor(ctx)
            const result = await indexDocument(repos, {
              companyId, ...checked, source: 'upload',
              userId: readAuth(request)?.user.id ?? null,
              ...(provider ? { provider } : {}),
            })
            createdDocumentId = result.document.id
            const attached = repos.knowledge.setUploadMetadata(companyId, result.document.id, {
              originalName: input.filename, mimeType: extracted.mimeType,
              sizeBytes: input.bytes.length, storageKey: key, originalChecksum: checksum,
            })
            if (!attached) throw notFound('Tài liệu đã bị xóa trong lúc tải lên')
            saved = true
            const document = repos.knowledge.findDocumentById(result.document.id, companyId)!
            repos.accounting.audit({ companyId, userId: readAuth(request)?.user.id,
              action: 'knowledge.upload', target: document.path,
              payload: { filename: input.filename, sizeBytes: input.bytes.length } })
            const warning = result.warning ?? (!provider ? 'Đã lưu và index từ khóa. Chưa có nhà cung cấp vector; tài liệu vẫn truy xuất được theo từ khóa.' : undefined)
            request.json(201, {
              document: toKnowledgeDocumentView(document, documentHasEmbedding(repos, document.id), extracted.content),
              ...(warning ? { warning } : {}),
            })
          } finally {
            if (!saved) {
              await removeKnowledgeOriginal(ctx.config.kbRoot, companyId, key)
              if (createdDocumentId) repos.knowledge.deleteDocument(companyId, checked.path)
            }
          }
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
          if ((document.source === 'upload' || document.source === 'upload-auto') && (patch.content !== undefined || (patch.path !== undefined && patch.path !== document.path))) {
            throw validation('Nội dung file tải lên là chỉ đọc; hãy tải file mới để thay đổi nội dung')
          }
          if (document.source === 'upload-auto' && patch.category !== undefined) throw validation('Hãy sửa danh mục của từng phần kiến thức, không đổi toàn bộ file')
          if (patch.path && patch.path !== document.path) {
            const target = repos.knowledge.findDocument(companyId, patch.path)
            if (target) throw validation('Đường dẫn đích đã có tài liệu; không thể ghi đè khi đổi đường dẫn')
          }
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
          if (document.storageKey) {
            await removeKnowledgeOriginal(ctx.config.kbRoot, companyId, document.storageKey)
          } else if (document.source === 'file' || document.source === 'seed') {
            const company = repos.auth.findCompanyById(companyId)
            if (!company) throw notFound('Không tìm thấy công ty')
            const { companyKbDir } = await loadKb()
            await removeLegacyKnowledgeFile(companyKbDir(company.slug, ctx.config.kbRoot), document.path)
          }
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
          const { indexDocument, companyKbDir, scanMarkdownFiles } = await loadKb()
          const { readFile, stat } = await import('node:fs/promises')
          const { join } = await import('node:path')
          const provider = await embeddingFor(ctx)
          const response = { indexed: 0, skipped: 0, chunks: 0, queued:0, processing:0, classificationFailed:0, errors: [] as string[] }
          const rootDir = companyKbDir(company.slug, ctx.config.kbRoot)
          const files = existsSync(rootDir) ? scanMarkdownFiles(rootDir) : []
          const paths = new Set(files)
          const stored = repos.knowledge.listDocuments(companyId, { limit: 100_000 })
          const storedByPath = new Map(stored.map((doc) => [doc.path, doc]))
          const diskPaths = new Set(files)
          for (const doc of stored) paths.add(doc.path)
          for (const path of paths) {
            if (input.paths && !input.paths.includes(path)) continue
            const doc = storedByPath.get(path)
            if(doc?.source==='upload-auto' && repos.knowledge.listSections(companyId,doc.id).length===0) {
              const job=repos.knowledge.getClassificationJob(companyId,doc.id)
              if(job?.status==='pending'||job?.status==='running') response.processing++
              else {
                if(!job) repos.knowledge.enqueueClassification(companyId,doc.id)
                else repos.knowledge.retryClassification(companyId,doc.id)
                response.queued++
              }
              continue
            }
            try {
              const fromFile = diskPaths.has(path) && (!doc || doc.source === 'file' || doc.source === 'seed')
              const content = fromFile ? await readFile(join(rootDir, path), 'utf8') : doc ? documentContent(repos, doc.id) : ''
              const result = await indexDocument(repos, {
                companyId, path, content, force: input.force,
                ...(fromFile ? { source: 'file', mtime: (await stat(join(rootDir, path))).mtime.toISOString() } : doc ? {
                  title: doc.title, category: doc.category, tags: parseTags(doc.tagsJson), source: doc.source,
                } : {}),
                ...(provider ? { provider } : {}),
              })
              if (result.status === 'indexed') { response.indexed++; response.chunks += result.chunks }
              else response.skipped++
              if (result.warning) response.errors.push(`${path}: ${result.warning}`)
            } catch (error) {
              response.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
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

      router.post('/api/companies/:companyId/knowledge/classification/retry',async(request)=>{
        const companyId=request.params.companyId!
        let queued=0,processing=0
        for(const doc of repos.knowledge.listDocuments(companyId,{limit:100000})) {
          if(doc.source!=='upload-auto') continue
          const job=repos.knowledge.getClassificationJob(companyId,doc.id)
          if(job?.status==='pending'||job?.status==='running'){processing++;continue}
          if(job?.status==='failed') {if(repos.knowledge.retryClassification(companyId,doc.id)) queued++}
          else if(!job){repos.knowledge.enqueueClassification(companyId,doc.id);queued++}
        }
        repos.accounting.audit({companyId,userId:readAuth(request)?.user.id,action:'knowledge.classification.retry-all',payload:{queued,processing}})
        request.json(202,{queued,processing,failed:0})
      },[requireMembership(repos),requireWork])

      router.get('/api/companies/:companyId/knowledge/:docId/classification', async (request) => {
        const companyId=request.params.companyId!, docId=request.params.docId!
        if(!repos.knowledge.findDocumentById(docId,companyId)) throw notFound('Không tìm thấy tài liệu')
        request.json(200,{job:repos.knowledge.getClassificationJob(companyId,docId) ?? null})
      },[requireMembership(repos)])
      router.post('/api/companies/:companyId/knowledge/:docId/classification/retry', async (request) => {
        const companyId=request.params.companyId!, docId=request.params.docId!
        const doc=repos.knowledge.findDocumentById(docId,companyId)
        if(!doc) throw notFound('Không tìm thấy tài liệu')
        if(doc.source !== 'upload-auto') throw validation('Tài liệu này dùng phân loại thủ công')
        if(!repos.knowledge.getClassificationJob(companyId,docId)) repos.knowledge.enqueueClassification(companyId,docId)
        else repos.knowledge.retryClassification(companyId,docId)
        request.json(202,{job:repos.knowledge.getClassificationJob(companyId,docId)})
      },[requireMembership(repos),requireWork])
      router.patch('/api/companies/:companyId/knowledge/:docId/sections/:sectionId', async (request) => {
        const companyId=request.params.companyId!,docId=request.params.docId!
        const doc=repos.knowledge.findDocumentById(docId,companyId)
        if(!doc) throw notFound('Không tìm thấy tài liệu')
        const patch=parseOrThrow(upsertKnowledgeSchema.pick({category:true,tags:true}),await request.body(),'phân loại phần kiến thức')
        const job=repos.knowledge.getClassificationJob(companyId,docId)
        if(job?.status==='running' || job?.status==='pending') throw validation('Hãy đợi phân loại hoàn tất trước khi chỉnh sửa')
        if(!repos.knowledge.updateSection(companyId,docId,request.params.sectionId!,patch)) throw notFound('Không tìm thấy phần kiến thức')
        repos.accounting.audit({companyId,userId:readAuth(request)?.user.id,action:'knowledge.section.update',target:request.params.sectionId!})
        request.json(200,{document:knowledgeDocumentView(repos,doc,true),sections:sectionViews(repos,companyId,docId)})
      },[requireMembership(repos),requireWork])

      // Specific /jobs and /stats routes must be registered before /:docId.
      router.get('/api/companies/:companyId/knowledge/:docId/download', async (request) => {
        const companyId = request.params.companyId!
        const doc = repos.knowledge.findDocumentById(request.params.docId!, companyId)
        if (!doc?.storageKey) throw notFound('Không tìm thấy file gốc của tài liệu')
        const bytes = await readKnowledgeOriginal(ctx.config.kbRoot, companyId, doc.storageKey)
        request.res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': bytes.length,
          'Content-Disposition': `attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(doc.originalName ?? 'document')}`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        request.res.end(bytes)
      }, [requireMembership(repos)])
      router.get('/api/companies/:companyId/knowledge/:docId', async (request) => {
        const companyId = request.params.companyId!
        const doc = repos.knowledge.findDocumentById(request.params.docId!, companyId)
        if (!doc) throw notFound('Không tìm thấy tài liệu')
        request.json(200, { document: knowledgeDocumentView(repos,doc,true),sections:sectionViews(repos,companyId,doc.id) })
      }, [requireMembership(repos)])
    },
  }
}

/** Dựng `KnowledgeResponse` từ danh sách tài liệu, có lọc theo category/từ khoá. */
function buildKnowledgeResponse(
  repos: Repos,
  companyId: string,
  filter: { category?: string | undefined; query?: string | undefined },
): KnowledgeResponse {
  const all = repos.knowledge.listDocuments(companyId, { limit: 100_000 })
  const contentByDocument = documentContentMap(repos, companyId)
  const embedded = embeddedDocumentIds(repos, companyId)
  const query = filter.query?.toLowerCase()

  const views = all.map((doc) => ({...knowledgeDocumentView(repos,doc),content:doc.source.startsWith('upload') ? '' : contentByDocument.get(doc.id) ?? ''}))
  const documents = views
    .filter((doc) => (filter.category ? doc.categories?.includes(filter.category) : true))
    .filter((doc) =>
      query ? doc.title.toLowerCase().includes(query) || doc.path.toLowerCase().includes(query) : true,
    )


  const stats = repos.knowledge.stats(companyId)
  return {
    documents,
    categories: KB_CATEGORIES.map((category) => ({
      code: category.code,
      label: category.label,
      count: views.filter((doc) => doc.categories?.includes(category.code)).length,
    })),
    stats: { documents: stats.documents, chunks: stats.chunks, embedded: embedded.size },
  }
}

function sectionViews(repos:Repos,companyId:string,docId:string) {
  return repos.knowledge.listSections(companyId,docId).map((section)=>({...section,tags:parseTags(section.tagsJson)}))
}

function knowledgeDocumentView(repos: Repos, doc: KbDocumentRecord, includeContent = false) {
  const job = repos.knowledge.getClassificationJob(doc.companyId,doc.id)
  const sections = repos.knowledge.listSections(doc.companyId,doc.id)
  const categories = [...new Set(sections.map((section) => section.category))]
  const chunkCount=repos.knowledge.listChunks(doc.id).length
  return {...toKnowledgeDocumentView(doc,documentHasEmbedding(repos,doc.id),includeContent ? documentContent(repos,doc.id) : ''),chunkCount,
    ...(doc.source === 'upload-auto' ? {classificationStatus: job?.status ?? 'pending',classificationError:job?.error ?? null,classificationNextAttemptAt:job?.nextAttemptAt ?? null,categories,sectionCount:sections.length} : {categories:[doc.category]})}
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
