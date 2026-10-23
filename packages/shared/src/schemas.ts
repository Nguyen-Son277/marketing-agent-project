/** Zod validators for HTTP and tool boundaries. Records use snake-free camelCase. */
import { z } from 'zod'
import { validation } from './errors.ts'
import {
  AGENT_ROLES,
  ARTIFACT_KINDS,
  COMPANY_ROLES,
  INTEGRATION_KINDS,
  KB_CATEGORY_CODES,
  MODEL_TIERS,
  PROVIDER_KINDS,
} from './domain.ts'

export const emailSchema = z.string().trim().toLowerCase().email('Email không hợp lệ')
export const passwordSchema = z
  .string()
  .min(10, 'Mật khẩu cần ít nhất 10 ký tự')
  .max(200, 'Mật khẩu quá dài')

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, 'Cần tên hiển thị').max(120),
})
export type RegisterInput = z.infer<typeof registerSchema>

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Cần mật khẩu').max(200),
})
export type LoginInput = z.infer<typeof loginSchema>

export const createCompanySchema = z.object({
  name: z.string().trim().min(1, 'Cần tên công ty').max(160),
})
export type CreateCompanyInput = z.infer<typeof createCompanySchema>

export const providerKindSchema = z.enum(PROVIDER_KINDS)
export const providerKeyUsageModeSchema = z.enum(['failover', 'round_robin'])
export const modelTierSchema = z.enum(MODEL_TIERS)
export const agentRoleSchema = z.enum(AGENT_ROLES)
export const companyRoleSchema = z.enum(COMPANY_ROLES)
export const artifactKindSchema = z.enum(ARTIFACT_KINDS)
export const integrationKindSchema = z.enum(INTEGRATION_KINDS)
export const kbCategorySchema = z.enum(KB_CATEGORY_CODES as [string, ...string[]])

export const createProviderSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: providerKindSchema.default('openai_compatible'),
  baseUrl: z.string().trim().url('URL không hợp lệ'),
  keyUsageMode: providerKeyUsageModeSchema.default('failover'),
  /**
   * Khoá đầu tiên, tuỳ chọn. Plaintext chỉ nhận một lần khi ghi rồi mã hoá ngay.
   * Thêm khoá tiếp theo bằng endpoint `/providers/:id/keys`.
   */
  apiKey: z.string().trim().min(1).max(500).optional(),
  apiKeyLabel: z.string().trim().min(1).max(80).optional(),
  extraJson: z.record(z.unknown()).optional(),
  enabled: z.boolean().default(true),
})
export type CreateProviderInput = z.infer<typeof createProviderSchema>

/**
 * Sửa provider KHÔNG nhận khoá: đổi khoá là thao tác trên từng khoá, để một lần gõ
 * nhầm không âm thầm thay khoá đang chạy và để nhiều khoá cùng tồn tại được.
 */
export const updateProviderSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  kind: providerKindSchema.optional(),
  baseUrl: z.string().trim().url('URL không hợp lệ').optional(),
  keyUsageMode: providerKeyUsageModeSchema.optional(),
  extraJson: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
})
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>

export const createProviderKeySchema = z.object({
  label: z.string().trim().min(1, 'Cần nhãn cho khoá').max(80),
  apiKey: z.string().trim().min(1).max(500),
  /** Số nhỏ dùng trước. Khoá đầu tiên nên là 100, khoá dự phòng 200, 300, … */
  priority: z.number().int().min(0).max(10_000).default(100),
  enabled: z.boolean().default(true),
})
export type CreateProviderKeyInput = z.infer<typeof createProviderKeySchema>

export const updateProviderKeySchema = createProviderKeySchema.partial()
export type UpdateProviderKeyInput = z.infer<typeof updateProviderKeySchema>

/** Fetch model: chọn khoá nào để gọi, bỏ trống thì dùng khoá đang bật có priority nhỏ nhất. */
export const fetchModelsSchema = z.object({
  keyId: z.string().min(1).optional(),
})
export type FetchModelsInput = z.infer<typeof fetchModelsSchema>

