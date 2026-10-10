/**
 * HTTP client cho giao diện.
 *
 * Vì sao có tầng này thay vì gọi `fetch` rải rác: mọi lời gọi đều phải xử lý ba
 * việc giống nhau — gửi kèm cookie phiên, biến lỗi JSON của server thành ngoại lệ
 * có `code` đọc được, và dịch 401 thành tín hiệu "cần đăng nhập". Làm một chỗ thì
 * không có màn hình nào lỡ quên.
 */
import type {
  ArtifactView,
  CompanySummary,
  ConversationDetailResponse,
  ConversationView,
  CostsResponse,
  CreateModelBody,
  CreateProviderBody,
  DashboardResponse,
  DiagramResponse,
  ErrorEnvelope,
  IntegrationTestResponse,
  IntegrationView,
  IntegrationsResponse,
  KnowledgeResponse,
  ModelOptionView,
  ModelRouteView,
  ProviderView,
  LimitsView,
  MeResponse,
  MessageView,
  ProviderTestResponse,
  ProvidersResponse,
  ReindexResponse,
  ReviewTaskResponse,
  RunView,
  SendMessageResponse,
  SystemStatusResponse,
  TaskDetailResponse,
  TaskListResponse,
  TeamMemberView,
  TeamResponse,
  UpdateTeamMemberBody,
  UpsertIntegrationBody,
  UpsertRouteBody,
} from '@marketing-agent/shared'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  /** Chưa đăng nhập hoặc phiên hết hạn. */
  get isUnauthorized(): boolean {
    return this.status === 401
  }

  /** Thiếu cấu hình, ví dụ chưa kết nối một tích hợp. */
  get needsConfiguration(): boolean {
    return this.code === 'needs_configuration'
  }

  /** Bị chặn quyền. */
  get isForbidden(): boolean {
    return this.status === 403
  }

  get isNotFound(): boolean {
    return this.status === 404
  }
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  readonly body?: unknown
  readonly signal?: AbortSignal
  /** Cho phép caller tự xử lý 401 (ví dụ màn hình đăng nhập). */
  readonly allowUnauthorized?: boolean
}

/** Được gọi khi server trả 401, để app chuyển về màn hình đăng nhập. */
type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | undefined
export function setUnauthorizedHandler(handler: UnauthorizedHandler | undefined): void {
  onUnauthorized = handler
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body === undefined ? { Accept: 'application/json' } : {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal ? { signal: options.signal } : {}),
  })

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let payload: unknown
  try {
    payload = text.length > 0 ? JSON.parse(text) : undefined
  } catch {
    // Một phản hồi không phải JSON thường là trang lỗi của proxy.
    if (!response.ok) {
      throw new ApiError(response.status, 'invalid_response', text.slice(0, 300) || 'Phản hồi không hợp lệ')
    }
    throw new ApiError(response.status, 'invalid_response', 'Máy chủ trả về dữ liệu không phải JSON')
  }

  if (!response.ok) {
    const envelope = payload as ErrorEnvelope | undefined
    const error = envelope?.error
    if (response.status === 401 && !options.allowUnauthorized) onUnauthorized?.()
    throw new ApiError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? `Yêu cầu thất bại (HTTP ${response.status})`,
      error?.details,
    )
  }

  return payload as T
}

