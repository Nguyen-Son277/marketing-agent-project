/**
 * Company provisioning.
 *
 * Creating a company must leave it immediately usable STRUCTURALLY: every agent gets
 * a preset and a knowledge ACL derived from the built-in catalog. Providers, API keys
 * and models are deliberately NOT created here — the user declares them in Settings
 * and picks a model per agent. A company therefore starts with agents enabled but no
 * model; the first run says so explicitly instead of failing at an unconfigured URL.
 */
import { AppError, newId, nowIso, type CompanyRecord, type CompanyRole, type PublicUser } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { installDefaultKnowledgeAcl } from './knowledge-acl.ts'

export interface CreateCompanyResult {
  readonly company: CompanyRecord
  readonly role: CompanyRole
  readonly members: number
  readonly presets: number
  /** Số bản ghi quyền đọc/ghi kho kiến thức đã cài (6 danh mục × 11 agent). */
  readonly aclEntries: number
}

/** Preferred tier per built-in role, used when a preset is created. */
const TIER_BY_ROLE: Readonly<Record<string, 'light' | 'standard' | 'deep'>> = {
  'marketing-leader': 'deep',
  'market-research': 'standard',
  'content-writer': 'standard',
  'seo-technical': 'standard',
  'web-technical': 'standard',
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
  readonly providers: number
  readonly problem?: string
}

/**
 * Verify the global catalog exists before serving traffic. A deployment that forgot
 * to seed would otherwise fail confusingly on the first message.
 *
 * `models`/`providers` are reported for the operator but are NOT part of readiness:
 * with per-company providers, a fresh install legitimately has none until someone
 * fills in Settings, and that must not block creating a company.
 */
export function preflight(repos: Repos): PreflightReport {
  const agentDefs = repos.team.listAgentDefs().length
  const skills = repos.team.listSkills().length
  const models = repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM llm_models WHERE enabled = 1')?.n ?? 0
  const providers = repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM llm_providers')?.n ?? 0
  if (agentDefs === 0 || skills === 0) {
    return {
      ready: false,
      agentDefs,
      skills,
      models,
      providers,
      problem: 'Chưa có định nghĩa agent hoặc kỹ năng nào. Hãy chạy: pnpm db:seed',
    }
  }
  return { ready: true, agentDefs, skills, models, providers }
}

/** Create a company owned by `user`. Providers/models are configured afterwards. */
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

    // Presets with the role's preferred tier. No routes: the model is a deliberate
    // choice the user makes in Settings → Đội agent, never a silent default.
    const defs = repos.team.listAgentDefs()
    let presets = 0
    for (const def of defs) {
      repos.team.ensurePreset(companyId, def.id, {
        tier: TIER_BY_ROLE[def.role] ?? 'standard',
      })
      presets++
    }

    // Phân quyền tri thức là bước BẮT BUỘC, không phải tuỳ chọn: thiếu nó thì mọi
    // agent chạy nhưng không đọc được tài liệu nào, và triệu chứng duy nhất là câu
    // trả lời "không tìm thấy" — rất khó lần ra. Xem services/knowledge-acl.ts.
    const aclEntries = installDefaultKnowledgeAcl(repos, companyId)

    const company = repos.auth.findCompanyById(companyId)
    if (!company) throw new AppError('internal', 'Không tạo được công ty')

    return {
      company,
      role: 'owner' as CompanyRole,
      members: 1,
      presets,
      aclEntries,
    }
  })
}

/** Delete a company and everything scoped to it. Cascades handle child rows. */
export function deleteCompany(repos: Repos, companyId: string): void {
  repos.db.tx(() => {
    repos.db.run('DELETE FROM companies WHERE id = ?', [companyId])
  })
}
