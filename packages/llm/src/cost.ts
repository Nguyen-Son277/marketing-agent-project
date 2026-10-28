/**
 * Đồng hồ đo chi phí cho một lượt chạy agent.
 *
 * Vì sao tách khỏi vòng lặp tool: chi phí phải được cộng dồn theo *từng model*, vì
 * một run có thể đổi model khi escalate. Đồng thời hạn mức ngày được kiểm tra trước
 * mỗi lượt gọi model — chặn trước khi tiêu tiền luôn rẻ hơn chặn sau. `usage_daily`
 * do `AccountingRepo.finishRun` rollup, nên ở đây chỉ cần mở/cộng/đóng đúng một lần.
 */
import {
  AppError,
  budgetExceeded,
  round,
  type LlmModelRecord,
  type LlmUsage,
  type RunRecord,
  type RunStatus,
} from '@marketing-agent/shared'
import { computeCostUsd, type AccountingRepo, type UsageSummary } from '@marketing-agent/db'

export interface OpenRunInput {
  readonly companyId: string
  readonly agentDefId: string
  readonly taskId?: string | null
  readonly conversationId?: string | null
  readonly providerId?: string | null
  readonly modelId?: string | null
}

export interface FinishRunInput {
  readonly status: RunStatus
  readonly steps: number
  readonly latencyMs?: number
  readonly error?: string | null
  readonly modelId?: string | null
}

/** Hạn mức chi phí; trường bỏ trống nghĩa là không giới hạn theo tiêu chí đó. */
export interface BudgetLimits {
  readonly dailyCostUsd?: number
  readonly taskCostUsd?: number
}

export interface BudgetStatus {
  readonly allowed: boolean
  readonly spentTodayUsd: number
  readonly spentThisRunUsd: number
  readonly remainingTodayUsd: number | null
  readonly remainingTaskUsd: number | null
}

/** Ảnh chụp usage cộng dồn của một run. */
export interface CostSnapshot {
  readonly tokensIn: number
  readonly tokensOut: number
  readonly cachedTokens: number
  readonly costUsd: number
  readonly calls: number
}

/**
 * Giao diện tối thiểu mà vòng lặp agent cần. `CostMeter` thoả mãn nó, còn test có
 * thể thay bằng đồng hồ giả mà không phải dựng SQLite.
 */
export interface RunMeter {
  readonly runId: string | null
  addUsage(model: LlmModelRecord, usage: LlmUsage): unknown
  checkBudget(companyId: string, limits: BudgetLimits): unknown
  snapshot(): CostSnapshot
  finish(input: FinishRunInput): void
}

/** Mốc đầu ngày theo UTC, khớp với `dayKey` mà `usage_daily` dùng. */
export function startOfUtcDayIso(at: Date = new Date()): string {
  return `${at.toISOString().slice(0, 10)}T00:00:00.000Z`
}

export class CostMeter implements RunMeter {
  private runIdValue: string | null = null
  private finished = false
  private lastModelId: string | null = null
  private budgetScope: {companyId:string;limits:BudgetLimits} | null = null
  private totals: CostSnapshot = { tokensIn: 0, tokensOut: 0, cachedTokens: 0, costUsd: 0, calls: 0 }

  constructor(private readonly accounting: AccountingRepo) {}

  /** Mở một run mới. Gọi lại sẽ thay run cũ — mỗi `CostMeter` phục vụ đúng một run. */
  open(input: OpenRunInput): string {
    this.runIdValue = this.accounting.startRun({
      companyId: input.companyId,
      taskId: input.taskId ?? null,
      conversationId: input.conversationId ?? null,
      agentDefId: input.agentDefId,
      providerId: input.providerId ?? null,
      modelId: input.modelId ?? null,
    })
    this.finished = false
    this.budgetScope = {companyId:input.companyId,limits:this.accounting.notificationBudgetLimits(input.companyId)}
    this.totals = {tokensIn:0,tokensOut:0,cachedTokens:0,costUsd:0,calls:0}
    this.lastModelId = input.modelId ?? null
    return this.runIdValue
  }

