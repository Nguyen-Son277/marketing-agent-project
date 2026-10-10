/**
 * Record shapes and the LLM wire vocabulary. These interfaces are the contract
 * between packages; `schemas.ts` holds the zod validators for API boundaries.
 */
import type {
  AgentMessageKind,
  AgentRole,
  ArtifactKind,
  CompanyRole,
  ConversationPhase,
  IntegrationKind,
  KbIndexStatus,
  MessageAuthorKind,
  ModelTier,
  ProviderKind,
  RunStatus,
  TaskStatus,
} from './domain.ts'

/* ------------------------------------------------------------------ tenancy */

export interface UserRecord {
  readonly id: string
  readonly email: string
  readonly passwordHash: string
  readonly name: string
  readonly isAdmin: boolean
  readonly createdAt: string
}

/** User as exposed to clients — never carries the password hash. */
export interface PublicUser {
  readonly id: string
  readonly email: string
  readonly name: string
  readonly isAdmin: boolean
}

export interface CompanyRecord {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly createdAt: string
}

export interface MembershipRecord {
  readonly id: string
  readonly companyId: string
  readonly userId: string
  readonly role: CompanyRole
  readonly createdAt: string
}

/* ----------------------------------------------------------------- providers */

/**
 * Một nhà cung cấp = một URL. Khoá API KHÔNG nằm ở đây mà ở `LlmProviderKeyRecord`:
 * một URL có thể có nhiều khoá, và khoá hỏng thì hệ thống tự chuyển sang khoá kế tiếp.
 *
 * Vì sao không còn `apiKeyRef`: khoá qua biến môi trường là nguồn lỗi thật — người dùng
 * cài đặt xong nhưng quên điền `.env`, và mọi lượt chạy đều hỏng. Khoá do người dùng
 * nhập trực tiếp trong giao diện mới là nguồn sự thật.
 */
export interface LlmProviderRecord {
  readonly id: string
  readonly companyId: string | null
  readonly name: string
  readonly kind: ProviderKind
  readonly baseUrl: string
  readonly extraJson: string | null
  readonly enabled: boolean
  readonly createdAt: string
}

/** Một khoá API của provider. Giá trị gốc chỉ tồn tại lúc ghi, DB chỉ giữ bản mã hoá. */
export interface LlmProviderKeyRecord {
  readonly id: string
  readonly providerId: string
  readonly label: string
  /** Vài ký tự đầu/cuối của khoá để người dùng nhận ra, không đủ để tái tạo khoá. */
  readonly hint: string | null
  readonly priority: number
  readonly enabled: boolean
  readonly createdAt: string
}

/** Model dự phòng của một agent, theo thứ tự dùng khi model chính lỗi. */
export interface ModelFallbackRecord {
  readonly id: string
  readonly companyId: string
  readonly agentDefId: string
  readonly position: number
  readonly modelFk: string
}

export interface LlmModelRecord {
  readonly id: string
  readonly providerId: string
  readonly modelId: string
  readonly label: string
  readonly contextWindow: number
  readonly maxOutput: number
  readonly supportsTools: boolean
  readonly supportsVision: boolean
  readonly costInPerMtok: number
  readonly costOutPerMtok: number
  readonly enabled: boolean
}

export interface ModelRouteRecord {
  readonly id: string
  readonly companyId: string
  readonly agentDefId: string
  readonly tier: ModelTier
  readonly modelFk: string
  readonly reasoningEffort: string | null
  readonly maxTokens: number | null
  readonly priority: number
}

/* --------------------------------------------------------------------- team */

export interface AgentDefRecord {
  readonly id: string
  readonly role: AgentRole
  readonly name: string
  readonly description: string
  readonly systemPrompt: string
  readonly defaultSkillsJson: string
  readonly defaultToolsJson: string
  readonly isLeader: boolean
  readonly createdAt: string
}

export interface AgentPresetRecord {
  readonly id: string
  readonly companyId: string
  readonly agentDefId: string
  readonly displayName: string | null
  readonly enabled: boolean
  readonly modelFk: string | null
  readonly tier: ModelTier
  readonly reasoningEffort: string | null
  readonly maxTokens: number | null
  readonly contextBudgetTokens: number
  readonly systemPromptOverride: string | null
  readonly requireApproval: boolean
}

export interface AgentPresetSkillRecord {
  readonly presetId: string
  readonly skillName: string
  readonly companyId: string
}

export interface AgentPresetToolRecord {
  readonly presetId: string
  readonly toolName: string
  readonly companyId: string
  readonly configJson: string | null
}

export interface AgentSkillRecord {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly category: string
  readonly bodyMd: string
  readonly origin: string
}

/** Fully resolved agent configuration used to build one run's prompt and tools. */
export interface ResolvedAgent {
  readonly companyId: string
  readonly agentDef: AgentDefRecord
  readonly preset: AgentPresetRecord
  readonly role: AgentRole
  readonly displayName: string
  readonly model: LlmModelRecord | null
  readonly provider: LlmProviderRecord | null
  readonly skills: readonly AgentSkillRecord[]
  readonly toolNames: readonly string[]
  readonly knowledgeRead: readonly string[]
  readonly knowledgeWrite: readonly string[]
}

/* --------------------------------------------------------------- knowledge */

