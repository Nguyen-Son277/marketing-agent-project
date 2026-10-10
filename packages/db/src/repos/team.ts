/**
 * The team layer: global agent definitions plus each company's presets, which
 * bind an agent to a model tier, a skill set, a tool grant, and a knowledge ACL.
 */
import {
  conflict,
  newId,
  notFound,
  nowIso,
  type AgentDefRecord,
  type AgentPresetRecord,
  type AgentPresetSkillRecord,
  type AgentPresetToolRecord,
  type AgentRole,
  type AgentSkillRecord,
  type KbAclRecord,
  type ModelTier,
  type ResolvedAgent,
} from '@marketing-agent/shared'
import type { Database } from '../database.ts'
import type { LlmRepo } from './llm.ts'

interface AgentDefRow {
  id: string
  role: AgentRole
  name: string
  description: string
  system_prompt: string
  default_skills_json: string
  default_tools_json: string
  is_leader: number
  created_at: string
}

interface PresetRow {
  id: string
  company_id: string
  agent_def_id: string
  display_name: string | null
  enabled: number
  model_fk: string | null
  tier: ModelTier
  reasoning_effort: string | null
  max_tokens: number | null
  context_budget_tokens: number
  system_prompt_override: string | null
  require_approval: number
}

interface SkillRow {
  id: string
  name: string
  description: string
  category: string
  body_md: string
  origin: string
}

interface AclRow {
  company_id: string
  category: string
  agent_def_id: string
  can_read: number
  can_write: number
}

const toAgentDef = (row: AgentDefRow): AgentDefRecord => ({
  id: row.id,
  role: row.role,
  name: row.name,
  description: row.description,
  systemPrompt: row.system_prompt,
  defaultSkillsJson: row.default_skills_json,
  defaultToolsJson: row.default_tools_json,
  isLeader: row.is_leader === 1,
  createdAt: row.created_at,
})

const toPreset = (row: PresetRow): AgentPresetRecord => ({
  id: row.id,
  companyId: row.company_id,
  agentDefId: row.agent_def_id,
  displayName: row.display_name,
  enabled: row.enabled === 1,
  modelFk: row.model_fk,
  tier: row.tier,
  reasoningEffort: row.reasoning_effort,
  maxTokens: row.max_tokens,
  contextBudgetTokens: row.context_budget_tokens,
  systemPromptOverride: row.system_prompt_override,
  requireApproval: row.require_approval === 1,
})

const toSkill = (row: SkillRow): AgentSkillRecord => ({
  id: row.id,
  name: row.name,
  description: row.description,
  category: row.category,
  bodyMd: row.body_md,
  origin: row.origin,
})

const toAcl = (row: AclRow): KbAclRecord => ({
  companyId: row.company_id,
  category: row.category,
  agentDefId: row.agent_def_id,
  canRead: row.can_read === 1,
  canWrite: row.can_write === 1,
})

export class TeamRepo {
  constructor(
    private readonly db: Database,
    private readonly llm: LlmRepo,
  ) {}

  /* ---------------------------------------------------------- definitions */

  upsertAgentDef(input: {
    role: AgentRole
    name: string
    description: string
    systemPrompt: string
    defaultSkills?: readonly string[]
    defaultTools?: readonly string[]
    isLeader?: boolean
  }): AgentDefRecord {
    const existing = this.findAgentDefByRole(input.role)
    const params = {
      role: input.role,
      name: input.name,
      description: input.description,
      systemPrompt: input.systemPrompt,
      skills: JSON.stringify(input.defaultSkills ?? []),
      tools: JSON.stringify(input.defaultTools ?? []),
      isLeader: input.isLeader ? 1 : 0,
    }
    if (existing) {
      this.db.run(
        `UPDATE agent_defs
            SET name = @name, description = @description, system_prompt = @systemPrompt,
                default_skills_json = @skills, default_tools_json = @tools, is_leader = @isLeader
          WHERE id = @id`,
        { ...params, id: existing.id },
      )
      return this.requireAgentDef(existing.id)
    }
    const id = newId()
    this.db.run(
      `INSERT INTO agent_defs
         (id, role, name, description, system_prompt, default_skills_json, default_tools_json, is_leader, created_at)
       VALUES (@id, @role, @name, @description, @systemPrompt, @skills, @tools, @isLeader, @createdAt)`,
      { ...params, id, createdAt: nowIso() },
    )
    return this.requireAgentDef(id)
  }

  findAgentDefByRole(role: string): AgentDefRecord | undefined {
    const row = this.db.get<AgentDefRow>('SELECT * FROM agent_defs WHERE role = ?', [role])
    return row ? toAgentDef(row) : undefined
  }

