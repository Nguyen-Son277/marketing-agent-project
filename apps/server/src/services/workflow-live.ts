import type { RuntimeObservation, WorkflowActiveRun } from '@marketing-agent/shared'

interface LiveRun {
  companyId: string
  conversationId: string
  value: WorkflowActiveRun
}

const runtimeTypes = new Set([
  'run.started', 'run.finished', 'model.started', 'model.finished',
  'run.retrying', 'tool.started', 'tool.finished',
])

/** In-process liveness only. No persisted `running` row proves a run is active. */
export class WorkflowLiveRegistry {
  private readonly active = new Map<string, LiveRun>()
  // Bounded tombstones prevent a late observation from reviving a finished run.
  // They contain scope/run identifiers only, never errors, prompts or tool arguments.
  private readonly finished = new Map<string, true>()

  constructor(private readonly recentLimit = 500, private readonly toolLimit = 100) {}

  observe(companyId: string, payload: unknown): void {
    const event = observation(payload)
    if (!event || event.companyId !== companyId || !event.conversationId || !event.runId) return
    const key = JSON.stringify([companyId, event.conversationId, event.runId])
    if (event.type === 'run.finished') {
      this.active.delete(key)
      this.finished.delete(key)
      this.finished.set(key, true)
      while (this.finished.size > Math.max(0, this.recentLimit)) {
        this.finished.delete(this.finished.keys().next().value!)
      }
      return
    }
    if (this.finished.has(key)) return
    if (event.type === 'run.started') {
      if (this.active.has(key)) return
      this.active.set(key, {
        companyId,
        conversationId: event.conversationId,
        value: {
          runId: event.runId,
          taskId: event.taskId,
          agentDefId: event.agentDefId,
          agentRole: event.agentRole,
          modelId: event.modelId ?? null,
          providerId: event.providerId ?? null,
          startedAt: event.at,
          updatedAt: event.at,
          modelRequest: null,
          tools: [],
          retry: null,
        },
      })
      return
    }
    const live = this.active.get(key)
    if (!live) return // Only run.started establishes liveness.
    const run = live.value
    run.updatedAt = event.at
    if (event.modelId !== undefined) run.modelId = event.modelId
    if (event.providerId !== undefined) run.providerId = event.providerId
    switch (event.type) {
      case 'model.started':
        if (Number.isInteger(event.requestIndex) && event.requestIndex! >= 0) {
          run.modelRequest = { requestIndex: event.requestIndex!, startedAt: event.at }
          run.retry = null
        }
        break
      case 'model.finished':
        if (run.modelRequest?.requestIndex === event.requestIndex) run.modelRequest = null
        break
      case 'run.retrying':
        if (event.strategy === 'retry' || event.strategy === 'key_rotation' || event.strategy === 'model_fallback') {
          run.retry = { strategy: event.strategy, at: event.at }
        }
        break
      case 'tool.started':
        if (shortString(event.toolInvocationId) && shortString(event.toolName) &&
          !run.tools.some((tool) => tool.id === event.toolInvocationId) && run.tools.length < this.toolLimit) {
          run.tools = [...run.tools, { id: event.toolInvocationId!, name: event.toolName!, startedAt: event.at }]
        }
        break
      case 'tool.finished':
        run.tools = run.tools.filter((tool) => tool.id !== event.toolInvocationId)
        break
    }
  }

  activity(companyId: string, conversationId: string): WorkflowActiveRun[] {
    const result: WorkflowActiveRun[] = []
    for (const live of this.active.values()) {
      if (live.companyId !== companyId || live.conversationId !== conversationId) continue
      const run = live.value
      // Defensive copies keep SSE consumers from mutating registry truth.
      result.push({
        ...run,
        modelRequest: run.modelRequest ? { ...run.modelRequest } : null,
        tools: run.tools.map((tool) => ({ ...tool })),
        retry: run.retry ? { ...run.retry } : null,
      })
    }
    return result.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId))
  }
}

function shortString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
}

/** Validate only metadata needed by this registry; do not retain the original payload. */
function observation(payload: unknown): RuntimeObservation | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const event = payload as RuntimeObservation
  if (!runtimeTypes.has(event.type) || !shortString(event.companyId) ||
    !shortString(event.conversationId) || !shortString(event.runId) ||
    !shortString(event.agentDefId) || !shortString(event.agentRole) ||
    !shortString(event.at) || !Number.isFinite(Date.parse(event.at)) ||
    (event.taskId !== null && !shortString(event.taskId)) ||
    (event.modelId !== undefined && event.modelId !== null && !shortString(event.modelId)) ||
    (event.providerId !== undefined && event.providerId !== null && !shortString(event.providerId))) return undefined
  return event
}
