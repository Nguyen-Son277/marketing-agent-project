/**
 * Sổ đăng ký model: nơi duy nhất biết cách biến một `model_fk` trong DB thành một
 * adapter gọi được.
 *
 * Vì sao cần lớp này: router chỉ nên quan tâm "model nào", còn việc giải mã API key,
 * chọn wire protocol và dựng URL là chi tiết hạ tầng. Gộp vào một chỗ giúp khoá được
 * giải mã đúng một lần cho mỗi request (không cache) nên xoay khoá có hiệu lực ngay.
 */
import type { LlmModelRecord, LlmProviderRecord, ModelTier } from '@marketing-agent/shared'
import { AppError, needsConfiguration } from '@marketing-agent/shared'
import type { LlmRepo } from '@marketing-agent/db'
import { AnthropicAdapter } from './adapters/anthropic.ts'
import { OpenAiCompatibleAdapter } from './adapters/openai-compatible.ts'
import { parseProviderExtra, type ProviderAdapter } from './provider.ts'

/** Model kèm provider đã kiểm tra tồn tại và đang bật. */
export interface ResolvedModel {
  readonly model: LlmModelRecord
  readonly provider: LlmProviderRecord
}

/** Tiêu chí lọc khi cần tìm model thay thế. */
export interface ModelQuery {
  readonly providerId?: string
  readonly requireTools?: boolean
  readonly excludeModelIds?: readonly string[]
}

/** Model kèm provider, dạng mà `LlmRepo.listModels` trả về. */
export type ModelWithProvider = LlmModelRecord & { readonly provider: LlmProviderRecord }

/**
 * Một cách gọi model: adapter đã dựng với đúng một khoá API. Nhiều ứng viên cho cùng
 * một model nghĩa là model đó có nhiều khoá — vòng lặp agent sẽ thử lần lượt.
 */
export interface ModelAdapterCandidate {
  readonly keyId: string | null
  readonly keyLabel: string | null
  readonly adapter: ProviderAdapter
}

export class ModelRegistry {
  constructor(private readonly llm: LlmRepo) {}

  findModel(modelFk: string): LlmModelRecord | undefined {
    return this.llm.findModel(modelFk)
  }

  requireModel(modelFk: string): LlmModelRecord {
    const model = this.llm.findModel(modelFk)
    if (!model) {
      throw new AppError('needs_configuration', 'Model chưa được cấu hình trong hệ thống', {
        messageKey: 'errors.provider.modelMissing',
      })
    }
    return model
  }

  providerOf(model: LlmModelRecord): LlmProviderRecord {
    return this.llm.requireProvider(model.providerId)
  }

  /** Model sẵn sàng chạy: tồn tại, đang bật, và có provider. */
  resolve(modelFk: string): ResolvedModel {
    const model = this.requireModel(modelFk)
    if (!model.enabled) throw needsConfiguration(`Model ${model.label} đang bị tắt`)
    return { model, provider: this.providerOf(model) }
  }

  /** Tất cả model công ty nhìn thấy, đang bật, kèm provider. */
  visibleModels(companyId: string): ModelWithProvider[] {
    return this.llm.listModels(companyId)
  }

  /**
   * Dựng adapter cho một model, MỘT adapter cho mỗi khoá API đang bật, theo thứ tự
   * `priority`. Khoá được giải mã ở đây, theo từng request, để việc đổi khoá trong UI
   * có hiệu lực ngay mà không cần khởi động lại tiến trình.
   *
   * Provider không có khoá nào vẫn hợp lệ (gateway nội bộ): trả đúng một adapter không
   * khoá. Không còn nhánh đọc khoá từ biến môi trường.
   */
  adaptersFor(model: LlmModelRecord): ModelAdapterCandidate[] {
    const provider = this.providerOf(model)
    const extra = parseProviderExtra(provider.extraJson)
    const build = (apiKey: string | undefined): ProviderAdapter => {
      const config = {
        baseUrl: provider.baseUrl,
        apiKey,
        headers: extra.headers,
        anthropicVersion: extra.anthropicVersion,
        includeStreamUsage: extra.includeStreamUsage,
      }
      return provider.kind === 'anthropic'
        ? new AnthropicAdapter(config)
        : new OpenAiCompatibleAdapter(config)
    }

    const keys = this.llm.resolveProviderKeys(provider)
    if (keys.length === 0) return [{ keyId: null, keyLabel: null, adapter: build(undefined) }]
    return keys.map((key) => ({
      keyId: key.id,
      keyLabel: key.label,
      adapter: build(key.apiKey.length > 0 ? key.apiKey : undefined),
    }))
  }

