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

/**
 * Đổi tên hiển thị của công ty.
 *
 * Cố ý KHÔNG cho đổi `slug`: slug là tên thư mục kho kiến thức trên đĩa
 * (`<kbRoot>/<slug>/kb`) và là khoá tra cứu tài liệu đã index. Đổi slug sẽ làm mồ côi
 * toàn bộ tài liệu đang có, nên tên hiển thị và đường dẫn tách rời nhau có chủ đích.
 */
export interface UpdateCompanyBody {
  readonly name: string
}

export interface CompanySummary {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly role: CompanyRole
}

export interface MeResponse {
  readonly user: {
    readonly id: string
    readonly email: string
    readonly name: string
    readonly isAdmin: boolean
    readonly approvalStatus: 'pending' | 'approved'
    readonly accountType: 'user' | 'employee'
    readonly mustChangePassword: boolean
  }
  readonly companies: readonly CompanySummary[]
}

export type AdminUserView = MeResponse['user'] & {
  readonly createdAt: string
  readonly approvedAt: string | null
}

export interface AdminUsersResponse {
  readonly users: readonly AdminUserView[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
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
  /**
   * Model dự phòng theo thứ tự dùng khi model chính lỗi. Rỗng nghĩa là không cấu hình;
   * hệ thống KHÔNG tự chọn hộ.
   */
  readonly fallbackModelFks: readonly string[]
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
  /** `id` của nhà cung cấp. Nhờ nó giao diện tách được hai model trùng mã khác URL. */
  readonly providerId: string
  readonly providerName: string
  readonly enabled: boolean
  readonly contextWindow: number
  readonly supportsTools: boolean
  readonly costInPerMtok: number
  readonly costOutPerMtok: number
  /** Số route/preset/fallback đang tham chiếu model; > 0 thì không xoá được. */
  readonly usedByAgentCount: number
}

/**
 * Body cho các thao tác ghi ở màn Cài đặt. Ghi ra đây vì cả hai phía phải dùng
 * đúng tên trường; đây là hợp đồng, không phải chi tiết nội bộ.
 */
export interface CreateProviderBody {
  readonly name: string
  readonly kind: ProviderKind
  readonly baseUrl: string
  /** Khoá đầu tiên, tuỳ chọn. Chỉ gửi khi tạo; server không bao giờ trả lại giá trị này. */
  readonly apiKey?: string
  readonly apiKeyLabel?: string
  readonly extra?: Record<string, unknown>
  readonly enabled?: boolean
}

/** Sửa provider không nhận khoá: khoá được quản lý riêng, từng khoá một. */
export interface UpdateProviderBody {
  readonly name?: string
  readonly kind?: ProviderKind
  readonly baseUrl?: string
  readonly extra?: Record<string, unknown>
  readonly enabled?: boolean
}

/** Khoá API như giao diện thấy: có nhãn và gợi ý, không bao giờ có giá trị gốc. */
export interface ProviderKeyView {
  readonly id: string
  readonly label: string
  readonly hint: string | null
  readonly priority: number
  readonly enabled: boolean
}

export interface CreateProviderKeyBody {
  readonly label: string
  readonly apiKey: string
  readonly priority?: number
  readonly enabled?: boolean
}

export interface UpdateProviderKeyBody {
  readonly label?: string
  readonly apiKey?: string
  readonly priority?: number
  readonly enabled?: boolean
}

/** Một model đọc được từ `GET {baseUrl}/models`, chưa lưu vào DB. */
export interface FetchedModelView {
  readonly modelId: string
  readonly label: string
  /** Đã có trong DB của nhà cung cấp này chưa, để giao diện khoá lựa chọn trùng. */
  readonly alreadyAdded: boolean
}

export interface FetchModelsResponse {
  readonly ok: boolean
  readonly message: string
  readonly latencyMs: number
  readonly models: readonly FetchedModelView[]
}

export interface ImportModelsBody {
  readonly models: readonly {
    readonly modelId: string
    readonly label?: string
    readonly contextWindow?: number
    readonly maxOutput?: number
    readonly supportsTools?: boolean
    readonly supportsVision?: boolean
    readonly costInPerMtok?: number
    readonly costOutPerMtok?: number
  }[]
}

export interface ImportModelsResponse {
  readonly created: readonly ModelOptionView[]
  readonly skipped: readonly string[]
}

export interface PurgeModelsResponse {
  readonly deleted: number
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
  /** Danh sách model dự phòng theo thứ tự dùng; gửi `[]` để xoá hết. */
  readonly fallbackModelFks?: readonly string[]
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
  /**
   * Thẻ chọn phương án, nếu tin nhắn này là một câu hỏi làm rõ.
   *
   * Suy ra từ `meta` ở tầng API thay vì để giao diện tự đọc `meta`: `meta` là `unknown`
   * và đã được dùng cho việc khác, nên giao diện đọc thẳng vào đó sẽ vỡ im lặng mỗi khi
   * hình dạng đổi. Tầng API là nơi kiểm tra hình dạng và trả `undefined` nếu không khớp.
   */
  readonly clarify?: ClarificationRequest
  readonly workforceDraftIds?: readonly string[]
  readonly tokensIn: number
  readonly tokensOut: number
  readonly costUsd: number
  readonly createdAt: string
}

/* ---------------------------------------------- hỏi lại có cấu trúc */

/** Cách người dùng trả lời một câu hỏi: chọn một, hay chọn nhiều phương án. */
export type ClarificationInputMode = 'single' | 'multi'

export interface ClarificationOption {
  /**
   * Mã ổn định để gửi lại khi người dùng chọn.
   *
   * Vì sao tách mã khỏi nhãn: nhãn là câu chữ hiển thị và có thể đổi (sửa lỗi chính tả,
   * đổi ngôn ngữ), còn mã là thứ server dùng để ánh xạ câu trả lời vào đúng trường brief.
   * Gửi nhãn làm khoá thì một lần sửa chữ sẽ làm hỏng mọi câu trả lời đang chờ.
   */
  readonly id: string
  /** Nhãn hiển thị, ĐÃ Ở NGÔN NGỮ CỦA CUỘC TRAO ĐỔI tại thời điểm hỏi. */
  readonly label: string
  readonly hint?: string
  /** Chỉ có nghĩa khi `inputMode` là `multi`: phương án này nói về việc KHÔNG làm. */
  readonly exclusive?: boolean
}

export interface ClarificationQuestion {
  /** Trường brief mà câu trả lời sẽ điền vào, để server áp tất định. */
  readonly field: string
  readonly question: string
  readonly helper?: string
  readonly inputMode: ClarificationInputMode
  readonly options: readonly ClarificationOption[]
  /**
   * Luôn là `true` trong thực tế: người dùng phải luôn còn đường nói ý của mình, kể cả
   * khi danh sách gợi ý không có phương án nào đúng.
   */
  readonly allowCustom: boolean
}

/** Yêu cầu làm rõ của Leader, đi kèm tin nhắn để giao diện vẽ thẻ chọn. */
export interface ClarificationRequest {
  readonly intro: string
  readonly questions: readonly ClarificationQuestion[]
}

/** Câu trả lời của người dùng cho một câu hỏi. */
export interface ClarificationAnswer {
  readonly field: string
  readonly optionIds: readonly string[]
  /** Ý kiến riêng, nối thêm vào câu trả lời của câu hỏi này. */
  readonly custom?: string
}

/** Kết quả một lượt gửi tin: câu trả lời của Leader kèm trạng thái brief. */
export interface SendMessageResponse {
  readonly conversation: ConversationView
  readonly reply: MessageView
  readonly briefComplete: boolean
  readonly missingFields: readonly string[]
  readonly phase: ConversationPhase
  readonly costUsd: number
  /** Câu hỏi làm rõ của lượt này, nếu brief vẫn còn thiếu trường. */
  readonly clarify?: ClarificationRequest
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
  /** Toàn bộ khoá của URL này, để giao diện quản lý từng khoá một. */
  readonly keys: readonly ProviderKeyView[]
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
  adminUsers: '/api/admin/users',
  approveUser: (id: string) => `/api/admin/users/${encodeURIComponent(id)}/approve`,
  companies: '/api/companies',
  company: (id: string) => `/api/companies/${id}`,
  updateCompany: (id: string) => `/api/companies/${id}`,
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
  providerKeys: (id: string, providerId: string) => `/api/companies/${id}/providers/${providerId}/keys`,
  providerKey: (id: string, providerId: string, keyId: string) =>
    `/api/companies/${id}/providers/${providerId}/keys/${keyId}`,
  providerKeyTest: (id: string, providerId: string, keyId: string) =>
    `/api/companies/${id}/providers/${providerId}/keys/${keyId}/test`,
  providerFetchModels: (id: string, providerId: string) =>
    `/api/companies/${id}/providers/${providerId}/fetch-models`,
  providerImportModels: (id: string, providerId: string) =>
    `/api/companies/${id}/providers/${providerId}/import-models`,
  providerPurgeModels: (id: string, providerId: string) =>
    `/api/companies/${id}/providers/${providerId}/purge-models`,
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
