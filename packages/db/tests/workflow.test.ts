import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError, type RunStatus } from '@marketing-agent/shared'
import { createRepos, type Repos } from '../src/index.ts'
import { MIGRATIONS } from '../src/migrations.ts'

let repos: Repos
const at = '2026-01-01T00:00:00.000Z'

beforeEach(() => {
  repos = createRepos({ file: ':memory:', allowWeakSecret: true })
  repos.db.run('INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)',
    ['user', 'workflow@example.com', 'unused', 'User', at])
  for (const companyId of ['company-a', 'company-b']) {
    repos.db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)',
      [companyId, companyId, companyId, at])
  }
  for (const [id, companyId] of [['conversation-a', 'company-a'], ['conversation-other', 'company-a'], ['conversation-b', 'company-b']]) {
    repos.db.run('INSERT INTO conversations (id, company_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, companyId, 'user', 'Duplicate conversation title', at, at])
  }
  for (const id of ['agent-a', 'agent-b', 'leader']) {
    repos.db.run('INSERT INTO agent_defs (id, role, name, description, system_prompt, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, `${id}-role`, `${id} name`, 'private description', 'private prompt', at])
  }
})

afterEach(() => { repos.db.close() })

function task(id: string, conversationId = 'conversation-a', companyId = 'company-a', agentDefId: string | null = 'agent-a') {
  return repos.work.createTask({ id, companyId, conversationId, assigneeAgentDefId: agentDefId,
    title: 'Same title', briefMd: 'PRIVATE BRIEF', status: 'assigned' })
}

function run(id: string, input: {
  taskId?: string | null
  conversationId?: string
  companyId?: string
  agentDefId?: string
  status?: RunStatus
  createdAt?: string
  modelId?: string | null
  providerId?: string | null
} = {}) {
  repos.db.run(`INSERT INTO runs (id, company_id, task_id, conversation_id, agent_def_id, provider_id, model_id,
    status, tokens_in, tokens_out, cost_usd, latency_ms, steps, error, created_at)
    VALUES (@id, @companyId, @taskId, @conversationId, @agentDefId, @providerId, @modelId, @status, 11, 12, 0.13, 14, 15, 'PRIVATE ERROR', @createdAt)`, {
    id, companyId: input.companyId ?? 'company-a', taskId: input.taskId ?? null,
    conversationId: input.conversationId ?? 'conversation-a', agentDefId: input.agentDefId ?? 'agent-a',
    providerId: input.providerId ?? null, modelId: input.modelId ?? null,
    status: input.status ?? 'succeeded', createdAt: input.createdAt ?? at,
  })
}

const snapshot = () => repos.work.workflowData('company-a', 'conversation-a')

