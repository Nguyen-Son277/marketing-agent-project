import { describe, expect, it } from 'vitest'
import type { WorkflowSnapshotResponse } from '@marketing-agent/shared'
import { staleWorkflowSnapshot } from '../src/lib/workflow-freshness.ts'

describe('workflow stale liveness', () => {
  it('keeps last-known facts but clears active model/tool activity and unverifies running history', () => {
    const snapshot = {
      generatedAt: '2026-10-14T00:00:00Z', tasks: [{ id: 'task', status: 'in_progress' }],
      activeRuns: [{ runId: 'live', tools: [{ name: 'tool' }] }],
      runs: [{ id: 'live', status: 'running', activity: 'active' }, { id: 'old', status: 'succeeded', activity: 'terminal' }],
      counts: { in_progress: 1 }, usage: { costUsd: 1 },
    } as unknown as WorkflowSnapshotResponse
    const stale = staleWorkflowSnapshot(snapshot)!
    expect(stale.activeRuns).toEqual([])
    expect(stale.runs[0]?.activity).toBe('unverified')
    expect(stale.runs[1]).toBe(snapshot.runs[1])
    expect(stale.tasks).toBe(snapshot.tasks)
    expect(stale.usage).toBe(snapshot.usage)
    expect(stale.generatedAt).toBe(snapshot.generatedAt)
    expect(snapshot.activeRuns).toHaveLength(1)
    expect(snapshot.runs[0]?.activity).toBe('active')
  })
  it('does not manufacture data without a prior snapshot', () => {
    expect(staleWorkflowSnapshot(null)).toBeNull()
  })
})
