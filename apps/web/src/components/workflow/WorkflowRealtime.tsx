import { useEffect, useId, useState, type ReactNode } from 'react'
import { TASK_STATUSES } from '@marketing-agent/shared'
import { useLiveWorkflow } from '../../lib/useLiveWorkflow.ts'
import { useI18n } from '../../lib/i18n.tsx'
import { workflowNodeActivity } from '../../lib/workflow-graph.ts'
import { WorkflowCanvas } from './WorkflowCanvas.tsx'
import { WorkflowDetails, WorkflowRunActivity, WorkflowRunHistory, workflowEventKey } from './WorkflowDetails.tsx'

/** Read-only runtime view. Mounted only while the workflow tab is active. */
export function WorkflowRealtime({ companyId }: { companyId: string }): ReactNode {
  const { t, translateError, formatNumber, formatDateTime } = useI18n()
  const live = useLiveWorkflow(companyId)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [view, setView] = useState<'graph' | 'list'>('graph')
  const chooserId = useId()
  const snapshot = live.snapshot
  const tasks = snapshot?.tasks ?? []
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null
  const tooLarge = Boolean(snapshot && (!snapshot.graphEligible || tasks.length > 100))
  const showGraph = view === 'graph' && !tooLarge
  const leaderRuns = snapshot?.activeRuns.filter((run) => run.taskId === null) ?? []
  const leaderHistory = snapshot?.runs.filter((run) => run.taskId === null) ?? []
  useEffect(() => { setSelectedTaskId(null) }, [companyId, live.conversationId])
  useEffect(() => {
    if (selectedTaskId && snapshot && !snapshot.tasks.some((task) => task.id === selectedTaskId)) setSelectedTaskId(null)
  }, [snapshot, selectedTaskId])

  return <section className="workflow__realtime" aria-label={t('diagram.tab.workflow')}>
    <p className="workflow__muted">{t('diagram.workflow.readOnly')}</p>
    <div className="workflow__toolbar">
      <div className="workflow__chooser">
        <label htmlFor={chooserId}>{t('diagram.workflow.conversation')}</label>
        <select id={chooserId} value={live.conversationId ?? ''} disabled={live.listLoading && !live.conversations.length}
          onChange={(event) => { if (event.target.value) live.selectConversation(event.target.value) }}>
          <option value="" disabled={Boolean(live.conversationId)}>{t('diagram.workflow.chooseConversation')}</option>
          {live.conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}
        </select>
        <span className="workflow__muted">{t('diagram.workflow.recent50')}</span>
      </div>
      <div className="workflow__refresh">
        <button type="button" className="workflow__button" onClick={() => { void live.refreshList() }} disabled={live.listLoading}>{t('diagram.workflow.refreshList')}</button>
        <button type="button" className="workflow__button" onClick={() => { void live.refresh() }} disabled={!live.conversationId || live.loading}>{t('diagram.workflow.refresh')}</button>
      </div>
    </div>
    <div className="workflow__connection" role="status" aria-live="polite">
      <span className={`workflow__connection-dot workflow__connection-dot--${live.connection}`} aria-hidden="true" />
      <strong>{t(`diagram.workflow.connection.${live.connection}`)}</strong>
      <span className="workflow__muted">{t('diagram.workflow.connection.notActivity')}</span>
      {live.lastUpdated !== null && live.lastUpdated !== undefined && <span>{t('diagram.workflow.lastUpdated', { at: formatDateTime(live.lastUpdated) })}</span>}
    </div>
    {live.listLoading && <p role="status">{t('diagram.workflow.listLoading')}</p>}
    {live.listError !== null && live.listError !== undefined && <p role="alert" className="workflow__error">{translateError(live.listError)}</p>}
    {!live.listLoading && !live.listError && !live.conversations.length && <p className="workflow__empty">{t('diagram.workflow.noConversations')}</p>}
    {!live.conversationId && live.conversations.length > 0 && <p className="workflow__empty">{t('diagram.workflow.chooseConversation')}</p>}
    {live.loading && <p role="status">{t('diagram.workflow.loading')}</p>}
    {live.error !== null && live.error !== undefined && <p role="alert" className="workflow__error">{translateError(live.error)}</p>}
    {snapshot && <>
      <h3 className="workflow__conversation-title">{snapshot.conversation.title}</h3>
      <div className="workflow__counts" aria-label={t('diagram.workflow.counts')}>
        {TASK_STATUSES.map((status) => <div key={status} className={`workflow__count workflow__count--${status}`}>
          <strong>{formatNumber(snapshot.counts[status])}</strong><span>{t(`taskStatus.${status}`)}</span>
        </div>)}
      </div>
      {snapshot.historyTruncated && <p className="workflow__notice">{t('diagram.workflow.historyTruncated')}</p>}
      {(leaderRuns.length > 0 || leaderHistory.length > 0) && <section className="workflow__leader" aria-label={t('diagram.workflow.leader.title')}>
        <h3>{t('diagram.workflow.leader.title')}</h3><p className="workflow__muted">{t('diagram.workflow.leader.description')}</p>
        {leaderRuns.map((run) => <WorkflowRunActivity key={run.runId} run={run} />)}
        {leaderHistory.length > 0 && <details><summary>{t('diagram.workflow.leader.history')}</summary><WorkflowRunHistory runs={leaderHistory} /></details>}
      </section>}
      {!tasks.length ? <p className="workflow__empty">{t('diagram.workflow.noTasks')}</p> : <>
        <div className="workflow__view-controls" role="group" aria-label={t('diagram.workflow.view')}>
          <button type="button" className="workflow__button" aria-pressed={showGraph} disabled={tooLarge} onClick={() => setView('graph')}>{t('diagram.workflow.graph')}</button>
          <button type="button" className="workflow__button" aria-pressed={!showGraph} onClick={() => setView('list')}>{t('diagram.workflow.list')}</button>
        </div>
        {tooLarge && <p className="workflow__notice">{t('diagram.workflow.tooLarge')}</p>}
        <div className="workflow__workspace">
          <div className="workflow__main">
            {showGraph ? <WorkflowCanvas tasks={snapshot.tasks} dependencies={snapshot.dependencies} activeRuns={snapshot.activeRuns}
              selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} /> :
              <ul className="workflow__task-list" aria-label={t('diagram.workflow.list')}>
                {tasks.map((task) => {
                  const active = workflowNodeActivity(task, snapshot.activeRuns) === 'active'
                  const unverified = workflowNodeActivity(task, snapshot.activeRuns) === 'unverified'
                  const activity = active ? t('diagram.workflow.running') : unverified ? t('diagram.workflow.unverified') : null
                  return <li key={task.id}><button type="button" className={`workflow__task-row${selectedTaskId === task.id ? ' workflow__task-row--selected' : ''}`}
                    aria-pressed={selectedTaskId === task.id} onClick={() => setSelectedTaskId(task.id)}>
                    <strong>{task.title}</strong><span>{task.assigneeName ?? task.assigneeRole ?? t('diagram.workflow.unknownAgent')}</span>
                    <span className="workflow__status">{t(`taskStatus.${task.status}`)}</span>
                    {activity && <span className={`workflow__status${active ? ' workflow__status--live' : ''}`}>{activity}</span>}
                  </button></li>
                })}
              </ul>}
          </div>
          <WorkflowDetails key={live.conversationId} task={selectedTask} activeRuns={snapshot.activeRuns} runs={snapshot.runs} />
        </div>
      </>}
    </>}
    <section className="workflow__observed" aria-label={t('diagram.workflow.events.title')}>
      <h3>{t('diagram.workflow.events.title')}</h3>
      <p className="workflow__muted">{t('diagram.workflow.events.description')}</p>
      {live.events.length ? <ol className="workflow__events">{live.events.slice(-50).map((event, index) => <li key={`${event.at}-${event.type}-${index}`}>
        <time dateTime={new Date(event.at).toISOString()}>{formatDateTime(event.at)}</time> {t(workflowEventKey(event.type))}
      </li>)}</ol> : <p className="workflow__muted">{t('diagram.workflow.events.empty')}</p>}
    </section>
  </section>
}
