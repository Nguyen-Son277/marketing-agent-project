/** Providers, models, per-provider API keys and per-agent fallbacks. Secrets encrypted. */
import {
  newId,
  notFound,
  nowIso,
  round,
  type AgentRole,
  type LlmModelRecord,
  type LlmProviderKeyRecord,
  type LlmProviderRecord,
  type ModelFallbackRecord,
  type ModelRouteRecord,
  type ModelTier,
  type ProviderKind,
} from '@marketing-agent/shared'
import type { Database } from '../database.ts'
import type { SecretBox } from '../crypto.ts'
import { keyHint } from '../crypto.ts'

interface ProviderRow {
  id: string
  company_id: string | null
  name: string
  kind: ProviderKind
  base_url: string
  extra_json: string | null
  enabled: number
  created_at: string
}

interface ProviderKeyRow {
  id: string
  provider_id: string
  label: string
  api_key_enc: string | null
  api_key_iv: string | null
  api_key_hint: string | null
  priority: number
  enabled: number
  created_at: string
}

interface ModelRow {
  id: string
  provider_id: string
  model_id: string
  label: string
  context_window: number
  max_output: number
  supports_tools: number
  supports_vision: number
  cost_in_per_mtok: number
  cost_out_per_mtok: number
  enabled: number
}

interface RouteRow {
  id: string
  company_id: string
  agent_def_id: string
  tier: ModelTier
  model_fk: string
  reasoning_effort: string | null
  max_tokens: number | null
  priority: number
}

interface FallbackRow {
  id: string
  company_id: string
  agent_def_id: string
  position: number
  model_fk: string
}

const toProvider = (row: ProviderRow): LlmProviderRecord => ({
  id: row.id,
  companyId: row.company_id,
  name: row.name,
  kind: row.kind,
  baseUrl: row.base_url,
  extraJson: row.extra_json,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
})

const toProviderKey = (row: ProviderKeyRow): LlmProviderKeyRecord => ({
  id: row.id,
  providerId: row.provider_id,
  label: row.label,
  hint: row.api_key_hint,
  priority: row.priority,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
})

const toModel = (row: ModelRow): LlmModelRecord => ({
  id: row.id,
  providerId: row.provider_id,
  modelId: row.model_id,
  label: row.label,
  contextWindow: row.context_window,
  maxOutput: row.max_output,
  supportsTools: row.supports_tools === 1,
  supportsVision: row.supports_vision === 1,
  costInPerMtok: row.cost_in_per_mtok,
  costOutPerMtok: row.cost_out_per_mtok,
  enabled: row.enabled === 1,
})

const toRoute = (row: RouteRow): ModelRouteRecord => ({
  id: row.id,
  companyId: row.company_id,
  agentDefId: row.agent_def_id,
  tier: row.tier,
  modelFk: row.model_fk,
  reasoningEffort: row.reasoning_effort,
  maxTokens: row.max_tokens,
  priority: row.priority,
})

const toFallback = (row: FallbackRow): ModelFallbackRecord => ({
  id: row.id,
  companyId: row.company_id,
  agentDefId: row.agent_def_id,
  position: row.position,
  modelFk: row.model_fk,
})

export class LlmRepo {
  constructor(
    private readonly db: Database,
    private readonly secrets: SecretBox,
  ) {}

  /* ------------------------------------------------------------- providers */

  createProvider(input: {
    companyId: string | null
    name: string
    kind: ProviderKind
    baseUrl: string
    extra?: Record<string, unknown>
    enabled?: boolean
  }): LlmProviderRecord {
    const id = newId()
    this.db.run(
      `INSERT INTO llm_providers (id, company_id, name, kind, base_url, extra_json, enabled, created_at)
       VALUES (@id, @companyId, @name, @kind, @baseUrl, @extra, @enabled, @createdAt)`,
      {
        id,
        companyId: input.companyId,
        name: input.name,
        kind: input.kind,
        baseUrl: input.baseUrl.replace(/\/+$/, ''),
        extra: input.extra ? JSON.stringify(input.extra) : null,
        enabled: (input.enabled ?? true) ? 1 : 0,
        createdAt: nowIso(),
      },
    )
    return this.requireProvider(id)
  }

