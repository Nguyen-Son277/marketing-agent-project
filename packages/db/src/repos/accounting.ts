/** Runs, daily usage rollups, integrations and the audit log. */
import { newId, notFound, nowIso, round, type IntegrationKind, type IntegrationRecord, type RunRecord, type RunStatus } from '@marketing-agent/shared'
import type { Database } from '../database.ts'
import type { SecretBox } from '../crypto.ts'

interface RunRow {
  id: string
  company_id: string
  task_id: string | null
  conversation_id: string | null
  agent_def_id: string
  provider_id: string | null
  model_id: string | null
  status: string
  tokens_in: number
  tokens_out: number
  cost_usd: number
  latency_ms: number
  steps: number
  error: string | null
  created_at: string
}

interface IntegrationRow {
  id: string
  company_id: string
  kind: string
  name: string
  config_enc: string | null
  config_iv: string | null
  status: string
  last_check_at: string | null
  created_at: string
}

const toRun = (row: RunRow): RunRecord => ({
  id: row.id,
  companyId: row.company_id,
  taskId: row.task_id,
  conversationId: row.conversation_id,
  agentDefId: row.agent_def_id,
  providerId: row.provider_id,
  modelId: row.model_id,
  status: row.status as RunStatus,
  tokensIn: row.tokens_in,
  tokensOut: row.tokens_out,
  costUsd: row.cost_usd,
  latencyMs: row.latency_ms,
  steps: row.steps,
  error: row.error,
  createdAt: row.created_at,
})

const toIntegration = (row: IntegrationRow): IntegrationRecord => ({
  id: row.id,
  companyId: row.company_id,
  kind: row.kind as IntegrationKind,
  name: row.name,
  configEnc: row.config_enc,
  configIv: row.config_iv,
  status: row.status,
  lastCheckAt: row.last_check_at,
  createdAt: row.created_at,
})

/** `YYYY-MM-DD` bucket for the daily rollup, derived from an ISO timestamp. */
export const dayKey = (iso: string): string => iso.slice(0, 10)

export interface UsageSummary {
  readonly tokensIn: number
  readonly tokensOut: number
  readonly costUsd: number
  readonly runs: number
}

export class AccountingRepo {
  constructor(
    private readonly db: Database,
    private readonly secrets: SecretBox,
  ) {}

  /* ------------------------------------------------------------------ runs */

  startRun(input: {
    companyId: string
    taskId?: string | null
    conversationId?: string | null
    agentDefId: string
    providerId?: string | null
    modelId?: string | null
  }): string {
    const id = newId()
    this.db.run(
      `INSERT INTO runs
         (id, company_id, task_id, conversation_id, agent_def_id, provider_id, model_id, status, tokens_in, tokens_out,
          cost_usd, latency_ms, steps, error, created_at)
       VALUES (@id, @companyId, @taskId, @conversationId, @agentDefId, @providerId, @modelId, 'running', 0, 0, 0, 0,
               0, NULL, @createdAt)`,
      {
        id,
        companyId: input.companyId,
        taskId: input.taskId ?? null,
        conversationId: input.conversationId ?? null,
        agentDefId: input.agentDefId,
        providerId: input.providerId ?? null,
        modelId: input.modelId ?? null,
        createdAt: nowIso(),
      },
    )
    return id
  }

  /** Finish a run and roll its usage into `usage_daily` in one transaction. */
  finishRun(
    id: string,
    input: {
      status: RunStatus
      tokensIn: number
      tokensOut: number
      costUsd: number
      latencyMs: number
      steps: number
      error?: string | null
      modelId?: string | null
    },
  ): RunRecord {
    return this.db.tx(() => {
      const run = this.db.get<RunRow>('SELECT * FROM runs WHERE id = ?', [id])
      if (!run) throw notFound('Không tìm thấy lượt chạy')
      const cost = round(input.costUsd, 6)
      this.db.run(
        `UPDATE runs
            SET status = @status, tokens_in = @tokensIn, tokens_out = @tokensOut, cost_usd = @costUsd,
                latency_ms = @latencyMs, steps = @steps, error = @error, model_id = COALESCE(@modelId, model_id)
          WHERE id = @id`,
        {
          id,
          status: input.status,
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
          costUsd: cost,
          latencyMs: input.latencyMs,
          steps: input.steps,
          error: input.error ?? null,
          modelId: input.modelId ?? null,
        },
      )
      const modelKey = input.modelId ?? run.model_id ?? 'unknown'
      this.db.run(
        `INSERT INTO usage_daily (company_id, day, agent_def_id, model_id, tokens_in, tokens_out, cost_usd, runs)
         VALUES (@companyId, @day, @agentDefId, @modelId, @tokensIn, @tokensOut, @costUsd, 1)
         ON CONFLICT(company_id, day, agent_def_id, model_id) DO UPDATE SET
           tokens_in = tokens_in + excluded.tokens_in,
           tokens_out = tokens_out + excluded.tokens_out,
           cost_usd = cost_usd + excluded.cost_usd,
           runs = runs + 1`,
        {
          companyId: run.company_id,
          day: dayKey(run.created_at),
          agentDefId: run.agent_def_id,
          modelId: modelKey,
          tokensIn: input.tokensIn,
          tokensOut: input.tokensOut,
          costUsd: cost,
        },
      )
      const finished = this.db.get<RunRow>('SELECT * FROM runs WHERE id = ?', [id])
      return toRun(finished!)
    })
  }

