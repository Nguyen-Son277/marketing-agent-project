/** Conversations, messages, tasks, the dependency DAG, and artifacts. */
import {
  conflict,
  newId,
  notFound,
  nowIso,
  type AgentMessageKind,
  type AgentMessageRecord,
  type ArtifactKind,
  type ArtifactRecord,
  type ConversationPhase,
  type ConversationRecord,
  type MessageAuthorKind,
  type MessageRecord,
  type TaskRecord,
  type TaskStatus,
  type WorkflowDependency,
  type WorkflowRunSummary,
  type WorkflowTaskNode,
  TERMINAL_TASK_STATUSES,
} from '@marketing-agent/shared'
import type { Database } from '../database.ts'

interface ConversationRow {
  id: string
  company_id: string
  user_id: string
  title: string
  phase: ConversationPhase
  brief_json: string | null
  language: string
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: string
  conversation_id: string
  company_id: string
  role: 'user' | 'assistant' | 'system'
  author_kind: MessageAuthorKind
  author_agent: string | null
  content_md: string
  meta_json: string | null
  tokens_in: number
  tokens_out: number
  cost_usd: number
  created_at: string
}

interface TaskRow {
  id: string
  company_id: string
  conversation_id: string | null
  parent_task_id: string | null
  title: string
  brief_md: string
  assignee_agent_def_id: string | null
  status: TaskStatus
  priority: number
  deadline: string | null
  result_md: string | null
  deliverable_spec: string | null
  revision_count: number
  created_at: string
  updated_at: string
}

interface WorkflowTaskRow {
  id: string
  conversation_id: string
  parent_task_id: string | null
  assignee_agent_def_id: string | null
  assignee_role: string | null
  assignee_name: string | null
  title: string
  status: TaskStatus
  priority: number
  revision_count: number
  deadline: string | null
  created_at: string
  updated_at: string
}

interface WorkflowRunRow {
  id: string
  task_id: string | null
  conversation_id: string
  agent_def_id: string
  agent_role: string
  agent_name: string
  model_id: string | null
  model_label: string | null
  provider_id: string | null
  effective_provider_id: string | null
  status: WorkflowRunSummary['status']
  tokens_in: number
  tokens_out: number
  cost_usd: number
  latency_ms: number
  steps: number
  created_at: string
  total_count: number
}

interface ArtifactRow {
  id: string
  company_id: string
  task_id: string | null
  name: string
  kind: ArtifactKind
  content: string | null
  path: string | null
  meta_json: string | null
  created_at: string
}

interface AgentMessageRow {
  id: string
  company_id: string
  from_agent: string
  to_agent: string
  task_id: string | null
  kind: AgentMessageKind
  content_md: string
  created_at: string
}

