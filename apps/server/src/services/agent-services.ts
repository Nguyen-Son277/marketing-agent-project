import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
/**
 * Vòng đời của các dịch vụ nặng: tool registry, embedding provider, orchestrator.
 *
 * Vì sao không dựng ngay trong từng handler: mỗi lần dựng lại là một lần nạp
 * model nhúng, một lần quét catalog tool, và tệ nhất là một kết nối SQLite mới.
 * Ở đây mọi thứ được nhớ theo chính đối tượng `Repos`: một tiến trình chạy production
 * chỉ có một `Repos` nên cũng chỉ có một registry và một embedding provider.
 *
 * Orchestrator được nhớ theo `(Repos, companyId)` vì giới hạn vận hành (trần chi
 * phí, số bước) là cấu hình riêng của từng công ty, mà hàm dựng orchestrator chỉ
 * nhận một bộ giới hạn. Nó vẫn KHÔNG được dựng lại theo từng request, và dùng
 * chung registry/embedding/kết nối với mọi orchestrator khác.
 *
 * Gói `@marketing-agent/tools|kb|orchestrator` được nạp bằng import động có bọc
 * try/catch: module route phải nạp được ngay cả khi một gói chưa sẵn sàng, để
 * `main.ts` không phải bỏ toàn bộ các route còn lại.
 */
import { AppError, type LlmImage } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import type { AppContext } from '../context.ts'
import type { CoordinationHost, IntegrationStore, PlannedTaskInput, ToolDescriptor, ToolRegistry } from '@marketing-agent/tools'
import type { EmbeddingProvider } from '@marketing-agent/kb'
import type { ConversationOrchestrator } from '@marketing-agent/orchestrator'
import type { AgentRuntimeDeps } from '@marketing-agent/agent-runtime'
import { readStoredLimits } from './company-settings.ts'
import { readKnowledgeOriginal } from './knowledge-storage.ts'

interface SharedServices {
  readonly registry: ToolRegistry
  readonly integrationStore: IntegrationStore | undefined
  readonly embedding: EmbeddingProvider | undefined
}

const sharedCache = new WeakMap<Repos, Promise<SharedServices>>()
const embeddingCache = new WeakMap<Repos, Promise<EmbeddingProvider | undefined>>()
const orchestratorCache = new WeakMap<Repos, Map<string, Promise<ConversationOrchestrator>>>()
const runtimeOverrides = new WeakMap<Repos, Partial<AgentRuntimeDeps>>()

function needsConfiguration(message: string, cause?: unknown): AppError {
  return new AppError('needs_configuration', message, { cause })
}

/**
 * Cổng test: gắn adapter LLM giả cho một `Repos` cụ thể trước khi gọi route.
 * Production không bao giờ gọi hàm này, nên không có nhánh nào phụ thuộc nó.
 */
export function setAgentRuntimeOverrides(repos: Repos, overrides: Partial<AgentRuntimeDeps>): void {
  runtimeOverrides.set(repos, overrides)
  orchestratorCache.delete(repos)
}

/** Xoá cache orchestrator (ví dụ sau khi công ty đổi giới hạn vận hành). */
export function invalidateOrchestrators(repos: Repos): void {
  orchestratorCache.delete(repos)
}

async function buildEmbedding(ctx: AppContext): Promise<EmbeddingProvider | undefined> {
  try {
    const { createEmbeddingProvider } = await import('@marketing-agent/kb')
    return await createEmbeddingProvider({
      provider: ctx.config.embedding.provider,
      model: ctx.config.embedding.model,
      ...(ctx.config.embedding.baseUrl ? { baseUrl: ctx.config.embedding.baseUrl } : {}),
      ...(ctx.config.embedding.apiKey ? { apiKey: ctx.config.embedding.apiKey } : {}),
    })
  } catch (error) {
    // Thiếu model nhúng không được làm máy chủ chết: truy xuất chuyển sang từ khoá.
    console.warn('[services] không tạo được embedding provider, tạm dùng tìm kiếm từ khoá:', error)
    return undefined
  }
}