  listRuns(
    companyId: string,
    options: { conversationId?: string; taskId?: string; limit?: number } = {},
  ): RunRecord[] {
    const params: unknown[] = [companyId]
    let sql = 'SELECT * FROM runs WHERE company_id = ?'
    if (options.conversationId) {
      sql += ' AND conversation_id = ?'
      params.push(options.conversationId)
    }
    if (options.taskId) {
      sql += ' AND task_id = ?'
      params.push(options.taskId)
    }
    sql += ' ORDER BY created_at DESC LIMIT ?'
    params.push(options.limit ?? 100)
    return this.db.all<RunRow>(sql, params).map(toRun)
  }

  /* --------------------------------------------------------------- budget */

  /** Usage since an instant, used by the budget guard before starting work. */
  usageSince(companyId: string, sinceIso: string): UsageSummary {
    const row = this.db.get<{ tokens_in: number; tokens_out: number; cost_usd: number; runs: number }>(
      `SELECT COALESCE(SUM(tokens_in),0) AS tokens_in, COALESCE(SUM(tokens_out),0) AS tokens_out,
              COALESCE(SUM(cost_usd),0) AS cost_usd, COUNT(*) AS runs
         FROM runs WHERE company_id = ? AND created_at >= ?`,
      [companyId, sinceIso],
    )
    return {
      tokensIn: row?.tokens_in ?? 0,
      tokensOut: row?.tokens_out ?? 0,
      costUsd: round(row?.cost_usd ?? 0, 6),
      runs: row?.runs ?? 0,
    }
  }

  summaryForConversation(companyId: string, conversationId: string): UsageSummary {
    const row = this.db.get<{ tokens_in: number; tokens_out: number; cost_usd: number; runs: number }>(
      `SELECT COALESCE(SUM(tokens_in),0) AS tokens_in, COALESCE(SUM(tokens_out),0) AS tokens_out,
              COALESCE(SUM(cost_usd),0) AS cost_usd, COUNT(*) AS runs
         FROM runs WHERE company_id = ? AND conversation_id = ?`,
      [companyId, conversationId],
    )
    return {
      tokensIn: row?.tokens_in ?? 0,
      tokensOut: row?.tokens_out ?? 0,
      costUsd: round(row?.cost_usd ?? 0, 6),
      runs: row?.runs ?? 0,
    }
  }

  dailyUsage(
    companyId: string,
    range: { from: string; to: string },
  ): { day: string; agentDefId: string; modelId: string; tokensIn: number; tokensOut: number; costUsd: number; runs: number }[] {
    return this.db
      .all<{
        day: string
        agent_def_id: string
        model_id: string
        tokens_in: number
        tokens_out: number
        cost_usd: number
        runs: number
      }>(
        `SELECT day, agent_def_id, model_id, tokens_in, tokens_out, cost_usd, runs
           FROM usage_daily
          WHERE company_id = ? AND day >= ? AND day <= ?
          ORDER BY day ASC, cost_usd DESC`,
        [companyId, range.from, range.to],
      )
      .map((row) => ({
        day: row.day,
        agentDefId: row.agent_def_id,
        modelId: row.model_id,
        tokensIn: row.tokens_in,
        tokensOut: row.tokens_out,
        costUsd: round(row.cost_usd, 6),
        runs: row.runs,
      }))
  }

  /** Cost by agent over a window, for the "who is expensive" panel. */
  costByAgent(companyId: string, range: { from: string; to: string }): { agentDefId: string; costUsd: number; runs: number; tokens: number }[] {
    return this.db
      .all<{ agent_def_id: string; cost_usd: number; runs: number; tokens: number }>(
        `SELECT agent_def_id, COALESCE(SUM(cost_usd),0) AS cost_usd, COALESCE(SUM(runs),0) AS runs,
                COALESCE(SUM(tokens_in + tokens_out),0) AS tokens
           FROM usage_daily
          WHERE company_id = ? AND day >= ? AND day <= ?
          GROUP BY agent_def_id
          ORDER BY cost_usd DESC`,
        [companyId, range.from, range.to],
      )
      .map((row) => ({
        agentDefId: row.agent_def_id,
        costUsd: round(row.cost_usd, 6),
        runs: row.runs,
        tokens: row.tokens,
      }))
  }

