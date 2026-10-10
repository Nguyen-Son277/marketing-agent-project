import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepos, type Repos } from '@marketing-agent/db'
import { AGENT_ROLES, KB_CATEGORIES } from '@marketing-agent/shared'
import { seedCatalog, seedCompany, expectedTierMatrix } from '../src/index.ts'
import { SKILL_SEEDS } from '../src/skills.ts'
import { PROVIDER_SEEDS } from '../src/providers.ts'
import { DEMO_KB_DOCUMENTS } from '../src/knowledge.ts'

let repos: Repos

beforeEach(() => {
  repos = createRepos({ file: ':memory:', allowWeakSecret: true })
  seedCatalog(repos)
})

afterEach(() => {
  repos.db.close()
})

describe('seedCatalog', () => {
  it('installs every agent definition exactly once', () => {
    const defs = repos.team.listAgentDefs()
    expect(defs).toHaveLength(AGENT_ROLES.length)
    expect(defs.map((d) => d.role).sort()).toEqual([...AGENT_ROLES].sort())
  })

  it('marks exactly one leader', () => {
    expect(repos.team.listAgentDefs().filter((d) => d.isLeader)).toHaveLength(1)
    expect(repos.team.findAgentDefByRole('marketing-leader')?.isLeader).toBe(true)
  })

  it('installs the skills', () => {
    expect(repos.team.listSkills()).toHaveLength(SKILL_SEEDS.length)
  })

  it('installs the provider and its models', () => {
    const models = repos.llm.listModels('any-company')
    expect(models.length).toBeGreaterThanOrEqual(5)
    expect(models.map((m) => m.modelId)).toContain('deepseek-v4-flash')
    expect(models.map((m) => m.modelId)).toContain('deepseek-v4-pro')
  })

  it('is idempotent: re-seeding creates no duplicates', () => {
    const first = repos.team.listAgentDefs().length
    seedCatalog(repos)
    seedCatalog(repos)
    expect(repos.team.listAgentDefs()).toHaveLength(first)
    expect(repos.team.listSkills()).toHaveLength(SKILL_SEEDS.length)
    expect(repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM llm_providers')?.n).toBe(
      PROVIDER_SEEDS.length,
    )
  })

  it('gives every definition at least one tool', () => {
    for (const def of repos.team.listAgentDefs()) {
      expect(JSON.parse(def.defaultToolsJson).length, `${def.role} thiếu tool`).toBeGreaterThan(0)
    }
  })

  it('references only skills that exist', () => {
    const known = new Set(repos.team.listSkills().map((s) => s.name))
    for (const def of repos.team.listAgentDefs()) {
      for (const skill of JSON.parse(def.defaultSkillsJson) as string[]) {
        expect(known.has(skill), `${def.role} tham chiếu kỹ năng không tồn tại: ${skill}`).toBe(true)
      }
    }
  })
})

