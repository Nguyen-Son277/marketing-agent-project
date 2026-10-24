/**
 * HTTP client cho giao diện.
 *
 * Vì sao có tầng này thay vì gọi `fetch` rải rác: mọi lời gọi đều phải xử lý ba
 * việc giống nhau — gửi kèm cookie phiên, biến lỗi JSON của server thành ngoại lệ
 * có `code` đọc được, và dịch 401 thành tín hiệu "cần đăng nhập". Làm một chỗ thì
 * không có màn hình nào lỡ quên.
 */
import { readLocale } from "./locale-store.ts";
import type {
  AdminUsersResponse,
  AgencyResponse,
  ArtifactView,
  ClarificationAnswer,
  CompanySummary,
  CompanyRole,
  ConversationDetailResponse,
  ConversationView,
  CostsResponse,
  CreateModelBody,
  CreateProviderBody,
  CreateProviderKeyBody,
  DashboardResponse,
  CampaignLoopResponse,
  AutomationPolicyView,
  CampaignView,
  AudienceView,
  DiagramResponse,
  ErrorEnvelope,
  FetchModelsResponse,
  ImportModelsBody,
  ImportModelsResponse,
  IntegrationTestResponse,
  IntegrationView,
  IntegrationsResponse,
  KnowledgeResponse,
  KnowledgeDocumentView,
  ModelOptionView,
  ModelRouteView,
  ProviderKeyView,
  ProviderView,
  LimitsView,
  MeResponse,
  MessageView,
  ProviderTestResponse,
  ProvidersResponse,
  PurgeModelsResponse,
  ReindexResponse,
  ReviewTaskResponse,
  RunView,
  SendMessageResponse,
  SystemStatusResponse,
  TaskDetailResponse,
  TaskListResponse,
  TeamMemberView,
  TeamResponse,
  UpdateProviderBody,
  UpdateProviderKeyBody,
  UpdateTeamMemberBody,
  UpsertIntegrationBody,
  UpsertRouteBody,
  WorkflowSnapshotResponse,
  ChatAttachmentView,
} from "@marketing-agent/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  /**
   * Khoá dịch của lỗi, nếu backend cung cấp.
   *
   * Vì sao giữ lại: `message` đã được backend dịch theo `Accept-Language` lúc gọi, nhưng
   * người dùng có thể đổi ngôn ngữ SAU đó. Có khoá thì giao diện dịch lại theo ngôn ngữ
   * đang chọn, nên thông báo lỗi luôn khớp với phần còn lại của màn hình.
   */
  readonly messageKey: string | undefined;
  readonly messageParams: Record<string, string | number> | undefined;
  /** Câu gốc từ backend, giữ để hiển thị khi chưa có khoá hoặc chưa có bản dịch. */
  readonly fallbackMessage: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    extras: {
      messageKey?: string;
      messageParams?: Record<string, string | number>;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.fallbackMessage = message;
    this.messageKey = extras.messageKey;
    this.messageParams = extras.messageParams;
  }

  /** Chưa đăng nhập hoặc phiên hết hạn. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** Thiếu cấu hình, ví dụ chưa kết nối một tích hợp. */
  get needsConfiguration(): boolean {
    return this.code === "needs_configuration";
  }

  /** Bị chặn quyền. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  /** Cho phép caller tự xử lý 401 (ví dụ màn hình đăng nhập). */
  readonly allowUnauthorized?: boolean;
}

/** Được gọi khi server trả 401, để app chuyển về màn hình đăng nhập. */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | undefined;
export function setUnauthorizedHandler(
  handler: UnauthorizedHandler | undefined,
): void {
  onUnauthorized = handler;
}