const toConversation = (row: ConversationRow): ConversationRecord => ({
  id: row.id,
  companyId: row.company_id,
  userId: row.user_id,
  title: row.title,
  phase: row.phase,
  briefJson: row.brief_json,
  language: row.language,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toMessage = (row: MessageRow): MessageRecord => ({
  id: row.id,
  conversationId: row.conversation_id,
  companyId: row.company_id,
  role: row.role,
  authorKind: row.author_kind,
  authorAgent: row.author_agent,
  contentMd: row.content_md,
  metaJson: row.meta_json,
  tokensIn: row.tokens_in,
  tokensOut: row.tokens_out,
  costUsd: row.cost_usd,
  createdAt: row.created_at,
})

const toTask = (row: TaskRow): TaskRecord => ({
  id: row.id,
  companyId: row.company_id,
  conversationId: row.conversation_id,
  parentTaskId: row.parent_task_id,
  title: row.title,
  briefMd: row.brief_md,
  assigneeAgentDefId: row.assignee_agent_def_id,
  status: row.status,
  priority: row.priority,
  deadline: row.deadline,
  resultMd: row.result_md,
  deliverableSpec: row.deliverable_spec,
  revisionCount: row.revision_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const toArtifact = (row: ArtifactRow): ArtifactRecord => ({
  id: row.id,
  companyId: row.company_id,
  taskId: row.task_id,
  name: row.name,
  kind: row.kind,
  content: row.content,
  path: row.path,
  metaJson: row.meta_json,
  createdAt: row.created_at,
})

const toAgentMessage = (row: AgentMessageRow): AgentMessageRecord => ({
  id: row.id,
  companyId: row.company_id,
  fromAgent: row.from_agent,
  toAgent: row.to_agent,
  taskId: row.task_id,
  kind: row.kind,
  contentMd: row.content_md,
  createdAt: row.created_at,
})

export class WorkRepo {
  constructor(private readonly db: Database) {}

  /* -------------------------------------------------------- conversations */

  createConversation(input: {
    companyId: string
    userId: string
    title: string
    /** Ngôn ngữ agent trả lời; mặc định tiếng Việt để giữ hành vi cũ. */
    language?: string
  }): ConversationRecord {
    const id = newId()
    const now = nowIso()
    this.db.run(
      `INSERT INTO conversations (id, company_id, user_id, title, phase, brief_json, language, created_at, updated_at)
       VALUES (@id, @companyId, @userId, @title, 'intake', NULL, @language, @now, @now)`,
      {
        id,
        companyId: input.companyId,
        userId: input.userId,
        title: input.title,
        language: input.language ?? 'vi',
        now,
      },
    )
    return this.requireConversation(id, input.companyId)
  }

  findConversation(id: string, companyId: string): ConversationRecord | undefined {
    const row = this.db.get<ConversationRow>('SELECT * FROM conversations WHERE id = ? AND company_id = ?', [
      id,
      companyId,
    ])
    return row ? toConversation(row) : undefined
  }

  requireConversation(id: string, companyId: string): ConversationRecord {
    const conversation = this.findConversation(id, companyId)
    if (!conversation) throw notFound('Không tìm thấy cuộc trao đổi')
    return conversation
  }

  listConversations(companyId: string, limit = 50): ConversationRecord[] {
    return this.db
      .all<ConversationRow>(
        'SELECT * FROM conversations WHERE company_id = ? ORDER BY updated_at DESC LIMIT ?',
        [companyId, limit],
      )
      .map(toConversation)
  }

  /** Update phase and/or the structured brief; always bumps updated_at. */
  updateConversation(
    id: string,
    companyId: string,
    patch: { title?: string; phase?: ConversationPhase; brief?: unknown },
  ): ConversationRecord {
    const sets: string[] = ['updated_at = @updatedAt']
    const params: Record<string, unknown> = { id, companyId, updatedAt: nowIso() }
    if (patch.title !== undefined) {
      sets.push('title = @title')
      params.title = patch.title
    }
    if (patch.phase !== undefined) {
      sets.push('phase = @phase')
      params.phase = patch.phase
    }
    if (patch.brief !== undefined) {
      sets.push('brief_json = @brief')
      params.brief = JSON.stringify(patch.brief)
    }
    const result = this.db.run(
      `UPDATE conversations SET ${sets.join(', ')} WHERE id = @id AND company_id = @companyId`,
      params,
    )
    if (result.changes === 0) throw notFound('Không tìm thấy cuộc trao đổi')
    return this.requireConversation(id, companyId)
  }

  /** Metadata-only, consistent workflow graph; never silently returns a cut task graph. */
  workflowData(companyId: string, conversationId: string): {
    tasks: WorkflowTaskNode[]
    dependencies: WorkflowDependency[]
    runs: WorkflowRunSummary[]
    historyTruncated: boolean
  } {
    // Empty scope must not degrade to a company-wide read.
    if (!companyId || !conversationId) {
      return { tasks: [], dependencies: [], runs: [], historyTruncated: false }
    }
    return this.db.tx(() => {
      const scope = { companyId, conversationId }
      const taskRows = this.db.all<WorkflowTaskRow>(
        `SELECT t.id, t.conversation_id, parent.id AS parent_task_id,
                t.assignee_agent_def_id, a.role AS assignee_role,
                COALESCE(p.display_name, a.name) AS assignee_name,
                t.title, t.status, t.priority, t.revision_count, t.deadline, t.created_at, t.updated_at
           FROM tasks t
           LEFT JOIN tasks parent ON parent.id = t.parent_task_id
             AND parent.company_id = @companyId AND parent.conversation_id = @conversationId
           LEFT JOIN agent_defs a ON a.id = t.assignee_agent_def_id
           LEFT JOIN agent_presets p ON p.agent_def_id = a.id AND p.company_id = @companyId
          WHERE t.company_id = @companyId AND t.conversation_id = @conversationId
          ORDER BY t.created_at ASC, t.id ASC LIMIT 501`,
        scope,
      )
      if (taskRows.length > 500) {
        throw conflict('Workflow exceeds the supported limit of 500 tasks')
      }
      const artifactCounts = new Map(this.db.all<{ task_id: string; n: number }>(
        `SELECT a.task_id, COUNT(*) AS n FROM artifacts a
           JOIN tasks t ON t.id = a.task_id
          WHERE a.company_id = @companyId AND t.company_id = @companyId
            AND t.conversation_id = @conversationId
          GROUP BY a.task_id`,
        scope,
      ).map((row) => [row.task_id, row.n]))
      const tasks: WorkflowTaskNode[] = taskRows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        parentTaskId: row.parent_task_id,
        agentDefId: row.assignee_agent_def_id,
        assigneeRole: row.assignee_role,
        assigneeName: row.assignee_name,
        title: row.title,
        status: row.status,
        priority: row.priority,
        revisionCount: row.revision_count,
        deadline: row.deadline,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        artifactCount: artifactCounts.get(row.id) ?? 0,
      }))
      const dependencies = this.db.all<{ task_id: string; depends_on_task_id: string }>(
        `SELECT d.task_id, d.depends_on_task_id FROM task_deps d
           JOIN tasks target ON target.id = d.task_id
           JOIN tasks source ON source.id = d.depends_on_task_id
          WHERE target.company_id = @companyId AND target.conversation_id = @conversationId
            AND source.company_id = @companyId AND source.conversation_id = @conversationId
          ORDER BY d.depends_on_task_id ASC, d.task_id ASC`,
        scope,
      ).map((row): WorkflowDependency => ({
        id: JSON.stringify([row.depends_on_task_id, row.task_id]),
        sourceTaskId: row.depends_on_task_id,
        targetTaskId: row.task_id,
      }))
      // Rank in SQLite so historical rows (and raw error text) never become a huge
      // application payload. Null-task leaders form their own per-agent groups.
      const runRows = this.db.all<WorkflowRunRow>(
        `WITH ranked AS (
           SELECT r.id, r.task_id, r.conversation_id, r.agent_def_id, r.model_id, r.provider_id,
                  r.status, r.tokens_in, r.tokens_out, r.cost_usd, r.latency_ms, r.steps, r.created_at,
                  ROW_NUMBER() OVER (PARTITION BY r.task_id, r.agent_def_id ORDER BY r.created_at DESC, r.id DESC) AS pair_rank,
                  ROW_NUMBER() OVER (ORDER BY r.created_at DESC, r.id DESC) AS history_rank,
                  COUNT(*) OVER () AS total_count
             FROM runs r
            WHERE r.company_id = @companyId AND r.conversation_id = @conversationId
              AND (r.task_id IS NULL OR EXISTS (
                SELECT 1 FROM tasks t WHERE t.id = r.task_id
                  AND t.company_id = @companyId AND t.conversation_id = @conversationId
              ))
         )
         SELECT r.id, r.task_id, r.conversation_id, r.agent_def_id, r.model_id, r.provider_id,
                r.status, r.tokens_in, r.tokens_out, r.cost_usd, r.latency_ms, r.steps, r.created_at, r.total_count,
                COALESCE(a.role, r.agent_def_id) AS agent_role,
                COALESCE(p.display_name, a.name, r.agent_def_id) AS agent_name, m.label AS model_label, COALESCE(m.provider_id, r.provider_id) AS effective_provider_id
           FROM ranked r
           LEFT JOIN agent_defs a ON a.id = r.agent_def_id
           LEFT JOIN agent_presets p ON p.agent_def_id = a.id AND p.company_id = @companyId
           LEFT JOIN llm_models m ON m.id = r.model_id AND EXISTS (
             SELECT 1 FROM llm_providers provider WHERE provider.id = m.provider_id AND provider.company_id = @companyId
           )
          WHERE r.status = 'running' OR r.pair_rank = 1 OR r.history_rank <= 50
          ORDER BY r.created_at DESC, r.id DESC`,
        scope,
      )
      const runs: WorkflowRunSummary[] = runRows.map((row) => ({
        id: row.id,
        taskId: row.task_id,
        conversationId: row.conversation_id,
        agentDefId: row.agent_def_id,
        agentRole: row.agent_role,
        agentName: row.agent_name,
        modelId: row.model_id,
        modelLabel: row.model_label,
        providerId: row.effective_provider_id,
        status: row.status,
        tokensIn: row.tokens_in,
        tokensOut: row.tokens_out,
        costUsd: row.cost_usd,
        latencyMs: row.latency_ms,
        steps: row.steps,
        createdAt: row.created_at,
        activity: row.status === 'running' ? 'unverified' : 'terminal',
      }))
      return { tasks, dependencies, runs, historyTruncated: (runRows[0]?.total_count ?? 0) > runs.length }
    })
  }

  /* ------------------------------------------------------------- messages */

  addMessage(input: {
    conversationId: string
    companyId: string
    role: 'user' | 'assistant' | 'system'
    authorKind: MessageAuthorKind
    authorAgent?: string | null
    contentMd: string
    meta?: unknown
    tokensIn?: number
    tokensOut?: number
    costUsd?: number
  }): MessageRecord {
    const id = newId()
    this.db.run(
      `INSERT INTO messages
         (id, conversation_id, company_id, role, author_kind, author_agent, content_md, meta_json, tokens_in, tokens_out, cost_usd, created_at)
       VALUES (@id, @conversationId, @companyId, @role, @authorKind, @authorAgent, @contentMd, @meta, @tokensIn, @tokensOut, @costUsd, @createdAt)`,
      {
        id,
        conversationId: input.conversationId,
        companyId: input.companyId,
        role: input.role,
        authorKind: input.authorKind,
        authorAgent: input.authorAgent ?? null,
        contentMd: input.contentMd,
        meta: input.meta === undefined ? null : JSON.stringify(input.meta),
        tokensIn: input.tokensIn ?? 0,
        tokensOut: input.tokensOut ?? 0,
        costUsd: input.costUsd ?? 0,
        createdAt: nowIso(),
      },
    )
    this.db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [nowIso(), input.conversationId])
    return this.requireMessage(id, input.companyId)
  }

  findMessage(id: string, companyId: string): MessageRecord | undefined {
    const row = this.db.get<MessageRow>('SELECT * FROM messages WHERE id = ? AND company_id = ?', [id, companyId])
    return row ? toMessage(row) : undefined
  }

  requireMessage(id: string, companyId: string): MessageRecord {
    const message = this.findMessage(id, companyId)
    if (!message) throw notFound('Không tìm thấy tin nhắn')
    return message
  }

  listMessages(conversationId: string, companyId: string, limit = 200): MessageRecord[] {
    return this.db
      .all<MessageRow>(
        `SELECT * FROM messages
          WHERE conversation_id = ? AND company_id = ?
          ORDER BY created_at ASC, rowid ASC
          LIMIT ?`,
        [conversationId, companyId, limit],
      )
      .map(toMessage)
  }

  /* ---------------------------------------------------------------- tasks */

  createTask(input: {
    companyId: string
    conversationId?: string | null
    parentTaskId?: string | null
    title: string
    briefMd: string
    assigneeAgentDefId?: string | null
    status?: TaskStatus
    priority?: number
    deadline?: string | null
    deliverableSpec?: string | null
    id?: string
  }): TaskRecord {
    const id = input.id ?? newId()
    const now = nowIso()
    this.db.run(
      `INSERT INTO tasks
         (id, company_id, conversation_id, parent_task_id, title, brief_md, assignee_agent_def_id, status, priority,
          deadline, result_md, deliverable_spec, revision_count, created_at, updated_at)
       VALUES (@id, @companyId, @conversationId, @parentTaskId, @title, @briefMd, @assignee, @status, @priority,
               @deadline, NULL, @deliverableSpec, 0, @now, @now)`,
      {
        id,
        companyId: input.companyId,
        conversationId: input.conversationId ?? null,
        parentTaskId: input.parentTaskId ?? null,
        title: input.title,
        briefMd: input.briefMd,
        assignee: input.assigneeAgentDefId ?? null,
        status: input.status ?? 'draft',
        priority: input.priority ?? 3,
        deadline: input.deadline ?? null,
        deliverableSpec: input.deliverableSpec ?? null,
        now,
      },
    )
    return this.requireTask(id, input.companyId)
  }

  findTask(id: string, companyId: string): TaskRecord | undefined {
    const row = this.db.get<TaskRow>('SELECT * FROM tasks WHERE id = ? AND company_id = ?', [id, companyId])
    return row ? toTask(row) : undefined
  }

  requireTask(id: string, companyId: string): TaskRecord {
    const task = this.findTask(id, companyId)
    if (!task) throw notFound('Không tìm thấy công việc')
    return task
  }

  listTasks(
    companyId: string,
    options: { conversationId?: string; statuses?: readonly TaskStatus[]; assigneeAgentDefId?: string; limit?: number } = {},
  ): TaskRecord[] {
    const params: unknown[] = [companyId]
    let sql = 'SELECT * FROM tasks WHERE company_id = ?'
    if (options.conversationId) {
      sql += ' AND conversation_id = ?'
      params.push(options.conversationId)
    }
    if (options.statuses && options.statuses.length > 0) {
      sql += ` AND status IN (${options.statuses.map(() => '?').join(', ')})`
      params.push(...options.statuses)
    }
    if (options.assigneeAgentDefId) {
      sql += ' AND assignee_agent_def_id = ?'
      params.push(options.assigneeAgentDefId)
    }
    sql += ' ORDER BY priority ASC, created_at ASC LIMIT ?'
    params.push(options.limit ?? 200)
    return this.db.all<TaskRow>(sql, params).map(toTask)
  }

  updateTask(
    id: string,
    companyId: string,
    patch: Partial<{
      title: string
      briefMd: string
      assigneeAgentDefId: string | null
      status: TaskStatus
      priority: number
      deadline: string | null
      resultMd: string | null
      deliverableSpec: string | null
      incrementRevision: boolean
    }>,
  ): TaskRecord {
    const map: Record<string, string> = {
      title: 'title',
      briefMd: 'brief_md',
      assigneeAgentDefId: 'assignee_agent_def_id',
      status: 'status',
      priority: 'priority',
      deadline: 'deadline',
      resultMd: 'result_md',
      deliverableSpec: 'deliverable_spec',
    }
    const sets: string[] = ['updated_at = @updatedAt']
    const params: Record<string, unknown> = { id, companyId, updatedAt: nowIso() }
    for (const [key, column] of Object.entries(map)) {
      const value = (patch as Record<string, unknown>)[key]
      if (value === undefined) continue
      sets.push(`${column} = @${key}`)
      params[key] = value
    }
    if (patch.incrementRevision) sets.push('revision_count = revision_count + 1')
    const result = this.db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = @id AND company_id = @companyId`, params)
    if (result.changes === 0) throw notFound('Không tìm thấy công việc')
    return this.requireTask(id, companyId)
  }

  /** Transition a task, refusing to revive a terminal task without a reopen call. */
  setTaskStatus(id: string, companyId: string, status: TaskStatus, resultMd?: string | null): TaskRecord {
    const task = this.requireTask(id, companyId)
    if (TERMINAL_TASK_STATUSES.includes(task.status) && !TERMINAL_TASK_STATUSES.includes(status)) {
      throw conflict(`Công việc đã ở trạng thái ${task.status}, không thể chuyển sang ${status}`)
    }
    return this.updateTask(id, companyId, resultMd === undefined ? { status } : { status, resultMd })
  }

  /* ----------------------------------------------------------- task graph */

  addDependency(taskId: string, dependsOnTaskId: string): void {
    if (taskId === dependsOnTaskId) throw conflict('Công việc không thể phụ thuộc chính nó')
    this.db.run(
      'INSERT OR IGNORE INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)',
      [taskId, dependsOnTaskId],
    )
  }

  listDependencies(companyId: string, taskIds?: readonly string[]): { taskId: string; dependsOnTaskId: string }[] {
    if (taskIds) {
      if (taskIds.length === 0) return []
      const placeholders = taskIds.map(() => '?').join(', ')
      return this.db.all<{ task_id: string; depends_on_task_id: string }>(
        `SELECT d.task_id, d.depends_on_task_id FROM task_deps d
           JOIN tasks target ON target.id = d.task_id
           JOIN tasks source ON source.id = d.depends_on_task_id
          WHERE target.company_id = ? AND source.company_id = ?
            AND d.task_id IN (${placeholders}) AND d.depends_on_task_id IN (${placeholders})`,
        [companyId, companyId, ...taskIds, ...taskIds],
      ).map((row) => ({ taskId: row.task_id, dependsOnTaskId: row.depends_on_task_id }))
    }
    return this.db
      .all<{ task_id: string; depends_on_task_id: string }>(
        `SELECT d.task_id, d.depends_on_task_id
           FROM task_deps d
           JOIN tasks t ON t.id = d.task_id
            JOIN tasks source ON source.id = d.depends_on_task_id
          WHERE t.company_id = ? AND source.company_id = ?`,
        [companyId, companyId],
      )
      .map((row) => ({ taskId: row.task_id, dependsOnTaskId: row.depends_on_task_id }))
  }

  addTaskEvent(taskId: string, companyId: string, kind: string, payload?: unknown): void {
    this.db.run(
      `INSERT INTO task_events (id, task_id, company_id, kind, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), taskId, companyId, kind, payload === undefined ? null : JSON.stringify(payload), nowIso()],
    )
  }

  listTaskEvents(taskId: string, companyId: string, limit = 100): {
    id: string
    kind: string
    payload: unknown
    createdAt: string
  }[] {
    return this.db
      .all<{ id: string; kind: string; payload_json: string | null; created_at: string }>(
        'SELECT id, kind, payload_json, created_at FROM task_events WHERE task_id = ? AND company_id = ? ORDER BY created_at ASC LIMIT ?',
        [taskId, companyId, limit],
      )
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        payload: row.payload_json ? safeJson(row.payload_json) : null,
        createdAt: row.created_at,
      }))
  }

  /* ------------------------------------------------------------ artifacts */

  addArtifact(input: {
    companyId: string
    taskId?: string | null
    name: string
    kind: ArtifactKind
    content?: string | null
    path?: string | null
    meta?: unknown
  }): ArtifactRecord {
    const id = newId()
    this.db.run(
      `INSERT INTO artifacts (id, company_id, task_id, name, kind, content, path, meta_json, created_at)
       VALUES (@id, @companyId, @taskId, @name, @kind, @content, @path, @meta, @createdAt)`,
      {
        id,
        companyId: input.companyId,
        taskId: input.taskId ?? null,
        name: input.name,
        kind: input.kind,
        content: input.content ?? null,
        path: input.path ?? null,
        meta: input.meta === undefined ? null : JSON.stringify(input.meta),
        createdAt: nowIso(),
      },
    )
    return this.requireArtifact(id, input.companyId)
  }

  findArtifact(id: string, companyId: string): ArtifactRecord | undefined {
    const row = this.db.get<ArtifactRow>('SELECT * FROM artifacts WHERE id = ? AND company_id = ?', [id, companyId])
    return row ? toArtifact(row) : undefined
  }

  requireArtifact(id: string, companyId: string): ArtifactRecord {
    const artifact = this.findArtifact(id, companyId)
    if (!artifact) throw notFound('Không tìm thấy tài sản đầu ra')
    return artifact
  }

  listArtifacts(companyId: string, options: { taskId?: string; limit?: number } = {}): ArtifactRecord[] {
    const params: unknown[] = [companyId]
    let sql = 'SELECT * FROM artifacts WHERE company_id = ?'
    if (options.taskId) {
      sql += ' AND task_id = ?'
      params.push(options.taskId)
    }
    sql += ' ORDER BY created_at DESC LIMIT ?'
    params.push(options.limit ?? 200)
    return this.db.all<ArtifactRow>(sql, params).map(toArtifact)
  }

  /* -------------------------------------------------------- agent messages */

  addAgentMessage(input: {
    companyId: string
    fromAgent: string
    toAgent: string
    taskId?: string | null
    kind: AgentMessageKind
    contentMd: string
  }): AgentMessageRecord {
    const id = newId()
    this.db.run(
      `INSERT INTO agent_messages (id, company_id, from_agent, to_agent, task_id, kind, content_md, created_at)
       VALUES (@id, @companyId, @fromAgent, @toAgent, @taskId, @kind, @contentMd, @createdAt)`,
      {
        id,
        companyId: input.companyId,
        fromAgent: input.fromAgent,
        toAgent: input.toAgent,
        taskId: input.taskId ?? null,
        kind: input.kind,
        contentMd: input.contentMd,
        createdAt: nowIso(),
      },
    )
    return this.requireAgentMessage(id, input.companyId)
  }

  findAgentMessage(id: string, companyId: string): AgentMessageRecord | undefined {
    const row = this.db.get<AgentMessageRow>(
      'SELECT * FROM agent_messages WHERE id = ? AND company_id = ?',
      [id, companyId],
    )
    return row ? toAgentMessage(row) : undefined
  }

  requireAgentMessage(id: string, companyId: string): AgentMessageRecord {
    const message = this.findAgentMessage(id, companyId)
    if (!message) throw notFound('Không tìm thấy trao đổi giữa các agent')
    return message
  }

  listAgentMessages(
    companyId: string,
    options: { taskId?: string; conversationTaskIds?: readonly string[]; limit?: number } = {},
  ): AgentMessageRecord[] {
    if (!options.taskId && options.conversationTaskIds?.length === 0) return []
    const params: unknown[] = [companyId]
    let sql = 'SELECT * FROM agent_messages WHERE company_id = ?'
    if (options.taskId) {
      sql += ' AND task_id = ?'
      params.push(options.taskId)
    } else if (options.conversationTaskIds && options.conversationTaskIds.length > 0) {
      sql += ` AND task_id IN (${options.conversationTaskIds.map(() => '?').join(', ')})`
      params.push(...options.conversationTaskIds)
    }
    sql += ' ORDER BY created_at ASC LIMIT ?'
    params.push(options.limit ?? 200)
    return this.db.all<AgentMessageRow>(sql, params).map(toAgentMessage)
  }

  /** Count request/reply rounds between two agents in one task, to bound peer loops. */
  countPeerRounds(taskId: string, fromAgent: string, toAgent: string): number {
    const row = this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM agent_messages
        WHERE task_id = ? AND from_agent = ? AND to_agent = ? AND kind IN ('request','blocker')`,
      [taskId, fromAgent, toAgent],
    )
    return row?.n ?? 0
  }
}

function safeJson(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
