/**
 * Hợp đồng API mà giao diện web dựa vào.
 *
 * Vì sao tệp này tồn tại: tầng route (`apps/server/src/routes`) và giao diện
 * (`apps/web`) được phát triển song song. Hai bên chỉ khớp nhau nếu hình dạng dữ
 * liệu được chốt trước. Đây là bản chốt đó — sửa ở đây là sửa hợp đồng, phải cập
 * nhật cả hai phía.
 *
 * Quy ước chung:
 *  - Mọi phản hồi thành công là JSON (trừ SSE và tệp tĩnh).
 *  - Mọi lỗi có dạng `{ error: { code, message, details? } }`, `code` là một trong
 *    các giá trị của `AppErrorCode` trong packages/shared/src/errors.ts.
 *  - `companyId` KHÔNG bao giờ nằm trong body của thao tác ghi; nó đến từ đường dẫn
 *    và được kiểm tra membership trước khi handler chạy.
 */

import type {
  AgentRole,
  ArtifactKind,
  CompanyRole,
  ConversationPhase,
  IntegrationKind,
  MessageAuthorKind,
  ModelTier,
  ProviderKind,
  RunStatus,
  TaskStatus,
} from '@marketing-agent/shared'

/* ------------------------------------------------------------------ chung */

export interface ErrorEnvelope {
  readonly error: {
    readonly code: string
    /** Đã dịch theo `Accept-Language` của yêu cầu. */
    readonly message: string
    /**
     * Khoá dịch, để trình duyệt dịch lại theo ngôn ngữ giao diện đang chọn.
     *
     * Vì sao cần cả hai: `Accept-Language` chỉ được gửi lúc gọi API, còn người dùng có
     * thể đổi ngôn ngữ sau đó mà không gọi lại. Có khoá thì giao diện dịch được ngay.
     */
    readonly messageKey?: string
    readonly messageParams?: Record<string, string | number>
    readonly details?: unknown
  }
}

export interface CompanySummary {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly role: CompanyRole
}

export interface MeResponse {
  readonly user: { readonly id: string; readonly email: string; readonly name: string; readonly isAdmin: boolean }
  readonly companies: readonly CompanySummary[]
}

/* ------------------------------------------------------------------- team */

/** Một agent trong đội, đã ghép định nghĩa + cấu hình riêng của công ty. */
export interface TeamMemberView {
  readonly agentDefId: string
  readonly role: AgentRole
  readonly name: string
  readonly displayName: string
  readonly description: string
  readonly enabled: boolean
  readonly isLeader: boolean
  readonly tier: ModelTier
  /**
   * `llm_models.id` of the preset's explicit model, or null when the agent relies
   * on a tier route. This is the value a client must send back to change the model,
   * so it is exposed directly rather than only via `modelLabel`.
   */
  readonly modelFk: string | null
  readonly modelId: string | null
  readonly modelLabel: string | null
  readonly providerName: string | null
  readonly reasoningEffort: string | null
  readonly maxTokens: number | null
  readonly contextBudgetTokens: number
  readonly requireApproval: boolean
  readonly skills: readonly { readonly name: string; readonly description: string; readonly category: string }[]
  readonly tools: readonly string[]
  readonly knowledge: readonly { readonly category: string; readonly canRead: boolean; readonly canWrite: boolean }[]
}

export interface TeamResponse {
  readonly members: readonly TeamMemberView[]
  /** Toàn bộ kỹ năng hệ thống biết, để giao diện cho chọn. */
  readonly availableSkills: readonly { readonly name: string; readonly description: string; readonly category: string }[]
  /** Tool khả dụng trong bản triển khai này, kèm tool nào cần phê duyệt. */
  readonly availableTools: readonly { readonly name: string; readonly description: string; readonly requiresApproval: boolean }[]
  readonly models: readonly ModelOptionView[]
}

export interface ModelOptionView {
  readonly id: string
  readonly modelId: string
  readonly label: string
  readonly providerName: string
  readonly contextWindow: number
  readonly supportsTools: boolean
  readonly costInPerMtok: number
  readonly costOutPerMtok: number
}

/**
 * Body cho các thao tác ghi ở màn Cài đặt. Ghi ra đây vì cả hai phía phải dùng
 * đúng tên trường; đây là hợp đồng, không phải chi tiết nội bộ.
 */
export interface CreateProviderBody {
  readonly name: string
  readonly kind: ProviderKind
  readonly baseUrl: string
  /** Chỉ gửi khi tạo hoặc khi muốn thay khoá; server không bao giờ trả lại giá trị này. */
  readonly apiKey?: string
  readonly extra?: Record<string, unknown>
  readonly enabled?: boolean
}

