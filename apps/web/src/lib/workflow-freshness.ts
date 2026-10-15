import type { WorkflowSnapshotResponse } from '@marketing-agent/shared'

/** Retain last-known business facts without presenting old process activity as live. */
export function staleWorkflowSnapshot(snapshot: WorkflowSnapshotResponse | null): WorkflowSnapshotResponse | null {
  if (!snapshot) return null
  return {
    ...snapshot,
    activeRuns: [],
    runs: snapshot.runs.map(run => run.status === 'running' ? { ...run, activity: 'unverified' as const } : run),
  }
}