  updateProvider(
    id: string,
    patch: {
      name?: string
      kind?: ProviderKind
      baseUrl?: string
      extra?: Record<string, unknown>
      enabled?: boolean
    },
  ): LlmProviderRecord {
    const sets: string[] = []
    const params: Record<string, unknown> = { id }
    if (patch.name !== undefined) {
      sets.push('name = @name')
      params.name = patch.name
    }
    if (patch.kind !== undefined) {
      sets.push('kind = @kind')
      params.kind = patch.kind
    }
    if (patch.baseUrl !== undefined) {
      sets.push('base_url = @baseUrl')
      params.baseUrl = patch.baseUrl.replace(/\/+$/, '')
    }
    if (patch.extra !== undefined) {
      sets.push('extra_json = @extra')
      params.extra = JSON.stringify(patch.extra)
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled = @enabled')
      params.enabled = patch.enabled ? 1 : 0
    }
    if (sets.length > 0) {
      this.db.run(`UPDATE llm_providers SET ${sets.join(', ')} WHERE id = @id`, params)
    }
    return this.requireProvider(id)
  }

  deleteProvider(id: string): void {
    this.db.run('DELETE FROM llm_providers WHERE id = ?', [id])
  }

  findProvider(id: string): LlmProviderRecord | undefined {
    const row = this.db.get<ProviderRow>('SELECT * FROM llm_providers WHERE id = ?', [id])
    return row ? toProvider(row) : undefined
  }

  requireProvider(id: string): LlmProviderRecord {
    const provider = this.findProvider(id)
    if (!provider) throw notFound('Không tìm thấy nhà cung cấp model')
    return provider
  }

  /** Global providers (company_id NULL) plus this company's own, enabled only. */
  listProviders(companyId: string, options: { includeDisabled?: boolean } = {}): LlmProviderRecord[] {
    const rows = this.db.all<ProviderRow>(
      `SELECT * FROM llm_providers
        WHERE (company_id IS NULL OR company_id = ?)
          ${options.includeDisabled ? '' : 'AND enabled = 1'}
        ORDER BY (company_id IS NULL) DESC, name ASC`,
      [companyId],
    )
    return rows.map(toProvider)
  }

  /* ------------------------------------------------------------------ keys */

  /**
   * Thêm một khoá cho provider. Khoá được mã hoá ngay tại đây; chỉ `hint` (vài ký tự
   * đầu/cuối) được lưu dạng đọc được để người dùng nhận ra khoá nào là khoá nào.
   */
  createProviderKey(input: {
    providerId: string
    label: string
    apiKey: string
    priority?: number
    enabled?: boolean
  }): LlmProviderKeyRecord {
    const id = newId()
    const encrypted = this.secrets.encrypt(input.apiKey)
    this.db.run(
      `INSERT INTO llm_provider_keys
         (id, provider_id, label, api_key_enc, api_key_iv, api_key_hint, priority, enabled, created_at)
       VALUES
         (@id, @providerId, @label, @enc, @iv, @hint, @priority, @enabled, @createdAt)`,
      {
        id,
        providerId: input.providerId,
        label: input.label,
        enc: encrypted.enc,
        iv: encrypted.iv,
        hint: keyHint(input.apiKey),
        priority: input.priority ?? 100,
        enabled: (input.enabled ?? true) ? 1 : 0,
        createdAt: nowIso(),
      },
    )
    return this.requireProviderKey(id)
  }

