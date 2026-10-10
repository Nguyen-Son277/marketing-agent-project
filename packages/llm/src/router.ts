/**
 * Bộ định tuyến model: quyết định mỗi agent chạy model nào, và chuyển sang model dự
 * phòng khi thất bại.
 *
 * Vì sao vẫn cần router dù người dùng chọn model: lượt chạy phải biết thứ tự thử khi
 * nhà cung cấp lỗi. Thứ tự đó do NGƯỜI DÙNG cấu hình, không phải hệ thống tự đoán:
 * model chính → các model dự phòng theo thứ tự → route của mức năng lực cao hơn. Hệ
 * thống KHÔNG tự gắn model rẻ nhất/mạnh nhất cho agent: chưa chọn thì báo lỗi cấu hình
 * ngay tại màn hình nơi sửa được, thay vì âm thầm chạy một model người dùng chưa duyệt.
 *
 * Hai quy tắc cứng còn giữ: model phải hỗ trợ công cụ khi lượt chạy cần công cụ (thay
 * bằng model dự phòng hoặc model cùng nhà cung cấp, không vượt ra ngoài lựa chọn của
 * người dùng), và lỗi nhà cung cấp thì phải chuyển model chứ không lặp mãi một model hỏng.
 */
import type { LlmModelRecord, LlmProviderRecord, ModelRouteRecord, ModelTier, ResolvedAgent } from '@marketing-agent/shared'
import { AppError, MODEL_TIERS, needsConfiguration } from '@marketing-agent/shared'
import type { LlmRepo } from '@marketing-agent/db'
import type { ModelRegistry } from './registry.ts'

/** Lý do router chọn model, dùng cho log và UI giải thích chi phí. */
export type RouteSource = 'preset' | 'route' | 'fallback' | 'capability_guard' | 'escalation'

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

interface Candidate {
  readonly model: LlmModelRecord
  readonly source: RouteSource
  readonly reason: string
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
   * Chọn model đầu tiên cho một agent. Không có model nào được cấu hình thì ném
   * `needs_configuration` — đây là lỗi cấu hình người dùng sửa được, không phải lỗi
   * hệ thống, và tuyệt đối không được lấp bằng một model tự chọn.
   */
  chooseForAgent(agent: ResolvedAgent, options: ChooseOptions = {}): ModelChoice {
    const needsTools = options.needsTools ?? false
    const first = this.candidateChain(agent)[0]
    if (!first) {
      throw new AppError(
        'needs_configuration',
        `Agent ${agent.displayName} chưa được chọn model. Vào Cài đặt → Đội agent để chọn model.`,
        {
          messageKey: 'errors.provider.noModelForAgent',
          messageParams: { role: agent.role },
        },
      )
    }
    return this.guardTools(agent, first.model, agent.preset.tier, first.source, first.reason, needsTools)
  }

  /**
   * Model kế tiếp sau `currentModelId` trong chuỗi đã cấu hình. Hết chuỗi thì ném lỗi
   * cấu hình để vòng lặp dừng với thông báo rõ ràng thay vì thử lại vô ích.
   */
  escalate(agent: ResolvedAgent, currentModelId: string): ModelChoice {
    const chain = this.candidateChain(agent)
    const index = chain.findIndex((candidate) => candidate.model.id === currentModelId)
    // Bình thường `current` nằm trong chuỗi nên lấy phần tử kế tiếp. Trường hợp model
    // hiện tại do capability guard thay vào (không có trong chuỗi), lấy ứng viên đầu
    // tiên khác nó.
    const next = index >= 0 ? chain[index + 1] : chain.find((candidate) => candidate.model.id !== currentModelId)
    if (!next) {
      const current = this.registry.findModel(currentModelId)
      throw needsConfiguration(
        `Không còn model dự phòng cho ${agent.displayName}${current ? ` sau ${current.label}` : ''}. ` +
          'Thêm model dự phòng trong Cài đặt → Đội agent.',
      )
    }
    const reason = `Nhà cung cấp lỗi; chuyển sang ${next.model.label}`
    return this.guardTools(agent, next.model, agent.preset.tier, 'escalation', reason, true)
  }

