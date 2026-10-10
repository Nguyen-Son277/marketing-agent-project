/**
 * Cài đặt của công ty: nhà cung cấp model, model, route theo tier, kết nối ngoài
 * và giới hạn vận hành.
 *
 * Vì sao mọi thao tác ghi đều `requireManage`: đây là cấu hình ảnh hưởng tới chi
 * phí và tới dữ liệu gửi ra ngoài của cả công ty. Một thành viên thường đổi được
 * model hay thêm khoá API là thay đổi ngoài thẩm quyền của họ.
 *
 * Quy tắc fail closed cho tài nguyên toàn cục: một provider `company_id IS NULL` là
 * của toàn hệ thống. Công ty chỉ được sửa tài nguyên do chính mình tạo; sửa tài
 * nguyên toàn cục từ route của một công ty sẽ ảnh hưởng mọi công ty khác, nên bị trả
 * 404 như thể không tồn tại. (Từ migration 0008 không còn provider nào được seed.)
 */
import { z } from 'zod'
import {
  conflict,
  notFound,
  parseOrThrow,
  upsertIntegrationSchema,
  upsertRouteSchema,
  createModelSchema,
  createProviderSchema,
  createProviderKeySchema,
  fetchModelsSchema,
  importModelsSchema,
  updateModelSchema,
  updateProviderKeySchema,
  updateProviderSchema,
} from '@marketing-agent/shared'
import type {
  FetchModelsResponse,
  ImportModelsResponse,
  IntegrationTestResponse,
  IntegrationView,
  LimitsView,
  ModelOptionView,
  ModelRouteView,
  ProviderKeyView,
  ProvidersResponse,
  ProviderView,
  PurgeModelsResponse,
  IntegrationKind,
  ModelTier,
} from '@marketing-agent/shared'
import type { LlmProviderKeyRecord, LlmProviderRecord } from '@marketing-agent/shared'
import type { AppContext } from '../context.ts'
import { requireManage, requireMembership } from '../http/middleware.ts'
import type { Router } from '../http/router.ts'
import { invalidateOrchestrators, probeProvider } from '../services/agent-services.ts'
import { readLimitsView, saveLimits } from '../services/company-settings.ts'
import { toIntegrationView, toModelOptionView, toModelRouteView, toProviderView } from '../services/view-mappers.ts'

/** Bổ sung `enabled` cho model vì `CreateModelBody` của hợp đồng không có trường này. */
const createModelBodySchema = createModelSchema

/** Body PATCH /limits; giới hạn chặt hơn nữa để một lần gõ nhầm không mở toang trần. */
const limitsPatchSchema = z.object({
  dailyCostUsd: z.number().min(0).max(10_000).optional(),
  taskCostUsd: z.number().min(0).max(10_000).optional(),
  maxStepsPerRun: z.number().int().min(1).max(100).optional(),
  maxPeerRounds: z.number().int().min(0).max(50).optional(),
  maxRevisionsPerTask: z.number().int().min(0).max(20).optional(),
  maxParallelTasks: z.number().int().min(1).max(20).optional(),
})

/** Trường bắt buộc tối thiểu của mỗi loại kết nối, để kiểm tra được mà không gọi mạng. */
const INTEGRATION_REQUIRED_KEYS: Readonly<Record<IntegrationKind, readonly string[]>> = {
  firecrawl: ['apiKey'],
  'google-search-console': ['clientId', 'clientSecret', 'refreshToken'],
  'google-analytics': ['clientId', 'clientSecret', 'refreshToken'],
  'google-sheets': ['clientId', 'clientSecret', 'refreshToken'],
  'google-ads': ['clientId', 'clientSecret', 'refreshToken', 'developerToken', 'customerId'],
  meta: ['accessToken'],
  linkedin: ['accessToken'],
  'email-smtp': ['host', 'port', 'user', 'password', 'from'],
}