  get runId(): string | null {
    return this.runIdValue
  }

  /** Cộng usage của một lượt gọi model và trả về ảnh chụp mới nhất. */
  addUsage(model: LlmModelRecord, usage: LlmUsage): CostSnapshot {
    this.totals = {
      tokensIn: this.totals.tokensIn + usage.promptTokens,
      tokensOut: this.totals.tokensOut + usage.completionTokens,
      cachedTokens: this.totals.cachedTokens + usage.cachedTokens,
      costUsd: round(this.totals.costUsd + computeCostUsd(model, usage.promptTokens, usage.completionTokens), 6),
      calls: this.totals.calls + 1,
    }
    this.lastModelId = model.id
    if(this.budgetScope && this.runIdValue) this.accounting.observeBudget(this.budgetScope.companyId,this.runIdValue,this.totals.costUsd,this.budgetScope.limits)
    return this.snapshot()
  }

  snapshot(): CostSnapshot {
    return { ...this.totals }
  }

  spentToday(companyId: string): UsageSummary {
    return this.accounting.usageSince(companyId, startOfUtcDayIso())
  }

  /**
   * Kiểm tra hạn mức trước khi gọi model. Ném `budget_exceeded` khi vượt; nếu chưa
   * vượt thì trả về số liệu để caller log. Chi phí đang chạy được cộng thêm vì run
   * hiện tại chưa nằm trong `usage_daily` cho tới khi đóng.
   */
  checkBudget(companyId: string, limits: BudgetLimits): BudgetStatus {
    this.budgetScope={companyId,limits}
    if(this.runIdValue) this.accounting.observeBudget(companyId,this.runIdValue,this.totals.costUsd,limits)
    const today = this.spentToday(companyId)
    const runCost = this.finished ? 0 : this.totals.costUsd
    const spentTodayUsd = round(today.costUsd + runCost, 6)

    if (limits.dailyCostUsd !== undefined && limits.dailyCostUsd > 0 && spentTodayUsd > limits.dailyCostUsd) {
      throw budgetExceeded(
        `Đã vượt hạn mức chi phí trong ngày (${spentTodayUsd} / ${limits.dailyCostUsd} USD). Hãy chờ sang ngày mới hoặc nâng hạn mức.`,
        { spentTodayUsd, dailyCostUsd: limits.dailyCostUsd },
      )
    }
    if (limits.taskCostUsd !== undefined && limits.taskCostUsd > 0 && runCost > limits.taskCostUsd) {
      throw budgetExceeded(
        `Lượt chạy này đã vượt hạn mức chi phí cho một việc (${runCost} / ${limits.taskCostUsd} USD).`,
        { spentThisRunUsd: runCost, taskCostUsd: limits.taskCostUsd },
      )
    }

    return {
      allowed: true,
      spentTodayUsd,
      spentThisRunUsd: runCost,
      remainingTodayUsd:
        !limits.dailyCostUsd || limits.dailyCostUsd <= 0 ? null : round(Math.max(0, limits.dailyCostUsd - spentTodayUsd), 6),
      remainingTaskUsd:
        !limits.taskCostUsd || limits.taskCostUsd <= 0 ? null : round(Math.max(0, limits.taskCostUsd - runCost), 6),
    }
  }

  /** Đóng run và ghi bản ghi bất biến; `usage_daily` được rollup trong cùng transaction. */
  finish(input: FinishRunInput): RunRecord {
    if (!this.runIdValue) throw new AppError('internal', 'Chưa mở lượt chạy trước khi đóng')
    const record = this.accounting.finishRun(this.runIdValue, {
      status: input.status,
      tokensIn: this.totals.tokensIn,
      tokensOut: this.totals.tokensOut,
      costUsd: this.totals.costUsd,
      latencyMs: input.latencyMs ?? 0,
      steps: input.steps,
      error: input.error ?? null,
      modelId: input.modelId ?? this.lastModelId,
    })
    this.finished = true
    return record
  }
}
