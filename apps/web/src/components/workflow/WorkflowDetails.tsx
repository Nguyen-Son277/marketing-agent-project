import { useEffect, useState, type ReactNode } from 'react'
import type { TaskDetailResponse, WorkflowActiveRun, WorkflowRunSummary, WorkflowTaskNode } from '@marketing-agent/shared'
import type { MessageKey } from '@marketing-agent/i18n'
import { api } from '../../lib/api.ts'
import { useI18n } from '../../lib/i18n.tsx'
import { Markdown } from '../Markdown.tsx'

/** Allowlisted enum summaries only: event payloads may contain private provider errors. */
export const WORKFLOW_EVENT_KEYS: Readonly<Record<string, MessageKey>> = {
  'run.started': 'diagram.workflow.event.runStarted',
  'run.finished': 'diagram.workflow.event.runFinished',
  'model.started': 'diagram.workflow.event.modelStarted',
  'model.finished': 'diagram.workflow.event.modelFinished',
  'run.retrying': 'diagram.workflow.event.retrying',
  'tool.started': 'diagram.workflow.event.toolStarted',
  'tool.finished': 'diagram.workflow.event.toolFinished',
  'leader.thinking': 'diagram.workflow.event.leaderThinking',
  'leader.replied': 'diagram.workflow.event.leaderReplied',
  'brief.updated': 'diagram.workflow.event.briefUpdated',
  'plan.created': 'diagram.workflow.event.planCreated',
  'task.updated': 'diagram.workflow.event.taskUpdated',
  'agent.started': 'diagram.workflow.event.agentStarted',
  'tool.called': 'diagram.workflow.event.toolFinished',
  'artifact.created': 'diagram.workflow.event.artifactCreated',
  'agent.message': 'diagram.workflow.event.agentMessage',
  'review.completed': 'diagram.workflow.event.reviewCompleted',
  'report.created': 'diagram.workflow.event.reportCreated',
  'conversation.updated': 'diagram.workflow.event.conversationUpdated',
  'warning': 'diagram.workflow.event.warning',
  created: 'diagram.workflow.event.taskCreated',
  assigned: 'diagram.workflow.event.taskAssigned',
  status_changed: 'diagram.workflow.event.taskUpdated',
  completed: 'diagram.workflow.event.taskCompleted',
  failed: 'diagram.workflow.event.taskFailed',
}

export function workflowEventKey(type: string): MessageKey {
  return WORKFLOW_EVENT_KEYS[type] ?? 'diagram.workflow.event.other'
}

/** Metadata inspector: never render raw run errors, prompts or provider response bodies. */
export function WorkflowRunActivity({ run }: { run: WorkflowActiveRun }): ReactNode {
  const { t, formatNumber, formatDateTime } = useI18n()
  const strategy = run.retry?.strategy
  const retryKey = strategy === 'retry' ? 'diagram.workflow.retry.retry' :
    strategy === 'key_rotation' ? 'diagram.workflow.retry.keyRotation' :
    strategy === 'model_fallback' ? 'diagram.workflow.retry.modelFallback' : 'diagram.workflow.retry.other'
  return <div className="workflow__run workflow__run--active">
    <strong>{run.agentRole || t('diagram.workflow.unknownAgent')}</strong>
    <span className="workflow__status workflow__status--live">{t('diagram.workflow.running')}</span>
    <dl className="workflow__metadata">
      <dt>{t('diagram.workflow.details.model')}</dt><dd>{run.modelId ?? t('diagram.workflow.details.unassigned')}</dd>
      <dt>{t('diagram.workflow.details.modelRequest')}</dt><dd>{run.modelRequest ? formatNumber(run.modelRequest.requestIndex) : t('diagram.workflow.waiting')}</dd>
      <dt>{t('diagram.workflow.details.tools')}</dt><dd>{run.tools.length ? run.tools.map((tool) => tool.name).join(', ') : t('diagram.workflow.details.noTools')}</dd>
      <dt>{t('diagram.workflow.details.retry')}</dt><dd>{run.retry ? t(retryKey) : t('diagram.workflow.details.noRetry')}</dd>
      <dt>{t('diagram.workflow.details.updated')}</dt><dd>{formatDateTime(run.updatedAt)}</dd>
    </dl>
  </div>
}

export function WorkflowRunHistory({ runs }: { runs: readonly WorkflowRunSummary[] }): ReactNode {
  const { t, formatNumber, formatCurrencyUsd, formatDateTime } = useI18n()
  return <ul className="workflow__run-list">
    {runs.map((run) => <li key={run.id} className="workflow__run">
      <div className="workflow__run-heading"><strong>{run.agentName || run.agentRole || t('diagram.workflow.unknownAgent')}</strong>
        <span className="workflow__status">{run.activity === 'unverified' ? t('diagram.workflow.unverified') :
          run.status === 'running' ? t('diagram.workflow.running') :
          run.status === 'succeeded' ? t('diagram.workflow.run.succeeded') :
          run.status === 'failed' ? t('diagram.workflow.run.failed') :
          run.status === 'cancelled' ? t('diagram.workflow.run.cancelled') : t('diagram.workflow.run.budgetExceeded')}</span>
      </div>
      <div className="workflow__muted">{run.modelLabel ?? run.modelId ?? t('diagram.workflow.details.unassigned')} · {formatDateTime(run.createdAt)}</div>
      <div className="workflow__muted">{t('diagram.workflow.run.usage', { tokens: formatNumber(run.tokensIn + run.tokensOut), cost: formatCurrencyUsd(run.costUsd), steps: formatNumber(run.steps) })}</div>
    </li>)}
  </ul>
}