  updateProviderKey(
    id: string,
    patch: { label?: string; apiKey?: string; priority?: number; enabled?: boolean },
  ): LlmProviderKeyRecord {
    const sets: string[] = []
    const params: Record<string, unknown> = { id }
    if (patch.label !== undefined) {
      sets.push('label = @label')
      params.label = patch.label
    }
    if (patch.apiKey !== undefined) {
      const encrypted = this.secrets.encrypt(patch.apiKey)
      sets.push('api_key_enc = @enc', 'api_key_iv = @iv', 'api_key_hint = @hint')
      params.enc = encrypted.enc
      params.iv = encrypted.iv
      params.hint = keyHint(patch.apiKey)
    }
    if (patch.priority !== undefined) {
      sets.push('priority = @priority')
      params.priority = patch.priority
    }
    if (patch.enabled !== undefined) {
      sets.push('enabled = @enabled')
      params.enabled = patch.enabled ? 1 : 0
    }
    if (sets.length > 0) {
      this.db.run(`UPDATE llm_provider_keys SET ${sets.join(', ')} WHERE id = @id`, params)
    }
    return this.requireProviderKey(id)
  }

  deleteProviderKey(id: string): void {
    this.db.run('DELETE FROM llm_provider_keys WHERE id = ?', [id])
  }

  findProviderKey(id: string): LlmProviderKeyRecord | undefined {
    const row = this.db.get<ProviderKeyRow>('SELECT * FROM llm_provider_keys WHERE id = ?', [id])
    return row ? toProviderKey(row) : undefined
  }

  requireProviderKey(id: string): LlmProviderKeyRecord {
    const key = this.findProviderKey(id)
    if (!key) throw notFound('Không tìm thấy khoá API')
    return key
  }

  /** Khoá của một provider, sắp theo thứ tự dùng (priority tăng dần). */
  listProviderKeys(providerId: string, options: { includeDisabled?: boolean } = {}): LlmProviderKeyRecord[] {
    const rows = this.db.all<ProviderKeyRow>(
      `SELECT * FROM llm_provider_keys
        WHERE provider_id = ? ${options.includeDisabled ? '' : 'AND enabled = 1'}
        ORDER BY priority ASC, created_at ASC`,
      [providerId],
    )
    return rows.map(toProviderKey)
  }

  /**
   * Khoá đã giải mã cho MỘT lượt gọi, theo thứ tự thử. Trả về mảng rỗng khi provider
   * không có khoá nào — gateway nội bộ có thể không cần khoá, nên đây không phải lỗi.
   */
  resolveProviderKeys(provider: LlmProviderRecord): { id: string; label: string; apiKey: string }[] {
    const rows = this.db.all<ProviderKeyRow>(
      `SELECT * FROM llm_provider_keys
        WHERE provider_id = ? AND enabled = 1
        ORDER BY priority ASC, created_at ASC`,
      [provider.id],
    )
    return rows.map((row) => ({
      id: row.id,
      label: row.label,
      apiKey: row.api_key_enc && row.api_key_iv ? this.secrets.decrypt(row.api_key_enc, row.api_key_iv) : '',
    }))
  }

  /* ---------------------------------------------------------------- models */

  createModel(input: {
    providerId: string
    modelId: string
    label: string
    contextWindow?: number
    maxOutput?: number
    supportsTools?: boolean
    supportsVision?: boolean
    costInPerMtok?: number
    costOutPerMtok?: number
    enabled?: boolean
  }): LlmModelRecord {
    const id = newId()
    this.db.run(
      `INSERT INTO llm_models
         (id, provider_id, model_id, label, context_window, max_output, supports_tools, supports_vision,
          cost_in_per_mtok, cost_out_per_mtok, enabled, created_at)
       VALUES
         (@id, @providerId, @modelId, @label, @contextWindow, @maxOutput, @supportsTools, @supportsVision,
          @costIn, @costOut, @enabled, @createdAt)`,
      {
        id,
        providerId: input.providerId,
        modelId: input.modelId,
        label: input.label,
        contextWindow: input.contextWindow ?? 128_000,
        maxOutput: input.maxOutput ?? 16_000,
        supportsTools: (input.supportsTools ?? true) ? 1 : 0,
        supportsVision: (input.supportsVision ?? false) ? 1 : 0,
        costIn: input.costInPerMtok ?? 0,
        costOut: input.costOutPerMtok ?? 0,
        enabled: (input.enabled ?? true) ? 1 : 0,
        createdAt: nowIso(),
      },
    )
    return this.requireModel(id)
  }

