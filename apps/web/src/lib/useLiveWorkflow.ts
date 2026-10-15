import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationView, RuntimeObservation, WorkflowSnapshotResponse } from '@marketing-agent/shared'
import { api, ApiError, openConversationStream } from './api.ts'
import type { StreamEvent } from './api.ts'
import { staleWorkflowSnapshot } from './workflow-freshness.ts'
import { createRefreshCoordinator } from './workflow-refresh.ts'
import type { RefreshCoordinator } from './workflow-refresh.ts'

type Connection = 'connecting' | 'live' | 'reconnecting' | 'disconnected'
export interface LiveWorkflow {
  conversations: readonly ConversationView[]
  conversationId: string | null
  selectConversation: (id: string) => void
  snapshot: WorkflowSnapshotResponse | null
  loading: boolean
  listLoading: boolean
  error: ApiError | Error | null
  listError: ApiError | Error | null
  connection: Connection
  lastUpdated: string | null
  events: readonly StreamEvent[]
  refresh: () => void
  refreshList: () => void
}
const runtimeTypes = new Set(['run.started', 'run.finished', 'model.started', 'model.finished', 'run.retrying', 'tool.started', 'tool.finished'])
const terminalError = (error: unknown) => error instanceof ApiError && [401, 403, 404].includes(error.status)
const asError = (error: unknown): Error => error instanceof Error ? error : new Error('Workflow request failed')
const hidden = () => typeof document !== 'undefined' && document.hidden

/** Validate and project metadata, never retain arbitrary event content in workflow state. */
function observation(event: StreamEvent, companyId: string, conversationId: string): RuntimeObservation | null {
  if (!runtimeTypes.has(event.type) || event.data === null || typeof event.data !== 'object') return null
  const data = event.data as Record<string, unknown>
  if (data.type !== event.type || data.companyId !== companyId || data.conversationId !== conversationId ||
    (event.companyId !== undefined && event.companyId !== companyId) ||
    typeof data.at !== 'string' || !Number.isFinite(Date.parse(data.at)) ||
    typeof data.agentDefId !== 'string' || typeof data.agentRole !== 'string' ||
    !(data.taskId === null || typeof data.taskId === 'string') ||
    !(data.runId === null || typeof data.runId === 'string')) return null
  const safe: Record<string, unknown> = {
    type: data.type, at: data.at, companyId, conversationId,
    taskId: data.taskId, runId: data.runId, agentDefId: data.agentDefId, agentRole: data.agentRole,
  }
  for (const key of ['modelId', 'providerId', 'errorCode']) {
    if (data[key] !== undefined) {
      if (data[key] !== null && typeof data[key] !== 'string') return null
      safe[key] = data[key]
    }
  }
  for (const key of ['toolInvocationId', 'toolName', 'stopReason']) {
    if (data[key] !== undefined) {
      if (typeof data[key] !== 'string') return null
      safe[key] = data[key]
    }
  }
  for (const key of ['requestIndex', 'attemptIndex', 'durationMs', 'httpStatus', 'requestCount', 'toolCount']) {
    if (data[key] !== undefined) {
      if (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0) return null
      safe[key] = data[key]
    }
  }
  const enums: Record<string, readonly string[]> = {
    outcome: ['succeeded', 'failed', 'cancelled', 'timed_out', 'denied', 'invalid_arguments'],
    status: ['running', 'succeeded', 'failed', 'cancelled', 'budget_exceeded'],
    strategy: ['retry', 'key_rotation', 'model_fallback'], accountingStatus: ['recorded', 'failed'],
  }
  for (const [key, values] of Object.entries(enums)) {
    if (data[key] !== undefined) {
      if (typeof data[key] !== 'string' || !values.includes(data[key])) return null
      safe[key] = data[key]
    }
  }
  if (data.usage !== undefined) {
    if (data.usage === null || typeof data.usage !== 'object') return null
    const usage = data.usage as Record<string, unknown>
    const projected: Record<string, number> = {}
    for (const key of ['tokensIn', 'tokensOut', 'cachedTokens', 'costUsd']) {
      if (typeof usage[key] !== 'number' || !Number.isFinite(usage[key]) || usage[key] < 0) return null
      projected[key] = usage[key]
    }
    safe.usage = projected
  }
  return safe as unknown as RuntimeObservation
}