export interface WorkflowDetailsProps {
  task: WorkflowTaskNode | null
  activeRuns: readonly WorkflowActiveRun[]
  runs: readonly WorkflowRunSummary[]
}

export function WorkflowDetails({ task, activeRuns, runs }: WorkflowDetailsProps): ReactNode {
  const { t, translateError, formatDateTime, formatNumber } = useI18n()
  const [detail, setDetail] = useState<TaskDetailResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const taskId = task?.id ?? null
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setDetail(null)
    setError(null)
    setLoading(Boolean(taskId))
    if (taskId) void api.task(taskId, controller.signal).then((response) => {
      if (!cancelled) setDetail(response)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause)
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [taskId, revision])

  const currentRuns = activeRuns.filter((run) => run.taskId === taskId && taskId !== null)
  const history = runs.filter((run) => run.taskId === taskId && taskId !== null)
  return <aside className="workflow__details" aria-label={t('diagram.workflow.details.title')}>
    <h3>{t('diagram.workflow.details.title')}</h3>
    {!task ? <p className="workflow__muted">{t('diagram.workflow.details.select')}</p> : <>
      <h4>{task.title}</h4>
      <dl className="workflow__metadata">
        <dt>{t('diagram.workflow.details.agent')}</dt><dd>{task.assigneeName ?? task.assigneeRole ?? t('diagram.workflow.unknownAgent')}</dd>
        <dt>{t('diagram.workflow.details.status')}</dt><dd>{t(`taskStatus.${task.status}`)}</dd>
        <dt>{t('diagram.workflow.details.revisions')}</dt><dd>{formatNumber(task.revisionCount)}</dd>
        <dt>{t('diagram.workflow.details.deadline')}</dt><dd>{task.deadline ? formatDateTime(task.deadline) : t('diagram.workflow.details.none')}</dd>
      </dl>
      <h4>{t('diagram.workflow.details.live')}</h4>
      {currentRuns.length ? currentRuns.map((run) => <WorkflowRunActivity key={run.runId} run={run} />) : <p className="workflow__muted">{t('diagram.workflow.details.noLive')}</p>}
      <h4>{t('diagram.workflow.details.runs')}</h4>
      {history.length ? <WorkflowRunHistory runs={history} /> : <p className="workflow__muted">{t('diagram.workflow.details.noRuns')}</p>}
      <button type="button" className="workflow__button" onClick={() => setRevision((value) => value + 1)} disabled={loading}>{t('diagram.workflow.details.refresh')}</button>
      {loading && <p role="status">{t('diagram.workflow.details.loading')}</p>}
      {error !== null && <p role="alert" className="workflow__error">{translateError(error)}</p>}
      {detail && detail.task.id === taskId && <>
        <h4>{t('diagram.workflow.details.brief')}</h4>
        <Markdown>{detail.task.briefMd}</Markdown>
        <h4>{t('diagram.workflow.details.result')}</h4>
        {detail.task.resultMd ? <Markdown>{detail.task.resultMd}</Markdown> : <p className="workflow__muted">{t('diagram.workflow.details.noResult')}</p>}
        <h4>{t('diagram.workflow.details.artifacts')}</h4>
        {detail.artifacts.length ? <ul className="workflow__artifacts">{detail.artifacts.map((artifact) => <li key={artifact.id}>
          <strong>{artifact.name}</strong><span className="workflow__muted"> · {t(`diagram.workflow.artifact.${artifact.kind}`)}</span>
          {artifact.content && <details><summary>{t('diagram.workflow.details.showArtifact')}</summary>
            {artifact.kind === 'markdown' ? <Markdown>{artifact.content}</Markdown> : <pre className="workflow__artifact-content">{artifact.content}</pre>}
          </details>}
        </li>)}</ul> : <p className="workflow__muted">{t('diagram.workflow.details.noArtifacts')}</p>}
        <h4>{t('diagram.workflow.details.events')}</h4>
        {detail.events.length ? <ol className="workflow__events">{detail.events.slice(-50).map((event) => <li key={event.id}>
          <time dateTime={event.createdAt}>{formatDateTime(event.createdAt)}</time> {t(workflowEventKey(event.kind))}
        </li>)}</ol> : <p className="workflow__muted">{t('diagram.workflow.details.noEvents')}</p>}
      </>}
    </>}
  </aside>
}