export function settingsRoutes() {
  return {
    name: 'settings',
    register(router: Router, ctx: AppContext): void {
      const repos = ctx.repos

      /* ---------------------------------------------------------- providers */

      router.get(
        '/api/companies/:companyId/providers',
        async (request) => {
          const companyId = request.params.companyId!
          const providers = repos.llm.listProviders(companyId, { includeDisabled: true })
          const models = repos.llm.listModels(companyId, { includeDisabled: true })
          const providerNames = new Map(providers.map((provider) => [provider.id, provider.name]))
          const usage = repos.llm.modelUsage(companyId)
          const response: ProvidersResponse = {
            providers: providers.map((provider) =>
              toProviderView(
                provider,
                repos.llm.listProviderKeys(provider.id, { includeDisabled: true }),
                models.filter((model) => model.providerId === provider.id),
                providerNames,
                usage,
              ),
            ),
          }
          request.json(200, response)
        },
        [requireMembership(repos)],
      )

      router.post(
        '/api/companies/:companyId/providers',
        async (request) => {
          const companyId = request.params.companyId!
          const body = normalizeProviderBody(await request.body())
          const input = parseOrThrow(createProviderSchema, body, 'nhà cung cấp model')
          // Tạo provider và khoá đầu tiên trong MỘT transaction: provider không có khoá
          // vì lỗi nửa chừng là cấu hình chết mà người dùng không hiểu vì sao.
          const provider = repos.db.tx(() => {
            const created = repos.llm.createProvider({
              companyId,
              name: input.name,
              kind: input.kind ?? 'openai_compatible',
              baseUrl: input.baseUrl,
              ...(input.extraJson ? { extra: input.extraJson } : {}),
              enabled: input.enabled,
            })
            if (input.apiKey) {
              repos.llm.createProviderKey({
                providerId: created.id,
                label: input.apiKeyLabel ?? 'Key 1',
                apiKey: input.apiKey,
                priority: 100,
              })
            }
            return created
          })
          repos.accounting.audit({ companyId, action: 'provider.create', target: input.name })
          request.json(201, { provider: providerView(repos, companyId, provider) })
        },
        [requireMembership(repos), requireManage],
      )

      router.patch(
        '/api/companies/:companyId/providers/:providerId',
        async (request) => {
          const companyId = request.params.companyId!
          const provider = requireOwnedProvider(repos, companyId, request.params.providerId!)
          const body = normalizeProviderBody(await request.body())
          const input = parseOrThrow(updateProviderSchema, body, 'cập nhật nhà cung cấp')
          const updated = repos.llm.updateProvider(provider.id, {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.kind === undefined ? {} : { kind: input.kind }),
            ...(input.baseUrl === undefined ? {} : { baseUrl: input.baseUrl }),
            ...(input.extraJson === undefined ? {} : { extra: input.extraJson }),
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          })
          repos.accounting.audit({ companyId, action: 'provider.update', target: provider.name })
          request.json(200, { provider: providerView(repos, companyId, updated) })
        },
        [requireMembership(repos), requireManage],
      )

      router.delete(
        '/api/companies/:companyId/providers/:providerId',
        async (request) => {
          const companyId = request.params.companyId!
          const provider = requireOwnedProvider(repos, companyId, request.params.providerId!)
          repos.llm.deleteProvider(provider.id)
          repos.accounting.audit({ companyId, action: 'provider.delete', target: provider.name })
          request.json(200, { deleted: true })
        },
        [requireMembership(repos), requireManage],
      )

      router.post(
        '/api/companies/:companyId/providers/:providerId/test',
        async (request) => {
          const companyId = request.params.companyId!
          const provider = requireOwnedProvider(repos, companyId, request.params.providerId!)
          const body = (await request.body()) as { keyId?: unknown } | undefined
          const keyId = typeof body?.keyId === 'string' ? body.keyId : undefined
          const result = await probeProvider({
            baseUrl: provider.baseUrl,
            kind: provider.kind,
            ...resolveProbeKey(repos, provider, keyId),
          })
          request.json(200, result)
        },
        [requireMembership(repos), requireManage],
      )

      /* ------------------------------------------------------------ api keys */

      router.get(
        '/api/companies/:companyId/providers/:providerId/keys',
        async (request) => {
          const companyId = request.params.companyId!
          const provider = requireOwnedProvider(repos, companyId, request.params.providerId!)
          request.json(200, { keys: providerKeyViews(repos, provider) })
        },
        [requireMembership(repos)],
      )

      router.post(
        '/api/companies/:companyId/providers/:providerId/keys',
        async (request) => {
          const companyId = request.params.companyId!
          const provider = requireOwnedProvider(repos, companyId, request.params.providerId!)
          const input = parseOrThrow(createProviderKeySchema, await request.body(), 'khoá API')
          const key = repos.llm.createProviderKey({
            providerId: provider.id,
            label: input.label,
            apiKey: input.apiKey,
            priority: input.priority,
            enabled: input.enabled,
          })
          repos.accounting.audit({ companyId, action: 'provider.key.create', target: `${provider.name}:${input.label}` })
          request.json(201, { key: toProviderKeyView(key) })
        },
        [requireMembership(repos), requireManage],
      )

      router.patch(
        '/api/companies/:companyId/providers/:providerId/keys/:keyId',
        async (request) => {
          const companyId = request.params.companyId!
          const provider = requireOwnedProvider(repos, companyId, request.params.providerId!)
          const key = requireOwnedKey(repos, provider, request.params.keyId!)
          const input = parseOrThrow(updateProviderKeySchema, await request.body(), 'cập nhật khoá API')
          const updated = repos.llm.updateProviderKey(key.id, {
            ...(input.label === undefined ? {} : { label: input.label }),
            ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
            ...(input.priority === undefined ? {} : { priority: input.priority }),
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          })
          repos.accounting.audit({ companyId, action: 'provider.key.update', target: `${provider.name}:${updated.label}` })
          request.json(200, { key: toProviderKeyView(updated) })
        },
        [requireMembership(repos), requireManage],
      )

      router.delete(
        '/api/companies/:companyId/providers/:providerId/keys/:keyId',
        async (request) => {
          const companyId = request.params.companyId!
          const provider = requireOwnedProvider(repos, companyId, request.params.providerId!)
          const key = requireOwnedKey(repos, provider, request.params.keyId!)
          repos.llm.deleteProviderKey(key.id)
          repos.accounting.audit({ companyId, action: 'provider.key.delete', target: `${provider.name}:${key.label}` })
          request.json(200, { deleted: true })
        },
        [requireMembership(repos), requireManage],
      )

      router.post(
        '/api/companies/:companyId/providers/:providerId/keys/:keyId/test',
        async (request) => {
          const companyId = request.params.companyId!
          const provider = requireOwnedProvider(repos, companyId, request.params.providerId!)
          const key = requireOwnedKey(repos, provider, request.params.keyId!)
          const result = await probeProvider({
            baseUrl: provider.baseUrl,
            kind: provider.kind,
            apiKey: resolveKeyValue(repos, key.id),
          })
          request.json(200, result)
        },
        [requireMembership(repos), requireManage],
      )

      /* ----------------------------------------------------------- fetch model */

      router.post(
        '/api/companies/:companyId/providers/:providerId/fetch-models',
        async (request) => {
          const companyId = request.params.companyId!
          const provider = requireOwnedProvider(repos, companyId, request.params.providerId!)
          const input = parseOrThrow(fetchModelsSchema, await request.body(), 'danh sách model')
          // `requireOwnedKey` buộc khoá phải thuộc ĐÚNG provider này. Nếu chỉ tra theo id,
          // một công ty có thể mượn khoá của công ty khác để gọi URL của mình.
          const chosenKey = input.keyId ? requireOwnedKey(repos, provider, input.keyId) : undefined
          const result = await probeProvider({
            baseUrl: provider.baseUrl,
            kind: provider.kind,
            timeoutMs: 15_000,
            ...(chosenKey ? { apiKey: resolveKeyValue(repos, chosenKey.id) } : resolveProbeKey(repos, provider)),
          })
          const existing = new Set(
            repos.llm
              .listModels(companyId, { includeDisabled: true })
              .filter((model) => model.providerId === provider.id)
              .map((model) => model.modelId),
          )
          const response: FetchModelsResponse = {
            ok: result.ok,
            message: result.message,
            latencyMs: result.latencyMs,
            models: (result.models ?? []).map((model) => ({
              modelId: model.modelId,
              label: model.label,
              alreadyAdded: existing.has(model.modelId),
            })),
          }
          request.json(200, response)
        },
        [requireMembership(repos), requireManage],
      )

      router.post(
        '/api/companies/:companyId/providers/:providerId/import-models',
        async (request) => {
          const companyId = request.params.companyId!
          const provider = requireOwnedProvider(repos, companyId, request.params.providerId!)
          const input = parseOrThrow(importModelsSchema, await request.body(), 'model nhập về')
          const created: ModelOptionView[] = []
          const skipped: string[] = []
          repos.db.tx(() => {
            for (const item of input.models) {
              if (repos.llm.findModelByModelId(provider.id, item.modelId)) {
                skipped.push(item.modelId)
                continue
              }
              const model = repos.llm.createModel({
                providerId: provider.id,
                modelId: item.modelId,
                label: item.label ?? item.modelId,
                contextWindow: item.contextWindow,
                maxOutput: item.maxOutput,
                supportsTools: item.supportsTools,
                supportsVision: item.supportsVision,
                costInPerMtok: item.costInPerMtok,
                costOutPerMtok: item.costOutPerMtok,
              })
              created.push(toModelOptionView(model, { providerName: provider.name }))
            }
          })
          repos.accounting.audit({ companyId, action: 'model.import', target: provider.name, payload: { created: created.length, skipped: skipped.length } })
          const response: ImportModelsResponse = { created, skipped }
          request.json(201, response)
        },
        [requireMembership(repos), requireManage],
      )

      router.post(
        '/api/companies/:companyId/providers/:providerId/purge-models',
        async (request) => {
          const companyId = request.params.companyId!
          const provider = requireOwnedProvider(repos, companyId, request.params.providerId!)
          const deleted = repos.llm.deleteUnusedModels(provider.id)
          repos.accounting.audit({ companyId, action: 'model.purge', target: provider.name, payload: { deleted } })
          const response: PurgeModelsResponse = { deleted }
          request.json(200, response)
        },
        [requireMembership(repos), requireManage],
      )

      /* ------------------------------------------------------------- models */

      router.get(
        '/api/companies/:companyId/models',
        async (request) => {
          const companyId = request.params.companyId!
          const usage = repos.llm.modelUsage(companyId)
          const models = repos.llm.listModels(companyId, { includeDisabled: true }).map((model) =>
            toModelOptionView(model, {
              providerName: model.provider.name,
              usedByAgentCount: usage.get(model.id) ?? 0,
            }),
          )
          request.json(200, { models })
        },
        [requireMembership(repos)],
      )

      router.post(
        '/api/companies/:companyId/models',
        async (request) => {
          const companyId = request.params.companyId!
          const input = parseOrThrow(createModelBodySchema, await request.body(), 'model')
          const provider = requireOwnedProvider(repos, companyId, input.providerId)
          const model = repos.llm.createModel({
            providerId: provider.id,
            modelId: input.modelId,
            label: input.label,
            contextWindow: input.contextWindow,
            maxOutput: input.maxOutput,
            supportsTools: input.supportsTools,
            supportsVision: input.supportsVision,
            costInPerMtok: input.costInPerMtok,
            costOutPerMtok: input.costOutPerMtok,
            enabled: input.enabled,
          })
          repos.accounting.audit({ companyId, action: 'model.create', target: input.label })
          const view: ModelOptionView = { ...toModelOptionView(model, { providerName: provider.name }) }
          request.json(201, { model: view })
        },
        [requireMembership(repos), requireManage],
      )

      router.patch(
        '/api/companies/:companyId/models/:modelId',
        async (request) => {
          const companyId = request.params.companyId!
          const model = requireOwnedModel(repos, companyId, request.params.modelId!)
          const input = parseOrThrow(updateModelSchema, await request.body(), 'cập nhật model')
          const updated = repos.llm.updateModel(model.id, input)
          repos.accounting.audit({ companyId, action: 'model.update', target: updated.label })
          const provider = repos.llm.findProvider(updated.providerId)
          const usage = repos.llm.modelUsage(companyId)
          const view: ModelOptionView = toModelOptionView(updated, {
            providerName: provider?.name ?? '',
            usedByAgentCount: usage.get(updated.id) ?? 0,
          })
          request.json(200, { model: view })
        },
        [requireMembership(repos), requireManage],
      )

      router.delete(
        '/api/companies/:companyId/models/:modelId',
        async (request) => {
          const companyId = request.params.companyId!
          const model = requireOwnedModel(repos, companyId, request.params.modelId!)
          // Xoá model còn được route/preset/fallback trỏ tới sẽ khiến cấu hình của agent
          // biến mất trong im lặng. Chặn lại và nói rõ cần gỡ ở đâu trước.
          const usage = repos.llm.modelUsage(companyId).get(model.id) ?? 0
          if (usage > 0 || repos.llm.referencedModelIds().has(model.id)) {
            throw conflict(
              `Model ${model.label} đang được ${usage > 0 ? `${usage} agent` : 'cấu hình'} sử dụng. ` +
                'Hãy gỡ khỏi agent/route trước khi xoá, hoặc dùng "Xoá model không dùng".',
            )
          }
          repos.llm.deleteModel(model.id)
          repos.accounting.audit({ companyId, action: 'model.delete', target: model.label })
          request.json(200, { deleted: true })
        },
        [requireMembership(repos), requireManage],
      )

      /* ------------------------------------------------------------- routes */

      router.get(
        '/api/companies/:companyId/routes',
        async (request) => {
          const companyId = request.params.companyId!
          request.json(200, { routes: modelRouteViews(repos, companyId) })
        },
        [requireMembership(repos)],
      )

      router.post(
        '/api/companies/:companyId/routes',
        async (request) => {
          const companyId = request.params.companyId!
          const raw = (await request.body()) as Record<string, unknown> | undefined
          const agentDefId = raw && typeof raw['agentDefId'] === 'string' ? raw['agentDefId'] : undefined
          if (!agentDefId) {
            throw parseOrThrow(upsertRouteSchema, {}, 'route model')
          }
          const def = repos.team.findAgentDef(agentDefId)
          if (!def) throw notFound(`Không có agent với id ${agentDefId}`)
          const input = parseOrThrow(upsertRouteSchema, { ...raw, agentRole: def.role }, 'route model')
          requireOwnedModel(repos, companyId, input.modelFk)
          const route = repos.llm.upsertRoute({
            companyId,
            agentDefId: def.id,
            tier: input.tier,
            modelFk: input.modelFk,
            reasoningEffort: input.reasoningEffort ?? null,
            maxTokens: input.maxTokens ?? null,
            priority: input.priority,
          })
          repos.accounting.audit({ companyId, action: 'route.upsert', target: `${def.role}:${input.tier}` })
          const view = toModelRouteView(route, def, repos.llm.findModel(route.modelFk)?.label ?? null)
          request.json(201, { route: view })
        },
        [requireMembership(repos), requireManage],
      )

      router.delete(
        '/api/companies/:companyId/routes/:agentDefId/:tier',
        async (request) => {
          const companyId = request.params.companyId!
          const def = repos.team.findAgentDef(request.params.agentDefId!)
          if (!def) throw notFound('Không tìm thấy agent')
          const tier = request.params.tier as ModelTier
          if (!['light', 'standard', 'deep'].includes(tier)) throw notFound('Không tìm thấy route model')
          repos.llm.deleteRoute(companyId, def.id, tier)
          repos.accounting.audit({ companyId, action: 'route.delete', target: `${def.role}:${tier}` })
          request.json(200, { deleted: true })
        },
        [requireMembership(repos), requireManage],
      )

      /* ------------------------------------------------------- integrations */

      router.get(
        '/api/companies/:companyId/integrations',
        async (request) => {
          const companyId = request.params.companyId!
          request.json(200, {
            integrations: repos.accounting.listIntegrations(companyId).map((record) => toIntegrationView(record)),
          })
        },
        [requireMembership(repos)],
      )

      router.post(
        '/api/companies/:companyId/integrations',
        async (request) => {
          const companyId = request.params.companyId!
          const input = parseOrThrow(upsertIntegrationSchema, await request.body(), 'kết nối')
          const record = repos.accounting.upsertIntegration({
            companyId,
            kind: input.kind,
            name: input.name,
            config: input.config,
          })
          repos.accounting.audit({ companyId, action: 'integration.upsert', target: `${input.kind}:${input.name}` })
          const view: IntegrationView = toIntegrationView(record)
          request.json(201, { integration: view })
        },
        [requireMembership(repos), requireManage],
      )

      router.delete(
        '/api/companies/:companyId/integrations/:integrationId',
        async (request) => {
          const companyId = request.params.companyId!
          const record = repos.accounting.requireIntegration(request.params.integrationId!, companyId)
          repos.accounting.deleteIntegration(companyId, record.kind, record.name)
          repos.accounting.audit({ companyId, action: 'integration.delete', target: `${record.kind}:${record.name}` })
          request.json(200, { deleted: true })
        },
        [requireMembership(repos), requireManage],
      )

      router.post(
        '/api/companies/:companyId/integrations/:integrationId/test',
        async (request) => {
          const companyId = request.params.companyId!
          const record = repos.accounting.requireIntegration(request.params.integrationId!, companyId)
          const started = Date.now()
          const result = testIntegrationConfig(repos, record.kind, record.configEnc, record.configIv)
          repos.accounting.markIntegrationChecked(record.id, companyId, result.status)
          const response: IntegrationTestResponse = {
            ok: result.ok,
            message: result.message,
            status: result.status,
            latencyMs: Date.now() - started,
          }
          request.json(200, response)
        },
        [requireMembership(repos), requireManage],
      )

      /* ------------------------------------------------------------- limits */

      router.get(
        '/api/companies/:companyId/limits',
        async (request) => {
          request.json(200, readLimitsView(repos, request.params.companyId!))
        },
        [requireMembership(repos)],
      )

      router.patch(
        '/api/companies/:companyId/limits',
        async (request) => {
          const companyId = request.params.companyId!
          const input = parseOrThrow(limitsPatchSchema, await request.body(), 'giới hạn vận hành')
          const view: LimitsView = saveLimits(repos, companyId, input)
          // Giới hạn được truyền vào orchestrator lúc khởi tạo: bỏ cache để lượt
          // tiếp theo dùng giá trị mới thay vì phải khởi động lại tiến trình.
          invalidateOrchestrators(repos)
          repos.accounting.audit({ companyId, action: 'limits.update', payload: input })
          request.json(200, view)
        },
        [requireMembership(repos), requireManage],
      )
    },
  }
}