  /** Reserve a key immediately before an actual chat request, not when listing adapters. */
  selectAdapterFor(model: LlmModelRecord, options: {
    preferredKeyId?: string | null
    excludeKeyIds?: readonly string[]
  } = {}): (ModelAdapterCandidate & { mode: LlmProviderRecord['keyUsageMode']; blockId?: string }) | undefined {
    const provider = this.providerOf(model)
    if (!provider.enabled) throw needsConfiguration(`Nhà cung cấp ${provider.name} đang bị tắt`)
    const selected = this.llm.selectProviderKey(provider.id, options)
    if (!selected) return undefined
    const extra = parseProviderExtra(provider.extraJson)
    const config = {
      baseUrl: provider.baseUrl,
      apiKey: selected.key?.apiKey || undefined,
      headers: extra.headers,
      anthropicVersion: extra.anthropicVersion,
      includeStreamUsage: extra.includeStreamUsage,
    }
    return {
      mode: selected.mode,
      ...(selected.blockId ? { blockId: selected.blockId } : {}),
      keyId: selected.key?.id ?? null,
      keyLabel: selected.key?.label ?? null,
      adapter: provider.kind === 'anthropic' ? new AnthropicAdapter(config) : new OpenAiCompatibleAdapter(config),
    }
  }

  skipFailedKey(model: LlmModelRecord, keyId: string, blockId?: string): void {
    if (blockId) this.llm.skipFailedProviderKey(model.providerId, keyId, blockId)
  }

  /** Adapter đầu tiên (khoá ưu tiên cao nhất), dùng cho chỗ chỉ cần một cách gọi. */
  adapterFor(model: LlmModelRecord): ProviderAdapter {
    const [first] = this.adaptersFor(model)
    if (!first) throw needsConfiguration(`Không dựng được adapter cho model ${model.label}`)
    return first.adapter
  }

  /** Model rẻ nhất theo giá token vào, tie-break bằng giá token ra rồi tên. */
  cheapestModel(companyId: string, query: ModelQuery = {}): LlmModelRecord | undefined {
    return this.candidates(companyId, query)[0]
  }

  /**
   * Model mà công ty đã cấu hình cho một tier của agent, ưu tiên `priority` nhỏ nhất.
   * Trả `undefined` khi route trỏ tới model đã tắt — router sẽ tự lùi về mặc định rẻ.
   */
  routeModelForTier(companyId: string, agentDefId: string, tier: ModelTier): LlmModelRecord | undefined {
    const routes = this.llm
      .listRoutes(companyId)
      .filter((candidate) => candidate.agentDefId === agentDefId && candidate.tier === tier)
      .sort((a, b) => a.priority - b.priority)
    const route = routes[0]
    if (!route) return undefined
    const model = this.llm.findModel(route.modelFk)
    return model && model.enabled ? model : undefined
  }

  /** Model mạnh nhất theo giá: dùng khi phải nâng cấp mà không có route tier tương ứng. */
  strongestModel(companyId: string, query: ModelQuery = {}): LlmModelRecord | undefined {
    const sorted = this.candidates(companyId, query).sort(
      (a, b) => b.costInPerMtok - a.costInPerMtok || b.costOutPerMtok - a.costOutPerMtok,
    )
    return sorted[0]
  }

  /** Model hỗ trợ công cụ, rẻ nhất trước — dùng cho capability guard. */
  toolCapableModel(companyId: string, query: ModelQuery = {}): LlmModelRecord | undefined {
    return this.candidates(companyId, { ...query, requireTools: true })[0]
  }

  /** Ném lỗi cấu hình khi model không đáp ứng yêu cầu công cụ của lượt chạy. */
  assertSupportsTools(model: LlmModelRecord, needsTools = true): void {
    if (needsTools && !model.supportsTools) {
      throw needsConfiguration(`Model ${model.label} không hỗ trợ gọi công cụ`)
    }
  }

  private candidates(companyId: string, query: ModelQuery): ModelWithProvider[] {
    const excluded = new Set(query.excludeModelIds ?? [])
    return this.visibleModels(companyId)
      .filter((model) => model.enabled)
      .filter((model) => (query.providerId ? model.providerId === query.providerId : true))
      .filter((model) => (query.requireTools ? model.supportsTools : true))
      .filter((model) => !excluded.has(model.id))
      .sort(
        (a, b) =>
          a.costInPerMtok - b.costInPerMtok ||
          a.costOutPerMtok - b.costOutPerMtok ||
          a.label.localeCompare(b.label),
      )
  }
}
