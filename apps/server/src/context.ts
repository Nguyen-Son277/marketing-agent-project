/**
 * The object graph every HTTP handler receives.
 *
 * Built once at boot and shared: one SQLite connection, one set of repositories,
 * one embedding provider, one raw tool registry. Handlers stay thin and
 * resolve anything else per request (provider keys, ACLs) through these.
 */
import type { Repos } from '@marketing-agent/db'
import type { WorkflowActiveRun } from '@marketing-agent/shared'
import type { ServerConfig } from './config.ts'
import { WorkflowLiveRegistry } from './services/workflow-live.ts'

/** A registered raw tool plus the roles allowed to call it by default. */
export interface ToolCatalogEntry {
  readonly name: string
  readonly description: string
}

export interface AppContext {
  readonly config: ServerConfig
  readonly repos: Repos
  /** In-process event fan-out for SSE clients, keyed by company. */
  readonly events: EventBus
  /** Names of tools available in this deployment. */
  listToolNames(): readonly string[]
}

/* ------------------------------------------------------------------- events */

export interface AppEvent {
  readonly type: string
  readonly companyId: string
  readonly payload: unknown
  readonly at: string
}

type Listener = (event: AppEvent) => void

/**
 * A minimal per-company publisher for SSE.
 *
 * Only live server-sent notifications use this: durable truth always lives in
 * SQLite, so a dropped client simply refetches. That keeps the bus free of
 * replay and back-pressure concerns.
 */
export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly workflow = new WorkflowLiveRegistry()
  /** Best-effort bounded hints only; snapshot reconciliation, not durable replay. */
  private readonly recent = new Map<string, AppEvent[]>()
  private readonly recentLimit: number

  constructor(recentLimit = 50) {
    this.recentLimit = recentLimit
  }

  subscribe(companyId: string, listener: Listener): () => void {
    let set = this.listeners.get(companyId)
    if (!set) {
      set = new Set()
      this.listeners.set(companyId, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(companyId)
    }
  }

  publish(event: AppEvent): void {
    try {
      this.workflow.observe(event.companyId, event.payload)
    } catch {
      // Observability must not break execution or notification delivery.
    }
    let buffer = this.recent.get(event.companyId)
    if (!buffer) {
      buffer = []
      this.recent.set(event.companyId, buffer)
    }
    buffer.push(event)
    if (buffer.length > this.recentLimit) buffer.splice(0, buffer.length - this.recentLimit)

    const set = this.listeners.get(event.companyId)
    if (!set) return
    for (const listener of set) {
      try {
        listener(event)
      } catch {
        // A failing listener must never break the publisher or other listeners.
      }
    }
  }

  /** Exact-scope in-memory activity; persisted running rows are not consulted. */
  workflowActivity(companyId: string, conversationId: string): WorkflowActiveRun[] {
    return this.workflow.activity(companyId, conversationId)
  }

  /** Best-effort events after an instant. No lossless Last-Event-ID guarantee. */
  since(companyId: string, sinceIso: string | undefined): AppEvent[] {
    const buffer = this.recent.get(companyId) ?? []
    if (!sinceIso) return []
    return buffer.filter((event) => event.at > sinceIso)
  }

  /** Live subscriber count, surfaced in health output. */
  subscriberCount(companyId?: string): number {
    if (companyId) return this.listeners.get(companyId)?.size ?? 0
    let total = 0
    for (const set of this.listeners.values()) total += set.size
    return total
  }
}