  updateModel(
    id: string,
    patch: Partial<{
      label: string
      contextWindow: number
      maxOutput: number
      supportsTools: boolean
      supportsVision: boolean
      costInPerMtok: number
      costOutPerMtok: number
      enabled: boolean
    }>,
  ): LlmModelRecord {
    const map: Record<string, string> = {
      label: 'label',
      contextWindow: 'context_window',
      maxOutput: 'max_output',
      supportsTools: 'supports_tools',
      supportsVision: 'supports_vision',
      costInPerMtok: 'cost_in_per_mtok',
      costOutPerMtok: 'cost_out_per_mtok',
      enabled: 'enabled',
    }
    const sets: string[] = []
    const params: Record<string, unknown> = { id }
    for (const [key, column] of Object.entries(map)) {
      const value = (patch as Record<string, unknown>)[key]
      if (value === undefined) continue
      sets.push(`${column} = @${key}`)
      params[key] = typeof value === 'boolean' ? (value ? 1 : 0) : value
    }
    if (sets.length > 0) this.db.run(`UPDATE llm_models SET ${sets.join(', ')} WHERE id = @id`, params)
    return this.requireModel(id)
  }

  deleteModel(id: string): void {
    this.db.run('DELETE FROM llm_models WHERE id = ?', [id])
  }

  findModel(id: string): LlmModelRecord | undefined {
    const row = this.db.get<ModelRow>('SELECT * FROM llm_models WHERE id = ?', [id])
    return row ? toModel(row) : undefined
  }

  requireModel(id: string): LlmModelRecord {
    const model = this.findModel(id)
    if (!model) throw notFound('Không tìm thấy model')
    return model
  }

  findModelByModelId(providerId: string, modelId: string): LlmModelRecord | undefined {
    const row = this.db.get<ModelRow>('SELECT * FROM llm_models WHERE provider_id = ? AND model_id = ?', [
      providerId,
      modelId,
    ])
    return row ? toModel(row) : undefined
  }

  /** Every model visible to a company, with its provider, for pickers and the router. */
  listModels(companyId: string, options: { includeDisabled?: boolean } = {}): (LlmModelRecord & { provider: LlmProviderRecord })[] {
    const rows = this.db.all<ModelRow & { p_id: string; p_company_id: string | null }>(
      `SELECT m.*, p.id AS p_id, p.company_id AS p_company_id
         FROM llm_models m
         JOIN llm_providers p ON p.id = m.provider_id
        WHERE (p.company_id IS NULL OR p.company_id = ?)
          ${options.includeDisabled ? '' : 'AND m.enabled = 1 AND p.enabled = 1'}
        ORDER BY p.name ASC, m.label ASC`,
      [companyId],
    )
    return rows.map((row) => {
      const provider = this.findProvider(row.p_id)
      if (!provider) throw notFound('Model trỏ tới nhà cung cấp không tồn tại')
      return { ...toModel(row), provider }
    })
  }

