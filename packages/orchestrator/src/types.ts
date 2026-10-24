/**
 * Kiểu dữ liệu của tầng điều phối.
 *
 * Vì sao khai báo `OrchestratorDeps` dưới dạng giao diện thay vì truyền thẳng
 * `Repos`: orchestrator cần rất nhiều mảnh (LLM, kho kiến thức, tool, sự kiện),
 * nhưng test phải chạy được mà không cần mạng hay gateway. Giao diện hẹp cho phép
 * thay từng mảnh bằng đối tượng giả, và cũng là hợp đồng rõ ràng cho server.
 */
import type { Repos } from '@marketing-agent/db'
import type { EmbeddingProvider } from '@marketing-agent/kb'
import type { ToolRegistry } from '@marketing-agent/tools'
import type { ClarificationRequest, LlmImage } from '@marketing-agent/shared'
import type { AgentRunResult } from '@marketing-agent/agent-runtime'
import type { AppEvent } from './events.ts'

/** Sáu trường bắt buộc của một brief; thiếu trường nào thì chưa được lập kế hoạch. */
export interface Brief {
  readonly objective: string
  readonly kpi: string
  readonly scope: string
  readonly deadline: string
  readonly budget: string
  readonly constraints: string
}

export const BRIEF_FIELDS: readonly (keyof Brief)[] = [
  'objective',
  'kpi',
  'scope',
  'deadline',
  'budget',
  'constraints',
]

/** Nhãn tiếng Việt của từng trường, dùng khi hỏi lại người dùng. */
export const BRIEF_FIELD_LABELS: Readonly<Record<keyof Brief, string>> = {
  objective: 'Mục tiêu (kết quả kinh doanh mong muốn)',
  kpi: 'KPI (chỉ số đo được + mốc thời gian)',
  scope: 'Phạm vi (làm gì, và KHÔNG làm gì)',
  deadline: 'Thời hạn',
  budget: 'Ngân sách (tiền và/hoặc số giờ người)',
  constraints: 'Ràng buộc (thương hiệu, pháp lý, kênh bắt buộc)',
}

/** Kết quả một lượt trao đổi với Leader. */
export interface LeaderTurnResult {
  readonly reply: string
  readonly phase: string
  /** Brief đã đủ 6 trường hay chưa. */
  readonly briefComplete: boolean
  /** Trường còn thiếu, để giao diện hỏi đúng chỗ. */
  readonly missingFields: readonly (keyof Brief)[]
  /**
   * Câu hỏi có cấu trúc của lượt này, chỉ có khi brief còn thiếu.
   *
   * Vì sao trả kèm ở đây chứ không bắt tầng HTTP đọc lại `meta` của tin nhắn: `meta` là
   * `unknown` và không có hợp đồng kiểu; trả thẳng từ nguồn sinh ra nó thì route chỉ việc
   * chuyển tiếp, còn lịch sử tin nhắn vẫn lấy được qua `MessageView.clarify`.
   */
  readonly clarify?: ClarificationRequest
  readonly plan?: PlanResult
  readonly runId: string | null
  readonly costUsd: number
}

export interface PlannedTask {
  readonly id: string
  readonly title: string
  readonly assigneeRole: string
  readonly dependsOn: readonly string[]
}

export interface PlanResult {
  readonly tasks: readonly PlannedTask[]
  /** Thứ tự thi hành đã kiểm tra không có chu trình. */
  readonly order: readonly string[]
}

/** Kết quả một task sau khi chuyên môn chạy xong. */
export interface TaskOutcome {
  readonly taskId: string
  readonly title: string
  readonly assigneeRole: string
  readonly status: 'done' | 'blocked' | 'failed' | 'cancelled'
  readonly resultMd: string
  readonly artifactIds: readonly string[]
  readonly run: AgentRunResult | null
  readonly reason?: string
}

export interface DispatchSummary {
  readonly outcomes: readonly TaskOutcome[]
  readonly completed: number
  readonly blocked: number
  readonly failed: number
}

export interface ReviewDecision {
  readonly verdict: 'pass' | 'revise'
  readonly noteMd: string
  readonly issues: readonly string[]
}

export interface ReportResult {
  readonly markdown: string
  readonly artifactId: string
  readonly costUsd: number
}

/** Giới hạn vận hành; đọc từ `app_settings` với giá trị mặc định trong seed. */
export interface OrchestratorLimits {
  readonly dailyCostUsd: number
  readonly taskCostUsd: number
  readonly maxStepsPerRun: number
  readonly maxPeerRounds: number
  readonly maxRevisionsPerTask: number
  readonly maxParallelTasks: number
}

/**
 * Toàn bộ phụ thuộc của tầng điều phối. `repos` là mảnh duy nhất bắt buộc phải
 * thật; ba mảnh còn lại có thể là giả trong test.
 */
export interface OrchestratorDeps {
  readonly repos: Repos
  readonly tools: ToolRegistry
  /** Thiếu embedding thì truy xuất chỉ dùng từ khoá — vẫn hoạt động. */
  readonly embedding?: EmbeddingProvider | undefined
  readonly limits?: Partial<OrchestratorLimits>
  /** Phát sự kiện cho SSE; bỏ trống thì không phát. */
  readonly publish?: ((event: AppEvent) => void) | undefined
  /** Ghi log chẩn đoán; bỏ trống thì im lặng. */
  readonly log?: ((message: string, data?: unknown) => void) | undefined
  /**
   * Ghi lại một payload chẩn đoán dài (ví dụ nguyên văn bảng kế hoạch mà parser
   * không đọc được). Tầng điều phối không tự quyết định chỗ ghi: môi trường triển
   * khai biết chỗ nào ghi được, và test có thể bỏ qua.
   */
  readonly writeDiagnostic?:
    | ((name: string, content: string) => void | Promise<void>)
    | undefined
  /** Ghi đè tham số chạy agent, dùng trong test để chèn adapter giả. */
  readonly runtimeOverrides?: Partial<Pick<import('@marketing-agent/agent-runtime').AgentRuntimeDeps, 'adapter' | 'adapters' | 'router' | 'meterFactory'>> | undefined
  /** Product-image context loader. Descriptions are always supplied; raw bytes only when the selected model supports vision. */
  readonly productImageContext?: ((companyId: string, query: string, includeImages: boolean, limit: number) => Promise<{ context: string; images: readonly LlmImage[] }>) | undefined
}

export const DEFAULT_LIMITS: OrchestratorLimits = {
  dailyCostUsd: 20,
  taskCostUsd: 2,
  maxStepsPerRun: 12,
  maxPeerRounds: 3,
  maxRevisionsPerTask: 2,
  maxParallelTasks: 3,
}