/**
 * Load product-image metadata for an agent and, only when its selected model
 * supports vision, attach the private image bytes. The model never receives a
 * filesystem path; the URL in the textual context is the tenant-checked
 * endpoint that the final report renderer can use.
 */
async function productImageContextFor(
  ctx: AppContext,
  companyId: string,
  query: string,
  includeImages: boolean,
  limit: number,
): Promise<{ context: string; images: readonly LlmImage[] }> {
  const docs = ctx.repos.knowledge.listProductImages(companyId, query, Math.min(Math.max(limit, 0), 3))
  if (docs.length === 0) return { context: '', images: [] }

  const lines = ['## Ảnh sản phẩm trong Kho kiến thức', 'Chỉ dùng ảnh dưới đây khi đúng sản phẩm/thương hiệu; không tự bịa ảnh khác.']
  const images: LlmImage[] = []
  let rawBytes = 0
  for (const [index, doc] of docs.entries()) {
    const tags = parseImageTags(doc.tagsJson)
    const imageUrl = `/api/companies/${encodeURIComponent(companyId)}/knowledge/${encodeURIComponent(doc.id)}/original`
    lines.push(
      `${index + 1}. Tên: ${doc.title}` +
        `${doc.imageProduct ? `; sản phẩm: ${doc.imageProduct}` : ''}` +
        `${doc.imageBrand ? `; thương hiệu: ${doc.imageBrand}` : ''}` +
        `${tags.length > 0 ? `; tags: ${tags.join(', ')}` : ''}` +
        `${doc.imageDescription ? `; mô tả: ${doc.imageDescription}` : ''}` +
        `; URL nội bộ: ${imageUrl}`,
    )

    if (!includeImages || !doc.storageKey) continue
    const mimeType = normalizeImageMime(doc.mimeType)
    if (!mimeType) continue
    try {
      const bytes = await readKnowledgeOriginal(ctx.config.kbRoot, companyId, doc.storageKey)
      if (rawBytes + bytes.length > 8 * 1024 * 1024) continue
      rawBytes += bytes.length
      images.push({ mimeType, data: bytes.toString('base64') })
    } catch (error) {
      // A missing original must not prevent the task from using metadata or
      // the remaining images. The endpoint still enforces tenant membership.
      console.warn('[services] không đọc được ảnh sản phẩm cho agent:', error instanceof Error ? error.message : String(error))
    }
  }
  return { context: lines.join('\n'), images }
}

function parseImageTags(tagsJson: string): string[] {
  try {
    const value: unknown = JSON.parse(tagsJson)
    return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string').slice(0, 12) : []
  } catch {
    return []
  }
}

function normalizeImageMime(value: string | null | undefined): LlmImage['mimeType'] | undefined {
  if (value === 'image/png' || value === 'image/jpeg' || value === 'image/webp') return value
  return undefined
}

/**
 * Provider nhúng dùng chung cho cả tiến trình. Trả `undefined` khi không cấu hình
 * được — index vẫn ghi chunk và tìm kiếm vẫn chạy bằng từ khoá.
 */
export function embeddingFor(ctx: AppContext): Promise<EmbeddingProvider | undefined> {
  const cached = embeddingCache.get(ctx.repos)
  if (cached) return cached
  const pending = buildEmbedding(ctx)
  embeddingCache.set(ctx.repos, pending)
  return pending
}

