/**
 * Chuyển bản ghi trong cơ sở dữ liệu thành hình dạng API đã chốt trong
 * `packages/shared/src/api.ts`.
 *
 * Vì sao tách khỏi tầng route: cùng một thực thể (công việc, cuộc trao đổi, tài
 * sản) xuất hiện ở nhiều endpoint — danh sách, chi tiết, dashboard, báo cáo. Nếu
 * mỗi route tự ghép, chỉ cần một trường đổi tên là giao diện vỡ ở vài màn hình mà
 * không ai biết vì sao. Ghép một chỗ thì hợp đồng chỉ có một nguồn.
 */
import type { Repos } from '@marketing-agent/db'
import type {
  AgentDefRecord,
  ArtifactRecord,
  ArtifactView,
  ConversationRecord,
  ConversationView,
  IntegrationRecord,
  IntegrationView,
  KbDocumentRecord,
  KnowledgeDocumentView,
  LlmModelRecord,
  LlmProviderKeyRecord,
  LlmProviderRecord,
  MessageRecord,
  MessageView,
  ModelOptionView,
  ModelRouteRecord,
  ModelRouteView,
  ProviderKeyView,
  ProviderView,
  RunRecord,
  RunView,
  TaskRecord,
  TaskStatus,
  TaskView,
  TeamMemberView,
} from '@marketing-agent/shared'
import { TASK_STATUSES } from '@marketing-agent/shared'

/** Sáu trường brief, khớp `Brief` của orchestrator; dùng để suy ra trạng thái brief. */
const BRIEF_FIELDS = ['objective', 'kpi', 'scope', 'deadline', 'budget', 'constraints'] as const

