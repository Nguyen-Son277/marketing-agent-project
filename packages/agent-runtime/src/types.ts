/**
 * Kiểu dữ liệu của vòng lặp agent.
 *
 * Vì sao tách khỏi `tool-loop.ts`: orchestrator và server cần import kiểu kết quả mà
 * không muốn kéo theo toàn bộ thân hàm. Đồng thời các cổng phụ thuộc (`ModelChooser`,
 * `AdapterResolver`, `RunMeter`) được khai báo ở đây dưới dạng giao diện tối thiểu —
 * nhờ vậy test chạy được vòng lặp mà không cần SQLite hay mạng.
 */
import type {
  LlmChatRequest,
  LlmChunk,
  LlmMessage,
  LlmModelRecord,
  LlmProviderRecord,
  LlmUsage,
  ModelTier,
  ResolvedAgent,
  RunStatus,
  RuntimeObserver,
  ToolContext,
  ToolDefinition,
} from '@marketing-agent/shared'
import type { BudgetLimits } from '@marketing-agent/llm'

/** Lý do vòng lặp dừng; tách khỏi `RunStatus` để phân biệt "xong" với "hết bước". */
export type AgentStopReason =
  | 'completed'
  | 'max_steps'
  | 'budget'
  | 'output_limit'
  | 'model_error'
  | 'cancelled'

/** Nhật ký một lượt gọi công cụ, đủ để debug mà không cần log toàn bộ hội thoại. */
export interface AgentToolCallLog {
  readonly name: string
  readonly argumentsJson: string
  readonly ok: boolean
  readonly durationMs: number
  readonly error: string | null
}

/** Usage cộng dồn của cả run; khớp cấu trúc `CostSnapshot` của gói llm. */
export interface AgentRunUsage {
  readonly tokensIn: number
  readonly tokensOut: number
  readonly cachedTokens: number
  readonly costUsd: number
  readonly calls: number
}

/** Bản ghi một lần nén context, để caller ghi vào `messages.meta_json`. */
export interface CompactionRecord {
  readonly reason: string
  readonly beforeTokens: number
  readonly afterTokens: number
  readonly compactedMessages: number
  readonly at: string
  readonly summary: string
}

export interface AgentRunResult {
  readonly status: RunStatus
  readonly stopReason: AgentStopReason
  /** Câu trả lời cuối cùng của agent; có thể rỗng nếu model chỉ gọi công cụ. */
  readonly output: string
  readonly steps: number
  readonly toolCalls: readonly AgentToolCallLog[]
  readonly usage: AgentRunUsage
  readonly runId: string | null
  readonly modelId: string | null
  readonly error: string | null
  readonly compactions: readonly CompactionRecord[]
  /**
   * Reasoning the model produced but did not turn into an answer. Non-empty only
   * for reasoning models; the orchestrator uses it to tell "no answer" apart from
   * "no reasoning at all" when reporting a failed run.
   */
  readonly reasoningText: string
}

/** Model đã chọn cho lượt chạy, kèm lý do — dùng để log chi phí. */
export interface ModelChoice {
  readonly model: LlmModelRecord
  readonly provider: LlmProviderRecord
  readonly tier: ModelTier
  readonly source: string
  readonly reason: string
}

/** Giao diện router mà vòng lặp cần; `ModelRouter` của gói llm thoả mãn nó. */
export interface ModelChooser {
  chooseForAgent(agent: ResolvedAgent, options?: { readonly needsTools?: boolean; readonly needsVision?: boolean }): ModelChoice
  escalate(agent: ResolvedAgent, currentModelId: string, options?: { readonly needsTools?: boolean; readonly needsVision?: boolean }): ModelChoice
}

/** Bề mặt tối thiểu của một adapter chat. */
export interface ChatAdapter {
  chat(request: LlmChatRequest): AsyncIterable<LlmChunk>
}

/** Dựng adapter cho model; `ModelRegistry` của gói llm thoả mãn nó. */
export interface AdapterResolver {
  adapterFor(model: LlmModelRecord): ChatAdapter
  /**
   * Mọi cách gọi model này, theo thứ tự ưu tiên — thường là một adapter cho mỗi API
   * key của nhà cung cấp. Vòng lặp thử lần lượt khi một khoá lỗi. Bỏ trống thì chỉ
   * dùng `adapterFor` (test cũ giữ nguyên hành vi).
   */
  adaptersFor?(model: LlmModelRecord): readonly ChatAdapter[]
  selectAdapterFor?(model: LlmModelRecord, options: {
    preferredKeyId?: string | null
    excludeKeyIds?: readonly string[]
  }): { adapter: ChatAdapter; keyId: string | null; keyLabel: string | null; mode: 'failover' | 'round_robin'; blockId?: string } | undefined
  skipFailedKey?(model: LlmModelRecord, keyId: string, blockId?: string): void
}

/** Tham số mở một run để ghi nhận chi phí. */
export interface MeterStartInput {
  readonly companyId: string
  readonly agentDefId: string
  readonly taskId?: string | null
  readonly conversationId?: string | null
  readonly providerId?: string | null
  readonly modelId?: string | null
}

export interface MeterFinishInput {
  readonly status: RunStatus
  readonly steps: number
  readonly latencyMs?: number
  readonly error?: string | null
  readonly modelId?: string | null
}

/** Đồng hồ chi phí của một run; `CostMeter` của gói llm thoả mãn nó. */
export interface RunMeter {
  readonly runId: string | null
  addUsage(model: LlmModelRecord, usage: LlmUsage): unknown
  checkBudget(companyId: string, limits: BudgetLimits): unknown
  snapshot(): AgentRunUsage
  finish(input: MeterFinishInput): void
}

/** Phụ thuộc của vòng lặp; mọi thứ đều thay thế được trong test. */
export interface AgentRuntimeDeps {
  readonly router: ModelChooser
  readonly adapters: AdapterResolver
  /** Tạo đồng hồ chi phí cho mỗi run — mỗi lần gọi phải trả về một đối tượng mới. */
  readonly meterFactory: (input: MeterStartInput) => RunMeter
  /** Cổng test: dùng adapter cố định thay vì hỏi `adapters`. */
  readonly adapter?: ChatAdapter
}

export interface AgentRunInput {
  readonly agent: ResolvedAgent
  /** Ngữ cảnh tenant + run mà mọi công cụ nhận được. */
  readonly context: ToolContext
  /** Lịch sử hội thoại, không gồm system prompt. */
  readonly messages?: readonly LlmMessage[]
  /** Công cụ agent được cấp; ngoài danh sách này bị hệ thống từ chối. */
  readonly tools: readonly ToolDefinition[]
  /** Bỏ trống thì `runAgent` tự dựng bằng `buildSystemPrompt`. */
  readonly systemPrompt?: string
  readonly maxSteps?: number
  readonly maxOutputTokens?: number
  readonly budget?: BudgetLimits | null
  readonly temperature?: number
  readonly signal?: AbortSignal
  readonly toolTimeoutMs?: number
  /** Metadata-only lifecycle observer; failures must never interrupt the run. */
  readonly observe?: RuntimeObserver
}