  /**
   * Số agent (khác nhau) đang tham chiếu mỗi model, gộp từ preset, route và fallback.
   *
   * Vì sao cần: giao diện chỉ nên cho xoá model không còn ai dùng. Đếm theo agent chứ
   * không theo số bản ghi, vì một agent có thể có nhiều route cùng trỏ một model.
   */
  modelUsage(companyId: string): Map<string, number> {
    const agentsByModel = new Map<string, Set<string>>()
    const add = (modelFk: string | null, agentDefId: string): void => {
      if (!modelFk) return
      const bucket = agentsByModel.get(modelFk) ?? new Set<string>()
      bucket.add(agentDefId)
      agentsByModel.set(modelFk, bucket)
    }
    for (const row of this.db.all<{ model_fk: string; agent_def_id: string }>(
      'SELECT model_fk, agent_def_id FROM model_routes WHERE company_id = ?',
      [companyId],
    )) {
      add(row.model_fk, row.agent_def_id)
    }
    for (const row of this.db.all<{ model_fk: string | null; agent_def_id: string }>(
      'SELECT model_fk, agent_def_id FROM agent_presets WHERE company_id = ? AND model_fk IS NOT NULL',
      [companyId],
    )) {
      add(row.model_fk, row.agent_def_id)
    }
    for (const row of this.db.all<{ model_fk: string; agent_def_id: string }>(
      'SELECT model_fk, agent_def_id FROM agent_model_fallbacks WHERE company_id = ?',
      [companyId],
    )) {
      add(row.model_fk, row.agent_def_id)
    }
    return new Map([...agentsByModel].map(([modelFk, agents]) => [modelFk, agents.size]))
  }

  /**
   * Tập model đang được tham chiếu ở BẤT KỲ công ty nào. Dùng cho thao tác xoá: xoá
   * một model còn được route trỏ tới sẽ kéo theo route đó biến mất trong im lặng.
   */
  referencedModelIds(): Set<string> {
    const rows = this.db.all<{ model_fk: string }>(
      `SELECT model_fk FROM model_routes
        UNION SELECT model_fk FROM agent_presets WHERE model_fk IS NOT NULL
        UNION SELECT model_fk FROM agent_model_fallbacks`,
    )
    return new Set(rows.map((row) => row.model_fk))
  }

  /** Xoá mọi model của một provider không còn được tham chiếu; trả về số đã xoá. */
  deleteUnusedModels(providerId: string): number {
    const referenced = this.referencedModelIds()
    const models = this.db.all<ModelRow>('SELECT * FROM llm_models WHERE provider_id = ?', [providerId])
    let deleted = 0
    for (const model of models) {
      if (referenced.has(model.id)) continue
      this.deleteModel(model.id)
      deleted += 1
    }
    return deleted
  }

  /* -------------------------------------------------------------- fallbacks */

  /** Model dự phòng của một agent, theo thứ tự dùng. */
  listModelFallbacks(companyId: string, agentDefId: string): ModelFallbackRecord[] {
    return this.db
      .all<FallbackRow>(
        'SELECT * FROM agent_model_fallbacks WHERE company_id = ? AND agent_def_id = ? ORDER BY position ASC',
        [companyId, agentDefId],
      )
      .map(toFallback)
  }

  /** Toàn bộ fallback của một công ty, gom theo agent — tránh N+1 khi dựng danh sách đội. */
  fallbacksByAgent(companyId: string): Map<string, ModelFallbackRecord[]> {
    const map = new Map<string, ModelFallbackRecord[]>()
    for (const row of this.db
      .all<FallbackRow>(
        'SELECT * FROM agent_model_fallbacks WHERE company_id = ? ORDER BY agent_def_id ASC, position ASC',
        [companyId],
      )
      .map(toFallback)) {
      const bucket = map.get(row.agentDefId)
      if (bucket) bucket.push(row)
      else map.set(row.agentDefId, [row])
    }
    return map
  }

  /**
   * Thay toàn bộ danh sách fallback của một agent bằng danh sách mới, giữ đúng thứ tự.
   * Ghi trong một transaction: nửa danh sách cũ nửa danh sách mới là cấu hình sai.
   */
  setModelFallbacks(companyId: string, agentDefId: string, modelFks: readonly string[]): ModelFallbackRecord[] {
    const unique = [...new Set(modelFks)]
    this.db.tx(() => {
      this.db.run('DELETE FROM agent_model_fallbacks WHERE company_id = ? AND agent_def_id = ?', [
        companyId,
        agentDefId,
      ])
      unique.forEach((modelFk, position) => {
        this.db.run(
          `INSERT INTO agent_model_fallbacks (id, company_id, agent_def_id, position, model_fk)
           VALUES (@id, @companyId, @agentDefId, @position, @modelFk)`,
          { id: newId(), companyId, agentDefId, position, modelFk },
        )
      })
    })
    return this.listModelFallbacks(companyId, agentDefId)
  }

