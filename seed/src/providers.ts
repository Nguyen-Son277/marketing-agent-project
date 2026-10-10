/**
 * Default provider and model catalog.
 *
 * The local gateway at :20128 is an OpenAI-compatible router in front of many
 * upstream providers, so one provider row reaches every model. Its API key is
 * required (verified: an unauthenticated call returns `Missing API key`), and is
 * referenced by environment-variable name rather than stored in the repository.
 *
 * Costs are USD per million tokens. The gateway does not bill per model, and
 * deepseek-* rows are local-route models with zero marginal cost, so the cost
 * columns exist for providers a company adds later (OpenAI, Anthropic, OpenRouter).
 */
export interface ModelSeed {
  readonly modelId: string
  readonly label: string
  readonly contextWindow: number
  readonly maxOutput: number
  readonly supportsTools: boolean
  readonly supportsVision: boolean
  readonly costInPerMtok: number
  readonly costOutPerMtok: number
  /** Which agent tiers this model is the default for, if any. */
  readonly tiers?: readonly ('light' | 'standard' | 'deep')[]
}

export interface ProviderSeed {
  readonly name: string
  readonly kind: 'openai_compatible' | 'anthropic'
  readonly baseUrl: string
  /** Environment variable holding the key. Resolved per request, never persisted. */
  readonly apiKeyRef: string
  readonly models: readonly ModelSeed[]
  readonly enabled: boolean
  /** Marks the row created by seeding, so re-seeding can find it again. */
  readonly seedKey: string
}

export const DEFAULT_BASE_URL = process.env.DEFAULT_LLM_BASE_URL ?? 'http://localhost:20128/v1'
export const DEFAULT_API_KEY_REF = process.env.DEFAULT_LLM_API_KEY_REF ?? 'DEEPSEEK_API_KEY'

export const PROVIDER_SEEDS: readonly ProviderSeed[] = [
  {
    name: 'Gateway nội bộ (OpenAI-compatible)',
    kind: 'openai_compatible',
    baseUrl: DEFAULT_BASE_URL,
    apiKeyRef: DEFAULT_API_KEY_REF,
    enabled: true,
    seedKey: 'gateway-local',
    models: [
      {
        modelId: 'deepseek-v4-flash',
        label: 'DeepSeek-V4-Flash (nhanh, rẻ)',
        contextWindow: 128_000,
        maxOutput: 32_000,
        supportsTools: true,
        supportsVision: false,
        costInPerMtok: 0,
        costOutPerMtok: 0,
        tiers: ['light', 'standard'],
      },
      {
        modelId: 'deepseek-v4-pro',
        label: 'DeepSeek-V4-Pro (suy luận sâu)',
        contextWindow: 200_000,
        maxOutput: 64_000,
        supportsTools: true,
        supportsVision: false,
        costInPerMtok: 0,
        costOutPerMtok: 0,
        tiers: ['deep'],
      },
      {
        modelId: 'deepseek-v4-flash-vision-exp',
        label: 'DeepSeek-V4-Flash Vision (thử nghiệm)',
        contextWindow: 128_000,
        maxOutput: 32_000,
        supportsTools: true,
        supportsVision: true,
        costInPerMtok: 0,
        costOutPerMtok: 0,
      },
      {
        modelId: 'claude-sonnet-5-5',
        label: 'Claude Sonnet 5.5 (qua gateway)',
        contextWindow: 200_000,
        maxOutput: 64_000,
        supportsTools: true,
        supportsVision: true,
        costInPerMtok: 3,
        costOutPerMtok: 15,
      },
      {
        modelId: 'gpt-5.6-luna',
        label: 'GPT-5.6 Luna (qua gateway)',
        contextWindow: 200_000,
        maxOutput: 64_000,
        supportsTools: true,
        supportsVision: true,
        costInPerMtok: 2.5,
        costOutPerMtok: 10,
      },
    ],
  },
]

/**
 * Agent-tier → model assignments applied to a company by default. This is the
 * cost lever: only the roles that genuinely need deeper reasoning run the pro
 * model; everything else stays on flash.
 */
export const DEFAULT_TIER_ROUTES: readonly {
  readonly role: string
  readonly tier: 'light' | 'standard' | 'deep'
  readonly modelId: string
}[] = [
  { role: 'marketing-leader', tier: 'light', modelId: 'deepseek-v4-flash' },
  { role: 'marketing-leader', tier: 'standard', modelId: 'deepseek-v4-flash' },
  { role: 'marketing-leader', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'market-research', tier: 'standard', modelId: 'deepseek-v4-flash' },
  { role: 'market-research', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'content-writer', tier: 'light', modelId: 'deepseek-v4-flash' },
  { role: 'content-writer', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'seo-technical', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'social-media', tier: 'light', modelId: 'deepseek-v4-flash' },
  { role: 'social-media', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'paid-media', tier: 'standard', modelId: 'deepseek-v4-flash' },
  { role: 'paid-media', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'email-crm', tier: 'standard', modelId: 'deepseek-v4-flash' },
  { role: 'email-crm', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'design-video', tier: 'standard', modelId: 'deepseek-v4-flash' },
  { role: 'design-video', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'analytics', tier: 'standard', modelId: 'deepseek-v4-flash' },
  { role: 'analytics', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'community-care', tier: 'standard', modelId: 'deepseek-v4-flash' },
  { role: 'community-care', tier: 'deep', modelId: 'deepseek-v4-pro' },
]

/** Default guardrails, overridable per company in `app_settings`. */
export const DEFAULT_BUDGET = {
  /** Max USD a company may spend per calendar day before work is refused. */
  dailyCostUsd: 20,
  /** Max USD a single conversational task may spend before it is paused. */
  taskCostUsd: 2,
  /** Max model steps one agent run may take. */
  maxStepsPerRun: 12,
  /** Max peer agent-to-agent question rounds per task. */
  maxPeerRounds: 3,
  /** Max review/revision loops before the leader must decide. */
  maxRevisionsPerTask: 2,
} as const