describe('seedCompany', () => {
  it('configures all ten agents with a preset and a knowledge ACL', () => {
    const result = seedCompany(repos, { companyName: 'Công ty Thử' })
    expect(result.presets).toBe(AGENT_ROLES.length)
    expect(result.aclEntries).toBe(AGENT_ROLES.length * KB_CATEGORIES.length)

    for (const def of repos.team.listAgentDefs()) {
      const acl = repos.team.listKnowledgeAcl(result.company.id, def.id)
      expect(acl, `${def.role} thiếu ACL`).toHaveLength(KB_CATEGORIES.length)
    }
  })

  it('grants every non-leader agent at least one readable category', () => {
    const result = seedCompany(repos, { companyName: 'Công ty Thử' })
    for (const def of repos.team.listAgentDefs()) {
      expect(
        repos.team.readableCategories(result.company.id, def.id).length,
        `${def.role} không đọc được danh mục nào`,
      ).toBeGreaterThan(0)
    }
  })

  it('gives the leader every category and the report category write access', () => {
    const result = seedCompany(repos, { companyName: 'Công ty Thử' })
    const leader = repos.team.findAgentDefByRole('marketing-leader')!
    expect(repos.team.readableCategories(result.company.id, leader.id).sort()).toEqual(
      KB_CATEGORIES.map((c) => c.code).sort(),
    )
    expect(repos.team.writableCategories(result.company.id, leader.id)).toEqual(['90-ket-qua'])
  })

  it('keeps the content writer read-only in the knowledge base', () => {
    const result = seedCompany(repos, { companyName: 'Công ty Thử' })
    const writer = repos.team.findAgentDefByRole('content-writer')!
    expect(repos.team.writableCategories(result.company.id, writer.id)).toEqual([])
  })

  it('enforces the ACL: an agent cannot read a category it was not granted', () => {
    const result = seedCompany(repos, { companyName: 'Công ty Thử' })
    const writer = repos.team.findAgentDefByRole('content-writer')!
    expect(repos.team.canReadCategory(result.company.id, writer.id, '40-du-lieu')).toBe(false)
    expect(repos.team.canReadCategory(result.company.id, writer.id, '10-brand')).toBe(true)
  })

  it('resolves every agent to a model and a provider', () => {
    const result = seedCompany(repos, { companyName: 'Công ty Thử' })
    for (const def of repos.team.listAgentDefs()) {
      const resolved = repos.team.resolveAgent(result.company.id, def.role)
      expect(resolved.model, `${def.role} không resolve được model`).not.toBeNull()
      expect(resolved.provider, `${def.role} không resolve được provider`).not.toBeNull()
      expect(resolved.toolNames.length).toBeGreaterThan(0)
    }
  })

  it('routes the leader to the pro model and the specialists to flash', () => {
    const result = seedCompany(repos, { companyName: 'Công ty Thử' })
    const leader = repos.team.resolveAgent(result.company.id, 'marketing-leader')
    const social = repos.team.resolveAgent(result.company.id, 'social-media')
    expect(leader.model?.modelId).toBe('deepseek-v4-pro')
    expect(social.model?.modelId).toBe('deepseek-v4-flash')
  })

  it('creates exactly one tier route per role and tier', () => {
    const result = seedCompany(repos, { companyName: 'Công ty Thử' })
    const routes = repos.llm.listRoutes(result.company.id)
    const keys = new Set(routes.map((r) => `${r.agentDefId}:${r.tier}`))
    expect(keys.size).toBe(routes.length)
  })

  it('is idempotent: re-seeding does not duplicate presets, routes or ACLs', () => {
    const first = seedCompany(repos, { companyName: 'Công ty Thử', withDemoKnowledge: true })
    const second = seedCompany(repos, { companyName: 'Công ty Thử', withDemoKnowledge: true })
    expect(second.company.id).toBe(first.company.id)
    expect(repos.team.listPresets(first.company.id)).toHaveLength(AGENT_ROLES.length)
    expect(repos.llm.listRoutes(first.company.id).length).toBe(first.routes)
    expect(second.documents).toBe(0)
    expect(repos.knowledge.listDocuments(first.company.id)).toHaveLength(DEMO_KB_DOCUMENTS.length)
  })

  it('installs the demo knowledge base with categories that exist', () => {
    const result = seedCompany(repos, { companyName: 'Công ty Thử', withDemoKnowledge: true })
    const docs = repos.knowledge.listDocuments(result.company.id)
    expect(docs.length).toBe(DEMO_KB_DOCUMENTS.length)
    const known = new Set<string>(KB_CATEGORIES.map((c) => c.code))
    for (const doc of docs) {
      expect(known.has(doc.category), `danh mục lạ: ${doc.category}`).toBe(true)
    }
  })

  it('reuses the owner account and membership on re-seed', () => {
    const options = {
      companyName: 'Công ty Thử',
      ownerEmail: 'owner@example.com',
      ownerPassword: 'matkhau-rat-dai-123',
      ownerName: 'Người sở hữu',
    }
    const first = seedCompany(repos, options)
    const second = seedCompany(repos, options)
    expect(second.owner?.id).toBe(first.owner?.id)
    expect(repos.auth.listCompaniesForUser(first.owner!.id)).toHaveLength(1)
  })

  it('matches the declared tier matrix', () => {
    const result = seedCompany(repos, { companyName: 'Công ty Thử' })
    const presets = repos.team.listPresets(result.company.id)
    const byDefId = new Map(presets.map((p) => [p.agentDefId, p]))
    for (const { role, tier } of expectedTierMatrix()) {
      const def = repos.team.findAgentDefByRole(role)!
      expect(byDefId.get(def.id)?.tier, `${role} sai tier`).toBe(tier)
    }
  })
})
