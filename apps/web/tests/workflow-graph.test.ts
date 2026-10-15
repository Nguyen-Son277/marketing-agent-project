import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkflowCanvas } from '../src/components/workflow/WorkflowCanvas.tsx'

vi.mock('../src/lib/i18n.tsx', () => ({ useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => key === 'diagram.workflow.node.label' ? `${params?.title}: ${params?.agent}, ${params?.status}` : params ? `${key}: ${Object.values(params).join(', ')}` : key }) }))
import type { WorkflowActiveRun, WorkflowDependency, WorkflowTaskNode } from '@marketing-agent/shared'
import {
  WORKFLOW_GRAPH, WORKFLOW_MAX_ZOOM, WORKFLOW_MIN_ZOOM,
  ensureWorkflowNodeVisible, fitWorkflowViewport, layoutWorkflowGraph, normalizeWorkflowGraph,
  workflowEdgeState, workflowNodeActivity, zoomWorkflowViewport,
} from '../src/lib/workflow-graph.ts'

const task = (id: string, createdAt = '2026-01-01T00:00:00Z', status: WorkflowTaskNode['status'] = 'draft'): WorkflowTaskNode => ({
  id, createdAt, updatedAt: createdAt, status, conversationId: 'c', parentTaskId: null,
  agentDefId: null, assigneeRole: null, assigneeName: null, title: id,
  priority: 0, revisionCount: 0, deadline: null, artifactCount: 0,
})
const edge = (sourceTaskId: string, targetTaskId: string): WorkflowDependency => ({ id: `${sourceTaskId}-${targetTaskId}`, sourceTaskId, targetTaskId })
const activeRun = (taskId: string): WorkflowActiveRun => ({
  taskId, runId: `run-${taskId}`, agentDefId: 'a', agentRole: 'content-writer', modelId: null,
  providerId: null, startedAt: '', updatedAt: '', modelRequest: null, tools: [], retry: null,
})
const layout = (tasks: readonly WorkflowTaskNode[], edges: readonly WorkflowDependency[]) => layoutWorkflowGraph(normalizeWorkflowGraph(tasks, edges))