export function parseJsonOrNull(json: string | null | undefined): unknown {
  if (!json) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

function parseStringArray(json: string | null | undefined): string[] {
  const value = parseJsonOrNull(json)
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/**
 * Trạng thái brief suy từ `brief_json` đã lưu. Quy tắc "trường dài dưới 3 ký tự
 * coi như chưa điền" được lặp lại có chủ đích: tầng route không import giá trị
 * runtime từ orchestrator để tránh phụ thuộc vòng khi nạp module.
 */
export function briefState(briefJson: string | null | undefined): {
  briefComplete: boolean
  missingFields: string[]
} {
  const parsed = parseJsonOrNull(briefJson)
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  const missingFields = BRIEF_FIELDS.filter((field) => {
    const value = record[field]
    return typeof value !== 'string' || value.trim().length < 3
  })
  return { briefComplete: missingFields.length === 0, missingFields: [...missingFields] }
}

/* --------------------------------------------------------------------- team */

export function toModelOptionView(
  model: LlmModelRecord,
  options: { providerName?: string; usedByAgentCount?: number } = {},
): ModelOptionView {
  return {
    id: model.id,
    modelId: model.modelId,
    label: model.label,
    providerId: model.providerId,
    providerName: options.providerName ?? '',
    enabled: model.enabled,
    contextWindow: model.contextWindow,
    supportsTools: model.supportsTools,
    costInPerMtok: model.costInPerMtok,
    costOutPerMtok: model.costOutPerMtok,
    usedByAgentCount: options.usedByAgentCount ?? 0,
  }
}

export function toTeamMemberView(input: {
  repos: Repos
  companyId: string
  def: AgentDefRecord
  preset: { id: string; displayName: string | null; enabled: boolean; tier: TeamMemberView['tier']; reasoningEffort: string | null; maxTokens: number | null; contextBudgetTokens: number; requireApproval: boolean; modelFk: string | null }
}): TeamMemberView {
  const { repos, companyId, def, preset } = input
  const model = resolvePresetModel(repos, companyId, def, preset)
  const provider = model ? repos.llm.findProvider(model.providerId) : undefined
  return {
    agentDefId: def.id,
    role: def.role,
    name: def.name,
    displayName: preset.displayName ?? def.name,
    description: def.description,
    enabled: preset.enabled,
    isLeader: def.isLeader,
    tier: preset.tier,
    modelFk: preset.modelFk,
    modelId: model?.id ?? null,
    modelLabel: model?.label ?? null,
    providerName: provider?.name ?? null,
    fallbackModelFks: repos.llm.listModelFallbacks(companyId, def.id).map((fallback) => fallback.modelFk),
    reasoningEffort: preset.reasoningEffort,
    maxTokens: preset.maxTokens,
    contextBudgetTokens: preset.contextBudgetTokens,
    requireApproval: preset.requireApproval,
    skills: repos.team.listSkillsForPreset(preset.id).map((skill) => ({
      name: skill.name,
      description: skill.description,
      category: skill.category,
    })),
    tools: repos.team.listPresetTools(preset.id).map((tool) => tool.toolName),
    knowledge: repos.team.listKnowledgeAcl(companyId, def.id).map((acl) => ({
      category: acl.category,
      canRead: acl.canRead,
      canWrite: acl.canWrite,
    })),
  }
}

/**
 * Model hiệu lực của một preset: model gán trực tiếp, rồi route theo tier. Không có
 * bước "model rẻ nhất" — hệ thống không tự gắn model cho agent; chưa chọn thì trả
 * `undefined` và giao diện hiển thị đúng trạng thái đó.
 */
export function resolvePresetModel(
  repos: Repos,
  companyId: string,
  def: AgentDefRecord,
  preset: { modelFk: string | null; tier: TeamMemberView['tier'] },
): LlmModelRecord | undefined {
  if (preset.modelFk) {
    const direct = repos.llm.findModel(preset.modelFk)
    if (direct && direct.enabled) return direct
  }
  const route = repos.llm
    .listRoutes(companyId)
    .filter((candidate) => candidate.agentDefId === def.id && candidate.tier === preset.tier)
    .sort((a, b) => a.priority - b.priority)[0]
  if (route) {
    const routed = repos.llm.findModel(route.modelFk)
    if (routed && routed.enabled) return routed
  }
  return undefined
}

/* ---------------------------------------------------------------- knowledge */

export function toKnowledgeDocumentView(doc: KbDocumentRecord, indexed: boolean, content: string): KnowledgeDocumentView {
  return {
    id: doc.id,
    path: doc.path,
    title: doc.title,
    category: doc.category,
    tags: parseStringArray(doc.tagsJson),
    version: doc.version,
    source: doc.source,
    updatedAt: doc.updatedAt,
    indexed,
    content,
  }
}

/** Một tài liệu được coi là đã nhúng khi có ít nhất một vector cho chunk của nó. */
export function documentHasEmbedding(repos: Repos, documentId: string): boolean {
  const row = repos.db.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM kb_embeddings e
       JOIN kb_chunks c ON c.id = e.chunk_id
      WHERE c.document_id = ?`,
    [documentId],
  )
  return (row?.n ?? 0) > 0
}

/** Nội dung Markdown của tài liệu được ghép lại từ các chunk đã lưu. */
export function documentContent(repos: Repos, documentId: string): string {
  return repos.knowledge
    .listChunks(documentId)
    .map((chunk) => chunk.text)
    .join('\n\n')
}

/**
 * Nội dung của mọi tài liệu trong một công ty, gom bằng MỘT truy vấn.
 * `kb_documents` không lưu bản gốc Markdown — chunk mới là nơi giữ văn bản — nên
 * đây là cách duy nhất để trả `content` cho danh sách mà không N+1 truy vấn.
 */
export function documentContentMap(repos: Repos, companyId: string): Map<string, string> {
  const rows = repos.db.all<{ document_id: string; text: string }>(
    'SELECT document_id, text FROM kb_chunks WHERE company_id = ? ORDER BY document_id ASC, ordinal ASC',
    [companyId],
  )
  const byDocument = new Map<string, string[]>()
  for (const row of rows) {
    const bucket = byDocument.get(row.document_id) ?? []
    bucket.push(row.text)
    byDocument.set(row.document_id, bucket)
  }
  const out = new Map<string, string>()
  for (const [documentId, parts] of byDocument) out.set(documentId, parts.join('\n\n'))
  return out
}

/** Tập id tài liệu đã có vector, để đánh dấu `indexed` cho cả danh sách. */
export function embeddedDocumentIds(repos: Repos, companyId: string): Set<string> {
  const rows = repos.db.all<{ document_id: string }>(
    `SELECT DISTINCT c.document_id AS document_id
       FROM kb_embeddings e
       JOIN kb_chunks c ON c.id = e.chunk_id
      WHERE e.company_id = ?`,
    [companyId],
  )
  return new Set(rows.map((row) => row.document_id))
}

/* ----------------------------------------------------------- conversation */

export function toConversationView(conversation: ConversationRecord, costUsd: number): ConversationView {
  const state = briefState(conversation.briefJson)
  return {
    id: conversation.id,
    title: conversation.title,
    language: conversation.language,
    phase: conversation.phase,
    briefComplete: state.briefComplete,
    missingFields: state.missingFields,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    costUsd,
  }
}

export function toMessageView(message: MessageRecord): MessageView {
  return {
    id: message.id,
    role: message.role,
    authorKind: message.authorKind,
    authorAgent: message.authorAgent,
    contentMd: message.contentMd,
    meta: parseJsonOrNull(message.metaJson),
    tokensIn: message.tokensIn,
    tokensOut: message.tokensOut,
    costUsd: message.costUsd,
    createdAt: message.createdAt,
  }
}

export function conversationCost(repos: Repos, companyId: string, conversationId: string): number {
  return repos.accounting.summaryForConversation(companyId, conversationId).costUsd
}

/* -------------------------------------------------------------------- tasks */

export function buildTaskViews(repos: Repos, companyId: string, tasks: readonly TaskRecord[]): TaskView[] {
  const ids = tasks.map((task) => task.id)
  const dependencies = repos.work.listDependencies(companyId, ids)
  const titleById = new Map(tasks.map((task) => [task.id, task.title]))
  const defs = new Map(repos.team.listAgentDefs().map((def) => [def.id, def]))
  const artifactsByTask = new Map<string, string[]>()
  for (const artifact of repos.work.listArtifacts(companyId, { limit: 500 })) {
    if (!artifact.taskId) continue
    const bucket = artifactsByTask.get(artifact.taskId) ?? []
    bucket.push(artifact.id)
    artifactsByTask.set(artifact.taskId, bucket)
  }

  return tasks.map((task) => {
    const def = task.assigneeAgentDefId ? defs.get(task.assigneeAgentDefId) : undefined
    const preset = def ? repos.team.findPreset(companyId, def.id) : undefined
    return {
      id: task.id,
      title: task.title,
      briefMd: task.briefMd,
      status: task.status,
      priority: task.priority,
      assigneeRole: def?.role ?? null,
      assigneeName: preset?.displayName ?? def?.name ?? null,
      dependsOn: dependencies
        .filter((dep) => dep.taskId === task.id)
        .map((dep) => titleById.get(dep.dependsOnTaskId) ?? '')
        .filter((title) => title.length > 0),
      blocks: dependencies
        .filter((dep) => dep.dependsOnTaskId === task.id)
        .map((dep) => titleById.get(dep.taskId) ?? '')
        .filter((title) => title.length > 0),
      resultMd: task.resultMd,
      deliverableSpec: task.deliverableSpec,
      revisionCount: task.revisionCount,
      deadline: task.deadline,
      artifactIds: artifactsByTask.get(task.id) ?? [],
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }
  })
}

export function buildTaskView(repos: Repos, companyId: string, task: TaskRecord): TaskView {
  const view = buildTaskViews(repos, companyId, [task])[0]
  if (!view) throw new Error('Không dựng được biểu diễn công việc')
  return view
}

/** Đếm công việc theo trạng thái, luôn trả đủ mọi trạng thái (kể cả 0). */
export function taskCounts(tasks: readonly TaskRecord[]): Record<TaskStatus, number> {
  const counts = {} as Record<TaskStatus, number>
  for (const status of TASK_STATUSES) counts[status] = 0
  for (const task of tasks) counts[task.status] += 1
  return counts
}

export function toArtifactView(artifact: ArtifactRecord): ArtifactView {
  return {
    id: artifact.id,
    taskId: artifact.taskId,
    name: artifact.name,
    kind: artifact.kind,
    content: artifact.content,
    path: artifact.path,
    meta: parseJsonOrNull(artifact.metaJson),
    createdAt: artifact.createdAt,
  }
}

export function toRunView(run: RunRecord): RunView {
  return {
    id: run.id,
    taskId: run.taskId,
    agentDefId: run.agentDefId,
    modelId: run.modelId,
    status: run.status,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd,
    latencyMs: run.latencyMs,
    error: run.error,
    steps: run.steps,
    createdAt: run.createdAt,
  }
}

/* ----------------------------------------------------------------- settings */

export function toProviderView(
  provider: LlmProviderRecord,
  keys: readonly LlmProviderKeyRecord[],
  models: readonly LlmModelRecord[],
  providerNameById: ReadonlyMap<string, string>,
  modelUsage: ReadonlyMap<string, number>,
): ProviderView {
  const keyViews: ProviderKeyView[] = keys.map((key) => ({
    id: key.id,
    label: key.label,
    hint: key.hint,
    priority: key.priority,
    enabled: key.enabled,
  }))
  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    isGlobal: provider.companyId === null,
    apiKeyConfigured: keyViews.length > 0,
    apiKeyHint: keyViews[0]?.hint ?? null,
    keys: keyViews,
    models: models.map((model) => ({
      ...toModelOptionView(model, {
        providerName: providerNameById.get(model.providerId) ?? '',
        usedByAgentCount: modelUsage.get(model.id) ?? 0,
      }),
    })),
  }
}

export function toIntegrationView(record: IntegrationRecord): IntegrationView {
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    status: record.status,
    configured: Boolean(record.configEnc),
    lastCheckAt: record.lastCheckAt,
  }
}

/** Route model hiển thị kèm vai trò và nhãn model để màn Cài đặt đọc lại được. */
export function toModelRouteView(
  route: ModelRouteRecord,
  def: AgentDefRecord | undefined,
  modelLabel: string | null,
): ModelRouteView | undefined {
  if (!def) return undefined
  return {
    id: route.id,
    agentDefId: route.agentDefId,
    role: def.role,
    tier: route.tier,
    modelFk: route.modelFk,
    modelLabel: modelLabel ?? '',
    reasoningEffort: route.reasoningEffort,
    maxTokens: route.maxTokens,
    priority: route.priority,
  }
}

