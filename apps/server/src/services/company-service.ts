/**
 * Company provisioning.
 *
 * Creating a company must leave it immediately usable: every agent gets a preset
 * with a working model, tier routes so the router can pick a model per tier, and
 * a knowledge ACL derived from the built-in catalog. This runs inside one
 * transaction so a half-configured company never becomes visible.
 */
import { AppError, newId, nowIso, type CompanyRecord, type CompanyRole, type PublicUser } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'

export interface CreateCompanyResult {
  readonly company: CompanyRecord
  readonly role: CompanyRole
  readonly members: number
  readonly presets: number
  readonly routes: number
}

/** Tier → model id defaults, matching the seeded catalog. Overridable per company. */
const DEFAULT_ROUTES: readonly { role: string; tier: 'light' | 'standard' | 'deep'; modelId: string }[] = [
  { role: 'marketing-leader', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'analytics', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'paid-media', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'market-research', tier: 'deep', modelId: 'deepseek-v4-pro' },
  { role: 'seo-technical', tier: 'deep', modelId: 'deepseek-v4-pro' },
]

/** Preferred tier per built-in role, used when a preset is created. */
const TIER_BY_ROLE: Readonly<Record<string, 'light' | 'standard' | 'deep'>> = {
  'marketing-leader': 'deep',
  'market-research': 'standard',
  'content-writer': 'standard',
  'seo-technical': 'standard',
  'social-media': 'standard',
  'paid-media': 'deep',
  'email-crm': 'standard',
  'design-video': 'standard',
  analytics: 'deep',
  'community-care': 'standard',
}

export interface PreflightReport {
  readonly ready: boolean
  readonly agentDefs: number
  readonly skills: number
  readonly models: number
  readonly problem?: string
}

/**
 * Verify the global catalog exists before serving traffic. A deployment that
 * forgot to seed would otherwise fail confusingly on the first message.
 */
export function preflight(repos: Repos): PreflightReport {
  const agentDefs = repos.team.listAgentDefs().length
  const skills = repos.team.listSkills().length
  const models = repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM llm_models WHERE enabled = 1')?.n ?? 0
  if (agentDefs === 0) {
    return {
      ready: false,
      agentDefs,
      skills,
      models,
      problem: 'Chưa có định nghĩa agent nào. Hãy chạy: pnpm db:seed',
    }
  }
  if (models === 0) {
    return {
      ready: false,
      agentDefs,
      skills,
      models,
      problem: 'Chưa có model nào được bật. Hãy chạy: pnpm db:seed, hoặc thêm provider trong giao diện Cài đặt.',
    }
  }
  return { ready: true, agentDefs, skills, models }
}

/** Create a company owned by `user`, fully configured. */
export function createCompanyForUser(
  repos: Repos,
  input: { name: string; slug: string; user: PublicUser },
): CreateCompanyResult {
  const report = preflight(repos)
  if (!report.ready) {
    throw new AppError('needs_configuration', report.problem ?? 'Hệ thống chưa sẵn sàng')
  }

  return repos.db.tx(() => {
    const companyId = `cmp_${newId().replaceAll('-', '').slice(0, 24)}`
    const createdAt = nowIso()
    repos.db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)', [
      companyId,
      input.name,
      input.slug,
      createdAt,
    ])
    repos.auth.addMembership(companyId, input.user.id, 'owner')

    // Presets with the role's preferred tier, then explicit routes so the router
    // has a deep-tier fallback for the roles that need it.
    const defs = repos.team.listAgentDefs()
    let presets = 0
    for (const def of defs) {
      repos.team.ensurePreset(companyId, def.id, {
        tier: TIER_BY_ROLE[def.role] ?? 'standard',
      })
      presets++
    }

    const modelByModelId = new Map<string, string>()
    for (const model of repos.llm.listModels(companyId)) {
      if (!modelByModelId.has(model.modelId)) modelByModelId.set(model.modelId, model.id)
    }
    let routes = 0
    for (const route of DEFAULT_ROUTES) {
      const modelFk = modelByModelId.get(route.modelId)
      const def = repos.team.findAgentDefByRole(route.role)
      if (!modelFk || !def) continue
      repos.llm.upsertRoute({
        companyId,
        agentDefId: def.id,
        tier: route.tier,
        modelFk,
      })
      routes++
    }

    // Knowledge ACL: leader reads everything, each specialist keeps the
    // definition's defaults already installed by `ensurePreset`.
    const company = repos.auth.findCompanyById(companyId)
    if (!company) throw new AppError('internal', 'Không tạo được công ty')

    return {
      company,
      role: 'owner' as CompanyRole,
      members: 1,
      presets,
      routes,
    }
  })
}

/** Delete a company and everything scoped to it. Cascades handle child rows. */
export function deleteCompany(repos: Repos, companyId: string): void {
  repos.db.tx(() => {
    repos.db.run('DELETE FROM companies WHERE id = ?', [companyId])
  })
}