/* ------------------------------------------------------------------ helpers */

function normalizeProviderBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body
  const record = { ...(body as Record<string, unknown>) }
  // Hợp đồng API dùng `extra`; schema dùng `extraJson`. Chấp nhận cả hai, ưu tiên `extra`.
  if (record['extra'] !== undefined && record['extraJson'] === undefined) {
    record['extraJson'] = record['extra']
  }
  delete record['extra']
  return record
}

function toProviderKeyView(key: LlmProviderKeyRecord): ProviderKeyView {
  return { id: key.id, label: key.label, hint: key.hint, priority: key.priority, enabled: key.enabled }
}

function providerKeyViews(repos: AppContext['repos'], provider: LlmProviderRecord): ProviderKeyView[] {
  return repos.llm.listProviderKeys(provider.id, { includeDisabled: true }).map(toProviderKeyView)
}

function providerView(repos: AppContext['repos'], companyId: string, provider: LlmProviderRecord): ProviderView {
  const models = repos.llm
    .listModels(companyId, { includeDisabled: true })
    .filter((model) => model.providerId === provider.id)
  return toProviderView(
    provider,
    repos.llm.listProviderKeys(provider.id, { includeDisabled: true }),
    models,
    new Map([[provider.id, provider.name]]),
    repos.llm.modelUsage(companyId),
  )
}

