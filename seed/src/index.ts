/**
 * Idempotent seeding.
 *
 * `seedCatalog` installs the global catalog (agent definitions, skills, the
 * default provider and its models) and is safe to re-run: every write is an
 * upsert keyed by a natural key.
 *
 * `seedCompany` configures one company end to end — presets, knowledge ACLs — and
 * optionally creates an owner account and the demo knowledge base. Re-running it
 * repairs missing rows without duplicating any. Providers, API keys and models are
 * NOT seeded: the user adds them in Settings.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
import { DEMO_KB_DOCUMENTS, type SeedDocument } from './knowledge.ts'

const ALL_CATEGORIES: readonly string[] = KB_CATEGORIES.map((c) => c.code)

export interface SeedCatalogResult {
  readonly agentDefs: number
  readonly skills: number
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

  return {
    agentDefs: AGENT_DEF_SEEDS.length,
    skills: SKILL_SEEDS.length,
  }
}

export interface SeedCompanyOptions {
  readonly companyName: string
  /** Creates (or reuses) this user as the company owner. */
  readonly ownerEmail?: string
  readonly ownerPassword?: string
  readonly ownerName?: string
  /** Install the demo knowledge base documents (files on disk plus DB rows). */
  readonly withDemoKnowledge?: boolean
  /** Root for the on-disk knowledge base, one directory per company slug. */
  readonly kbRoot?: string
}

export interface SeedCompanyResult {
  readonly company: CompanyRecord
  readonly owner?: PublicUser
  readonly presets: number
  readonly aclEntries: number
  readonly documents: number
}

/** Configure a company: presets, knowledge ACLs, optional content. */
export function seedCompany(repos: Repos, options: SeedCompanyOptions): SeedCompanyResult {
  const company = ensureCompany(repos, options.companyName)

  let owner: PublicUser | undefined
  if (options.ownerEmail && options.ownerPassword) {
    owner = ensureOwner(repos, company, options)
  }

  // Presets first, so every agent has a place to store its chosen model.
  // `ensurePresetsForCompany` applies each definition's preferred tier when it creates
  // the row. KHÔNG tạo route model: model do người dùng chọn trong giao diện.
  const presets = repos.team.ensurePresetsForCompany(company.id)

  for (const def of AGENT_DEF_SEEDS) {
    const agentDefId = requireDefId(repos, def)
    const preset = repos.team.findPreset(company.id, agentDefId)
    if (preset && preset.tier !== def.tier) {
      repos.team.updatePreset(company.id, agentDefId, { tier: def.tier })
    }
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
    // `data/companies/<slug>/kb` — cùng quy ước với `pnpm kb:index` và `KB_ROOT`.
    const kbDir = options.kbRoot ? join(options.kbRoot, company.slug, 'kb') : undefined
    documents = seedKnowledge(repos, company.id, kbDir ? { kbDir } : {})
  }

  return { company, owner, presets: presets.length, aclEntries, documents }
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
      // Seed là thao tác tin cậy của người vận hành, không phải đường đăng ký công khai.
      approvalStatus: 'approved',
    })
  }
  repos.auth.addMembership(company.id, user.id, 'owner')
  return { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin, approvalStatus: user.approvalStatus, accountType:user.accountType, mustChangePassword:user.mustChangePassword }
}

/**
 * Cài kho kiến thức mẫu cho một công ty.
 *
 * Ghi vào HAI nơi, và cả hai đều cần thiết:
 *
 * 1. **File Markdown trên đĩa** (`<kbRoot>/<slug>/kb/...`) — đây là bản gốc do người
 *    quản lý, và là thứ `pnpm kb:index` đọc. Nếu chỉ ghi DB thì lệnh index được gợi ý
 *    sẽ báo "không có thư mục kiến thức", và người dùng tưởng hệ thống hỏng.
 * 2. **Bản ghi trong DB** kèm một chunk toàn văn — để truy xuất chạy được ngay, trước
 *    khi index tạo chunk theo heading và vector.
 *
 * Indexer sở hữu việc chia chunk thật; seed chỉ đảm bảo có nội dung để đọc.
 */
export function seedKnowledge(
  repos: Repos,
  companyId: string,
  options: { kbDir?: string } = {},
): number {
  let count = 0
  for (const doc of DEMO_KB_DOCUMENTS) {
    if (options.kbDir) writeKbFile(options.kbDir, doc)

    const existing = repos.knowledge.findDocument(companyId, doc.path)
    if (existing && existing.checksum === checksumOf(doc.content)) continue
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

/**
 * Ghi một tài liệu thành file Markdown có frontmatter.
 *
 * Frontmatter là bắt buộc chứ không phải trang trí: indexer đọc `category` từ đó, và
 * `category` chính là đơn vị phân quyền. Thiếu nó thì tài liệu không index được.
 */
function writeKbFile(kbDir: string, doc: SeedDocument): void {
  const target = join(kbDir, doc.path)
  mkdirSync(dirname(target), { recursive: true })
  const frontmatter = [
    '---',
    `title: ${doc.title}`,
    `category: ${doc.category}`,
    `tags: [${doc.tags.join(', ')}]`,
    '---',
    '',
  ].join('\n')
  writeFileSync(target, frontmatter + doc.content, 'utf8')
}

function checksumOf(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Roles and tiers a company is expected to have configured; used by tests. */
export function expectedTierMatrix(): { role: AgentRole; tier: ModelTier }[] {
  return AGENT_DEF_SEEDS.map((def) => ({ role: def.role, tier: def.tier }))
}

/* ---------------------------------------------------------------- re-exports */

// The package root is the only supported import surface (a subpath alias would
// be shadowed by the root alias in the test resolver), so public seed data is
// re-exported here.
export { AGENT_DEF_SEEDS, AGENT_DEF_BY_ROLE, requireAgentDefSeed, expandKnowledgeRead } from './agents.ts'
export type { AgentDefSeed } from './agents.ts'
export { SKILL_SEEDS, SKILL_SEED_BY_NAME } from './skills.ts'
export type { SkillSeed } from './skills.ts'
export { DEMO_KB_DOCUMENTS } from './knowledge.ts'
export type { SeedDocument } from './knowledge.ts'
export { DEFAULT_BUDGET } from './providers.ts'
