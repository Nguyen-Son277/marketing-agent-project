/**
 * Idempotent seeding.
 *
 * `seedCatalog` installs the global catalog (agent definitions, skills, the
 * default provider and its models) and is safe to re-run: every write is an
 * upsert keyed by a natural key.
 *
 * `seedCompany` configures one company end to end — presets, model routes,
 * knowledge ACLs — and optionally creates an owner account and the demo
 * knowledge base. Re-running it repairs missing rows without duplicating any.
 */
import { createHash } from 'node:crypto'
import {
  KB_CATEGORIES,
  type AgentRole,
  type CompanyRecord,
  type ModelTier,
  type PublicUser,
  slugify,
  type UserRecord,
} from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { AGENT_DEF_SEEDS, expandKnowledgeRead, type AgentDefSeed } from './agents.ts'
import { SKILL_SEEDS } from './skills.ts'
import { PROVIDER_SEEDS, DEFAULT_TIER_ROUTES } from './providers.ts'
import { DEMO_KB_DOCUMENTS } from './knowledge.ts'

const ALL_CATEGORIES: readonly string[] = KB_CATEGORIES.map((c) => c.code)

export interface SeedCatalogResult {
  readonly agentDefs: number
  readonly skills: number
  readonly providers: number
  readonly models: number
}

/** Install or repair the global catalog every company depends on. */
export function seedCatalog(repos: Repos): SeedCatalogResult {
  for (const skill of SKILL_SEEDS) {
    repos.team.upsertSkill({
      name: skill.name,
      description: skill.description,
      category: skill.category,
      bodyMd: skill.bodyMd,
    })
  }

  for (const def of AGENT_DEF_SEEDS) {
    repos.team.upsertAgentDef({
      role: def.role,
      name: def.name,
      description: def.description,
      systemPrompt: def.basePrompt,
      defaultSkills: def.defaultSkills,
      defaultTools: def.defaultTools,
      isLeader: def.isLeader ?? false,
    })
  }

  let models = 0
  for (const provider of PROVIDER_SEEDS) {
    // Providers seeded locally are global (companyId null) so every company can use them.
    const existing = findByBaseUrl(repos, provider.baseUrl, provider.name)
    const record =
      existing ??
      repos.llm.createProvider({
        companyId: null,
        name: provider.name,
        kind: provider.kind,
        baseUrl: provider.baseUrl,
        apiKeyRef: provider.apiKeyRef,
        enabled: provider.enabled,
      })
    for (const model of provider.models) {
      const already = repos.llm.findModelByModelId(record.id, model.modelId)
      if (already) {
        repos.llm.updateModel(already.id, {
          label: model.label,
          contextWindow: model.contextWindow,
          maxOutput: model.maxOutput,
          supportsTools: model.supportsTools,
          supportsVision: model.supportsVision,
          costInPerMtok: model.costInPerMtok,
          costOutPerMtok: model.costOutPerMtok,
          enabled: true,
        })
      } else {
        repos.llm.createModel({
          providerId: record.id,
          modelId: model.modelId,
          label: model.label,
          contextWindow: model.contextWindow,
          maxOutput: model.maxOutput,
          supportsTools: model.supportsTools,
          supportsVision: model.supportsVision,
          costInPerMtok: model.costInPerMtok,
          costOutPerMtok: model.costOutPerMtok,
        })
      }
      models++
    }
  }

  return {
    agentDefs: AGENT_DEF_SEEDS.length,
    skills: SKILL_SEEDS.length,
    providers: PROVIDER_SEEDS.length,
    models,
  }
}

/**
 * Find a globally seeded provider by its canonical base URL, falling back to the
 * seeded name. Re-running the seed must reuse the row, never duplicate it.
 */
function findByBaseUrl(repos: Repos, baseUrl: string, name: string) {
  const normalized = baseUrl.replace(/\/+$/, '')
  const byUrl = repos.db.get<{ id: string }>(
    'SELECT id FROM llm_providers WHERE base_url = ? AND company_id IS NULL',
    [normalized],
  )
  if (byUrl) return repos.llm.findProvider(byUrl.id)
  const byName = repos.db.get<{ id: string }>(
    'SELECT id FROM llm_providers WHERE name = ? AND company_id IS NULL',
    [name],
  )
  return byName ? repos.llm.findProvider(byName.id) : undefined
}

export interface SeedCompanyOptions {
  readonly companyName: string
  /** Creates (or reuses) this user as the company owner. */
  readonly ownerEmail?: string
  readonly ownerPassword?: string
  readonly ownerName?: string
  /** Install the demo knowledge base documents. */
  readonly withDemoKnowledge?: boolean
}

export interface SeedCompanyResult {
  readonly company: CompanyRecord
  readonly owner?: PublicUser
  readonly presets: number
  readonly routes: number
  readonly aclEntries: number
  readonly documents: number
}

