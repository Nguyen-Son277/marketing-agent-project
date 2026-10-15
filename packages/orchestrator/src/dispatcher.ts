/**
 * Dispatcher: thi hành kế hoạch theo đồ thị phụ thuộc.
 *
 * Ba quy tắc định hình file này:
 *
 * 1. **Chạy song song theo mức.** Các việc không phụ thuộc nhau được chạy đồng
 *    thời, nhưng có trần (`maxParallelTasks`) để không mở quá nhiều lượt gọi model
 *    cùng lúc — vừa tốn tiền vừa dễ chạm giới hạn của nhà cung cấp.
 * 2. **Việc phụ thuộc chỉ chạy khi việc trước đã xong.** Kết quả của việc trước
 *    được đưa vào ngữ cảnh của việc sau, vì đó chính là lý do có phụ thuộc.
 * 3. **Thất bại không làm chết cả kế hoạch.** Một việc hỏng thì các việc không
 *    phụ thuộc nó vẫn chạy tiếp; chỉ những việc thật sự phụ thuộc mới bị chặn.
 */
import { AppError, type AgentRole } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import type { AgentRuntimeDeps } from '@marketing-agent/agent-runtime'
import type { EmbeddingProvider } from '@marketing-agent/kb'
import type { ToolRegistry } from '@marketing-agent/tools'
import { runAgentForTask, taskStatusForRun } from './agent-runner.ts'
import { event, type AppEvent } from './events.ts'
import type { DispatchSummary, OrchestratorLimits, PlanResult, TaskOutcome } from './types.ts'

export interface DispatchPlanInput {
  readonly repos: Repos
  readonly tools: ToolRegistry
  readonly embedding?: EmbeddingProvider | undefined
  readonly runtimeOverrides?: Partial<AgentRuntimeDeps> | undefined
  readonly companyId: string
  readonly conversationId: string | null
  readonly plan: PlanResult
  readonly limits: OrchestratorLimits
  readonly publish?: ((event: AppEvent) => void) | undefined
  readonly log?: ((message: string, data?: unknown) => void) | undefined
  readonly signal?: AbortSignal | undefined
  /** Được gọi sau mỗi việc kết thúc, để server đẩy sự kiện. */
  readonly onOutcome?: ((outcome: TaskOutcome) => void) | undefined
}

/**
 * Thi hành toàn bộ kế hoạch. Trả về kết quả từng việc theo thứ tự thi hành.
 *
 * Hàm này không ném lỗi vì một việc hỏng: trạng thái hỏng là dữ liệu mà Leader cần
 * để quyết định bước tiếp theo, không phải ngoại lệ làm sập cả phiên.
 */
export async function dispatchPlan(input: DispatchPlanInput): Promise<DispatchSummary> {
  const { repos, companyId, plan } = input
  const byTitle = new Map(plan.tasks.map((task) => [task.title, task]))
  const outcomes = new Map<string, TaskOutcome>()
  const remaining = new Set(plan.tasks.map((task) => task.title))

  // Map tiêu đề kế hoạch → task id thật trong cơ sở dữ liệu.
  const taskIdByTitle = new Map<string, string>()
  const companyTasks = repos.work.listTasks(companyId, {
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    limit: 200,
  })
  for (const task of companyTasks) {
    if (byTitle.has(task.title)) taskIdByTitle.set(task.title, task.id)
  }

  const pending = new Set<string>()
  const ready = (): string[] =>
    [...remaining].filter((title) => {
      const task = byTitle.get(title)
      if (!task) return false
      return task.dependsOn.every((dependency) => outcomes.get(dependency)?.status === 'done')
    })

  const blockedByFailure = (title: string): string | undefined => {
    const task = byTitle.get(title)
    for (const dependency of task?.dependsOn ?? []) {
      const outcome = outcomes.get(dependency)
      if (outcome && outcome.status !== 'done') return dependency
    }
    return undefined
  }

  while (remaining.size > 0) {
    const candidates = ready().filter((title) => !pending.has(title))

    if (candidates.length === 0 && pending.size === 0) {
      // Không còn việc sẵn sàng và không có việc đang chạy: phần còn lại bị chặn
      // bởi một việc đã hỏng. Đánh dấu blocked thay vì treo vô hạn.
      for (const title of [...remaining]) {
        const dependency = blockedByFailure(title)
        const outcome = makeBlockedOutcome({
          repos,
          companyId,
          taskId: taskIdByTitle.get(title) ?? null,
          title,
          role: byTitle.get(title)?.assigneeRole ?? 'marketing-leader',
          reason: dependency
            ? `Việc phụ thuộc "${dependency}" không hoàn thành nên việc này không thể chạy.`
            : 'Không thể chạy vì thiếu việc phụ thuộc.',
        })
        outcomes.set(title, outcome)
        remaining.delete(title)
        input.onOutcome?.(outcome)
        publishOutcome(input, outcome)
      }
      break
    }

    const batch = candidates.slice(0, Math.max(1, input.limits.maxParallelTasks))
    for (const title of batch) pending.add(title)

    const results = await Promise.all(
      batch.map(async (title) => {
        const task = byTitle.get(title)
        if (!task) throw new AppError('internal', `Không tìm thấy việc "${title}" trong kế hoạch`)
        const outcome = await executeTask({
          ...input,
          taskId: taskIdByTitle.get(title) ?? null,
          title,
          assigneeRole: task.assigneeRole,
          dependencyOutcomes: task.dependsOn
            .map((dependency) => outcomes.get(dependency))
            .filter((outcome): outcome is TaskOutcome => outcome !== undefined),
        })
        input.onOutcome?.(outcome)
        publishOutcome(input, outcome)
        return outcome
      }),
    )

    for (const [index, title] of batch.entries()) {
      pending.delete(title)
      remaining.delete(title)
      const outcome = results[index]
      if (!outcome) continue
      outcomes.set(title, outcome)
    }
  }

  const all = plan.order
    .map((title) => outcomes.get(title))
    .filter((outcome): outcome is TaskOutcome => outcome !== undefined)

  return {
    outcomes: all,
    completed: all.filter((outcome) => outcome.status === 'done').length,
    blocked: all.filter((outcome) => outcome.status === 'blocked').length,
    failed: all.filter((outcome) => outcome.status === 'failed' || outcome.status === 'cancelled').length,
  }
}