/** Khoá phải thuộc đúng provider đang thao tác; khoá của provider khác coi như không có. */
function requireOwnedKey(
  repos: AppContext['repos'],
  provider: LlmProviderRecord,
  keyId: string,
): LlmProviderKeyRecord {
  const key = repos.llm.findProviderKey(keyId)
  if (!key || key.providerId !== provider.id) throw notFound('Không tìm thấy khoá API')
  return key
}

/** Giá trị khoá đã giải mã của một id, dùng cho bước kiểm tra và fetch model. */
function resolveKeyValue(repos: AppContext['repos'], keyId: string): string {
  const key = repos.llm.requireProviderKey(keyId)
  const provider = repos.llm.requireProvider(key.providerId)
  return repos.llm.resolveProviderKeys(provider).find((item) => item.id === keyId)?.apiKey ?? ''
}

/**
 * Khoá để gọi thử khi không chỉ định: khoá đang bật có priority nhỏ nhất. Provider
 * không có khoá nào vẫn hợp lệ (gateway nội bộ) nên trả về object rỗng.
 */
function resolveProbeKey(
  repos: AppContext['repos'],
  provider: LlmProviderRecord,
  keyId?: string,
): { apiKey?: string } {
  if (keyId) {
    const key = requireOwnedKey(repos, provider, keyId)
    return { apiKey: resolveKeyValue(repos, key.id) }
  }
  const first = repos.llm.resolveProviderKeys(provider)[0]
  return first ? { apiKey: first.apiKey } : {}
}