  /* ---------------------------------------------------------------- routes */

  upsertRoute(input: {
    companyId: string
    agentDefId: string
    tier: ModelTier
    modelFk: string
    reasoningEffort?: string | null
    maxTokens?: number | null
    priority?: number
  }): ModelRouteRecord {
    const existing = this.db.get<RouteRow>(
      'SELECT * FROM model_routes WHERE company_id = ? AND agent_def_id = ? AND tier = ?',
      [input.companyId, input.agentDefId, input.tier],
    )
    if (existing) {
      this.db.run(
        `UPDATE model_routes
            SET model_fk = @modelFk, reasoning_effort = @reasoningEffort, max_tokens = @maxTokens, priority = @priority
          WHERE id = @id`,
        {
          id: existing.id,
          modelFk: input.modelFk,
          reasoningEffort: input.reasoningEffort ?? null,
          maxTokens: input.maxTokens ?? null,
          priority: input.priority ?? 100,
        },
      )
      return this.requireRoute(existing.id)
    }
    const id = newId()
    this.db.run(
      `INSERT INTO model_routes (id, company_id, agent_def_id, tier, model_fk, reasoning_effort, max_tokens, priority)
       VALUES (@id, @companyId, @agentDefId, @tier, @modelFk, @reasoningEffort, @maxTokens, @priority)`,
      {
        id,
        companyId: input.companyId,
        agentDefId: input.agentDefId,
        tier: input.tier,
        modelFk: input.modelFk,
        reasoningEffort: input.reasoningEffort ?? null,
        maxTokens: input.maxTokens ?? null,
        priority: input.priority ?? 100,
      },
    )
    return this.requireRoute(id)
  }

  findRoute(id: string): ModelRouteRecord | undefined {
    const row = this.db.get<RouteRow>('SELECT * FROM model_routes WHERE id = ?', [id])
    return row ? toRoute(row) : undefined
  }

  requireRoute(id: string): ModelRouteRecord {
    const route = this.findRoute(id)
    if (!route) throw notFound('Không tìm thấy route model')
    return route
  }

  listRoutes(companyId: string): ModelRouteRecord[] {
    return this.db
      .all<RouteRow>('SELECT * FROM model_routes WHERE company_id = ? ORDER BY priority ASC', [companyId])
      .map(toRoute)
  }

  deleteRoute(companyId: string, agentDefId: string, tier: ModelTier): void {
    this.db.run('DELETE FROM model_routes WHERE company_id = ? AND agent_def_id = ? AND tier = ?', [
      companyId,
      agentDefId,
      tier,
    ])
  }

  /** Every agent's route map for one company, keyed by role for the router. */
  routesByAgent(companyId: string): Map<string, ModelRouteRecord[]> {
    const map = new Map<string, ModelRouteRecord[]>()
    for (const route of this.listRoutes(companyId)) {
      const bucket = map.get(route.agentDefId)
      if (bucket) bucket.push(route)
      else map.set(route.agentDefId, [route])
    }
    return map
  }
}

/** Cost of one model call, rounded to micro-dollars to avoid float noise. */
export function computeCostUsd(
  model: Pick<LlmModelRecord, 'costInPerMtok' | 'costOutPerMtok'>,
  tokensIn: number,
  tokensOut: number,
): number {
  const cost = (tokensIn / 1_000_000) * model.costInPerMtok + (tokensOut / 1_000_000) * model.costOutPerMtok
  return round(cost, 6)
}

/** Human-readable key for a role+tier pair, used in seeds and diagnostics. */
export function roleModelKey(role: AgentRole, tier: ModelTier): string {
  return `${role}:${tier}`
}