interface ExecuteTaskInput extends DispatchPlanInput {
  readonly taskId: string | null
  readonly title: string
  readonly assigneeRole: string
  readonly dependencyOutcomes: readonly TaskOutcome[]
}

async function executeTask(input: ExecuteTaskInput): Promise<TaskOutcome> {
  const { repos, companyId, taskId } = input
  const startedAt = Date.now()

  const extraContext = composeDependencyContext(input.dependencyOutcomes)

  try {
    if (taskId) {
      repos.work.setTaskStatus(taskId, companyId, 'in_progress')
      repos.work.addTaskEvent(taskId, companyId, 'started', { role: input.assigneeRole })
      publishScoped(input, event('task.updated', companyId, {
        conversationId: input.conversationId, taskId, title: input.title,
        assigneeRole: input.assigneeRole, status: 'in_progress',
      }))
    }
    publishScoped(input, event('agent.started', companyId, {
      conversationId: input.conversationId, taskId, title: input.title,
      assigneeRole: input.assigneeRole,
    }))

    const result = await runAgentForTask({
      repos,
      tools: input.tools,
      embedding: input.embedding,
      runtimeOverrides: input.runtimeOverrides,
      publish: input.publish,
      companyId,
      role: input.assigneeRole as AgentRole,
      taskId,
      conversationId: input.conversationId,
      taskBrief: buildTaskBrief(repos, companyId, taskId, input.title),
      extraContext,
      maxSteps: input.limits.maxStepsPerRun,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.log ? { log: input.log } : {}),
    })

    const storedTask = taskId ? repos.work.findTask(taskId, companyId) : undefined
    const status = taskStatusForRun(result.run, storedTask?.status)
    const explicitBlocker = storedTask?.status === 'blocked' || storedTask?.status === 'cancelled'

    const artifactIds = taskId
      ? repos.work.listArtifacts(companyId, { taskId, limit: 50 }).map((artifact) => artifact.id)
      : []

    const outcome: TaskOutcome = {
      taskId: taskId ?? '',
      title: input.title,
      assigneeRole: input.assigneeRole,
      status,
      resultMd: explicitBlocker && storedTask?.resultMd ? storedTask.resultMd : result.run.output.trim().length > 0 ? result.run.output : result.summary,
      artifactIds,
      run: result.run,
      reason: status === 'done' ? undefined : (explicitBlocker && storedTask?.resultMd ? storedTask.resultMd : result.run.error ?? result.summary),
    }

    if (taskId) {
      repos.work.updateTask(taskId, companyId, {
        status,
        resultMd: outcome.resultMd,
      })
      repos.work.addTaskEvent(taskId, companyId, 'finished', {
        status,
        steps: result.run.steps,
        stopReason: result.run.stopReason,
        latencyMs: Date.now() - startedAt,
      })
      // Bàn giao cho Leader: đây là kênh để Leader biết việc đã xong và có gì.
      repos.work.addAgentMessage({
        companyId,
        fromAgent: input.assigneeRole,
        toAgent: 'marketing-leader',
        taskId,
        kind: status === 'done' ? 'handoff' : 'blocker',
        contentMd: buildHandoffMessage(outcome),
      })
    }

    if (artifactIds.length > 0) {
      publishScoped(input,
        event('artifact.created', companyId, { conversationId: input.conversationId, taskId, artifactIds, agentRole: input.assigneeRole }),
      )
    }

    return outcome
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    input.log?.(`Việc "${input.title}" thất bại`, { error: message })
    const storedTask = taskId ? repos.work.findTask(taskId, companyId) : undefined
    const status = storedTask?.status === 'cancelled' ? 'cancelled' : storedTask?.status === 'blocked' ? 'blocked' : 'failed'
    const resultMd = (status === 'cancelled' || status === 'blocked') && storedTask?.resultMd ? storedTask.resultMd : `Lỗi: ${message}`
    if (taskId && storedTask) {
      repos.work.updateTask(taskId, companyId, { status, resultMd })
      repos.work.addTaskEvent(taskId, companyId, 'error', { message })
      repos.work.addAgentMessage({
        companyId,
        fromAgent: input.assigneeRole,
        toAgent: 'marketing-leader',
        taskId,
        kind: 'blocker',
        contentMd: `Việc "${input.title}" không chạy được.\n\nLỗi: ${message}`,
      })
    }
    return {
      taskId: taskId ?? '',
      title: input.title,
      assigneeRole: input.assigneeRole,
      status,
      resultMd,
      artifactIds: [],
      run: null,
      reason: message,
    }
  }
}