/** Client có kiểu cho từng endpoint. */
export const api = {
  /* ------------------------------------------------------------- xác thực */

  async register(input: { email: string; password: string; name: string }): Promise<MeResponse> {
    return request<MeResponse>('/api/auth/register', {
      method: 'POST',
      body: input,
      allowUnauthorized: true,
    })
  },

  async login(input: { email: string; password: string }): Promise<MeResponse> {
    return request<MeResponse>('/api/auth/login', { method: 'POST', body: input, allowUnauthorized: true })
  },

  async logout(): Promise<void> {
    await request<unknown>('/api/auth/logout', { method: 'POST' })
  },

  async me(): Promise<MeResponse> {
    return request<MeResponse>('/api/auth/me', { allowUnauthorized: true })
  },

  async systemStatus(): Promise<SystemStatusResponse> {
    return request<SystemStatusResponse>('/api/system/status', { allowUnauthorized: true })
  },

  /* -------------------------------------------------------------- công ty */

  async listCompanies(): Promise<{ companies: CompanySummary[] }> {
    return request<{ companies: CompanySummary[] }>('/api/companies')
  },

  async createCompany(input: { name: string }): Promise<{ company: CompanySummary; presets: number }> {
    return request('/api/companies', { method: 'POST', body: input })
  },

  async dashboard(companyId: string): Promise<DashboardResponse> {
    return request(`/api/companies/${companyId}/dashboard`)
  },

  /* ------------------------------------------------------------------ đội */

  async team(companyId: string): Promise<TeamResponse> {
    return request(`/api/companies/${companyId}/team`)
  },

  async updateTeamMember(
    companyId: string,
    role: string,
    patch: UpdateTeamMemberBody,
  ): Promise<{ member: TeamMemberView }> {
    return request(`/api/companies/${companyId}/team/${role}`, { method: 'PATCH', body: patch })
  },

  /* -------------------------------------------------------- kho kiến thức */

  async knowledge(
    companyId: string,
    params: { category?: string; q?: string } = {},
  ): Promise<KnowledgeResponse> {
    const search = new URLSearchParams()
    if (params.category) search.set('category', params.category)
    if (params.q) search.set('q', params.q)
    const suffix = search.toString().length > 0 ? `?${search.toString()}` : ''
    return request(`/api/companies/${companyId}/knowledge${suffix}`)
  },

  async upsertKnowledge(
    companyId: string,
    input: { path: string; title: string; category: string; tags: string[]; content: string },
  ): Promise<KnowledgeResponse> {
    return request(`/api/companies/${companyId}/knowledge`, { method: 'POST', body: input })
  },

  async deleteKnowledge(companyId: string, documentId: string): Promise<void> {
    await request(`/api/companies/${companyId}/knowledge/${documentId}`, { method: 'DELETE' })
  },

  async reindexKnowledge(companyId: string, input: { force?: boolean } = {}): Promise<ReindexResponse> {
    return request(`/api/companies/${companyId}/knowledge/reindex`, { method: 'POST', body: input })
  },

  /* ------------------------------------------------------------ trao đổi */

  async conversations(companyId: string): Promise<{ conversations: ConversationView[] }> {
    return request(`/api/companies/${companyId}/conversations`)
  },

  async createConversation(companyId: string, title: string): Promise<{ conversation: ConversationView }> {
    return request(`/api/companies/${companyId}/conversations`, { method: 'POST', body: { title } })
  },

  async conversation(conversationId: string): Promise<ConversationDetailResponse> {
    return request(`/api/conversations/${conversationId}`)
  },

  async sendMessage(
    conversationId: string,
    input: { content: string; autoPlan?: boolean },
  ): Promise<SendMessageResponse> {
    return request(`/api/conversations/${conversationId}/messages`, { method: 'POST', body: input })
  },

  async planConversation(conversationId: string): Promise<{ tasks: { title: string; assigneeRole: string }[] }> {
    return request(`/api/conversations/${conversationId}/plan`, { method: 'POST', body: {} })
  },

  async runConversation(conversationId: string): Promise<unknown> {
    return request(`/api/conversations/${conversationId}/run`, { method: 'POST', body: {} })
  },

  async reportConversation(conversationId: string): Promise<{ artifactId: string; markdown: string }> {
    return request(`/api/conversations/${conversationId}/report`, { method: 'POST', body: {} })
  },

  /* ---------------------------------------------------------- công việc */

  async tasks(companyId: string): Promise<TaskListResponse> {
    return request(`/api/companies/${companyId}/tasks`)
  },

  async task(taskId: string): Promise<TaskDetailResponse> {
    return request(`/api/tasks/${taskId}`)
  },

  async reviewTask(
    taskId: string,
    input: { decision: 'approve' | 'request_changes' | 'cancel'; note?: string },
  ): Promise<ReviewTaskResponse> {
    return request(`/api/tasks/${taskId}/review`, { method: 'POST', body: input })
  },

  async artifacts(companyId: string, params: { taskId?: string } = {}): Promise<{ artifacts: ArtifactView[] }> {
    const suffix = params.taskId ? `?taskId=${encodeURIComponent(params.taskId)}` : ''
    return request(`/api/companies/${companyId}/artifacts${suffix}`)
  },

  /* ------------------------------------------------------------- cài đặt */

  async providers(companyId: string): Promise<ProvidersResponse> {
    return request(`/api/companies/${companyId}/providers`)
  },

  async createProvider(companyId: string, input: CreateProviderBody): Promise<{ provider: ProviderView }> {
    return request(`/api/companies/${companyId}/providers`, { method: 'POST', body: input })
  },

  async updateProvider(companyId: string, providerId: string, patch: unknown): Promise<unknown> {
    return request(`/api/companies/${companyId}/providers/${providerId}`, { method: 'PATCH', body: patch })
  },

  async testProvider(companyId: string, providerId: string): Promise<ProviderTestResponse> {
    return request(`/api/companies/${companyId}/providers/${providerId}/test`, { method: 'POST', body: {} })
  },

  async createModel(companyId: string, input: CreateModelBody): Promise<{ model: ModelOptionView }> {
    return request(`/api/companies/${companyId}/models`, { method: 'POST', body: input })
  },

  async upsertRoute(companyId: string, input: UpsertRouteBody): Promise<{ route: ModelRouteView }> {
    return request(`/api/companies/${companyId}/routes`, { method: 'POST', body: input })
  },

  async integrations(companyId: string): Promise<IntegrationsResponse> {
    return request(`/api/companies/${companyId}/integrations`)
  },

  async upsertIntegration(
    companyId: string,
    input: UpsertIntegrationBody,
  ): Promise<{ integration: IntegrationView }> {
    return request(`/api/companies/${companyId}/integrations`, { method: 'POST', body: input })
  },

  async testIntegration(companyId: string, integrationId: string): Promise<IntegrationTestResponse> {
    return request(`/api/companies/${companyId}/integrations/${integrationId}/test`, {
      method: 'POST',
      body: {},
    })
  },

  /** Route theo tier hiện có: agent nào dùng model nào cho mức năng lực nào. */
  async routes(companyId: string): Promise<{ routes: ModelRouteView[] }> {
    return request(`/api/companies/${companyId}/routes`)
  },

  async limits(companyId: string): Promise<LimitsView> {
    return request(`/api/companies/${companyId}/limits`)
  },

  async updateLimits(companyId: string, patch: unknown): Promise<LimitsView> {
    return request(`/api/companies/${companyId}/limits`, { method: 'PATCH', body: patch })
  },

  /* --------------------------------------------------------------- chi phí */

  async costs(companyId: string, range: { from?: string; to?: string } = {}): Promise<CostsResponse> {
    const search = new URLSearchParams()
    if (range.from) search.set('from', range.from)
    if (range.to) search.set('to', range.to)
    const suffix = search.toString().length > 0 ? `?${search.toString()}` : ''
    return request(`/api/companies/${companyId}/costs${suffix}`)
  },

  async runs(companyId: string): Promise<{ runs: RunView[] }> {
    return request(`/api/companies/${companyId}/runs`)
  },

  async audit(companyId: string): Promise<unknown> {
    return request(`/api/companies/${companyId}/audit`)
  },

  /* ----------------------------------------------------------------- sơ đồ */

  async diagram(companyId: string): Promise<DiagramResponse> {
    return request(`/api/companies/${companyId}/diagram`)
  },
}