  findAgentDef(id: string): AgentDefRecord | undefined {
    const row = this.db.get<AgentDefRow>('SELECT * FROM agent_defs WHERE id = ?', [id])
    return row ? toAgentDef(row) : undefined
  }

  requireAgentDef(id: string): AgentDefRecord {
    const def = this.findAgentDef(id)
    if (!def) throw notFound('Không tìm thấy định nghĩa agent')
    return def
  }

  listAgentDefs(): AgentDefRecord[] {
    return this.db.all<AgentDefRow>('SELECT * FROM agent_defs ORDER BY is_leader DESC, role ASC').map(toAgentDef)
  }

  /* -------------------------------------------------------------- presets */

  /** Create the company's preset for every known agent definition (idempotent). */
  ensurePresetsForCompany(companyId: string, options: { tier?: ModelTier; modelFk?: string | null } = {}): AgentPresetRecord[] {
    const defs = this.listAgentDefs()
    return defs.map((def) =>
      this.ensurePreset(companyId, def.id, {
        tier: def.isLeader ? 'deep' : (options.tier ?? 'standard'),
        modelFk: options.modelFk ?? null,
      }),
    )
  }

  ensurePreset(
    companyId: string,
    agentDefId: string,
    options: { tier?: ModelTier; modelFk?: string | null } = {},
  ): AgentPresetRecord {
    const existing = this.findPreset(companyId, agentDefId)
    if (existing) return existing
    const id = newId()
    this.db.run(
      `INSERT INTO agent_presets
         (id, company_id, agent_def_id, display_name, enabled, model_fk, tier, reasoning_effort, max_tokens,
          context_budget_tokens, system_prompt_override, require_approval, created_at)
       VALUES (@id, @companyId, @agentDefId, NULL, 1, @modelFk, @tier, NULL, NULL, 60000, NULL, 1, @createdAt)`,
      {
        id,
        companyId,
        agentDefId,
        modelFk: options.modelFk ?? null,
        tier: options.tier ?? 'standard',
        createdAt: nowIso(),
      },
    )
    const def = this.requireAgentDef(agentDefId)
    // Default grants come from the global definition so a new company is usable immediately.
    this.setPresetSkills(id, companyId, parseStringArray(def.defaultSkillsJson))
    this.setPresetTools(id, companyId, parseStringArray(def.defaultToolsJson))
    return this.requirePresetByCompanyAgent(companyId, agentDefId)
  }

  findPreset(companyId: string, agentDefId: string): AgentPresetRecord | undefined {
    const row = this.db.get<PresetRow>(
      'SELECT * FROM agent_presets WHERE company_id = ? AND agent_def_id = ?',
      [companyId, agentDefId],
    )
    return row ? toPreset(row) : undefined
  }

  findPresetById(id: string): AgentPresetRecord | undefined {
    const row = this.db.get<PresetRow>('SELECT * FROM agent_presets WHERE id = ?', [id])
    return row ? toPreset(row) : undefined
  }

  requirePresetByCompanyAgent(companyId: string, agentDefId: string): AgentPresetRecord {
    const preset = this.findPreset(companyId, agentDefId)
    if (!preset) throw notFound('Công ty chưa cấu hình agent này')
    return preset
  }