async function getOrchestrator(ctx: AppContext, companyId: string): Promise<ConversationOrchestrator> {
  let byCompany = orchestratorCache.get(ctx.repos)
  if (!byCompany) {
    byCompany = new Map()
    orchestratorCache.set(ctx.repos, byCompany)
  }
  const cached = byCompany.get(companyId)
  if (cached) return cached

  const pending = (async () => {
    const [{ ConversationOrchestrator }, shared] = await Promise.all([
      import('@marketing-agent/orchestrator'),
      getSharedServices(ctx),
    ])
    const overrides = runtimeOverrides.get(ctx.repos)
    return new ConversationOrchestrator({
      repos: ctx.repos,
      tools: shared.registry,
      embedding: shared.embedding,
      publish: (event) => ctx.events.publish(event),
      limits: readStoredLimits(ctx.repos, companyId),
      productImageContext: (imageCompanyId, query, includeImages, limit) =>
        productImageContextFor(ctx, imageCompanyId, query, includeImages, limit),
      ...(overrides ? { runtimeOverrides: overrides } : {}),
      log: (message, data) => {
        if (data === undefined) console.log(`[orchestrator] ${message}`)
        else console.log(`[orchestrator] ${message}`, data)
      },
      // Chẩn đoán dài (nguyên văn bảng kế hoạch khi parser không đọc được) ghi ra
      // đĩa để còn đối chiếu về sau. Server biết thư mục ghi được; tầng điều phối thì
      // không. Có biến môi trường để tắt khi không muốn giữ lại nội dung model sinh.
      ...(process.env.DIAGNOSTICS_DIR
        ? {
            writeDiagnostic: (name: string, content: string) => {
              mkdirSync(process.env.DIAGNOSTICS_DIR!, { recursive: true })
              writeFileSync(join(process.env.DIAGNOSTICS_DIR!, name), content, 'utf8')
            },
          }
        : {}),
    })
  })()
  byCompany.set(companyId, pending)
  try {
    return await pending
  } catch (error) {
    byCompany.delete(companyId)
    throw error
  }
}

/** Orchestrator của một công ty, dựng một lần rồi dùng lại cho mọi request sau. */
export function orchestratorFor(ctx: AppContext, companyId: string): Promise<ConversationOrchestrator> {
  return getOrchestrator(ctx, companyId).catch((error) => {
    throw needsConfiguration(
      'Chưa nạp được tầng điều phối. Hãy cài đủ gói phụ thuộc (pnpm install) rồi thử lại.',
      error,
    )
  })
}

async function buildSharedServices(ctx: AppContext): Promise<SharedServices> {
  const { buildToolRegistry } = await import('@marketing-agent/tools')

  // Coordination tools cần orchestrator, orchestrator cần registry: phá vòng lặp
  // bằng host trì hoãn — nó chỉ tra orchestrator khi một tool thật sự được gọi.
  const host: CoordinationHost = {
    async createTasks(scope, tasks: readonly PlannedTaskInput[]) {
      return (await getOrchestrator(ctx, scope.companyId)).createTasks(scope, tasks)
    },
    async dispatchTask(scope, taskId: string) {
      return (await getOrchestrator(ctx, scope.companyId)).dispatchTask(scope, taskId)
    },
    async askPeer(input) {
      return (await getOrchestrator(ctx, input.companyId)).askPeer(input)
    },
    async escalate(input) {
      return (await getOrchestrator(ctx, input.companyId)).escalate(input)
    },
    availableRoles(companyId: string) {
      // Cùng quy tắc với orchestrator, nhưng đọc thẳng repos để hàm này đồng bộ:
      // validation của tool `task_create` gọi nó ngay trong lượt chạy.
      return ctx.repos.team
        .listAgentDefs()
        .filter((def) => ctx.repos.team.findPreset(companyId, def.id)?.enabled === true)
        .map((def) => def.role)
    },
  }

  const embedding = await embeddingFor(ctx)
  const built = buildToolRegistry({
    repos: ctx.repos,
    coreOptions: { companiesRoot: ctx.config.companiesRoot },
    coordinationHost: host,
  })
  return { registry: built.registry, integrationStore: built.integrationStore, embedding }
}

function getSharedServices(ctx: AppContext): Promise<SharedServices> {
  const cached = sharedCache.get(ctx.repos)
  if (cached) return cached
  const pending = buildSharedServices(ctx)
  sharedCache.set(ctx.repos, pending)
  return pending
}

