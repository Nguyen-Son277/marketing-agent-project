import type { ConversationPhase, RunStatus, TaskStatus } from './domain.ts'

/** Metadata-only runtime events: never include prompts, raw errors/content, or keys. */
export type WorkflowRuntimeEventType =
  | 'run.started'
  | 'run.finished'
  | 'model.started'
  | 'model.finished'
  | 'run.retrying'
  | 'tool.started'
  | 'tool.finished'

export interface RuntimeObservation {
  type: WorkflowRuntimeEventType
  at: string
  companyId: string
  conversationId: string | null
  taskId: string | null
  runId: string | null
  agentDefId: string
  agentRole: string
  modelId?: string | null
  providerId?: string | null
  requestIndex?: number
  attemptIndex?: number
  toolInvocationId?: string
  toolName?: string
  outcome?: 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'denied' | 'invalid_arguments'
  status?: RunStatus
  stopReason?: string
  durationMs?: number
  strategy?: 'retry' | 'key_rotation' | 'model_fallback'
  errorCode?: string | null
  httpStatus?: number
  requestCount?: number
  toolCount?: number
  usage?: {
    tokensIn: number
    tokensOut: number
    cachedTokens: number
    costUsd: number
  }
  accountingStatus?: 'recorded' | 'failed'
}

export type RuntimeObserver = (event: RuntimeObservation) => void

export interface WorkflowTaskNode {
  id: string
  conversationId: string
  parentTaskId: string | null
  agentDefId: string | null
  assigneeRole: string | null
  assigneeName: string | null
  title: string
  status: TaskStatus
  priority: number
  revisionCount: number
  deadline: string | null
  createdAt: string
  updatedAt: string
  artifactCount: number
}

export interface WorkflowDependency {
  id: string
  sourceTaskId: string
  targetTaskId: string
}

/** Safe run history summary; deliberately excludes raw run errors. */
export interface WorkflowRunSummary {
  id: string
  taskId: string | null
  conversationId: string | null
  agentDefId: string
  agentRole: string
  agentName: string
  modelId: string | null
  modelLabel: string | null
  providerId: string | null
  status: RunStatus
  tokensIn: number
  tokensOut: number
  costUsd: number
  latencyMs: number
  steps: number
  createdAt: string
  activity: 'active' | 'unverified' | 'terminal'
}

export interface WorkflowActiveRun {
  runId: string
  taskId: string | null
  agentDefId: string
  agentRole: string
  modelId: string | null
  providerId: string | null
  startedAt: string
  updatedAt: string
  modelRequest: { requestIndex: number; startedAt: string } | null
  tools: readonly { id: string; name: string; startedAt: string }[]
  retry: { strategy: string; at: string } | null
}

export interface WorkflowSnapshotResponse {
  schemaVersion: 1
  generatedAt: string
  conversation: {
    id: string
    title: string
    phase: ConversationPhase
    updatedAt: string
  }
  tasks: readonly WorkflowTaskNode[]
  dependencies: readonly WorkflowDependency[]
  runs: readonly WorkflowRunSummary[]
  activeRuns: readonly WorkflowActiveRun[]
  counts: Readonly<Record<TaskStatus, number>>
  usage: { tokensIn: number; tokensOut: number; costUsd: number; runs: number }
  historyTruncated: boolean
  graphEligible: boolean
}

/** Runtime event payloads are RuntimeObservation, including their type and scope. */
export interface WorkflowStreamEnvelope {
  type: string
  companyId: string
  payload: unknown
  at: string
}
