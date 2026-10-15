import { conflict, TASK_STATUSES, type WorkflowSnapshotResponse } from '@marketing-agent/shared'
import type { AppContext } from '../context.ts'

/** Read-only reconciliation: this must never initialize an execution service. */
export function workflowSnapshot(
  ctx: AppContext,
  companyId: string,
  conversationId: string,
): WorkflowSnapshotResponse {
  const conversation = ctx.repos.work.requireConversation(conversationId, companyId)
  const data = ctx.repos.work.workflowData(companyId, conversationId)
  if (data.tasks.length > 500) throw conflict('Workflow vượt giới hạn 500 công việc; không thể trả đồ thị đầy đủ.')
  const activeRuns = ctx.events.workflowActivity(companyId, conversationId)
  const activeIds = new Set(activeRuns.map((run) => run.runId))
  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<(typeof TASK_STATUSES)[number], number>
  const tasks = data.tasks.map((task) => {
    counts[task.status]++
    // Explicit safe fields: never serialize task brief/result or other content.
    return {
      id: task.id,
      conversationId: task.conversationId,
      parentTaskId: task.parentTaskId,
      agentDefId: task.agentDefId,
      assigneeRole: task.assigneeRole,
      assigneeName: task.assigneeName,
      title: task.title,
      status: task.status,
      priority: task.priority,
      revisionCount: task.revisionCount,
      deadline: task.deadline,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      artifactCount: task.artifactCount,
    }
  })
  const runs = data.runs.map((run) => ({
    id: run.id,
    taskId: run.taskId,
    conversationId: run.conversationId,
    agentDefId: run.agentDefId,
    agentRole: run.agentRole,
    agentName: run.agentName,
    modelId: run.modelId,
    modelLabel: run.modelLabel,
    providerId: run.providerId,
    status: run.status,
    tokensIn: run.tokensIn,
    tokensOut: run.tokensOut,
    costUsd: run.costUsd,
    latencyMs: run.latencyMs,
    steps: run.steps,
    createdAt: run.createdAt,
    activity: (run.status !== 'running' ? 'terminal' : activeIds.has(run.id) ? 'active' : 'unverified') as 'active' | 'unverified' | 'terminal',
  }))
  const usage = ctx.repos.accounting.summaryForConversation(companyId, conversationId)
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    conversation: { id: conversation.id, title: conversation.title, phase: conversation.phase, updatedAt: conversation.updatedAt },
    tasks,
    dependencies: data.dependencies.map((dependency) => ({
      id: dependency.id, sourceTaskId: dependency.sourceTaskId, targetTaskId: dependency.targetTaskId,
    })),
    runs,
    // Runs without a DB summary remain visible here, without inventing accounting values.
    activeRuns,
    counts,
    usage: { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd, runs: usage.runs },
    historyTruncated: data.historyTruncated,
    graphEligible: tasks.length <= 100,
  }
}