export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  // `Accept-Language` gửi theo ngôn ngữ đang chọn để backend dịch thông báo lỗi ngay
  // trong phản hồi. Giao diện vẫn dịch lại theo `messageKey` nếu có, nên thông báo
  // đúng ngôn ngữ kể cả khi người dùng đổi ngôn ngữ sau lúc gọi.
  const baseHeaders = {
    Accept: "application/json",
    "Accept-Language": readLocale(),
  };
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const response = await fetch(path, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers:
      options.body === undefined || isFormData
        ? baseHeaders
        : { ...baseHeaders, "Content-Type": "application/json" },
    ...(options.body === undefined
      ? {}
      : {
          body: isFormData
            ? (options.body as FormData)
            : JSON.stringify(options.body),
        }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    // Một phản hồi không phải JSON thường là trang lỗi của proxy.
    if (!response.ok) {
      throw new ApiError(
        response.status,
        "invalid_response",
        text.slice(0, 300) || "Phản hồi không hợp lệ",
      );
    }
    throw new ApiError(
      response.status,
      "invalid_response",
      "Máy chủ trả về dữ liệu không phải JSON",
    );
  }

  if (!response.ok) {
    const envelope = payload as ErrorEnvelope | undefined;
    const error = envelope?.error;
    if (response.status === 401 && !options.allowUnauthorized)
      onUnauthorized?.();
    throw new ApiError(
      response.status,
      error?.code ?? "unknown",
      error?.message ?? `Yêu cầu thất bại (HTTP ${response.status})`,
      error?.details,
      {
        ...(error?.messageKey ? { messageKey: error.messageKey } : {}),
        ...(error?.messageParams ? { messageParams: error.messageParams } : {}),
      },
    );
  }

  return payload as T;
}

/** Classification data added by the file-upload workflow; kept local to the web client. */
export interface ClassificationModelSettings {
  mode: "leader" | "custom";
  modelFk: string | null;
  fallbackModelFks: string[];
}

export interface ClassificationEffectiveModel {
  id: string;
  modelId: string;
  label: string;
  providerId: string;
  providerName: string;
}

export interface ClassificationModelSettingsResponse {
  settings: ClassificationModelSettings;
  effectiveModels: ClassificationEffectiveModel[];
  valid: boolean;
  issues: string[];
  source: "leader" | "custom";
}

export interface ClassificationModelSettingsTestResponse {
  ok: boolean;
  message: string;
  model?: ClassificationEffectiveModel;
}

export interface KnowledgeClassificationFields {
  classificationStatus?: "pending" | "running" | "ready" | "failed";
  classificationError?: string | null;
  categories?: string[];
  sectionCount?: number;
  chunkCount?: number;
  classificationNextAttemptAt?: string | null;
}

export interface KnowledgeSectionView {
  id: string;
  title: string;
  category: string;
  tags: string[];
  confidence: number | null;
  startOffset: number;
  endOffset: number;
  assignmentSource: string;
}

export interface KnowledgeDocumentDetailResponse {
  document: KnowledgeDocumentView & KnowledgeClassificationFields;
  sections?: KnowledgeSectionView[];
}