/**
 * Một sự kiện SSE đã parse. `type` khớp `StreamEventType`; `data` là JSON tuỳ loại.
 */
export interface StreamEvent {
  readonly type: string
  readonly data: unknown
  readonly at: number
}

/**
 * Mở luồng sự kiện của một cuộc trao đổi.
 *
 * Dùng `EventSource` (không phải fetch stream) vì nó tự gửi cookie phiên, tự
 * reconnect, và resume theo `Last-Event-ID` — đúng ba thứ cần cho một luồng dài.
 * Hàm trả về disposer để component có thể huỷ khi unmount.
 */
export function openConversationStream(
  conversationId: string,
  handlers: {
    onEvent: (event: StreamEvent) => void
    onError?: (error: Event) => void
    onOpen?: () => void
  },
): () => void {
  const source = new EventSource(`/api/conversations/${conversationId}/stream`)
  const forward = (type: string) => (message: MessageEvent<string>) => {
    let data: unknown = message.data
    try {
      data = JSON.parse(message.data) as unknown
    } catch {
      // Giữ nguyên chuỗi thô; giao diện vẫn hiển thị được.
    }
    handlers.onEvent({ type, data, at: Date.now() })
  }

  // Đăng ký các loại đã biết, và cả message mặc định cho loại server thêm sau.
  for (const type of [
    'leader.thinking',
    'leader.replied',
    'brief.updated',
    'plan.created',
    'task.updated',
    'agent.started',
    'tool.called',
    'artifact.created',
    'agent.message',
    'review.completed',
    'report.created',
    'warning',
    'message',
  ]) {
    source.addEventListener(type, forward(type) as EventListener)
  }

  source.onopen = () => handlers.onOpen?.()
  source.onerror = (error) => handlers.onError?.(error)

  return () => source.close()
}