export const importModelSchema = z.object({
  modelId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(160).optional(),
  contextWindow: z.number().int().positive().max(10_000_000).optional(),
  maxOutput: z.number().int().positive().max(1_000_000).optional(),
  supportsTools: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  costInPerMtok: z.number().min(0).optional(),
  costOutPerMtok: z.number().min(0).optional(),
})
export type ImportModelInput = z.infer<typeof importModelSchema>

export const importModelsSchema = z.object({
  models: z.array(importModelSchema).min(1).max(200),
})
export type ImportModelsInput = z.infer<typeof importModelsSchema>

export const createModelSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(160),
  contextWindow: z.number().int().positive().max(10_000_000).default(128_000),
  maxOutput: z.number().int().positive().max(1_000_000).default(16_000),
  supportsTools: z.boolean().default(true),
  supportsVision: z.boolean().default(false),
  costInPerMtok: z.number().finite().min(0).default(0),
  costOutPerMtok: z.number().finite().min(0).default(0),
  enabled: z.boolean().default(true),
})
export type CreateModelInput = z.infer<typeof createModelSchema>

export const updateModelSchema = createModelSchema.partial().omit({ providerId: true })
export type UpdateModelInput = z.infer<typeof updateModelSchema>

export const upsertRouteSchema = z.object({
  agentRole: agentRoleSchema,
  tier: modelTierSchema,
  modelFk: z.string().min(1),
  reasoningEffort: z.string().trim().max(40).nullable().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  priority: z.number().int().min(0).max(100).default(100),
})
export type UpsertRouteInput = z.infer<typeof upsertRouteSchema>

export const updateTeamMemberSchema = z.object({
  enabled: z.boolean().optional(),
  displayName: z.string().trim().max(120).nullable().optional(),
  modelFk: z.string().min(1).nullable().optional(),
  /**
   * Danh sách model dự phòng theo thứ tự dùng. Giới hạn 5 để chuỗi thử vẫn ngắn:
   * mỗi phần tử là một lần gọi model thật, tốn thời gian và tiền.
   */
  fallbackModelFks: z.array(z.string().min(1)).max(5).optional(),
  tier: modelTierSchema.optional(),
  reasoningEffort: z.string().trim().max(40).nullable().optional(),
  maxTokens: z.number().int().positive().max(1_000_000).nullable().optional(),
  contextBudgetTokens: z.number().int().min(2_000).max(2_000_000).optional(),
  systemPromptOverride: z.string().max(20_000).nullable().optional(),
  requireApproval: z.boolean().optional(),
  skills: z.array(z.string().trim().min(1)).optional(),
  tools: z.array(z.string().trim().min(1)).optional(),
  knowledge: z
    .array(
      z.object({
        category: kbCategorySchema,
        canRead: z.boolean().default(true),
        canWrite: z.boolean().default(false),
      }),
    )
    .optional(),
})
export type UpdateTeamMemberInput = z.infer<typeof updateTeamMemberSchema>

/**
 * Đổi tên công ty.
 *
 * Giới hạn 120 ký tự để tên vừa thanh tiêu đề và ô chọn công ty; cắt khoảng trắng vì
 * tên chỉ có khoảng trắng ở hai đầu là lỗi gõ, không phải tên thật.
 */
export const updateCompanySchema = z.object({
  name: z.string().trim().min(1, 'Cần tên công ty').max(120, 'Tên công ty quá dài'),
})

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).default('Cuộc trao đổi mới'),
  /**
   * Ngôn ngữ agent dùng để trả lời trong phiên này.
   *
   * Vì sao TỪ CHỐI giá trị lạ thay vì âm thầm đổi thành `'vi'`: nếu im lặng sửa, người
   * gọi tưởng đã đặt được tiếng Anh và chỉ phát hiện khi đọc báo cáo — sai lệch âm thầm
   * khó lần ra hơn một lỗi rõ ràng. Danh sách ngôn ngữ khai báo tại đây thay vì import
   * từ gói i18n, vì `shared` là tầng thấp không phụ thuộc gói i18n.
   */
  language: z.enum(['vi', 'en']).default('vi'),
})
export type CreateConversationInput = z.infer<typeof createConversationSchema>