/** Client có kiểu cho từng endpoint. */
export const api = {
  /* ------------------------------------------------------------- xác thực */

  async register(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<MeResponse> {
    return request<MeResponse>("/api/auth/register", {
      method: "POST",
      body: input,
      allowUnauthorized: true,
    });
  },

  async login(input: { email: string; password: string }): Promise<MeResponse> {
    return request<MeResponse>("/api/auth/login", {
      method: "POST",
      body: input,
      allowUnauthorized: true,
    });
  },

  async logout(): Promise<void> {
    await request<unknown>("/api/auth/logout", { method: "POST" });
  },

  async me(): Promise<MeResponse> {
    return request<MeResponse>("/api/auth/me", { allowUnauthorized: true });
  },

  async systemStatus(): Promise<SystemStatusResponse> {
    return request<SystemStatusResponse>("/api/system/status", {
      allowUnauthorized: true,
    });
  },

  async adminUsers(params: {
    status: "pending" | "approved";
    q: string;
    page: number;
  }): Promise<AdminUsersResponse> {
    const query = new URLSearchParams({ ...params, page: String(params.page) });
    return request(`/api/admin/users?${query}`);
  },

  async approveUser(
    userId: string,
  ): Promise<{ user: MeResponse["user"]; changed: boolean }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/approve`, {
      method: "POST",
      body: {},
    });
  },

  /* -------------------------------------------------------------- công ty */

  async listCompanies(): Promise<{ companies: CompanySummary[] }> {
    return request<{ companies: CompanySummary[] }>("/api/companies");
  },

  async createCompany(input: {
    name: string;
  }): Promise<{ company: CompanySummary; presets: number }> {
    return request("/api/companies", { method: "POST", body: input });
  },

  /**
   * Đổi tên hiển thị công ty.
   *
   * Slug giữ nguyên có chủ đích: nó là tên thư mục kho kiến thức trên đĩa và là khoá tra
   * cứu tài liệu đã index. Xem `UpdateCompanyBody` trong shared.
   *
   * Trả kèm `role` để nơi gọi không phải tra lại quyền của mình ở công ty đó.
   */
  async renameCompany(
    companyId: string,
    name: string,
  ): Promise<{ company: CompanySummary; role: CompanyRole }> {
    return request(`/api/companies/${companyId}`, {
      method: "PATCH",
      body: { name },
    });
  },

  async dashboard(companyId: string): Promise<DashboardResponse> {
    return request(`/api/companies/${companyId}/dashboard`);
  },

  async campaignLoop(companyId: string): Promise<CampaignLoopResponse> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/campaign-loop`,
    );
  },

  async agencies(): Promise<{ agencies: AgencyResponse["agency"][] }> {
    return request("/api/agencies");
  },

  async agency(agencyId: string): Promise<AgencyResponse> {
    return request(`/api/agencies/${encodeURIComponent(agencyId)}`);
  },

  async createAgency(name: string): Promise<AgencyResponse> {
    return request("/api/agencies", { method: "POST", body: { name } });
  },

  async automationPolicy(
    companyId: string,
  ): Promise<{ policy: AutomationPolicyView }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/automation-policy`,
    );
  },

  async updateAutomationPolicy(
    companyId: string,
    patch: Partial<AutomationPolicyView>,
  ): Promise<{ policy: AutomationPolicyView }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/automation-policy`,
      { method: "PATCH", body: patch },
    );
  },

  async createCampaign(
    companyId: string,
    input: {
      name: string;
      timezone: string;
      objective?: string | null;
      items: readonly unknown[];
    },
  ): Promise<{ campaign: CampaignView }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/campaigns`,
      { method: "POST", body: input },
    );
  },

  async campaignAction(
    companyId: string,
    campaignId: string,
    action: "activate" | "pause" | "resume",
  ): Promise<{ campaign: CampaignView }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/campaigns/${encodeURIComponent(campaignId)}/${action}`,
      { method: "POST", body: {} },
    );
  },

  async jobAttempts(
    companyId: string,
    jobId: string,
  ): Promise<{
    attempts: {
      id: string;
      attempt: number;
      status: string;
      providerRequestId: string | null;
      error: string | null;
      startedAt: string;
      finishedAt: string | null;
    }[];
  }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/execution-jobs/${encodeURIComponent(jobId)}/attempts`,
    );
  },

  async createAudience(
    companyId: string,
    name: string,
  ): Promise<{ audience: AudienceView }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/audiences`,
      { method: "POST", body: { name } },
    );
  },

  async importAudienceCsv(
    companyId: string,
    audienceId: string,
    input: {
      csv: string;
      source: string;
      consentVersion: string;
      consentAt: string;
    },
  ): Promise<{
    result: { inserted: number; updated: number; skippedUnsubscribed: number };
  }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/audiences/${encodeURIComponent(audienceId)}/import`,
      { method: "POST", body: input },
    );
  },

  /* ------------------------------------------------------------------ đội */

  async team(companyId: string): Promise<TeamResponse> {
    return request(`/api/companies/${companyId}/team`);
  },

  async updateTeamMember(
    companyId: string,
    role: string,
    patch: UpdateTeamMemberBody,
  ): Promise<{ member: TeamMemberView }> {
    return request(`/api/companies/${companyId}/team/${role}`, {
      method: "PATCH",
      body: patch,
    });
  },

  /* -------------------------------------------------------- kho kiến thức */

  async knowledge(
    companyId: string,
    params: { category?: string; q?: string } = {},
  ): Promise<KnowledgeResponse> {
    const search = new URLSearchParams();
    if (params.category) search.set("category", params.category);
    if (params.q) search.set("q", params.q);
    const suffix = search.toString().length > 0 ? `?${search.toString()}` : "";
    return request(`/api/companies/${companyId}/knowledge${suffix}`);
  },

  async upsertKnowledge(
    companyId: string,
    input: {
      path: string;
      title: string;
      category: string;
      tags: string[];
      content: string;
    },
  ): Promise<KnowledgeResponse> {
    return request(`/api/companies/${companyId}/knowledge`, {
      method: "POST",
      body: input,
    });
  },

  async uploadKnowledge(
    companyId: string,
    input: { file: File; category?: string; title?: string; tags?: string[] },
  ): Promise<{
    document: KnowledgeDocumentView & KnowledgeClassificationFields;
    job?: unknown;
    duplicate?: boolean;
    warning?: string;
  }> {
    const form = new FormData();
    form.append("file", input.file);
    if (input.category) form.append("category", input.category);
    if (input.title) form.append("title", input.title);
    if (input.tags) form.append("tags", JSON.stringify(input.tags));
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/knowledge/upload`,
      {
        method: "POST",
        body: form,
      },
    );
  },

  /** Upload an image asset to the knowledge library. The server keeps the original
   * binary and returns the same document shape as regular knowledge uploads. */
  async uploadKnowledgeImage(
    companyId: string,
    input: { file: File; product?: string; brand?: string; tags?: string[] },
  ): Promise<{
    document: KnowledgeDocumentView;
    job?: unknown;
    duplicate?: boolean;
    warning?: string;
  }> {
    const form = new FormData();
    form.append("file", input.file);
    if (input.product) form.append("product", input.product);
    if (input.brand) form.append("brand", input.brand);
    if (input.tags) form.append("tags", JSON.stringify(input.tags));
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/knowledge/upload`,
      { method: "POST", body: form },
    );
  },

  knowledgeImageUrl(companyId: string, documentId: string): string {
    return `/api/companies/${encodeURIComponent(companyId)}/knowledge/${encodeURIComponent(documentId)}/original`;
  },

  async retryKnowledgeImageAnalysis(
    companyId: string,
    documentId: string,
  ): Promise<{ document: KnowledgeDocumentView; result?: unknown }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/knowledge/${encodeURIComponent(documentId)}/image-analysis`,
      { method: "POST", body: {} },
    );
  },

  async knowledgeDocument(
    companyId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentDetailResponse> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/knowledge/${encodeURIComponent(documentId)}`,
    );
  },

  async knowledgeClassification(
    companyId: string,
    documentId: string,
  ): Promise<{ job: unknown }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/knowledge/${encodeURIComponent(documentId)}/classification`,
    );
  },

  async retryKnowledgeClassification(
    companyId: string,
    documentId: string,
  ): Promise<{ job: unknown }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/knowledge/${encodeURIComponent(documentId)}/classification/retry`,
      { method: "POST", body: {} },
    );
  },

  async retryFailedKnowledge(
    companyId: string,
  ): Promise<{ queued: number; processing: number; failed: number }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/knowledge/classification/retry`,
      { method: "POST", body: {} },
    );
  },

  async updateKnowledgeSection(
    companyId: string,
    documentId: string,
    sectionId: string,
    input: { category: string; tags: string[] },
  ): Promise<KnowledgeDocumentDetailResponse> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/knowledge/${encodeURIComponent(documentId)}/sections/${encodeURIComponent(sectionId)}`,
      { method: "PATCH", body: input },
    );
  },

  knowledgeDownloadUrl(companyId: string, documentId: string): string {
    return `/api/companies/${encodeURIComponent(companyId)}/knowledge/${encodeURIComponent(documentId)}/download`;
  },

  async updateKnowledgeMetadata(
    companyId: string,
    documentId: string,
    input: { title: string; category?: string; tags: string[] },
  ): Promise<{ document: KnowledgeDocumentView }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/knowledge/${encodeURIComponent(documentId)}`,
      {
        method: "PATCH",
        body: input,
      },
    );
  },

  async deleteKnowledge(companyId: string, documentId: string): Promise<void> {
    await request(`/api/companies/${companyId}/knowledge/${documentId}`, {
      method: "DELETE",
    });
  },

  async reindexKnowledge(
    companyId: string,
    input: { force?: boolean } = {},
  ): Promise<ReindexResponse> {
    return request(`/api/companies/${companyId}/knowledge/reindex`, {
      method: "POST",
      body: input,
    });
  },

  /* ------------------------------------------------------------ trao đổi */

  async conversations(
    companyId: string,
    signal?: AbortSignal,
  ): Promise<{ conversations: ConversationView[] }> {
    return request(`/api/companies/${companyId}/conversations`, { signal });
  },

  async workflow(
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<WorkflowSnapshotResponse> {
    return request(
      `/api/conversations/${encodeURIComponent(conversationId)}/workflow`,
      { signal },
    );
  },

  /**
   * Tạo cuộc trao đổi mới.
   *
   * Ngôn ngữ mặc định lấy từ ngôn ngữ giao diện đang chọn, nên phiên mới đã đúng ngôn
   * ngữ ngay mà nơi gọi không phải truyền. Truyền tường minh khi cần khác (ví dụ tạo hộ).
   */
  async createConversation(
    companyId: string,
    title: string,
    language?: "vi" | "en",
  ): Promise<{ conversation: ConversationView }> {
    return request(`/api/companies/${companyId}/conversations`, {
      method: "POST",
      body: { title, language: language ?? readLocale() },
    });
  },

  async conversation(
    conversationId: string,
  ): Promise<ConversationDetailResponse> {
    return request(`/api/conversations/${conversationId}`);
  },

  async sendMessage(
    conversationId: string,
    input: {
      content: string;
      mode?: "campaign" | "workforce";
      autoPlan?: boolean;
      answers?: ClarificationAnswer[];
      attachmentIds?: string[];
    },
  ): Promise<SendMessageResponse> {
    return request(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      body: input,
    });
  },

  async uploadChatAttachment(
    conversationId: string,
    file: File,
    signal?: AbortSignal,
  ): Promise<{ attachment: ChatAttachmentView }> {
    const form = new FormData();
    form.append("file", file);
    return request(
      `/api/conversations/${encodeURIComponent(conversationId)}/attachments`,
      { method: "POST", body: form, signal },
    );
  },

  async removeChatAttachment(
    conversationId: string,
    attachmentId: string,
  ): Promise<void> {
    return request(
      `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { method: "DELETE" },
    );
  },

  async planConversation(
    conversationId: string,
  ): Promise<{ tasks: { title: string; assigneeRole: string }[] }> {
    return request(`/api/conversations/${conversationId}/plan`, {
      method: "POST",
      body: {},
    });
  },

  async runConversation(conversationId: string): Promise<unknown> {
    return request(`/api/conversations/${conversationId}/run`, {
      method: "POST",
      body: {},
    });
  },

  async reportConversation(
    conversationId: string,
  ): Promise<{ artifactId: string; markdown: string }> {
    return request(`/api/conversations/${conversationId}/report`, {
      method: "POST",
      body: {},
    });
  },

  /* ---------------------------------------------------------- công việc */

  async tasks(companyId: string): Promise<TaskListResponse> {
    return request(`/api/companies/${companyId}/tasks`);
  },

  async task(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<TaskDetailResponse> {
    return request(
      `/api/tasks/${encodeURIComponent(taskId)}`,
      signal ? { signal } : undefined,
    );
  },

  async reviewTask(
    taskId: string,
    input: {
      decision: "approve" | "request_changes" | "cancel";
      note?: string;
    },
  ): Promise<ReviewTaskResponse> {
    return request(`/api/tasks/${taskId}/review`, {
      method: "POST",
      body: input,
    });
  },

  async artifacts(
    companyId: string,
    params: { taskId?: string } = {},
  ): Promise<{ artifacts: ArtifactView[] }> {
    const suffix = params.taskId
      ? `?taskId=${encodeURIComponent(params.taskId)}`
      : "";
    return request(`/api/companies/${companyId}/artifacts${suffix}`);
  },

  /* ------------------------------------------------------------- cài đặt */

  async providers(companyId: string): Promise<ProvidersResponse> {
    return request(`/api/companies/${companyId}/providers`);
  },

  async classificationModelSettings(
    companyId: string,
  ): Promise<ClassificationModelSettingsResponse> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/knowledge/classification/settings`,
    );
  },

  async saveClassificationModelSettings(
    companyId: string,
    settings: ClassificationModelSettings,
  ): Promise<ClassificationModelSettingsResponse> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/knowledge/classification/settings`,
      {
        method: "PUT",
        body: settings,
      },
    );
  },

  async testClassificationModelSettings(
    companyId: string,
  ): Promise<ClassificationModelSettingsTestResponse> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/knowledge/classification/settings/test`,
      {
        method: "POST",
        body: {},
      },
    );
  },

  async createProvider(
    companyId: string,
    input: CreateProviderBody,
  ): Promise<{ provider: ProviderView }> {
    return request(`/api/companies/${companyId}/providers`, {
      method: "POST",
      body: input,
    });
  },

  async updateProvider(
    companyId: string,
    providerId: string,
    patch: UpdateProviderBody,
  ): Promise<unknown> {
    return request(`/api/companies/${companyId}/providers/${providerId}`, {
      method: "PATCH",
      body: patch,
    });
  },

  async deleteProvider(companyId: string, providerId: string): Promise<void> {
    await request(`/api/companies/${companyId}/providers/${providerId}`, {
      method: "DELETE",
    });
  },

  async testProvider(
    companyId: string,
    providerId: string,
    keyId?: string,
  ): Promise<ProviderTestResponse> {
    return request(`/api/companies/${companyId}/providers/${providerId}/test`, {
      method: "POST",
      body: keyId ? { keyId } : {},
    });
  },

  /* -------------------------------------------------------------- API key */

  async providerKeys(
    companyId: string,
    providerId: string,
  ): Promise<{ keys: ProviderKeyView[] }> {
    return request(`/api/companies/${companyId}/providers/${providerId}/keys`);
  },

  async createProviderKey(
    companyId: string,
    providerId: string,
    input: CreateProviderKeyBody,
  ): Promise<{ key: ProviderKeyView }> {
    return request(`/api/companies/${companyId}/providers/${providerId}/keys`, {
      method: "POST",
      body: input,
    });
  },

  async updateProviderKey(
    companyId: string,
    providerId: string,
    keyId: string,
    patch: UpdateProviderKeyBody,
  ): Promise<{ key: ProviderKeyView }> {
    return request(
      `/api/companies/${companyId}/providers/${providerId}/keys/${keyId}`,
      {
        method: "PATCH",
        body: patch,
      },
    );
  },

  async deleteProviderKey(
    companyId: string,
    providerId: string,
    keyId: string,
  ): Promise<void> {
    await request(
      `/api/companies/${companyId}/providers/${providerId}/keys/${keyId}`,
      { method: "DELETE" },
    );
  },

  async testProviderKey(
    companyId: string,
    providerId: string,
    keyId: string,
  ): Promise<ProviderTestResponse> {
    return request(
      `/api/companies/${companyId}/providers/${providerId}/keys/${keyId}/test`,
      {
        method: "POST",
        body: {},
      },
    );
  },

  /* ------------------------------------------------------------ fetch model */

  async fetchProviderModels(
    companyId: string,
    providerId: string,
    keyId?: string,
  ): Promise<FetchModelsResponse> {
    return request(
      `/api/companies/${companyId}/providers/${providerId}/fetch-models`,
      {
        method: "POST",
        body: keyId ? { keyId } : {},
      },
    );
  },

  async importProviderModels(
    companyId: string,
    providerId: string,
    input: ImportModelsBody,
  ): Promise<ImportModelsResponse> {
    return request(
      `/api/companies/${companyId}/providers/${providerId}/import-models`,
      {
        method: "POST",
        body: input,
      },
    );
  },

  async purgeProviderModels(
    companyId: string,
    providerId: string,
  ): Promise<PurgeModelsResponse> {
    return request(
      `/api/companies/${companyId}/providers/${providerId}/purge-models`,
      {
        method: "POST",
        body: {},
      },
    );
  },

  async createModel(
    companyId: string,
    input: CreateModelBody,
  ): Promise<{ model: ModelOptionView }> {
    return request(`/api/companies/${companyId}/models`, {
      method: "POST",
      body: input,
    });
  },

  async updateModelPricing(
    companyId: string,
    modelId: string,
    input: { costInPerMtok: number; costOutPerMtok: number },
  ): Promise<{ model: ModelOptionView }> {
    return request(`/api/companies/${companyId}/models/${modelId}`, {
      method: "PATCH",
      body: input,
    });
  },

  async updateModelVision(
    companyId: string,
    modelId: string,
    supportsVision: boolean,
  ): Promise<{ model: ModelOptionView }> {
    return request(`/api/companies/${companyId}/models/${modelId}`, {
      method: "PATCH",
      body: { supportsVision },
    });
  },

  async deleteModel(companyId: string, modelId: string): Promise<void> {
    await request(`/api/companies/${companyId}/models/${modelId}`, {
      method: "DELETE",
    });
  },

  async upsertRoute(
    companyId: string,
    input: UpsertRouteBody,
  ): Promise<{ route: ModelRouteView }> {
    return request(`/api/companies/${companyId}/routes`, {
      method: "POST",
      body: input,
    });
  },

  async integrations(companyId: string): Promise<IntegrationsResponse> {
    return request(`/api/companies/${companyId}/integrations`);
  },

  async upsertIntegration(
    companyId: string,
    input: UpsertIntegrationBody,
  ): Promise<{ integration: IntegrationView }> {
    return request(`/api/companies/${companyId}/integrations`, {
      method: "POST",
      body: input,
    });
  },

  async testIntegration(
    companyId: string,
    integrationId: string,
  ): Promise<IntegrationTestResponse> {
    return request(
      `/api/companies/${companyId}/integrations/${integrationId}/test`,
      {
        method: "POST",
        body: {},
      },
    );
  },

  /** OAuth entry point. The API may return a URL or redirect directly; callers use
   * this method when an application wants to open the provider in the same tab. */
  oauthStartUrl(companyId: string, provider: string): string {
    return `/oauth/${encodeURIComponent(provider)}/start?companyId=${encodeURIComponent(companyId)}`;
  },

  async saveOAuthApp(companyId: string, provider: string, input: { clientId: string; clientSecret: string; name?: string }): Promise<void> {
    await request(`/api/companies/${encodeURIComponent(companyId)}/oauth/${encodeURIComponent(provider)}/app`, { method: "PATCH", body: input });
  },

  async integrationOptions(
    companyId: string,
    kind: string,
  ): Promise<{
    options: readonly { id: string; name: string; type?: string }[];
  }> {
    const result = await request<{ options: readonly unknown[] }>(
      `/api/companies/${encodeURIComponent(companyId)}/integrations/${encodeURIComponent(kind)}/options`,
    );
    return {
      options: result.options.map((value, index) => {
        if (typeof value === "string") return { id: value, name: value };
        const item = value as Record<string, unknown>;
        const id = String(item.id ?? item.resourceName ?? item.siteUrl ?? item.urn ?? index);
        const name = String(item.name ?? item.displayName ?? item.siteUrl ?? item.resourceName ?? id);
        return { id, name, ...(typeof item.type === "string" ? { type: item.type } : {}) };
      }),
    };
  },

  async updateIntegrationDefaults(
    companyId: string,
    integrationId: string,
    defaults: Record<string, unknown>,
  ): Promise<{ integration: IntegrationView }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/integrations/${encodeURIComponent(integrationId)}/defaults`,
      { method: "PATCH", body: defaults },
    );
  },

  async reconnectIntegration(
    companyId: string,
    integrationId: string,
  ): Promise<{ url?: string }> {
    return request(
      `/api/companies/${encodeURIComponent(companyId)}/integrations/${encodeURIComponent(integrationId)}/reconnect`,
      { method: "POST", body: {} },
    );
  },

  async deleteIntegration(
    companyId: string,
    integrationId: string,
  ): Promise<void> {
    await request(
      `/api/companies/${encodeURIComponent(companyId)}/integrations/${encodeURIComponent(integrationId)}`,
      { method: "DELETE" },
    );
  },

  /** Route theo tier hiện có: agent nào dùng model nào cho mức năng lực nào. */
  async routes(companyId: string): Promise<{ routes: ModelRouteView[] }> {
    return request(`/api/companies/${companyId}/routes`);
  },

  async limits(companyId: string): Promise<LimitsView> {
    return request(`/api/companies/${companyId}/limits`);
  },

  async updateLimits(companyId: string, patch: unknown): Promise<LimitsView> {
    return request(`/api/companies/${companyId}/limits`, {
      method: "PATCH",
      body: patch,
    });
  },

  /* --------------------------------------------------------------- chi phí */

  async costs(
    companyId: string,
    range: { from?: string; to?: string } = {},
  ): Promise<CostsResponse> {
    const search = new URLSearchParams();
    if (range.from) search.set("from", range.from);
    if (range.to) search.set("to", range.to);
    const suffix = search.toString().length > 0 ? `?${search.toString()}` : "";
    return request(`/api/companies/${companyId}/costs${suffix}`);
  },

  async runs(companyId: string): Promise<{ runs: RunView[] }> {
    return request(`/api/companies/${companyId}/runs`);
  },

  async audit(companyId: string): Promise<unknown> {
    return request(`/api/companies/${companyId}/audit`);
  },

  /* ----------------------------------------------------------------- sơ đồ */

  async diagram(companyId: string): Promise<DiagramResponse> {
    return request(`/api/companies/${companyId}/diagram`);
  },
};

/**
 * Một sự kiện SSE đã parse. `type` khớp `StreamEventType`; `data` là JSON tuỳ loại.
 */
export interface StreamEvent {
  readonly type: string;
  readonly data: unknown;
  readonly at: number;
  /** Scope from the server envelope, when present. */
  readonly companyId?: string;
}

/**
 * Mở luồng sự kiện của một cuộc trao đổi.
 * EventSource gửi cookie cùng origin và tự reconnect. Server không replay lịch sử;
 * caller cần tải snapshot khi kết nối mở lại. Disposer đóng luồng khi unmount.
 */
export function openConversationStream(
  conversationId: string,
  handlers: {
    onEvent: (event: StreamEvent) => void;
    onError?: (error: Event) => void;
    onOpen?: () => void;
  },
): () => void {
  const source = new EventSource(`/api/conversations/${conversationId}/stream`);
  const forward = (type: string) => (message: MessageEvent<string>) => {
    let data: unknown = message.data;
    try {
      data = JSON.parse(message.data) as unknown;
    } catch {
      // Keep legacy data available to chat; workflow only uses validated metadata.
    }
    if (
      data !== null &&
      typeof data === "object" &&
      "payload" in data &&
      "type" in data
    ) {
      const envelope = data as {
        type: unknown;
        payload: unknown;
        companyId?: unknown;
        at?: unknown;
      };
      const serverAt =
        typeof envelope.at === "string" ? Date.parse(envelope.at) : NaN;
      handlers.onEvent({
        type: typeof envelope.type === "string" ? envelope.type : type,
        data: envelope.payload,
        at: Number.isFinite(serverAt) ? serverAt : Date.now(),
        ...(typeof envelope.companyId === "string"
          ? { companyId: envelope.companyId }
          : {}),
      });
    } else {
      handlers.onEvent({ type, data, at: Date.now() });
    }
  };

  // Đăng ký các loại đã biết, và cả message mặc định cho loại server thêm sau.
  for (const type of [
    "leader.thinking",
    "leader.replied",
    "brief.updated",
    "plan.created",
    "task.updated",
    "agent.started",
    "tool.called",
    "artifact.created",
    "agent.message",
    "review.completed",
    "report.created",
    "warning",
    "conversation.updated",
    "run.started",
    "run.finished",
    "model.started",
    "model.finished",
    "run.retrying",
    "tool.started",
    "tool.finished",
    "message",
  ]) {
    source.addEventListener(type, forward(type) as EventListener);
  }

  source.onopen = () => handlers.onOpen?.();
  source.onerror = (error) => handlers.onError?.(error);

  return () => source.close();
}
