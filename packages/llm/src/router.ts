/**
 * Bộ định tuyến model: quyết định mỗi agent chạy model nào, và nâng cấp khi thất bại.
 *
 * Vì sao có router thay vì để agent tự chọn: chi phí là đòn điều chỉnh chính của hệ
 * thống. Thứ tự ưu tiên (preset → route theo tier → model rẻ nhất) giữ cho mặc định
 * luôn rẻ, còn hai quy tắc cứng bảo vệ tính đúng đắn: model phải hỗ trợ công cụ khi
 * lượt chạy cần công cụ, và khi lỗi nhà cung cấp thì phải nâng tier chứ không lặp lại
 * mãi một model hỏng. Mọi quyết định đều kèm `reason` tiếng Việt để hiển thị/log.
 */
import type { LlmModelRecord, LlmProviderRecord, ModelRouteRecord, ModelTier, ResolvedAgent } from '@marketing-agent/shared'
import { MODEL_TIERS, needsConfiguration } from '@marketing-agent/shared'
import type { LlmRepo } from '@marketing-agent/db'
import type { ModelRegistry } from './registry.ts'

/** Lý do router chọn model, dùng cho log và UI giải thích chi phí. */
export type RouteSource = 'preset' | 'route' | 'cheapest' | 'capability_guard' | 'escalation'

export interface ModelChoice {
  readonly model: LlmModelRecord
  readonly provider: LlmProviderRecord
  readonly tier: ModelTier
  readonly source: RouteSource
  readonly reason: string
}

export interface ChooseOptions {
  /** Khi true, model không hỗ trợ tool sẽ bị thay bằng model cùng provider có tool. */
  readonly needsTools?: boolean
}

/** Tier kế tiếp để nâng cấp; `deep` là mức cao nhất nên trả `null`. */
export function nextTier(tier: ModelTier): ModelTier | null {
  const index = MODEL_TIERS.indexOf(tier)
  if (index === -1 || index === MODEL_TIERS.length - 1) return null
  return MODEL_TIERS[index + 1] ?? null
}

export class ModelRouter {
  constructor(
    private readonly registry: ModelRegistry,
    private readonly llm: LlmRepo,
  ) {}

  /**
   * Chọn model cho một agent theo thứ tự: chỉ định trong preset → route của tier đang
   * dùng → model rẻ nhất công ty. Sau đó áp capability guard nếu lượt chạy cần tool.
   */
  chooseForAgent(agent: ResolvedAgent, options: ChooseOptions = {}): ModelChoice {
    const needsTools = options.needsTools ?? false
    let chosen: LlmModelRecord | undefined
    let source: RouteSource = 'cheapest'
    let reason = ''

    if (agent.preset.modelFk) {
      const explicit = this.registry.findModel(agent.preset.modelFk)
      if (explicit && explicit.enabled) {
        chosen = explicit
        source = 'preset'
        reason = `Preset của ${agent.displayName} chỉ định model ${explicit.label}`
      } else {
        reason = `Model chỉ định trong preset không khả dụng; chuyển sang route tier ${agent.preset.tier}`
      }
    }

    if (!chosen) {
      const routed = this.routeModel(agent, agent.preset.tier)
      if (routed) {
        chosen = routed
        source = 'route'
        reason = reason.length > 0 ? `${reason} → ${routed.label}` : `Route tier ${agent.preset.tier} của ${agent.role}`
      }
    }

    if (!chosen) {
      // Không lọc theo tool ở đây: capability guard bên dưới là nơi duy nhất quyết định
      // model thay thế, nhờ vậy lý do đổi model luôn được ghi lại rõ ràng.
      chosen = this.registry.cheapestModel(agent.companyId)
      if (chosen) {
        source = 'cheapest'
        reason = 'Không có preset/route phù hợp; dùng model rẻ nhất đang bật'
      }
    }

    if (!chosen) {
      throw needsConfiguration(`Công ty chưa có model LLM nào khả dụng cho agent ${agent.role}`)
    }

    return this.guardTools(agent, chosen, agent.preset.tier, source, reason, needsTools)
  }