export interface KbDocumentRecord {
  readonly id: string
  readonly companyId: string
  readonly path: string
  readonly title: string
  readonly category: string
  readonly tagsJson: string
  readonly checksum: string
  readonly mtime: string | null
  readonly version: number
  readonly source: string
  readonly createdBy: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface KbChunkRecord {
  readonly id: string
  readonly documentId: string
  readonly companyId: string
  readonly ordinal: number
  readonly text: string
  readonly headingPath: string | null
  readonly tokens: number
}

/** One retrieval hit, carrying enough provenance for an agent to cite it. */
export interface KbHit {
  readonly chunkId: string
  readonly documentId: string
  readonly path: string
  readonly title: string
  readonly category: string
  readonly headingPath: string | null
  readonly headingUrl: string | null
  readonly text: string
  readonly score: number
  readonly lexicalRank: number | null
  readonly vectorRank: number | null
}

export interface KbAclRecord {
  readonly companyId: string
  readonly category: string
  readonly agentDefId: string
  readonly canRead: boolean
  readonly canWrite: boolean
}

/* ------------------------------------------------------------ conversation */

export interface ConversationRecord {
  readonly id: string
  readonly companyId: string
  readonly userId: string
  readonly title: string
  readonly phase: ConversationPhase
  readonly briefJson: string | null
  /**
   * Ngôn ngữ agent dùng để trả lời trong phiên này (`'vi'` hoặc `'en'`).
   *
   * Gắn ở phiên để báo cáo cũ giữ nguyên ngôn ngữ lúc tạo; xem migration
   * `0007_conversation_language` để biết vì sao không gắn ở người dùng.
   */
  readonly language: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface MessageRecord {
  readonly id: string
  readonly conversationId: string
  readonly companyId: string
  readonly role: 'user' | 'assistant' | 'system'
  readonly authorKind: MessageAuthorKind
  readonly authorAgent: string | null
  readonly contentMd: string
  readonly metaJson: string | null
  readonly tokensIn: number
  readonly tokensOut: number
  readonly costUsd: number
  readonly createdAt: string
}

export interface TaskRecord {
  readonly id: string
  readonly companyId: string
  readonly conversationId: string | null
  readonly parentTaskId: string | null
  readonly title: string
  readonly briefMd: string
  readonly assigneeAgentDefId: string | null
  readonly status: TaskStatus
  readonly priority: number
  readonly deadline: string | null
  readonly resultMd: string | null
  readonly deliverableSpec: string | null
  readonly revisionCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface TaskDepRecord {
  readonly taskId: string
  readonly dependsOnTaskId: string
}

export interface ArtifactRecord {
  readonly id: string
  readonly companyId: string
  readonly taskId: string | null
  readonly name: string
  readonly kind: ArtifactKind
  readonly content: string | null
  readonly path: string | null
  readonly metaJson: string | null
  readonly createdAt: string
}

export interface AgentMessageRecord {
  readonly id: string
  readonly companyId: string
  readonly fromAgent: string
  readonly toAgent: string
  readonly taskId: string | null
  readonly kind: AgentMessageKind
  readonly contentMd: string
  readonly createdAt: string
}

/* ------------------------------------------------------------- accounting */

export interface RunRecord {
  readonly id: string
  readonly companyId: string
  readonly taskId: string | null
  readonly conversationId: string | null
  readonly agentDefId: string
  readonly providerId: string | null
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

/* -------------------------------------------------------- llm wire shapes */

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool'

export interface LlmToolCall {
  readonly id: string
  readonly name: string
  /** Raw JSON string as returned by the provider; parsed by the runtime. */
  readonly argumentsJson: string
}

export interface LlmMessage {
  readonly role: LlmRole
  readonly content: string
  readonly toolCalls?: readonly LlmToolCall[]
  readonly toolCallId?: string
  readonly name?: string
}

/** JSON Schema object describing a tool's parameters, as providers expect it. */
export interface ToolParameterSchema {
  readonly type: 'object'
  readonly properties: Record<string, unknown>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean
}

export interface LlmToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: ToolParameterSchema
}

export interface LlmUsage {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly cachedTokens: number
}

export interface LlmChatRequest {
  readonly model: string
  readonly messages: readonly LlmMessage[]
  readonly tools?: readonly LlmToolDefinition[]
  readonly maxTokens?: number
  readonly reasoningEffort?: string | null
  readonly temperature?: number
  readonly signal?: AbortSignal
}

/** Streaming chunk; `done` carries the final usage so cost can be committed. */
export type LlmChunk =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | { readonly type: 'tool_call'; readonly call: LlmToolCall }
  | { readonly type: 'done'; readonly finishReason: string | null; readonly usage: LlmUsage }

/* ------------------------------------------------------------------ tools */

/** Context handed to a tool handler; carries tenancy plus the run identity. */
export interface ToolContext {
  readonly companyId: string
  readonly agentRole: AgentRole
  readonly agentDefId: string
  readonly taskId: string | null
  readonly conversationId: string | null
  readonly signal?: AbortSignal
  readonly log: (message: string, data?: unknown) => void
}

export interface ToolResult {
  /** Model-facing text. Must be self-describing: the model sees only this. */
  readonly content: string
  readonly isError?: boolean
  /** Structured payload for callers that persist side effects (artifacts, cost). */
  readonly data?: unknown
}

/** A tool a specialist agent may call, subject to its preset grant. */
export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: ToolParameterSchema
  /** Roles allowed by default; a preset grant may narrow this but never widen it. */
  readonly roles?: readonly AgentRole[]
  /** True when the tool performs an outward-facing side effect needing approval. */
  readonly requiresApproval?: boolean
  readonly handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

/* ----------------------------------------------------------- integrations */

export interface IntegrationRecord {
  readonly id: string
  readonly companyId: string
  readonly kind: IntegrationKind
  readonly name: string
  readonly configEnc: string | null
  readonly configIv: string | null
  readonly status: string
  readonly lastCheckAt: string | null
  readonly createdAt: string
}
