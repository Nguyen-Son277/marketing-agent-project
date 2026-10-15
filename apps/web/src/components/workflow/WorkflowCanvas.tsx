import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { WorkflowActiveRun, WorkflowDependency, WorkflowTaskNode } from '@marketing-agent/shared'
import { useI18n } from '../../lib/i18n.tsx'
import {
  WORKFLOW_GRAPH, WORKFLOW_MAX_ZOOM, WORKFLOW_MIN_ZOOM,
  ensureWorkflowNodeVisible, fitWorkflowViewport, layoutWorkflowGraph, normalizeWorkflowGraph,
  workflowEdgeState, workflowNodeActivity, zoomWorkflowViewport,
  type WorkflowBounds, type WorkflowViewport,
} from '../../lib/workflow-graph.ts'

export interface WorkflowCanvasProps {
  tasks: readonly WorkflowTaskNode[]
  dependencies: readonly WorkflowDependency[]
  activeRuns: readonly WorkflowActiveRun[]
  selectedTaskId: string | null
  onSelectTask: (id: string) => void
}

/** HTML task buttons remain keyboard-accessible; SVG edges are decoration only. */
export function WorkflowCanvas({ tasks, dependencies, activeRuns, selectedTaskId, onSelectTask }: WorkflowCanvasProps) {
  const { t } = useI18n()
  const graph = useMemo(() => normalizeWorkflowGraph(tasks, dependencies), [tasks, dependencies])
  // Only structural changes move cards or reset the user's viewport, never live statuses.
  const layout = useMemo(() => layoutWorkflowGraph(graph), [graph.topologyKey])
  const taskById = useMemo(() => new Map(graph.tasks.map(task => [task.id, task])), [graph.tasks])
  const containerRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef<WorkflowBounds>({ width: 0, height: 0 })
  const fittedTopologyRef = useRef<string | null>(null)
  const dragRef = useRef<{ pointerId: number; clientX: number; clientY: number; viewport: WorkflowViewport } | null>(null)
  const [viewport, setViewport] = useState<WorkflowViewport>({ x: 0, y: 0, scale: 1 })
  const markerId = `workflow-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  const fit = useCallback(() => {
    const size = sizeRef.current
    if (size.width > 0 && size.height > 0) {
      setViewport(fitWorkflowViewport(layout.bounds, size))
      fittedTopologyRef.current = graph.topologyKey
    }
  }, [layout.bounds, graph.topologyKey])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !graph.eligible) return
    const measure = () => {
      sizeRef.current = { width: container.clientWidth, height: container.clientHeight }
      if (fittedTopologyRef.current !== graph.topologyKey) fit()
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [graph.topologyKey, graph.eligible, fit])

  const zoom = (factor: number) => {
    const size = sizeRef.current
    setViewport(current => zoomWorkflowViewport(current, factor, { x: size.width / 2, y: size.height / 2 }))
  }
  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [data-workflow-no-pan]'))) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, viewport }
  }
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setViewport({ ...drag.viewport, x: drag.viewport.x + event.clientX - drag.clientX, y: drag.viewport.y + event.clientY - drag.clientY })
  }
  const stopPan = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const renderNodeContent = (task: WorkflowTaskNode) => {
    const activity = workflowNodeActivity(task, activeRuns)
    const status = activity === 'unverified' ? t('diagram.workflow.activity.unverified') : t(`taskStatus.${task.status}`)
    return <>
      <span className="workflow__node-title">{task.title}</span>
      <span className="workflow__node-assignee">{task.assigneeName ?? task.assigneeRole ?? t('diagram.workflow.node.unassigned')}</span>
      <span className="workflow__node-status">{status}</span>
      {(activity === 'active' || activity === 'waiting') && <span className={`workflow__activity workflow__activity--${activity}`}>{t(`diagram.workflow.activity.${activity}`)}</span>}
    </>
  }
  const nodeLabel = (task: WorkflowTaskNode) => t('diagram.workflow.node.label', {
    title: task.title,
    status: workflowNodeActivity(task, activeRuns) === 'unverified' ? t('diagram.workflow.activity.unverified') : workflowNodeActivity(task, activeRuns) === 'active' ? `${t(`taskStatus.${task.status}`)} · ${t('diagram.workflow.activity.active')}` : t(`taskStatus.${task.status}`),
    agent: task.assigneeName ?? task.assigneeRole ?? t('diagram.workflow.node.unassigned'),
    assignee: task.assigneeName ?? task.assigneeRole ?? t('diagram.workflow.node.unassigned'),
  })

  if (!graph.eligible) return <section className="workflow__fallback" aria-label={t('diagram.workflow.canvas.label')}>
    <p>{t('diagram.workflow.graph.warning')}</p>
    <ul className="workflow__warnings">{graph.warnings.map(warning => <li key={warning}>{t(`diagram.workflow.graph.warning.${warning}`)}</li>)}</ul>
    <ul className="workflow__fallback-list">{graph.tasks.map(task => <li key={task.id}>
      <button type="button" className={`workflow__node workflow__node--${workflowNodeActivity(task, activeRuns)}${task.id === selectedTaskId ? ' workflow__node--selected' : ''}`} aria-label={nodeLabel(task)} aria-pressed={task.id === selectedTaskId} onClick={() => onSelectTask(task.id)}>{renderNodeContent(task)}</button>
    </li>)}</ul>
  </section>

  return <div ref={containerRef} className="workflow__canvas" role="region" aria-label={t('diagram.workflow.canvas.label')} onPointerDown={startPan} onPointerMove={movePan} onPointerUp={stopPan} onPointerCancel={stopPan} onLostPointerCapture={() => { dragRef.current = null }}>
    <div className="workflow__controls" data-workflow-no-pan>
      <button type="button" className="workflow__control" aria-label={t('diagram.workflow.controls.zoomIn')} title={t('diagram.workflow.controls.zoomIn')} disabled={viewport.scale >= WORKFLOW_MAX_ZOOM} onClick={() => zoom(1.25)}>+</button>
      <button type="button" className="workflow__control" aria-label={t('diagram.workflow.controls.zoomOut')} title={t('diagram.workflow.controls.zoomOut')} disabled={viewport.scale <= WORKFLOW_MIN_ZOOM} onClick={() => zoom(0.8)}>−</button>
      <button type="button" className="workflow__control" onClick={fit}>{t('diagram.workflow.controls.fit')}</button>
    </div>
    {graph.tasks.length === 0 && <p className="workflow__empty">{t('diagram.workflow.empty')}</p>}
    <div className="workflow__world" style={{ width: layout.bounds.width, height: layout.bounds.height, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`, transformOrigin: '0 0' }}>
      <svg className="workflow__edges" width={layout.bounds.width} height={layout.bounds.height} aria-hidden="true" focusable="false">
        <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" /></marker></defs>
        {layout.edges.map(edge => <path key={JSON.stringify([edge.sourceTaskId, edge.targetTaskId])} className={`workflow__edge workflow__edge--${workflowEdgeState(taskById.get(edge.sourceTaskId)!, taskById.get(edge.targetTaskId)!, activeRuns)}`} d={edge.path} fill="none" markerEnd={`url(#${markerId})`} />)}
      </svg>
      {layout.nodes.map(node => {
        const task = taskById.get(node.id)!
        return <button key={node.id} type="button" className={`workflow__node workflow__node--${workflowNodeActivity(task, activeRuns)}${node.id === selectedTaskId ? ' workflow__node--selected' : ''}`} style={{ position: 'absolute', left: node.x, top: node.y, width: WORKFLOW_GRAPH.cardWidth, height: WORKFLOW_GRAPH.cardHeight }} aria-label={nodeLabel(task)} aria-pressed={node.id === selectedTaskId} onFocus={() => setViewport(current => ensureWorkflowNodeVisible(current, node, sizeRef.current))} onClick={() => onSelectTask(node.id)}>{renderNodeContent(task)}</button>
      })}
    </div>
  </div>
}