  /**
   * Nâng model lên tier kế tiếp sau khi provider thất bại. Không có route cho tier mới
   * thì lùi về model mạnh nhất còn dùng được, để lỗi cấu hình không biến thành run chết.
   */
  escalate(agent: ResolvedAgent, currentModelId: string): ModelChoice {
    const current = this.registry.findModel(currentModelId)
    const currentTier = this.routesFor(agent).find((route) => route.modelFk === currentModelId)?.tier ?? agent.preset.tier
    const target = nextTier(currentTier)

    if (!target) {
      const fallback = current ?? this.registry.strongestModel(agent.companyId, { requireTools: true })
      if (!fallback) throw needsConfiguration('Không còn model nào để nâng cấp')
      return this.guardTools(
        agent,
        fallback,
        currentTier,
        'escalation',
        `Model ${fallback.label} đã ở tier ${currentTier} (cao nhất); vẫn thử lại sau lỗi nhà cung cấp`,
        true,
      )
    }

    const routed = this.routeModel(agent, target)
    const stronger = routed ?? this.registry.strongestModel(agent.companyId, { requireTools: true })
    const model = stronger ?? current
    if (!model) throw needsConfiguration('Không còn model nào để nâng cấp')

    const why = routed
      ? `Nâng từ tier ${currentTier} lên ${target} sau lỗi nhà cung cấp: dùng ${model.label}`
      : `Nâng từ tier ${currentTier}: chưa có route cho tier ${target}; dùng model mạnh nhất còn khả dụng ${model.label}`
    return this.guardTools(agent, model, target, 'escalation', why, true)
  }

  /** Route đang cấu hình cho một agent, sắp theo priority tăng dần. */
  routesFor(agent: ResolvedAgent): ModelRouteRecord[] {
    return this.llm
      .listRoutes(agent.companyId)
      .filter((route) => route.agentDefId === agent.agentDef.id)
      .sort((a, b) => a.priority - b.priority)
  }

  private routeModel(agent: ResolvedAgent, tier: ModelTier): LlmModelRecord | undefined {
    return this.registry.routeModelForTier(agent.companyId, agent.agentDef.id, tier)
  }

  /**
   * Capability guard: model không có `supports_tools` mà lượt chạy cần công cụ thì
   * phải thay, ưu tiên model cùng nhà cung cấp để không đổi hạ tầng/khoá.
   */
  private guardTools(
    agent: ResolvedAgent,
    model: LlmModelRecord,
    tier: ModelTier,
    source: RouteSource,
    reason: string,
    needsTools: boolean,
  ): ModelChoice {
    if (!needsTools || model.supportsTools) return this.makeChoice(model, tier, source, reason)

    const sameProvider = this.registry.toolCapableModel(agent.companyId, {
      providerId: model.providerId,
      excludeModelIds: [model.id],
    })
    const replacement = sameProvider ?? this.registry.toolCapableModel(agent.companyId, { excludeModelIds: [model.id] })
    if (!replacement) {
      throw needsConfiguration(
        `Model ${model.label} không hỗ trợ gọi công cụ và công ty chưa có model nào hỗ trợ công cụ`,
      )
    }
    const scope = sameProvider ? 'cùng nhà cung cấp' : 'nhà cung cấp khác'
    const why = `${model.label} không hỗ trợ công cụ; tự chuyển sang ${replacement.label} (${scope})`
    const combined = reason.length > 0 ? `${reason}. ${why}` : why
    return this.makeChoice(replacement, tier, 'capability_guard', combined)
  }

  private makeChoice(model: LlmModelRecord, tier: ModelTier, source: RouteSource, reason: string): ModelChoice {
    return { model, provider: this.registry.providerOf(model), tier, source, reason }
  }
}
