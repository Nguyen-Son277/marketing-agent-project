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
  /** Plaintext key accepted once on write, encrypted before storage. Never echoed back. */
  apiKey: z.string().trim().min(1).max(500).optional(),
  extraJson: z.record(z.unknown()).optional(),
  enabled: z.boolean().default(true),
})
export type CreateProviderInput = z.infer<typeof createProviderSchema>

export const updateProviderSchema = createProviderSchema.partial()
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>

export const createModelSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(160),
  contextWindow: z.number().int().positive().max(10_000_000).default(128_000),
  maxOutput: z.number().int().positive().max(1_000_000).default(16_000),
  supportsTools: z.boolean().default(true),
  supportsVision: z.boolean().default(false),
  costInPerMtok: z.number().min(0).default(0),
  costOutPerMtok: z.number().min(0).default(0),
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

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).default('Cuộc trao đổi mới'),
})
export type CreateConversationInput = z.infer<typeof createConversationSchema>

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1, 'Cần nội dung').max(20_000),
  /** When true the leader plans and dispatches immediately instead of asking first. */
  autoPlan: z.boolean().default(false),
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

export const upsertIntegrationSchema = z.object({
  kind: integrationKindSchema,
  name: z.string().trim().min(1).max(80),
  /** Integration secrets/credentials, encrypted before storage. */
  config: z.record(z.unknown()),
})
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
export function parseOrThrow<T>(schema: z.ZodType<T>, payload: unknown, label = 'dữ liệu'): T {
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