export const sendMessageSchema = z.object({
  mode: z.enum(['campaign','workforce']).default('campaign'),
  content: z.string().trim().max(20_000).default(''),
  attachmentIds: z.array(z.string().uuid()).max(5).default([]),
  /** When true the leader plans and dispatches immediately instead of asking first. */
  autoPlan: z.boolean().default(false),
  /**
   * Câu trả lời cho thẻ chọn phương án, nếu lượt trước Leader có hỏi lại.
   *
   * Vì sao gửi kèm mã phương án thay vì chỉ gửi `content`: người dùng chọn "Không chạy
   * TikTok" mà máy lại suy ra `scope` là "chạy TikTok" thì đó là lỗi nguy hiểm. Có mã
   * phương án, server ánh xạ thẳng vào trường brief, không phải đoán từ câu chữ.
   */
  answers: z
    .array(
      z.object({
        field: z.string().trim().min(1).max(40),
        optionIds: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
        custom: z.string().trim().max(2_000).optional(),
      }),
    )
    .max(6)
    .default([]),
}).refine((input) => input.content.length > 0 || input.attachmentIds.length > 0, {
  message: 'Cần nội dung hoặc tệp đính kèm', path: ['content'],
}).refine((input) => new Set(input.attachmentIds).size === input.attachmentIds.length, {
  message: 'Tệp đính kèm bị trùng', path: ['attachmentIds'],
})
export type SendMessageInput = z.infer<typeof sendMessageSchema>

export const upsertKnowledgeSchema = z.object({
  path: z.string().trim().min(1).max(400),
  title: z.string().trim().min(1).max(300),
  category: kbCategorySchema,
  tags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  content: z.string().max(2_000_000),
})
export type UpsertKnowledgeInput = z.infer<typeof upsertKnowledgeSchema>

export const reindexSchema = z.object({
  paths: z.array(z.string().trim().min(1)).max(500).optional(),
  force: z.boolean().default(false),
})
export type ReindexInput = z.infer<typeof reindexSchema>

export const reviewTaskSchema = z.object({
  decision: z.enum(['approve', 'request_changes', 'cancel']),
  note: z.string().trim().max(4_000).optional(),
})
export type ReviewTaskInput = z.infer<typeof reviewTaskSchema>

/** Firecrawl cloud chỉ cần key; URL gốc riêng là tuỳ chọn cho self-host/proxy. */
export const firecrawlConfigSchema = z.object({
  apiKey: z.string().trim().min(1, 'Cần API key Firecrawl').max(2000),
  baseUrl: z.string().trim().url('URL Firecrawl không hợp lệ').refine((value) => {
    try {
      const url = new URL(value)
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
    } catch { return false }
  }, 'URL phải là HTTP/HTTPS, không chứa thông tin đăng nhập, query hoặc fragment').optional(),
}).passthrough()

export const upsertIntegrationSchema = z.object({
  kind: integrationKindSchema,
  name: z.string().trim().min(1).max(80),
  /** Integration secrets/credentials, encrypted before storage. */
  config: z.record(z.unknown()),
}).superRefine((input, ctx) => {
  if (input.kind !== 'firecrawl') return
  const result = firecrawlConfigSchema.safeParse(input.config)
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue({ ...issue, path: ['config', ...issue.path] })
  }
}).transform((input) => input.kind === 'firecrawl'
  ? { ...input, config: firecrawlConfigSchema.parse(input.config) }
  : input)
export type UpsertIntegrationInput = z.infer<typeof upsertIntegrationSchema>

export const costQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
})
export type CostQueryInput = z.infer<typeof costQuerySchema>

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})
export type PaginationInput = z.infer<typeof paginationSchema>

/** Parse a payload or throw a 400-shaped validation AppError. */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, payload: unknown, label = 'dữ liệu'): z.output<S> {
  const result = schema.safeParse(payload)
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join('.') || '(root)',
      message: i.message,
    }))
    throw validation(`${label} không hợp lệ`, issues)
  }
  return result.data
}