  updatePreset(
    companyId: string,
    agentDefId: string,
    patch: Partial<{
      displayName: string | null
      enabled: boolean
      modelFk: string | null
      tier: ModelTier
      reasoningEffort: string | null
      maxTokens: number | null
      contextBudgetTokens: number
      systemPromptOverride: string | null
      requireApproval: boolean
    }>,
  ): AgentPresetRecord {
    const map: Record<string, string> = {
      displayName: 'display_name',
      enabled: 'enabled',
      modelFk: 'model_fk',
      tier: 'tier',
      reasoningEffort: 'reasoning_effort',
      maxTokens: 'max_tokens',
      contextBudgetTokens: 'context_budget_tokens',
      systemPromptOverride: 'system_prompt_override',
      requireApproval: 'require_approval',
    }
    const sets: string[] = []
    const params: Record<string, unknown> = { companyId, agentDefId }
    for (const [key, column] of Object.entries(map)) {
      const value = (patch as Record<string, unknown>)[key]
      if (value === undefined) continue
      sets.push(`${column} = @${key}`)
      params[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value
    }
    if (sets.length > 0) {
      const result = this.db.run(
        `UPDATE agent_presets SET ${sets.join(', ')} WHERE company_id = @companyId AND agent_def_id = @agentDefId`,
        params,
      )
      if (result.changes === 0) throw notFound('Công ty chưa cấu hình agent này')
    }
    return this.requirePresetByCompanyAgent(companyId, agentDefId)
  }

  listPresets(companyId: string): AgentPresetRecord[] {
    return this.db
      .all<PresetRow>('SELECT * FROM agent_presets WHERE company_id = ? ORDER BY created_at ASC', [companyId])
      .map(toPreset)
  }

  /* --------------------------------------------------------------- grants */

  setPresetSkills(presetId: string, companyId: string, skillNames: readonly string[]): void {
    this.db.run('DELETE FROM agent_preset_skills WHERE preset_id = ?', [presetId])
    for (const name of new Set(skillNames)) {
      this.db.run(
        'INSERT INTO agent_preset_skills (preset_id, company_id, skill_name) VALUES (?, ?, ?)',
        [presetId, companyId, name],
      )
    }
  }

  listPresetSkills(presetId: string): AgentPresetSkillRecord[] {
    return this.db
      .all<{ preset_id: string; company_id: string; skill_name: string }>(
        'SELECT * FROM agent_preset_skills WHERE preset_id = ? ORDER BY skill_name ASC',
        [presetId],
      )
      .map((row) => ({ presetId: row.preset_id, companyId: row.company_id, skillName: row.skill_name }))
  }

  setPresetTools(
    presetId: string,
    companyId: string,
    tools: readonly (string | { name: string; config?: Record<string, unknown> })[],
  ): void {
    this.db.run('DELETE FROM agent_preset_tools WHERE preset_id = ?', [presetId])
    for (const entry of new Set(tools.map((t) => (typeof t === 'string' ? t : t.name)))) {
      const config = tools.find((t) => (typeof t === 'string' ? t : t.name) === entry)
      this.db.run(
        'INSERT INTO agent_preset_tools (preset_id, company_id, tool_name, config_json) VALUES (?, ?, ?, ?)',
        [
          presetId,
          companyId,
          entry,
          typeof config === 'object' && config.config ? JSON.stringify(config.config) : null,
        ],
      )
    }
  }

  listPresetTools(presetId: string): AgentPresetToolRecord[] {
    return this.db
      .all<{ preset_id: string; company_id: string; tool_name: string; config_json: string | null }>(
        'SELECT * FROM agent_preset_tools WHERE preset_id = ? ORDER BY tool_name ASC',
        [presetId],
      )
      .map((row) => ({
        presetId: row.preset_id,
        companyId: row.company_id,
        toolName: row.tool_name,
        configJson: row.config_json,
      }))
  }

  /* --------------------------------------------------------------- skills */

  upsertSkill(input: {
    name: string
    description: string
    category: string
    bodyMd: string
    origin?: string
  }): AgentSkillRecord {
    const existing = this.findSkillByName(input.name)
    if (existing) {
      this.db.run(
        'UPDATE agent_skills SET description = @description, category = @category, body_md = @bodyMd WHERE id = @id',
        { ...input, id: existing.id },
      )
      return this.requireSkillByName(input.name)
    }
    this.db.run(
      `INSERT INTO agent_skills (id, name, description, category, body_md, origin, created_at)
       VALUES (@id, @name, @description, @category, @bodyMd, @origin, @createdAt)`,
      {
        id: newId(),
        name: input.name,
        description: input.description,
        category: input.category,
        bodyMd: input.bodyMd,
        origin: input.origin ?? 'builtin',
        createdAt: nowIso(),
      },
    )
    return this.requireSkillByName(input.name)
  }

  findSkillByName(name: string): AgentSkillRecord | undefined {
    const row = this.db.get<SkillRow>('SELECT * FROM agent_skills WHERE name = ?', [name])
    return row ? toSkill(row) : undefined
  }

  requireSkillByName(name: string): AgentSkillRecord {
    const skill = this.findSkillByName(name)
    if (!skill) throw notFound(`Không tìm thấy kỹ năng ${name}`)
    return skill
  }

  listSkills(): AgentSkillRecord[] {
    return this.db.all<SkillRow>('SELECT * FROM agent_skills ORDER BY category ASC, name ASC').map(toSkill)
  }

  listSkillsForPreset(presetId: string): AgentSkillRecord[] {
    return this.db
      .all<SkillRow>(
        `SELECT s.* FROM agent_skills s
           JOIN agent_preset_skills ps ON ps.skill_name = s.name
          WHERE ps.preset_id = ?
          ORDER BY s.name ASC`,
        [presetId],
      )
      .map(toSkill)
  }

  /* ------------------------------------------------------- knowledge ACL */

  setKnowledgeAcl(
    companyId: string,
    agentDefId: string,
    entries: readonly { category: string; canRead: boolean; canWrite: boolean }[],
  ): void {
    this.db.run('DELETE FROM kb_acl WHERE company_id = ? AND agent_def_id = ?', [companyId, agentDefId])
    for (const entry of entries) {
      this.db.run(
        `INSERT INTO kb_acl (company_id, category, agent_def_id, can_read, can_write)
         VALUES (?, ?, ?, ?, ?)`,
        [companyId, entry.category, agentDefId, entry.canRead ? 1 : 0, entry.canWrite ? 1 : 0],
      )
    }
  }

  listKnowledgeAcl(companyId: string, agentDefId?: string): KbAclRecord[] {
    const rows = agentDefId
      ? this.db.all<AclRow>('SELECT * FROM kb_acl WHERE company_id = ? AND agent_def_id = ? ORDER BY category ASC', [
          companyId,
          agentDefId,
        ])
      : this.db.all<AclRow>('SELECT * FROM kb_acl WHERE company_id = ? ORDER BY agent_def_id ASC, category ASC', [
          companyId,
        ])
    return rows.map(toAcl)
  }

  /** Categories an agent may read; used to filter retrieval before ranking. */
  readableCategories(companyId: string, agentDefId: string): string[] {
    return this.db
      .all<{ category: string }>(
        'SELECT category FROM kb_acl WHERE company_id = ? AND agent_def_id = ? AND can_read = 1 ORDER BY category ASC',
        [companyId, agentDefId],
      )
      .map((row) => row.category)
  }

  writableCategories(companyId: string, agentDefId: string): string[] {
    return this.db
      .all<{ category: string }>(
        'SELECT category FROM kb_acl WHERE company_id = ? AND agent_def_id = ? AND can_write = 1 ORDER BY category ASC',
        [companyId, agentDefId],
      )
      .map((row) => row.category)
  }

  canReadCategory(companyId: string, agentDefId: string, category: string): boolean {
    const row = this.db.get<{ can_read: number }>(
      'SELECT can_read FROM kb_acl WHERE company_id = ? AND agent_def_id = ? AND category = ?',
      [companyId, agentDefId, category],
    )
    return row?.can_read === 1
  }

  canWriteCategory(companyId: string, agentDefId: string, category: string): boolean {
    const row = this.db.get<{ can_write: number }>(
      'SELECT can_write FROM kb_acl WHERE company_id = ? AND agent_def_id = ? AND category = ?',
      [companyId, agentDefId, category],
    )
    return row?.can_write === 1
  }

  /* ------------------------------------------------------------- resolve */

  /**
   * Full configuration for one agent, ready to build a run: model, provider,
   * skills, tool grants and knowledge permissions. Throws when the role is
   * unknown or disabled for the company.
   */
  resolveAgent(companyId: string, role: string): ResolvedAgent {
    const agentDef = this.findAgentDefByRole(role)
    if (!agentDef) throw notFound(`Không có agent với vai trò ${role}`)
    const preset = this.findPreset(companyId, agentDef.id)
    if (!preset) throw notFound(`Công ty chưa cấu hình agent ${role}`)
    if (!preset.enabled) throw conflict(`Agent ${role} đang bị tắt cho công ty này`)

    const model = this.resolveModelForPreset(companyId, preset, agentDef.id)
    const provider = model ? this.llm.requireProvider(model.providerId) : null
    return {
      companyId,
      agentDef,
      preset,
      role: agentDef.role,
      displayName: preset.displayName ?? agentDef.name,
      model,
      provider,
      skills: this.listSkillsForPreset(preset.id),
      toolNames: this.listPresetTools(preset.id).map((t) => t.toolName),
      knowledgeRead: this.readableCategories(companyId, agentDef.id),
      knowledgeWrite: this.writableCategories(companyId, agentDef.id),
    }
  }

  /**
   * Model hiệu lực của một preset: model gán trực tiếp, rồi route theo tier. KHÔNG có
   * bước "model rẻ nhất" — hệ thống không tự gắn model cho agent. Chưa chọn thì trả
   * `null` và lượt chạy sẽ báo cần cấu hình, đúng nơi người dùng sửa được.
   */
  private resolveModelForPreset(companyId: string, preset: AgentPresetRecord, agentDefId: string) {
    if (preset.modelFk) {
      const model = this.llm.findModel(preset.modelFk)
      if (model && model.enabled) return model
    }
    const route = this.db.get<{ model_fk: string }>(
      `SELECT model_fk FROM model_routes
        WHERE company_id = ? AND agent_def_id = ? AND tier = ?
        ORDER BY priority ASC LIMIT 1`,
      [companyId, agentDefId, preset.tier],
    )
    if (route) {
      const model = this.llm.findModel(route.model_fk)
      if (model && model.enabled) return model
    }
    return null
  }
}

function parseStringArray(json: string): string[] {
  try {
    const value = JSON.parse(json) as unknown
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