describe('deterministic workflow graph', () => {
  it('ranks a diamond using the longest path and ties by createdAt then id', () => {
    const tasks = [task('d'), task('c'), task('b'), task('a')]
    const edges = [edge('a', 'c'), edge('c', 'd'), edge('a', 'b'), edge('b', 'd')]
    const graph = normalizeWorkflowGraph(tasks, edges)
    expect(graph.eligible).toBe(true)
    expect([...graph.ranks]).toEqual([['a', 0], ['b', 1], ['c', 1], ['d', 2]])
    expect(layout(tasks, edges).nodes.map(({ id, rank, row }) => ({ id, rank, row }))).toEqual([
      { id: 'a', rank: 0, row: 0 }, { id: 'b', rank: 1, row: 0 }, { id: 'c', rank: 1, row: 1 }, { id: 'd', rank: 2, row: 0 },
    ])
    expect(layout([...tasks].reverse(), [...edges].reverse())).toEqual(layout(tasks, edges))
    expect(layout([task('z', '2025-01-01'), task('a')], []).nodes.map(node => node.id)).toEqual(['z', 'a'])
  })

  it('places fan-in and disconnected components with fixed geometry', () => {
    const result = layout([task('a'), task('b'), task('c'), task('d'), task('e')], [edge('a', 'd'), edge('b', 'c'), edge('c', 'd')])
    expect(result.nodes.find(node => node.id === 'd')?.rank).toBe(2)
    expect(result.nodes.find(node => node.id === 'e')).toMatchObject({ rank: 0, row: 2 })
    const first = result.nodes[0]!
    const second = result.nodes[1]!
    expect(first.x).toBe(WORKFLOW_GRAPH.padding)
    expect(second.y - first.y).toBe(WORKFLOW_GRAPH.cardHeight + WORKFLOW_GRAPH.rowGap)
    expect(result.bounds.width).toBe(2 * WORKFLOW_GRAPH.padding + 3 * WORKFLOW_GRAPH.cardWidth + 2 * WORKFLOW_GRAPH.columnGap)
  })

  it('does not move positions or change topology when statuses, labels, updates change', () => {
    const tasks = [task('a'), task('b')], edges = [edge('a', 'b')]
    const updated = tasks.map(t => ({ ...t, status: 'in_progress' as const, title: 'changed', updatedAt: 'later', artifactCount: 9 }))
    expect(normalizeWorkflowGraph(updated, edges).topologyKey).toBe(normalizeWorkflowGraph(tasks, edges).topologyKey)
    expect(layout(updated, edges)).toEqual(layout(tasks, edges))
  })

  it('deduplicates edge pairs and refuses malformed graphs for an accessible fallback', () => {
    expect(normalizeWorkflowGraph([task('a'), task('b')], [edge('a', 'b'), { ...edge('a', 'b'), id: 'other' }]).dependencies).toHaveLength(1)
    for (const [tasks, edges, warning] of [
      [[task('a')], [edge('a', 'a')], 'selfDependency'],
      [[task('a')], [edge('a', 'missing')], 'missingDependency'],
      [[task('a'), task('b')], [edge('a', 'b'), edge('b', 'a')], 'cycle'],
      [[task('a'), task('a')], [], 'duplicateTask'],
      [Array.from({ length: 101 }, (_, i) => task(String(i))), [], 'tooLarge'],
    ] as const) {
      const graph = normalizeWorkflowGraph(tasks, edges)
      expect(graph.warnings).toContain(warning)
      expect(graph.eligible).toBe(false)
      expect(layoutWorkflowGraph(graph).nodes).toEqual([])
    }
    expect(normalizeWorkflowGraph(Array.from({ length: 100 }, (_, i) => task(String(i))), []).eligible).toBe(true)
  })

  it('routes skip-column edges above every card and includes routes in positive bounds', () => {
    const result = layout([task('a'), task('b'), task('c'), task('d')], [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'c'), edge('a', 'd')])
    const top = Math.min(...result.nodes.map(node => node.y))
    for (const e of result.edges) {
      for (const point of e.points) {
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(result.bounds.width)
        expect(point.y).toBeLessThanOrEqual(result.bounds.height)
      }
      if (e.points.length === 6) {
        expect(e.points[2]!.y).toBeLessThan(top)
        // Vertical segments sit in column gaps, not inside intervening cards.
        expect(e.points[1]!.x).toBeGreaterThan(result.nodes.find(node => node.id === e.sourceTaskId)!.x + WORKFLOW_GRAPH.cardWidth)
        expect(e.points[4]!.x).toBeLessThan(result.nodes.find(node => node.id === e.targetTaskId)!.x)
      }
    }
    expect(result.edges.filter(e => e.points.length === 6).map(e => e.points[2]!.y)).toEqual([32, 44])
  })

  it('only pulses verified active runs and distinguishes waiting/blocked/terminal/unverified', () => {
    expect(workflowNodeActivity(task('a', undefined, 'in_progress'), [])).toBe('unverified')
    expect(workflowNodeActivity(task('a', undefined, 'assigned'), [])).toBe('waiting')
    expect(workflowNodeActivity(task('a', undefined, 'in_progress'), [activeRun('a')])).toBe('active')
    expect(workflowNodeActivity(task('a', undefined, 'in_progress'), [activeRun('b')])).toBe('unverified')
    for (const status of ['done', 'cancelled'] as const) expect(workflowNodeActivity(task('a', undefined, status), [activeRun('a')])).toBe('terminal')
    for (const status of ['failed', 'blocked'] as const) expect(workflowNodeActivity(task('a', undefined, status), [activeRun('a')])).toBe(status)
    expect(workflowEdgeState(task('a', undefined, 'done'), task('b'), [])).toBe('complete')
    expect(workflowEdgeState(task('a'), task('b', undefined, 'in_progress'), [])).toBe('idle')
    expect(workflowEdgeState(task('a'), task('b'), [activeRun('b')])).toBe('idle')
    expect(workflowEdgeState(task('a', undefined, 'assigned'), task('b', undefined, 'in_progress'), [activeRun('b')])).toBe('idle')
    expect(workflowEdgeState(task('a', undefined, 'done'), task('b', undefined, 'assigned'), [])).toBe('complete')
    expect(workflowEdgeState(task('a', undefined, 'done'), task('b', undefined, 'in_progress'), [activeRun('b')])).toBe('active')
    expect(workflowEdgeState(task('a', undefined, 'failed'), task('b'), [activeRun('b')])).toBe('blocked')
  })

  it('renders focusable task buttons, labeled controls and decorative edges without raw run payloads', () => {
    const html = renderToStaticMarkup(createElement(WorkflowCanvas, {
      tasks: [task('a', undefined, 'in_progress'), task('b', undefined, 'assigned')], dependencies: [edge('a', 'b')],
      activeRuns: [], selectedTaskId: 'a', onSelectTask: () => {},
    }))
    expect(html).toContain('aria-label="diagram.workflow.canvas.label"')
    expect(html).toContain('aria-label="diagram.workflow.controls.zoomIn"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('workflow__node--unverified')
    expect(html).not.toContain('workflow__node--active')
    expect(html).toContain('aria-hidden="true" focusable="false"')
    expect(html).toContain('diagram.workflow.activity.unverified')
    expect(html).toContain('aria-label="a: diagram.workflow.node.unassigned, diagram.workflow.activity.unverified"')
    expect(html).not.toContain('undefined')
    // SSR has no handlers; source assertion verifies focus is wired only to nodes,
    // not to an effect reacting to live status updates.
    const source = readFileSync(new URL('../src/components/workflow/WorkflowCanvas.tsx', import.meta.url), 'utf8')
    expect(source).toContain('onFocus={() => setViewport(current => ensureWorkflowNodeVisible(current, node, sizeRef.current))}')
    expect(source.match(/ensureWorkflowNodeVisible\(/g)).toHaveLength(1)
    expect(source).not.toContain("behavior: 'smooth'")
    const fallback = renderToStaticMarkup(createElement(WorkflowCanvas, {
      tasks: [task('a')], dependencies: [edge('a', 'a')], activeRuns: [], selectedTaskId: null, onSelectTask: () => {},
    }))
    expect(fallback).toContain('workflow__fallback-list')
    expect(fallback).toContain('diagram.workflow.graph.warning.selfDependency')
    expect(fallback).toContain('<button')
    expect(fallback).not.toContain('<svg')
  })

  it('reveals focused offscreen nodes immediately at readable zoom without moving visible cards', () => {
    const size = { width: 500, height: 400 }
    const current = { x: 0, y: 0, scale: 1 }
    expect(ensureWorkflowNodeVisible(current, { x: 32, y: 32 }, size)).toBe(current)
    const node = { x: 5000, y: 2000 }
    for (const scale of [0.005, 0.5, 1, 2]) {
      const visible = ensureWorkflowNodeVisible({ ...current, scale }, node, size)
      expect(visible.scale).toBeGreaterThanOrEqual(0.6)
      expect(visible.x + (node.x + WORKFLOW_GRAPH.cardWidth / 2) * visible.scale).toBeCloseTo(size.width / 2)
      expect(visible.y + (node.y + WORKFLOW_GRAPH.cardHeight / 2) * visible.scale).toBeCloseTo(size.height / 2)
    }
    const unreadable = ensureWorkflowNodeVisible({ ...current, scale: 0.1 }, { x: 32, y: 32 }, size)
    expect(unreadable.scale).toBe(0.6)
    expect(ensureWorkflowNodeVisible(current, node, { width: 0, height: 0 })).toBe(current)
  })

  it('fits bounds and zooms around the anchor with safe clamps', () => {
    const bounds = { width: 1000, height: 500 }, size = { width: 500, height: 400 }
    const viewport = fitWorkflowViewport(bounds, size)
    expect(viewport).toEqual({ x: 0, y: 75, scale: 0.5 })
    const anchor = { x: 250, y: 200 }
    const zoomed = zoomWorkflowViewport(viewport, 2, anchor)
    expect((anchor.x - zoomed.x) / zoomed.scale).toBe((anchor.x - viewport.x) / viewport.scale)
    expect((anchor.y - zoomed.y) / zoomed.scale).toBe((anchor.y - viewport.y) / viewport.scale)
    expect(zoomWorkflowViewport(viewport, 10000, anchor).scale).toBe(WORKFLOW_MAX_ZOOM)
    expect(zoomWorkflowViewport(viewport, 0.000001, anchor).scale).toBe(WORKFLOW_MIN_ZOOM)
    expect(zoomWorkflowViewport(viewport, NaN, anchor)).toEqual(viewport)
    expect(fitWorkflowViewport(bounds, { width: 0, height: 0 })).toEqual({ x: 0, y: 0, scale: 1 })
  })
})