  /* ---------------------------------------------------------- integrations */

  upsertIntegration(input: {
    companyId: string
    kind: IntegrationKind
    name: string
    config: Record<string, unknown>
    status?: string
  }): IntegrationRecord {
    const existing = this.findIntegration(input.companyId, input.kind, input.name)
    const encrypted = this.secrets.encryptJson(input.config)
    if (existing) {
      this.db.run(
        `UPDATE integrations SET config_enc = ?, config_iv = ?, status = ? WHERE id = ?`,
        [encrypted.enc, encrypted.iv, input.status ?? existing.status, existing.id],
      )
      return this.requireIntegration(existing.id, input.companyId)
    }
    const id = newId()
    this.db.run(
      `INSERT INTO integrations (id, company_id, kind, name, config_enc, config_iv, status, last_check_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      [id, input.companyId, input.kind, input.name, encrypted.enc, encrypted.iv, input.status ?? 'configured', nowIso()],
    )
    return this.requireIntegration(id, input.companyId)
  }

  findIntegration(companyId: string, kind: string, name?: string): IntegrationRecord | undefined {
    const row = name
      ? this.db.get<IntegrationRow>(
          'SELECT * FROM integrations WHERE company_id = ? AND kind = ? AND name = ?',
          [companyId, kind, name],
        )
      : this.db.get<IntegrationRow>(
          'SELECT * FROM integrations WHERE company_id = ? AND kind = ? ORDER BY created_at ASC LIMIT 1',
          [companyId, kind],
        )
    return row ? toIntegration(row) : undefined
  }

  requireIntegration(id: string, companyId: string): IntegrationRecord {
    const row = this.db.get<IntegrationRow>('SELECT * FROM integrations WHERE id = ? AND company_id = ?', [
      id,
      companyId,
    ])
    if (!row) throw notFound('Không tìm thấy kết nối')
    return toIntegration(row)
  }

  listIntegrations(companyId: string): IntegrationRecord[] {
    return this.db
      .all<IntegrationRow>('SELECT * FROM integrations WHERE company_id = ? ORDER BY kind ASC, name ASC', [companyId])
      .map(toIntegration)
  }

  deleteIntegration(companyId: string, kind: string, name?: string): number {
    const result = name
      ? this.db.run('DELETE FROM integrations WHERE company_id = ? AND kind = ? AND name = ?', [companyId, kind, name])
      : this.db.run('DELETE FROM integrations WHERE company_id = ? AND kind = ?', [companyId, kind])
    return result.changes
  }

  markIntegrationChecked(id: string, companyId: string, status: string): void {
    this.db.run('UPDATE integrations SET status = ?, last_check_at = ? WHERE id = ? AND company_id = ?', [
      status,
      nowIso(),
      id,
      companyId,
    ])
  }

  /** Decrypted integration config, resolved per call like provider keys. */
  resolveIntegrationConfig<T = Record<string, unknown>>(integration: IntegrationRecord): T | undefined {
    return this.secrets.decryptJson<T>(integration.configEnc, integration.configIv)
  }

  /* --------------------------------------------------------------- audit */

  audit(input: {
    companyId?: string | null
    userId?: string | null
    action: string
    target?: string | null
    payload?: unknown
  }): void {
    this.db.run(
      `INSERT INTO audit_log (id, company_id, user_id, action, target, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        input.companyId ?? null,
        input.userId ?? null,
        input.action,
        input.target ?? null,
        input.payload === undefined ? null : JSON.stringify(input.payload),
        nowIso(),
      ],
    )
  }

  listAudit(companyId: string, limit = 100): {
    id: string
    userId: string | null
    action: string
    target: string | null
    payload: unknown
    createdAt: string
  }[] {
    return this.db
      .all<{
        id: string
        user_id: string | null
        action: string
        target: string | null
        payload_json: string | null
        created_at: string
      }>(
        `SELECT id, user_id, action, target, payload_json, created_at
           FROM audit_log WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`,
        [companyId, limit],
      )
      .map((row) => ({
        id: row.id,
        userId: row.user_id,
        action: row.action,
        target: row.target,
        payload: row.payload_json ? safeJson(row.payload_json) : null,
        createdAt: row.created_at,
      }))
  }

  /* ------------------------------------------------------------- settings */

  getSetting<T>(key: string): T | undefined {
    const row = this.db.get<{ value_json: string }>('SELECT value_json FROM app_settings WHERE key = ?', [key])
    return row ? (safeJson(row.value_json) as T) : undefined
  }

  setSetting(key: string, value: unknown): void {
    this.db.run(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), nowIso()],
    )
  }
}

function safeJson(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