/** Provider phải do chính công ty tạo; provider toàn cục coi như không tồn tại. */
function requireOwnedProvider(repos: AppContext['repos'], companyId: string, providerId: string): LlmProviderRecord {
  const provider = repos.llm.findProvider(providerId)
  if (!provider || provider.companyId !== companyId) throw notFound('Không tìm thấy nhà cung cấp model')
  return provider
}

/** Model phải thuộc một provider của chính công ty. */
function requireOwnedModel(repos: AppContext['repos'], companyId: string, modelId: string) {
  const model = repos.llm.findModel(modelId)
  if (!model) throw notFound('Không tìm thấy model')
  const provider = repos.llm.findProvider(model.providerId)
  if (!provider || provider.companyId !== companyId) throw notFound('Không tìm thấy model')
  return model
}

function modelRouteViews(repos: AppContext['repos'], companyId: string): ModelRouteView[] {
  const defs = new Map(repos.team.listAgentDefs().map((def) => [def.id, def]))
  const routes: ModelRouteView[] = []
  for (const route of repos.llm.listRoutes(companyId)) {
    const view = toModelRouteView(
      route,
      defs.get(route.agentDefId),
      repos.llm.findModel(route.modelFk)?.label ?? null,
    )
    if (view) routes.push(view)
  }
  return routes
}

/**
 * Kiểm tra một cấu hình kết nối mà KHÔNG gọi mạng: xác nhận giải mã được và có đủ
 * trường bắt buộc. Kiểm tra sống còn thật sự cần quyền truy cập dịch vụ ngoài.
 */
function testIntegrationConfig(
  repos: AppContext['repos'],
  kind: IntegrationKind,
  configEnc: string | null,
  configIv: string | null,
): { ok: boolean; status: string; message: string } {
  let config: Record<string, unknown> | undefined
  try {
    config = repos.secrets.decryptJson<Record<string, unknown>>(configEnc, configIv)
  } catch {
    config = undefined
  }
  if (!config || Object.keys(config).length === 0) {
    return { ok: false, status: 'invalid', message: 'Chưa có cấu hình hoặc không giải mã được. Hãy nhập lại.' }
  }
  const missing = INTEGRATION_REQUIRED_KEYS[kind].filter((key) => {
    const value = config?.[key]
    return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0)
  })
  if (missing.length > 0) {
    return { ok: false, status: 'invalid', message: `Thiếu trường bắt buộc: ${missing.join(', ')}.` }
  }
  return { ok: true, status: 'ok', message: 'Cấu hình hợp lệ và đã giải mã được.' }
}