interface ListState {
  companyId: string
  conversations: readonly ConversationView[]
  selected: string | null
  loading: boolean
  error: Error | null
  blocked: boolean
}
interface DetailState {
  companyId: string
  conversationId: string | null
  snapshot: WorkflowSnapshotResponse | null
  loading: boolean
  error: Error | null
  connection: Connection
  events: readonly StreamEvent[]
}
const emptyDetail = (companyId: string, conversationId: string | null): DetailState => ({
  companyId, conversationId, snapshot: null, loading: conversationId !== null,
  error: null, connection: conversationId ? 'connecting' : 'disconnected', events: [],
})

export function useLiveWorkflow(companyId: string): LiveWorkflow {
  const [list, setList] = useState<ListState>(() => ({ companyId, conversations: [], selected: null, loading: true, error: null, blocked: false }))
  const [detail, setDetail] = useState<DetailState>(() => emptyDetail(companyId, null))
  const listCoordinator = useRef<RefreshCoordinator | null>(null)
  const detailCoordinator = useRef<RefreshCoordinator | null>(null)
  const listGeneration = useRef(0)
  const detailGeneration = useRef(0)
  const conversationId = list.companyId === companyId ? list.selected : null

  useEffect(() => {
    const generation = ++listGeneration.current
    let disposed = false
    setList({ companyId, conversations: [], selected: null, loading: true, error: null, blocked: false })
    setDetail(emptyDetail(companyId, null))
    const coordinator = createRefreshCoordinator({ run: async (signal) => {
      const current = () => !disposed && !signal.aborted && listGeneration.current === generation
      try {
        const result = await api.conversations(companyId, signal)
        if (!current()) return
        const conversations = [...result.conversations].sort((a, b) =>
          (Date.parse(b.updatedAt) || Date.parse(b.createdAt) || 0) - (Date.parse(a.updatedAt) || Date.parse(a.createdAt) || 0))
        setList(previous => ({ companyId, conversations,
          selected: previous.companyId === companyId && conversations.some(item => item.id === previous.selected)
            ? previous.selected : conversations[0]?.id ?? null,
          loading: false, error: null, blocked: false,
        }))
      } catch (error) {
        if (!current()) return
        const blocked = terminalError(error)
        setList(previous => ({ ...previous, loading: false, error: asError(error), blocked }))
        if (blocked) coordinator.dispose()
      }
    } })
    listCoordinator.current = coordinator
    coordinator.setPaused(hidden())
    coordinator.request(true)
    const visibility = () => coordinator.setPaused(hidden())
    document.addEventListener('visibilitychange', visibility)
    return () => {
      disposed = true
      ++listGeneration.current
      coordinator.dispose()
      if (listCoordinator.current === coordinator) listCoordinator.current = null
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [companyId])

  useEffect(() => {
    const generation = ++detailGeneration.current
    setDetail(list.blocked
      ? { ...emptyDetail(companyId, conversationId), loading: false, connection: 'disconnected' }
      : emptyDetail(companyId, conversationId))
    if (!conversationId || list.blocked) return
    let disposed = false
    let stopped = false
    let streamConnected = false
    let closeStream: (() => void) | undefined
    let poll: ReturnType<typeof setTimeout> | undefined
    let latest: WorkflowSnapshotResponse | null = null
    const current = (signal?: AbortSignal) => !disposed && !stopped && !signal?.aborted && detailGeneration.current === generation
    const clearPoll = () => { if (poll !== undefined) clearTimeout(poll); poll = undefined }
    const schedulePoll = () => {
      clearPoll()
      if (!current() || hidden()) return
      // Events never establish activity: only the authoritative snapshot can do so.
      const active = streamConnected && latest && (latest.activeRuns.length > 0 || latest.tasks.some(task => task.status === 'in_progress'))
      poll = setTimeout(() => coordinator.request(true), active ? 2_000 : 10_000)
    }
    const openStream = () => {
      if (!current() || closeStream) return
      closeStream = openConversationStream(conversationId, {
        onEvent(event) {
          if (!current() || (event.companyId !== undefined && event.companyId !== companyId)) return
          const metadata = observation(event, companyId, conversationId)
          if (metadata) setDetail(previous => ({ ...previous, events: [...previous.events, { ...event, data: metadata }].slice(-100) }))
          // Malformed runtime events still invalidate; they cannot mutate snapshot activity.
          coordinator.request()
          if (event.type === 'conversation.updated') listCoordinator.current?.request()
        },
        onOpen() {
          if (!current()) return
          streamConnected = true
          setDetail(previous => ({ ...previous, connection: 'live' }))
          coordinator.request()
        },
        onError() {
          if (!current()) return
          streamConnected = false
          latest = staleWorkflowSnapshot(latest)
          setDetail(previous => ({ ...previous, snapshot: staleWorkflowSnapshot(previous.snapshot), connection: 'reconnecting' }))
          // EventSource hides HTTP status. Snapshot detects revoked/deleted access and stops it.
          coordinator.request()
        },
      })
    }
    const coordinator = createRefreshCoordinator({ run: async signal => {
      try {
        const snapshot = await api.workflow(conversationId, signal)
        if (!current(signal)) return
        latest = snapshot
        setDetail(previous => ({ ...previous, snapshot, loading: false, error: null }))
      } catch (error) {
        if (!current(signal)) return
        const blocked = terminalError(error)
        latest = blocked ? null : staleWorkflowSnapshot(latest)
        setDetail(previous => ({ ...previous, snapshot: blocked ? null : staleWorkflowSnapshot(previous.snapshot),
          events: blocked ? [] : previous.events, loading: false, error: asError(error),
          ...(blocked ? { connection: 'disconnected' as const } : {}),
        }))
        if (blocked) {
          streamConnected = false
          stopped = true
          closeStream?.()
          clearPoll()
          coordinator.dispose()
        }
      } finally {
        if (current(signal)) {
          // Complete the initial snapshot attempt before opening SSE; onOpen refetches gaps.
          openStream()
          schedulePoll()
        }
      }
    } })
    detailCoordinator.current = coordinator
    coordinator.setPaused(hidden())
    coordinator.request(true)
    const visibility = () => {
      if (!current()) return
      coordinator.setPaused(hidden())
      if (hidden()) clearPoll()
      // setPaused(false) schedules the immediate refresh; the list has its own listener.
    }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      disposed = true
      ++detailGeneration.current
      coordinator.dispose()
      clearPoll()
      closeStream?.()
      if (detailCoordinator.current === coordinator) detailCoordinator.current = null
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [companyId, conversationId, list.blocked])

  const selectConversation = useCallback((id: string) => {
    if (id === conversationId) return
    // Mask previous selection immediately, not after its effect cleanup.
    ++detailGeneration.current
    detailCoordinator.current?.dispose()
    setDetail(emptyDetail(companyId, id))
    setList(previous => previous.companyId === companyId && previous.selected !== id ? { ...previous, selected: id } : previous)
  }, [companyId, conversationId])
  const refresh = useCallback(() => detailCoordinator.current?.request(true), [])
  const refreshList = useCallback(() => listCoordinator.current?.request(true), [])
  const visibleList = list.companyId === companyId ? list : null
  const visibleDetail = detail.companyId === companyId && detail.conversationId === conversationId ? detail : emptyDetail(companyId, conversationId)
  return {
    conversations: visibleList?.conversations ?? [], conversationId, selectConversation,
    snapshot: visibleDetail.snapshot, loading: visibleDetail.loading,
    listLoading: visibleList?.loading ?? true, error: visibleDetail.error,
    listError: visibleList?.error ?? null, connection: visibleDetail.connection,
    lastUpdated: visibleDetail.snapshot?.generatedAt ?? null, events: visibleDetail.events,
    refresh, refreshList,
  }
}