describe('WorkRepo.workflowData', () => {
  it('returns metadata-only task/run contracts with scoped names, labels and artifact counts', () => {
    task('task-a')
    task('task-b', 'conversation-a', 'company-a', null)
    repos.db.run('INSERT INTO agent_presets (id, company_id, agent_def_id, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
      ['preset-a', 'company-a', 'agent-a', 'Local specialist', at])
    repos.db.run('INSERT INTO agent_presets (id, company_id, agent_def_id, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
      ['preset-b', 'company-b', 'agent-a', 'FOREIGN NAME', at])
    repos.db.run('INSERT INTO llm_providers (id, company_id, name, kind, base_url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['provider-a', 'company-a', 'Provider', 'openai_compatible', 'https://example.com', at])
    repos.db.run('INSERT INTO llm_models (id, provider_id, model_id, label, created_at) VALUES (?, ?, ?, ?, ?)',
      ['model-a', 'provider-a', 'wire-model', 'Friendly model', at])
    repos.work.addArtifact({ companyId: 'company-a', taskId: 'task-a', name: 'Local', kind: 'markdown', content: 'PRIVATE CONTENT' })
    repos.work.addArtifact({ companyId: 'company-b', taskId: 'task-a', name: 'Foreign', kind: 'markdown', content: 'FOREIGN CONTENT' })
    repos.work.addArtifact({ companyId: 'company-a', name: 'Unattached', kind: 'markdown', content: 'PRIVATE CONTENT' })
    run('run-a', { taskId: 'task-a', modelId: 'model-a', providerId: 'provider-a' })
    const data = snapshot()
    expect(data.tasks.find((node) => node.id === 'task-a')).toEqual({
      id: 'task-a', conversationId: 'conversation-a', parentTaskId: null, agentDefId: 'agent-a',
      assigneeRole: 'agent-a-role', assigneeName: 'Local specialist', title: 'Same title', status: 'assigned',
      priority: 3, revisionCount: 0, deadline: null, createdAt: expect.any(String), updatedAt: expect.any(String), artifactCount: 1,
    })
    expect(data.tasks.find((node) => node.id === 'task-b')).toMatchObject({ agentDefId: null, assigneeRole: null, assigneeName: null, artifactCount: 0 })
    expect(data.runs).toEqual([{
      id: 'run-a', taskId: 'task-a', conversationId: 'conversation-a', agentDefId: 'agent-a',
      agentRole: 'agent-a-role', agentName: 'Local specialist', modelId: 'model-a', modelLabel: 'Friendly model',
      providerId: 'provider-a', status: 'succeeded', tokensIn: 11, tokensOut: 12, costUsd: 0.13,
      latencyMs: 14, steps: 15, createdAt: at, activity: 'terminal',
    }])
    expect(JSON.stringify(data)).not.toMatch(/PRIVATE|FOREIGN|error|briefMd|content/)
    expect(data.historyTruncated).toBe(false)
  })

  it('scopes both dependency endpoints by company and conversation and preserves ID identity/direction', () => {
    task('task:source')
    task('task:target')
    task('other-conversation', 'conversation-other')
    task('other-company', 'conversation-b', 'company-b')
    repos.work.addDependency('task:target', 'task:source')
    repos.work.addDependency('task:target', 'other-conversation')
    repos.work.addDependency('other-conversation', 'task:source')
    repos.work.addDependency('task:target', 'other-company')
    repos.work.addDependency('other-company', 'task:source')
    run('local', { taskId: 'task:source' })
    run('other-conversation-run', { taskId: 'other-conversation', conversationId: 'conversation-other' })
    run('other-company-run', { taskId: 'other-company', conversationId: 'conversation-b', companyId: 'company-b' })
    run('invalid-task-scope', { taskId: 'other-company' })
    run('invalid-conversation-scope', { taskId: 'task:source', companyId: 'company-b' })
    const data = snapshot()
    expect(data.tasks.map((node) => node.id)).toEqual(['task:source', 'task:target'])
    expect(data.dependencies).toEqual([{
      id: JSON.stringify(['task:source', 'task:target']), sourceTaskId: 'task:source', targetTaskId: 'task:target',
    }])
    expect(data.runs.map((item) => item.id)).toEqual(['local'])
    expect(repos.work.listDependencies('company-b', ['task:source', 'task:target'])).toEqual([])
    expect(repos.work.listDependencies('company-a', ['task:source', 'task:target'])).toEqual([
      { taskId: 'task:target', dependsOnTaskId: 'task:source' },
    ])
    expect(repos.work.listDependencies('company-a').some((dependency) =>
      dependency.taskId === 'other-company' || dependency.dependsOnTaskId === 'other-company')).toBe(false)
    expect(repos.work.workflowData('company-b', 'conversation-a')).toEqual({ tasks: [], dependencies: [], runs: [], historyTruncated: false })
  })

  it('omits an out-of-scope parent reference', () => {
    task('foreign-parent', 'conversation-other')
    repos.work.createTask({ id: 'child', companyId: 'company-a', conversationId: 'conversation-a',
      parentTaskId: 'foreign-parent', title: 'Child', briefMd: 'PRIVATE' })
    expect(snapshot().tasks[0]?.parentTaskId).toBeNull()
  })

  it('supports conversations without tasks, retaining null-task leader runs', () => {
    run('leader-running', { agentDefId: 'leader', status: 'running' })
    run('leader-finished', { agentDefId: 'leader', createdAt: '2026-01-02T00:00:00.000Z' })
    const data = snapshot()
    expect(data.tasks).toEqual([])
    expect(data.dependencies).toEqual([])
    expect(data.runs.map((item) => [item.id, item.activity])).toEqual([
      ['leader-finished', 'terminal'], ['leader-running', 'unverified'],
    ])
    expect(data.historyTruncated).toBe(false)
  })

  it('empty scope/explicit task ID collections never fall back to company-wide data', () => {
    task('a')
    task('b')
    repos.work.addDependency('b', 'a')
    run('run')
    const all = vi.spyOn(repos.db, 'all')
    for (const [companyId, conversationId] of [['company-a', ''], ['', 'conversation-a']] as const) {
      expect(repos.work.workflowData(companyId, conversationId)).toEqual({ tasks: [], dependencies: [], runs: [], historyTruncated: false })
    }
    expect(repos.work.listDependencies('company-a', [])).toEqual([])
    expect(repos.work.listAgentMessages('company-a', { conversationTaskIds: [] })).toEqual([])
    expect(all).not.toHaveBeenCalled()
  })

  it('allows all 500 tasks and rejects the 501st with a safe AppError, not a partial graph', () => {
    repos.db.tx(() => {
      for (let i = 0; i < 500; i++) task(`task-${i.toString().padStart(3, '0')}`)
    })
    expect(snapshot().tasks).toHaveLength(500)
    task('task-500')
    expect(() => snapshot()).toThrow(AppError)
    expect(() => snapshot()).toThrow('Workflow exceeds the supported limit of 500 tasks')
    try { snapshot() } catch (error) {
      expect(error).toMatchObject({ code: 'conflict', status: 409 })
      expect((error as AppError).details).toBeUndefined()
    }
  })

  it('keeps old running and latest per task/agent and null-task agent even outside latest 50 history', () => {
    task('busy-task')
    task('quiet-task')
    run('old-active', { taskId: 'busy-task', status: 'running', createdAt: '2025-01-01T00:00:00.000Z' })
    run('quiet-latest', { taskId: 'quiet-task', createdAt: '2025-01-02T00:00:00.000Z' })
    run('different-agent-latest', { taskId: 'busy-task', agentDefId: 'agent-b', createdAt: '2025-01-03T00:00:00.000Z' })
    run('leader-latest', { agentDefId: 'leader', createdAt: '2025-01-04T00:00:00.000Z' })
    run('leader-older', { agentDefId: 'leader', createdAt: '2025-01-03T00:00:00.000Z' })
    for (let i = 0; i < 80; i++) {
      run(`history-${i.toString().padStart(3, '0')}`, { taskId: 'busy-task', createdAt: at })
    }
    const data = snapshot()
    expect(data.runs).toHaveLength(54)
    const ids = data.runs.map((item) => item.id)
    expect(ids.slice(0, 50)).toEqual(Array.from({ length: 50 }, (_, i) => `history-${(79 - i).toString().padStart(3, '0')}`))
    expect(ids).toEqual(expect.arrayContaining(['old-active', 'quiet-latest', 'different-agent-latest', 'leader-latest']))
    expect(ids).not.toContain('leader-older')
    expect(new Set(ids).size).toBe(ids.length)
    expect(data.runs.find((item) => item.id === 'old-active')?.activity).toBe('unverified')
    expect(data.historyTruncated).toBe(true)
  })

  it('does not mark truncated when every run is retained by mandatory latest/running selection', () => {
    for (let i = 0; i < 60; i++) {
      task(`task-${i}`)
      run(`run-${i}`, { taskId: `task-${i}`, status: i % 2 ? 'running' : 'failed' })
    }
    const data = snapshot()
    expect(data.runs).toHaveLength(60)
    expect(data.historyTruncated).toBe(false)
    expect(data.runs.filter((item) => item.status === 'failed').every((item) => item.activity === 'terminal')).toBe(true)
  })

  it('never caps persisted running rows even when one task has more than 50 old active runs', () => {
    task('task')
    for (let i = 0; i < 75; i++) {
      run(`active-${i}`, { taskId: 'task', status: 'running', createdAt: '2025-01-01T00:00:00.000Z' })
    }
    for (let i = 0; i < 60; i++) run(`terminal-${i}`, { taskId: 'task' })
    const data = snapshot()
    expect(data.runs.filter((item) => item.status === 'running')).toHaveLength(75)
    expect(data.runs).toHaveLength(125)
    expect(data.historyTruncated).toBe(true)
  })

  it('uses four bulk reads and one synchronous transaction regardless of task count', () => {
    for (let i = 0; i < 10; i++) task(`task-${i}`)
    const all = vi.spyOn(repos.db, 'all')
    const get = vi.spyOn(repos.db, 'get')
    const tx = vi.spyOn(repos.db, 'tx')
    const data = snapshot()
    expect(data.tasks).toHaveLength(10)
    expect(all).toHaveBeenCalledTimes(4)
    expect(get).not.toHaveBeenCalled()
    expect(tx).toHaveBeenCalledTimes(1)
    expect(data).not.toBeInstanceOf(Promise)
    expect(all.mock.calls.every(([sql]) => !/SELECT\s+(?:\w+\.)?\*|\berror\b|\bcontent\b/i.test(sql))).toBe(true)
  })

  it('does not expose a foreign provider model label', () => {
    repos.db.run('INSERT INTO llm_providers (id, company_id, name, kind, base_url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['provider-b', 'company-b', 'Foreign provider', 'openai_compatible', 'https://example.com', at])
    repos.db.run('INSERT INTO llm_models (id, provider_id, model_id, label, created_at) VALUES (?, ?, ?, ?, ?)',
      ['model-b', 'provider-b', 'foreign-model', 'FOREIGN LABEL', at])
    run('run', { modelId: 'model-b', providerId: 'provider-b' })
    expect(snapshot().runs[0]?.modelLabel).toBeNull()
  })
})

describe('0012_workflow_indexes', () => {
  it('adds only stable company/conversation indexes without tables or data changes', () => {
    const migration = MIGRATIONS.find((item) => item.id === '0012_workflow_indexes')
    expect(migration).toBeDefined()
    const statements = migration!.sql.split(';').map((sql) => sql.trim()).filter(Boolean)
    expect(statements).toHaveLength(2)
    expect(statements.every((sql) => sql.startsWith('CREATE INDEX '))).toBe(true)
    for (const [name, table, descending] of [
      ['idx_runs_workflow_history', 'runs', 1], ['idx_tasks_workflow_stable', 'tasks', 0],
    ] as const) {
      const index = repos.db.all<{ name: string; desc: number }>(`PRAGMA index_xinfo(${name})`).filter((row) => row.name !== null)
      expect(index.map((row) => [row.name, row.desc])).toEqual([
        ['company_id', 0], ['conversation_id', 0], ['created_at', descending], ['id', descending],
      ])
      expect(repos.db.get<{ tbl_name: string }>('SELECT tbl_name FROM sqlite_master WHERE name = ?', [name])?.tbl_name).toBe(table)
    }
  })
})