export interface CreateModelBody {
  readonly providerId: string
  readonly modelId: string
  readonly label: string
  readonly contextWindow?: number
  readonly maxOutput?: number
  readonly supportsTools?: boolean
  readonly supportsVision?: boolean
  readonly costInPerMtok?: number
  readonly costOutPerMtok?: number
}

/** Route theo tier: agent nào dùng model nào cho mức năng lực nào. */
export interface UpsertRouteBody {
  readonly agentDefId: string
  readonly tier: ModelTier
  readonly modelFk: string
  readonly reasoningEffort?: string | null
  readonly maxTokens?: number | null
  readonly priority?: number
}

/** Body cập nhật một agent trong đội; khớp `updateTeamMemberSchema` ở shared. */
export interface UpdateTeamMemberBody {
  readonly enabled?: boolean
  readonly modelFk?: string | null
  readonly tier?: ModelTier
  readonly reasoningEffort?: string | null
  readonly maxTokens?: number | null
  readonly contextBudgetTokens?: number
  readonly requireApproval?: boolean
  readonly skills?: readonly string[]
  readonly tools?: readonly string[]
  readonly knowledge?: readonly { readonly category: string; readonly canRead: boolean; readonly canWrite: boolean }[]
}

export interface UpsertIntegrationBody {
  readonly kind: IntegrationKind
  readonly name: string
  /** Bí mật của tích hợp; server mã hoá trước khi lưu và không trả lại. */
  readonly config: Record<string, unknown>
}

/* -------------------------------------------------------------- knowledge */

export interface KnowledgeDocumentView {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly category: string
  readonly tags: readonly string[]
  readonly version: number
  readonly source: string
  readonly updatedAt: string
  /** Đã có vector chưa; false nghĩa là tìm kiếm chỉ dùng từ khoá. */
  readonly indexed: boolean
  /**
   * Nội dung Markdown đầy đủ. Danh sách tài liệu LUÔN kèm nội dung: tài liệu trong
   * kho là văn bản nhỏ, và như vậy giao diện không cần một lượt gọi riêng cho mỗi
   * lần chọn tài liệu.
   */
  readonly content: string
}

export interface KnowledgeResponse {
  readonly documents: readonly KnowledgeDocumentView[]
  readonly categories: readonly { readonly code: string; readonly label: string; readonly count: number }[]
  readonly stats: { readonly documents: number; readonly chunks: number; readonly embedded: number }
}

export interface ReindexResponse {
  readonly indexed: number
  readonly skipped: number
  readonly chunks: number
  readonly errors: readonly string[]
}

/* ------------------------------------------------------------------- chat */

export interface ConversationView {
  readonly id: string
  readonly title: string
  /** Ngôn ngữ agent trả lời trong phiên này (`'vi'` hoặc `'en'`). */
  readonly language: string
  readonly phase: ConversationPhase
  readonly briefComplete: boolean
  readonly missingFields: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly costUsd: number
}

export interface MessageView {
  readonly id: string
  readonly role: 'user' | 'assistant' | 'system'
  readonly authorKind: MessageAuthorKind
  readonly authorAgent: string | null
  readonly contentMd: string
  readonly meta: unknown
  readonly tokensIn: number
  readonly tokensOut: number
  readonly costUsd: number
  readonly createdAt: string
}

/** Kết quả một lượt gửi tin: câu trả lời của Leader kèm trạng thái brief. */
export interface SendMessageResponse {
  readonly conversation: ConversationView
  readonly reply: MessageView
  readonly briefComplete: boolean
  readonly missingFields: readonly string[]
  readonly phase: ConversationPhase
  readonly costUsd: number
}

export interface ConversationDetailResponse {
  readonly conversation: ConversationView
  readonly messages: readonly MessageView[]
  readonly tasks: readonly TaskView[]
  readonly costUsd: number
  readonly usage: { readonly tokensIn: number; readonly tokensOut: number; readonly runs: number }
}

/** Sự kiện đẩy qua SSE. `type` khớp `OrchestratorEventType` trong orchestrator. */
export type StreamEventType =
  | 'leader.thinking'
  | 'leader.replied'
  | 'brief.updated'
  | 'plan.created'
  | 'task.updated'
  | 'agent.started'
  | 'tool.called'
  | 'artifact.created'
  | 'agent.message'
  | 'review.completed'
  | 'report.created'
  | 'warning'

/* ------------------------------------------------------------------ tasks */