  /** Route đang cấu hình cho một agent, sắp theo priority tăng dần. */
  routesFor(agent: ResolvedAgent): ModelRouteRecord[] {
    return this.llm
      .listRoutes(agent.companyId)
      .filter((route) => route.agentDefId === agent.agentDef.id)
      .sort((a, b) => a.priority - b.priority)
  }

  /**
   * Chuỗi ứng viên theo đúng thứ tự người dùng cấu hình:
   * model chính (preset) → route theo tier hiện tại → model dự phòng → route tier cao hơn.
   * Khử trùng theo `model.id` để không thử cùng một model hai lần.
   */
  private candidateChain(agent: ResolvedAgent): Candidate[] {
    const out: Candidate[] = []
    const seen = new Set<string>()
    const push = (model: LlmModelRecord | undefined, source: RouteSource, reason: string): void => {
      if (!model || !model.enabled || seen.has(model.id)) return
      seen.add(model.id)
      out.push({ model, source, reason })
    }

    if (agent.preset.modelFk) {
      const explicit = this.registry.findModel(agent.preset.modelFk)
      if (explicit) {
        push(explicit, 'preset', `Preset của ${agent.displayName} chỉ định model ${explicit.label}`)
      }
    } else {
      const routed = this.routeModel(agent, agent.preset.tier)
      if (routed) push(routed, 'route', `Route tier ${agent.preset.tier} của ${agent.role}`)
    }

    for (const fallback of this.fallbacksFor(agent)) {
      const model = this.registry.findModel(fallback.modelFk)
      push(model, 'fallback', `Model dự phòng của ${agent.displayName}`)
    }

    let tier = nextTier(agent.preset.tier)
    while (tier) {
      const routed = this.routeModel(agent, tier)
      if (routed) push(routed, 'escalation', `Route tier cao hơn ${tier} của ${agent.role}`)
      tier = nextTier(tier)
    }
    return out
  }

  private fallbacksFor(agent: ResolvedAgent) {
    return this.llm
      .listModelFallbacks(agent.companyId, agent.agentDef.id)
      .sort((a, b) => a.position - b.position)
  }

  private routeModel(agent: ResolvedAgent, tier: ModelTier): LlmModelRecord | undefined {
    return this.registry.routeModelForTier(agent.companyId, agent.agentDef.id, tier)
  }

  /**
   * Capability guard: model không có `supports_tools` mà lượt chạy cần công cụ thì
   * phải thay. Ưu tiên model dự phòng người dùng đã chọn, rồi model cùng nhà cung cấp
   * để không đổi hạ tầng/khoá. Không lấy model từ nhà cung cấp khác ngoài lựa chọn.
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

    for (const fallback of this.fallbacksFor(agent)) {
      const candidate = this.registry.findModel(fallback.modelFk)
      if (candidate && candidate.enabled && candidate.supportsTools) {
        return this.makeChoice(
          candidate,
          tier,
          'capability_guard',
          `${model.label} không hỗ trợ công cụ; dùng model dự phòng ${candidate.label}`,
        )
      }
    }

    const sameProvider = this.registry.toolCapableModel(agent.companyId, {
      providerId: model.providerId,
      excludeModelIds: [model.id],
    })
    if (!sameProvider) {
      throw needsConfiguration(
        `Model ${model.label} không hỗ trợ gọi công cụ và chưa có model dự phòng nào phù hợp. ` +
          'Chọn model hỗ trợ công cụ trong Cài đặt → Đội agent.',
      )
    }
    const why = `${model.label} không hỗ trợ công cụ; tự chuyển sang ${sameProvider.label} (cùng nhà cung cấp)`
    const combined = reason.length > 0 ? `${reason}. ${why}` : why
    return this.makeChoice(sameProvider, tier, 'capability_guard', combined)
  }

  private makeChoice(model: LlmModelRecord, tier: ModelTier, source: RouteSource, reason: string): ModelChoice {
    return { model, provider: this.registry.providerOf(model), tier, source, reason }
  }
}