/** Bề mặt registry tool, dùng cho màn hình đội/cài đặt. */
export async function listToolDescriptors(ctx: AppContext): Promise<ToolDescriptor[]> {
  try {
    const shared = await getSharedServices(ctx)
    return shared.registry.list()
  } catch (error) {
    // Không nạp được gói tools: vẫn trả tên tool mà tiến trình biết, mô tả rỗng.
    console.warn('[services] không nạp được tool registry:', error)
    return ctx.listToolNames().map((name) => ({ name, description: '', roles: [], requiresApproval: false }))
  }
}

/** Tool registry dùng chung, cho những route cần tra cứu một tool cụ thể. */
export async function toolRegistryFor(ctx: AppContext): Promise<ToolRegistry | undefined> {
  try {
    return (await getSharedServices(ctx)).registry
  } catch {
    return undefined
  }
}

/**
 * Adapter HTTP tối thiểu để kiểm tra một provider và đọc danh sách model.
 * Không dùng SDK: một lời gọi `GET /models` là đủ để biết khoá và địa chỉ có sống,
 * và cũng là nguồn dữ liệu cho luồng "fetch model rồi chọn".
 */
export async function probeProvider(input: {
  baseUrl: string
  apiKey?: string
  kind: string
  timeoutMs?: number
}): Promise<{
  ok: boolean
  message: string
  latencyMs: number
  modelsSeen?: number
  models?: { modelId: string; label: string }[]
}> {
  const started = Date.now()
  const url = `${input.baseUrl.replace(/\/+$/, '')}/models`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 8_000)
  try {
    // Anthropic dùng `x-api-key` + version header, không dùng Bearer. Gửi sai kiểu
    // header khiến khoá đúng vẫn bị từ chối 401, nên nhánh này phải tách rõ.
    const headers: Record<string, string> =
      input.kind === 'anthropic'
        ? {
            Accept: 'application/json',
            'anthropic-version': '2023-06-01',
            ...(input.apiKey ? { 'x-api-key': input.apiKey } : {}),
          }
        : {
            Accept: 'application/json',
            ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
          }
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })
    const latencyMs = Date.now() - started
    if (!response.ok) {
      return {
        ok: false,
        message: `Nhà cung cấp trả về HTTP ${response.status}. Kiểm tra lại địa chỉ, khoá API và quyền truy cập.`,
        latencyMs,
      }
    }
    let models: { modelId: string; label: string }[] | undefined
    try {
      const payload = (await response.json()) as { data?: unknown }
      if (Array.isArray(payload.data)) {
        models = payload.data
          .map((item): { modelId: string; label: string } | null => {
            if (!item || typeof item !== 'object') return null
            const record = item as { id?: unknown; name?: unknown }
            const modelId = typeof record.id === 'string' ? record.id : undefined
            if (!modelId) return null
            const label = typeof record.name === 'string' && record.name.length > 0 ? record.name : modelId
            return { modelId, label }
          })
          .filter((item): item is { modelId: string; label: string } => item !== null)
      }
    } catch {
      models = undefined
    }
    return {
      ok: true,
      message:
        models === undefined ? 'Kết nối thành công.' : `Kết nối thành công, thấy ${models.length} model.`,
      latencyMs,
      ...(models === undefined ? {} : { modelsSeen: models.length, models }),
    }
  } catch (error) {
    const latencyMs = Date.now() - started
    return {
      ok: false,
      message:
        error instanceof Error && error.name === 'AbortError'
          ? `Hết thời gian chờ sau ${latencyMs} ms. Kiểm tra địa chỉ nhà cung cấp.`
          : `Không kết nối được nhà cung cấp: ${error instanceof Error ? error.message : String(error)}`,
      latencyMs,
    }
  } finally {
    clearTimeout(timer)
  }
}