export interface TaskView {
  readonly id: string
  readonly title: string
  readonly briefMd: string
  readonly status: TaskStatus
  readonly priority: number
  readonly assigneeRole: AgentRole | null
  readonly assigneeName: string | null
  readonly dependsOn: readonly string[]
  readonly blocks: readonly string[]
  readonly resultMd: string | null
  readonly deliverableSpec: string | null
  readonly revisionCount: number
  readonly deadline: string | null
  readonly artifactIds: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface TaskDetailResponse {
  readonly task: TaskView
  readonly events: readonly { readonly id: string; readonly kind: string; readonly payload: unknown; readonly createdAt: string }[]
  readonly artifacts: readonly ArtifactView[]
  readonly messages: readonly { readonly id: string; readonly fromAgent: string; readonly toAgent: string; readonly kind: string; readonly contentMd: string; readonly createdAt: string }[]
}

export interface TaskListResponse {
  readonly tasks: readonly TaskView[]
  readonly counts: Readonly<Record<TaskStatus, number>>
}

export interface ArtifactView {
  readonly id: string
  readonly taskId: string | null
  readonly name: string
  readonly kind: ArtifactKind
  readonly content: string | null
  readonly path: string | null
  readonly meta: unknown
  readonly createdAt: string
}

/** Phê duyệt hoặc yêu cầu sửa một công việc đang chờ review. */
export interface ReviewTaskResponse {
  readonly task: TaskView
  readonly decision: 'approve' | 'request_changes' | 'cancel'
}

/* --------------------------------------------------------------- settings */

export interface ProviderView {
  readonly id: string
  readonly name: string
  readonly kind: ProviderKind
  readonly baseUrl: string
  readonly enabled: boolean
  readonly isGlobal: boolean
  readonly apiKeyConfigured: boolean
  readonly apiKeyHint: string | null
  readonly models: readonly ModelOptionView[]
}

export interface ProvidersResponse {
  readonly providers: readonly ProviderView[]
}

export interface ProviderTestResponse {
  readonly ok: boolean
  readonly message: string
  readonly latencyMs: number
  readonly modelsSeen?: number
}

export interface IntegrationTestResponse {
  readonly ok: boolean
  readonly message: string
  readonly status: string
  readonly latencyMs: number
}

export interface IntegrationView {
  readonly id: string
  readonly kind: IntegrationKind
  readonly name: string
  readonly status: string
  readonly configured: boolean
  readonly lastCheckAt: string | null
}

export interface IntegrationsResponse {
  readonly integrations: readonly IntegrationView[]
}

export interface ModelRouteView {
  readonly id: string
  readonly agentDefId: string
  readonly role: AgentRole
  readonly tier: ModelTier
  readonly modelFk: string
  readonly modelLabel: string
  readonly reasoningEffort: string | null
  readonly maxTokens: number | null
  readonly priority: number
}

export interface LimitsView {
  readonly dailyCostUsd: number
  readonly taskCostUsd: number
  readonly maxStepsPerRun: number
  readonly maxPeerRounds: number
  readonly maxRevisionsPerTask: number
  readonly maxParallelTasks: number
  /** Chi phí đã dùng trong 24 giờ qua, để giao diện vẽ thanh tiến độ. */
  readonly usedTodayUsd: number
}

/* ------------------------------------------------------------------ costs */

export interface CostDayRow {
  readonly day: string
  readonly agentDefId: string
  readonly modelId: string
  readonly tokensIn: number
  readonly tokensOut: number
  readonly costUsd: number
  readonly runs: number
}

export interface CostAgentRow {
  readonly agentDefId: string
  readonly costUsd: number
  readonly runs: number
  readonly tokens: number
}

export interface CostsResponse {
  readonly totals: { readonly tokensIn: number; readonly tokensOut: number; readonly costUsd: number; readonly runs: number }
  readonly daily: readonly CostDayRow[]
  readonly byAgent: readonly CostAgentRow[]
  readonly runs: readonly RunView[]
}

export interface RunView {
  readonly id: string
  readonly taskId: string | null
  readonly agentDefId: string
  readonly modelId: string | null
  readonly status: RunStatus
  readonly tokensIn: number
  readonly tokensOut: number
  readonly costUsd: number
  readonly latencyMs: number
  readonly steps: number
  readonly error: string | null
  readonly createdAt: string
}

/* ----------------------------------------------------------------- sơ đồ */

/** Một nút trong sơ đồ đội agent. */
export interface DiagramNode {
  readonly id: string
  readonly role: AgentRole
  readonly label: string
  readonly layer: 'leader' | 'research' | 'content' | 'channel' | 'measure'
  readonly enabled: boolean
  readonly modelLabel: string | null
  readonly tier: ModelTier
  readonly skills: readonly string[]
  readonly tools: readonly string[]
  readonly knowledgeRead: readonly string[]
  readonly knowledgeWrite: readonly string[]
}

export interface DiagramEdge {
  readonly from: string
  readonly to: string
  readonly kind: 'delegates' | 'hands_off' | 'peer' | 'reads' | 'uses'
  readonly label?: string
}

export interface DiagramResponse {
  readonly nodes: readonly DiagramNode[]
  readonly edges: readonly DiagramEdge[]
  readonly workflow: readonly { readonly id: string; readonly title: string; readonly description: string }[]
  readonly knowledge: readonly { readonly code: string; readonly label: string; readonly owners: readonly AgentRole[] }[]
}

/* -------------------------------------------------------------- dashboard */

export interface DashboardResponse {
  readonly company: { readonly id: string; readonly name: string; readonly slug: string; readonly role: CompanyRole }
  readonly counts: {
    readonly tasks: Readonly<Record<TaskStatus, number>>
    readonly conversations: number
    readonly documents: number
    readonly agentsEnabled: number
    readonly agentsTotal: number
  }
  readonly cost: { readonly today: number; readonly last30Days: number; readonly limitPerDay: number }
  readonly recentActivity: readonly { readonly at: string; readonly kind: string; readonly summary: string }[]
}

/* --------------------------------------------------------- system status */

export interface SystemStatusResponse {
  readonly ready: boolean
  readonly catalog: {
    readonly ready: boolean
    readonly agentDefs: number
    readonly skills: number
    readonly models: number
    readonly problem?: string
  }
  readonly appliedMigrations: readonly string[]
}

/**
 * Tập hợp endpoint. Giao diện dùng hằng số này thay vì ghép chuỗi rải rác, để một
 * thay đổi đường dẫn chỉ phải sửa một chỗ.
 */
export const API_ROUTES = {
  register: '/api/auth/register',
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  me: '/api/auth/me',
  companies: '/api/companies',
  company: (id: string) => `/api/companies/${id}`,
  members: (id: string) => `/api/companies/${id}/members`,
  team: (id: string) => `/api/companies/${id}/team`,
  teamMember: (id: string, role: string) => `/api/companies/${id}/team/${role}`,
  knowledge: (id: string) => `/api/companies/${id}/knowledge`,
  knowledgeDoc: (id: string, docId: string) => `/api/companies/${id}/knowledge/${docId}`,
  knowledgeReindex: (id: string) => `/api/companies/${id}/knowledge/reindex`,
  knowledgeJobs: (id: string) => `/api/companies/${id}/knowledge/jobs`,
  knowledgeStats: (id: string) => `/api/companies/${id}/knowledge/stats`,
  conversations: (id: string) => `/api/companies/${id}/conversations`,
  conversation: (id: string) => `/api/conversations/${id}`,
  conversationMessages: (id: string) => `/api/conversations/${id}/messages`,
  conversationStream: (id: string) => `/api/conversations/${id}/stream`,
  conversationPlan: (id: string) => `/api/conversations/${id}/plan`,
  conversationRun: (id: string) => `/api/conversations/${id}/run`,
  conversationReport: (id: string) => `/api/conversations/${id}/report`,
  tasks: (id: string) => `/api/companies/${id}/tasks`,
  task: (taskId: string) => `/api/tasks/${taskId}`,
  taskReview: (taskId: string) => `/api/tasks/${taskId}/review`,
  artifacts: (id: string) => `/api/companies/${id}/artifacts`,
  artifact: (artifactId: string) => `/api/artifacts/${artifactId}`,
  providers: (id: string) => `/api/companies/${id}/providers`,
  provider: (id: string, providerId: string) => `/api/companies/${id}/providers/${providerId}`,
  providerTest: (id: string, providerId: string) => `/api/companies/${id}/providers/${providerId}/test`,
  models: (id: string) => `/api/companies/${id}/models`,
  model: (id: string, modelId: string) => `/api/companies/${id}/models/${modelId}`,
  routes: (id: string) => `/api/companies/${id}/routes`,
  integrations: (id: string) => `/api/companies/${id}/integrations`,
  integration: (id: string, integrationId: string) => `/api/companies/${id}/integrations/${integrationId}`,
  integrationTest: (id: string, integrationId: string) => `/api/companies/${id}/integrations/${integrationId}/test`,
  limits: (id: string) => `/api/companies/${id}/limits`,
  costs: (id: string) => `/api/companies/${id}/costs`,
  runs: (id: string) => `/api/companies/${id}/runs`,
  audit: (id: string) => `/api/companies/${id}/audit`,
  diagram: (id: string) => `/api/companies/${id}/diagram`,
  dashboard: (id: string) => `/api/companies/${id}/dashboard`,
  systemStatus: '/api/system/status',
  health: '/healthz',
  ready: '/readyz',
} as const
