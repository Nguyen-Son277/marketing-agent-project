/**
 * Domain vocabulary shared by every package: roles, statuses, tiers, and
 * knowledge categories. Kept dependency-free so any layer may import it.
 */

/** The ten specialist roles plus the orchestrating leader. Order is display order. */
export const AGENT_ROLES = [
  'marketing-leader',
  'market-research',
  'content-writer',
  'seo-technical',
  'social-media',
  'paid-media',
  'email-crm',
  'design-video',
  'analytics',
  'community-care',
] as const

export type AgentRole = (typeof AGENT_ROLES)[number]

export const LEADER_ROLE: AgentRole = 'marketing-leader'

/** Model cost/quality tier an agent runs at. Router falls back light → standard → deep. */
export const MODEL_TIERS = ['light', 'standard', 'deep'] as const
export type ModelTier = (typeof MODEL_TIERS)[number]

/** Provider wire protocol. `openai_compatible` covers the local gateway at :20128. */
export const PROVIDER_KINDS = ['openai_compatible', 'anthropic'] as const
export type ProviderKind = (typeof PROVIDER_KINDS)[number]

export const COMPANY_ROLES = ['owner', 'admin', 'member', 'viewer'] as const
export type CompanyRole = (typeof COMPANY_ROLES)[number]

export const TASK_STATUSES = [
  'draft',
  'assigned',
  'in_progress',
  'blocked',
  'review',
  'done',
  'failed',
  'cancelled',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Statuses that mean the task is no longer running. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['done', 'failed', 'cancelled']

export const MESSAGE_AUTHOR_KINDS = ['user', 'leader', 'specialist', 'system', 'tool'] as const
export type MessageAuthorKind = (typeof MESSAGE_AUTHOR_KINDS)[number]

export const AGENT_MESSAGE_KINDS = ['handoff', 'request', 'reply', 'blocker'] as const
export type AgentMessageKind = (typeof AGENT_MESSAGE_KINDS)[number]

export const ARTIFACT_KINDS = ['markdown', 'json', 'csv', 'image', 'html', 'link'] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export const CONVERSATION_PHASES = ['intake', 'clarify', 'brief', 'plan', 'assign', 'execute', 'review', 'report', 'closed'] as const
export type ConversationPhase = (typeof CONVERSATION_PHASES)[number]

/**
 * Knowledge categories: the ACL unit. `code` is the stable directory prefix and
 * the value stored in kb_acl; agents may only read categories they are granted.
 */
export const KB_CATEGORIES = [
  { code: '00-cong-ty', label: 'Công ty & sản phẩm', description: 'Tổng quan, sản phẩm/dịch vụ, khách hàng mục tiêu, đối thủ.' },
  { code: '10-brand', label: 'Thương hiệu & giọng nói', description: 'Brand guidelines, tone of voice, quy định pháp lý.' },
  { code: '20-thi-truong', label: 'Thị trường & đối thủ', description: 'Nghiên cứu thị trường, xu hướng ngành, hồ sơ đối thủ.' },
  { code: '30-kenh', label: 'Kênh & playbook', description: 'SEO, social, ads — chiến lược và playbook theo kênh.' },
  { code: '40-du-lieu', label: 'Dữ liệu & hiệu suất', description: 'Chỉ số GA4, kết quả chiến dịch, bài học.' },
  { code: '90-ket-qua', label: 'Kết quả & tài sản', description: 'Báo cáo, nội dung đã duyệt, tài sản tái sử dụng.' },
] as const

export type KbCategoryCode = (typeof KB_CATEGORIES)[number]['code']

export const KB_CATEGORY_CODES: readonly string[] = KB_CATEGORIES.map((c) => c.code)

export function isKbCategory(value: string): value is KbCategoryCode {
  return KB_CATEGORY_CODES.includes(value)
}

/**
 * Built-in skill names. A company's agents are granted skill subsets so the
 * model only sees methods relevant to its role.
 */
export const SKILL_NAMES = [
  'brief-intake',
  'task-decomposition',
  'quality-review',
  'report-writing',
  'market-research',
  'competitor-analysis',
  'persona-building',
  'copywriting',
  'seo-writing',
  'brand-voice',
  'keyword-research',
  'technical-seo-audit',
  'content-calendar',
  'social-copywriting',
  'campaign-structure',
  'audience-targeting',
  'budget-optimization',
  'email-sequence',
  'crm-segmentation',
  'creative-brief',
  'storyboarding',
  'data-analysis',
  'kpi-reporting',
  'anomaly-detection',
  'community-response',
  'crisis-escalation',
] as const

export type SkillName = (typeof SKILL_NAMES)[number]

/** Per-run lifecycle, used for cost/latency accounting. */
export const RUN_STATUSES = ['running', 'succeeded', 'failed', 'cancelled', 'budget_exceeded'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const KB_INDEX_STATUSES = ['pending', 'indexed', 'failed', 'skipped'] as const
export type KbIndexStatus = (typeof KB_INDEX_STATUSES)[number]

export const INTEGRATION_KINDS = [
  'firecrawl',
  'google-search-console',
  'google-analytics',
  'google-sheets',
  'meta',
  'linkedin',
  'google-ads',
  'email-smtp',
] as const
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number]