/** Brief của việc được đọc lại từ cơ sở dữ liệu để luôn là bản mới nhất. */
function buildTaskBrief(repos: Repos, companyId: string, taskId: string | null, fallbackTitle: string): string {
  if (!taskId) return fallbackTitle
  const task = repos.work.findTask(taskId, companyId)
  if (!task) return fallbackTitle
  const parts = [`### ${task.title}`, '', task.briefMd]
  if (task.deliverableSpec) parts.push('', `**Đầu ra yêu cầu:** ${task.deliverableSpec}`)
  if (task.deadline) parts.push('', `**Hạn:** ${task.deadline}`)
  return parts.join('\n')
}

/** Kết quả các việc phụ thuộc, đưa vào ngữ cảnh việc sau. */
export function composeDependencyContext(outcomes: readonly TaskOutcome[]): string | undefined {
  const usable = outcomes.filter((outcome) => outcome.resultMd.trim().length > 0)
  if (usable.length === 0) return undefined
  return usable
    .map(
      (outcome) =>
        `### Kết quả việc trước: ${outcome.title} (${outcome.assigneeRole})\n${truncateForContext(outcome.resultMd)}`,
    )
    .join('\n\n')
}

/** Giữ ngữ cảnh phụ thuộc ở mức đọc được, tránh nuốt hết cửa sổ context. */
function truncateForContext(text: string, maxChars = 4_000): string {
  const trimmed = text.trim()
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}\n…(đã lược bớt)`
}

function makeBlockedOutcome(input: {
  repos: Repos
  companyId: string
  taskId: string | null
  title: string
  role: string
  reason: string
}): TaskOutcome {
  if (input.taskId) {
    input.repos.work.updateTask(input.taskId, input.companyId, {
      status: 'blocked',
      resultMd: input.reason,
    })
    input.repos.work.addTaskEvent(input.taskId, input.companyId, 'blocked', { reason: input.reason })
  }
  return {
    taskId: input.taskId ?? '',
    title: input.title,
    assigneeRole: input.role,
    status: 'blocked',
    resultMd: input.reason,
    artifactIds: [],
    run: null,
    reason: input.reason,
  }
}

function buildHandoffMessage(outcome: TaskOutcome): string {
  const lines = [
    `Bàn giao việc "${outcome.title}" — trạng thái: ${outcome.status}`,
    '',
    truncateForContext(outcome.resultMd, 3_000),
  ]
  if (outcome.artifactIds.length > 0) {
    lines.push('', `Tài sản đã tạo: ${outcome.artifactIds.join(', ')}`)
  }
  if (outcome.run) {
    lines.push(
      '',
      `Chi phí: ${outcome.run.usage.costUsd.toFixed(4)} USD · ` +
        `${outcome.run.usage.tokensIn + outcome.run.usage.tokensOut} token · ${outcome.run.steps} bước`,
    )
  }
  return lines.join('\n')
}

function publishOutcome(input: DispatchPlanInput, outcome: TaskOutcome): void {
  publishScoped(input,
    event('task.updated', input.companyId, {
      conversationId: input.conversationId,
      taskId: outcome.taskId,
      title: outcome.title,
      assigneeRole: outcome.assigneeRole,
      status: outcome.status,
      reason: outcome.reason ?? null,
    }),
  )
}

/** No null-scoped workflow events on a company-wide stream. */
function publishScoped(input: DispatchPlanInput, appEvent: AppEvent): void {
  if (!input.conversationId) return
  try {
    const published: unknown = input.publish?.(appEvent)
    if (published instanceof Promise) void published.catch(() => undefined)
  } catch { /* telemetry is best-effort */ }
}