/** Configure a company: presets, tier routes, knowledge ACLs, optional content. */
export function seedCompany(repos: Repos, options: SeedCompanyOptions): SeedCompanyResult {
  const company = ensureCompany(repos, options.companyName)

  let owner: PublicUser | undefined
  if (options.ownerEmail && options.ownerPassword) {
    owner = ensureOwner(repos, company, options)
  }

  // Presets first, so every agent can resolve a model. `ensurePresetsForCompany`
  // applies each definition's preferred tier when it creates the row.
  const presets = repos.team.ensurePresetsForCompany(company.id)

  for (const def of AGENT_DEF_SEEDS) {
    const agentDefId = requireDefId(repos, def)
    const preset = repos.team.findPreset(company.id, agentDefId)
    if (preset && preset.tier !== def.tier) {
      repos.team.updatePreset(company.id, agentDefId, { tier: def.tier })
    }
  }
  const modelByModelId = new Map<string, string>()
  for (const record of repos.llm.listModels(company.id)) {
    if (!modelByModelId.has(record.modelId)) modelByModelId.set(record.modelId, record.id)
  }
  let routes = 0
  for (const route of DEFAULT_TIER_ROUTES) {
    const modelFk = modelByModelId.get(route.modelId)
    const agentDef = repos.team.findAgentDefByRole(route.role)
    if (!modelFk || !agentDef) continue
    repos.llm.upsertRoute({
      companyId: company.id,
      agentDefId: agentDef.id,
      tier: route.tier,
      modelFk,
    })
    routes++
  }

  // Knowledge ACL per agent definition, derived from the definition's reads.
  let aclEntries = 0
  for (const def of AGENT_DEF_SEEDS) {
    const agentDef = repos.team.findAgentDefByRole(def.role)
    if (!agentDef) continue
    const readable = new Set(expandKnowledgeRead(def.knowledgeRead, ALL_CATEGORIES))
    const writable = new Set(def.knowledgeWrite)
    repos.team.setKnowledgeAcl(
      company.id,
      agentDef.id,
      ALL_CATEGORIES.map((category) => ({
        category,
        canRead: readable.has(category),
        canWrite: writable.has(category),
      })),
    )
    aclEntries += ALL_CATEGORIES.length
  }

  let documents = 0
  if (options.withDemoKnowledge) {
    documents = seedKnowledge(repos, company.id)
  }

  return { company, owner, presets: presets.length, routes, aclEntries, documents }
}

function requireDefId(repos: Repos, def: AgentDefSeed): string {
  const agentDef = repos.team.findAgentDefByRole(def.role)
  if (!agentDef) throw new Error(`Thiếu định nghĩa agent ${def.role}; hãy chạy seedCatalog trước`)
  return agentDef.id
}

function ensureCompany(repos: Repos, name: string): CompanyRecord {
  const slug = slugify(name)
  const existing = repos.auth.findCompanyBySlug(slug)
  if (existing) return existing
  const id = `cmp_${slug.replaceAll('-', '').slice(0, 20)}_${Math.random().toString(36).slice(2, 8)}`
  repos.db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)', [
    id,
    name,
    slug,
    new Date().toISOString(),
  ])
  const created = repos.auth.findCompanyById(id)
  if (!created) throw new Error('Không tạo được công ty')
  return created
}

function ensureOwner(repos: Repos, company: CompanyRecord, options: SeedCompanyOptions): PublicUser {
  const email = options.ownerEmail!.trim().toLowerCase()
  let user: UserRecord | undefined = repos.auth.findUserByEmail(email)
  if (!user) {
    user = repos.auth.createUser({
      email,
      password: options.ownerPassword!,
      name: options.ownerName ?? 'Chủ sở hữu',
    })
  }
  repos.auth.addMembership(company.id, user.id, 'owner')
  return { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin }
}

/** Insert the demo documents. Chunking is the knowledge package's job, so this
 *  stores documents only when the caller has no indexer available; the CLI
 *  indexes them right after. */
export function seedKnowledge(repos: Repos, companyId: string): number {
  let count = 0
  for (const doc of DEMO_KB_DOCUMENTS) {
    const existing = repos.knowledge.findDocument(companyId, doc.path)
    if (existing && existing.checksum === checksumOf(doc.content)) continue
    // Chunks are produced by the knowledge package's indexer; seed a single
    // whole-document chunk so retrieval works even before an index run.
    repos.knowledge.upsertDocumentAndChunks(
      {
        companyId,
        path: doc.path,
        title: doc.title,
        category: doc.category,
        tags: doc.tags,
        content: doc.content,
        source: 'seed',
      },
      [{ ordinal: 0, text: doc.content, headingPath: doc.title, tokens: Math.ceil(doc.content.length / 4) }],
    )
    count++
  }
  return count
}

function checksumOf(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Roles and tiers a company is expected to have configured; used by tests. */
export function expectedTierMatrix(): { role: AgentRole; tier: ModelTier }[] {
  return AGENT_DEF_SEEDS.map((def) => ({ role: def.role, tier: def.tier }))
}
