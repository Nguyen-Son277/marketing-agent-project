import type { WorkflowActiveRun, WorkflowDependency, WorkflowTaskNode } from '@marketing-agent/shared'

export const WORKFLOW_GRAPH = { cardWidth: 240, cardHeight: 104, columnGap: 96, rowGap: 40, padding: 32, maxNodes: 100 } as const
export const WORKFLOW_MIN_ZOOM = 0.005
export const WORKFLOW_MAX_ZOOM = 2
export type WorkflowGraphWarning = 'selfDependency' | 'cycle' | 'missingDependency' | 'duplicateTask' | 'tooLarge'
export type WorkflowNodeActivity = 'active' | 'waiting' | 'unverified' | 'blocked' | 'failed' | 'terminal' | 'idle'
export type WorkflowEdgeState = 'active' | 'complete' | 'blocked' | 'idle'
export interface WorkflowPoint { x: number; y: number }
export interface WorkflowViewport { x: number; y: number; scale: number }
export interface WorkflowBounds { width: number; height: number }
export interface WorkflowGraphNode extends WorkflowPoint { id: string; rank: number; row: number }
export interface WorkflowGraphEdge { id: string; sourceTaskId: string; targetTaskId: string; points: readonly WorkflowPoint[]; path: string }
export interface NormalizedWorkflowGraph {
  tasks: readonly WorkflowTaskNode[]
  dependencies: readonly WorkflowDependency[]
  ranks: ReadonlyMap<string, number>
  warnings: readonly WorkflowGraphWarning[]
  eligible: boolean
  topologyKey: string
}
export interface WorkflowGraphLayout {
  nodes: readonly WorkflowGraphNode[]
  edges: readonly WorkflowGraphEdge[]
  bounds: WorkflowBounds
}

// Use code-point comparisons rather than locale-dependent ordering: server and browser agree.
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const compareTasks = (a: WorkflowTaskNode, b: WorkflowTaskNode) => compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id)

/** Metadata/status changes deliberately do not change the topology key or positions. */
export function normalizeWorkflowGraph(tasks: readonly WorkflowTaskNode[], dependencies: readonly WorkflowDependency[]): NormalizedWorkflowGraph {
  const warnings = new Set<WorkflowGraphWarning>()
  const sortedTasks = [...tasks].sort(compareTasks)
  const byId = new Map<string, WorkflowTaskNode>()
  for (const task of sortedTasks) {
    if (byId.has(task.id)) warnings.add('duplicateTask')
    else byId.set(task.id, task)
  }
  const uniqueTasks = [...byId.values()]
  if (uniqueTasks.length > WORKFLOW_GRAPH.maxNodes) warnings.add('tooLarge')
  const pairs = new Map<string, WorkflowDependency>()
  for (const dependency of [...dependencies].sort((a, b) => compareText(a.id, b.id))) {
    if (!byId.has(dependency.sourceTaskId) || !byId.has(dependency.targetTaskId)) {
      warnings.add('missingDependency')
      continue
    }
    if (dependency.sourceTaskId === dependency.targetTaskId) {
      warnings.add('selfDependency')
      continue
    }
    const key = JSON.stringify([dependency.sourceTaskId, dependency.targetTaskId])
    if (!pairs.has(key)) pairs.set(key, dependency)
  }
  const uniqueDependencies = [...pairs.values()].sort((a, b) => compareText(a.sourceTaskId, b.sourceTaskId) || compareText(a.targetTaskId, b.targetTaskId) || compareText(a.id, b.id))
  const indegree = new Map(uniqueTasks.map(task => [task.id, 0]))
  const outgoing = new Map<string, string[]>()
  const ranks = new Map(uniqueTasks.map(task => [task.id, 0]))
  for (const dependency of uniqueDependencies) {
    indegree.set(dependency.targetTaskId, indegree.get(dependency.targetTaskId)! + 1)
    const targets = outgoing.get(dependency.sourceTaskId) ?? []
    targets.push(dependency.targetTaskId)
    outgoing.set(dependency.sourceTaskId, targets)
  }
  const queue = uniqueTasks.filter(task => indegree.get(task.id) === 0)
  let visited = 0
  while (queue.length) {
    const task = queue.shift()!
    visited++
    for (const target of outgoing.get(task.id) ?? []) {
      ranks.set(target, Math.max(ranks.get(target)!, ranks.get(task.id)! + 1))
      indegree.set(target, indegree.get(target)! - 1)
      if (indegree.get(target) === 0) {
        queue.push(byId.get(target)!)
        queue.sort(compareTasks)
      }
    }
  }
  if (visited !== uniqueTasks.length) warnings.add('cycle')
  return {
    tasks: uniqueTasks,
    dependencies: uniqueDependencies,
    ranks,
    warnings: [...warnings].sort(compareText),
    eligible: warnings.size === 0,
    topologyKey: JSON.stringify([uniqueTasks.map(task => [task.id, task.createdAt]), uniqueDependencies.map(edge => [edge.sourceTaskId, edge.targetTaskId]), [...warnings].sort(compareText)]),
  }
}

/** Longest-path Kahn ranks with fixed cards. Long edges route entirely above all cards. */
export function layoutWorkflowGraph(graph: NormalizedWorkflowGraph): WorkflowGraphLayout {
  const { cardWidth, cardHeight, columnGap, rowGap, padding } = WORKFLOW_GRAPH
  if (!graph.eligible || graph.tasks.length === 0) return { nodes: [], edges: [], bounds: { width: padding * 2, height: padding * 2 } }
  const skipEdges = graph.dependencies.filter(edge => graph.ranks.get(edge.targetTaskId)! - graph.ranks.get(edge.sourceTaskId)! > 1)
  const gutter = skipEdges.length * 12
  const rows = new Map<number, number>()
  const nodes = graph.tasks.map(task => {
    const rank = graph.ranks.get(task.id)!
    const row = rows.get(rank) ?? 0
    rows.set(rank, row + 1)
    return { id: task.id, rank, row, x: padding + rank * (cardWidth + columnGap), y: padding + gutter + row * (cardHeight + rowGap) }
  })
  const byId = new Map(nodes.map(node => [node.id, node]))
  let skipIndex = 0
  const edges = graph.dependencies.map(edge => {
    const source = byId.get(edge.sourceTaskId)!, target = byId.get(edge.targetTaskId)!
    const start = { x: source.x + cardWidth, y: source.y + cardHeight / 2 }
    const end = { x: target.x, y: target.y + cardHeight / 2 }
    let points: WorkflowPoint[]
    if (target.rank - source.rank > 1) {
      const laneY = padding + skipIndex++ * 12
      points = [start, { x: start.x + 24, y: start.y }, { x: start.x + 24, y: laneY }, { x: end.x - 24, y: laneY }, { x: end.x - 24, y: end.y }, end]
    } else {
      const middleX = (start.x + end.x) / 2
      points = [start, { x: middleX, y: start.y }, { x: middleX, y: end.y }, end]
    }
    return { ...edge, points, path: points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ') }
  })
  return {
    nodes, edges,
    bounds: { width: Math.max(...nodes.map(node => node.x + cardWidth)) + padding, height: Math.max(...nodes.map(node => node.y + cardHeight)) + padding },
  }
}

/** A stale in_progress task is not evidence that an agent is actually executing. */
export function workflowNodeActivity(task: WorkflowTaskNode, activeRuns: readonly WorkflowActiveRun[]): WorkflowNodeActivity {
  if (task.status === 'failed') return 'failed'
  if (task.status === 'blocked') return 'blocked'
  if (task.status === 'done' || task.status === 'cancelled') return 'terminal'
  if (activeRuns.some(run => run.taskId === task.id)) return 'active'
  if (task.status === 'assigned') return 'waiting'
  if (task.status === 'in_progress') return 'unverified'
  return 'idle'
}

export function workflowEdgeState(source: WorkflowTaskNode, target: WorkflowTaskNode, activeRuns: readonly WorkflowActiveRun[]): WorkflowEdgeState {
  if (source.status === 'failed' || source.status === 'blocked' || source.status === 'cancelled' || target.status === 'failed' || target.status === 'blocked' || target.status === 'cancelled') return 'blocked'
  if (source.status === 'done' && workflowNodeActivity(target, activeRuns) === 'active') return 'active'
  if (source.status === 'done') return 'complete'
  return 'idle'
}

/** Focus alone reveals a card at readable zoom; ordinary status redraws never call this. */
export function ensureWorkflowNodeVisible(viewport: WorkflowViewport, node: WorkflowPoint, size: WorkflowBounds): WorkflowViewport {
  if (size.width <= 0 || size.height <= 0) return viewport
  const scale = Math.max(0.6, clampZoom(viewport.scale))
  const width = WORKFLOW_GRAPH.cardWidth * scale
  const height = WORKFLOW_GRAPH.cardHeight * scale
  const left = viewport.x + node.x * scale
  const top = viewport.y + node.y * scale
  const margin = 16
  if (scale === viewport.scale && left >= margin && top >= margin && left + width <= size.width - margin && top + height <= size.height - margin) return viewport
  return {
    x: (size.width - width) / 2 - node.x * scale,
    y: (size.height - height) / 2 - node.y * scale,
    scale,
  }
}

const clampZoom = (scale: number) => Math.max(WORKFLOW_MIN_ZOOM, Math.min(WORKFLOW_MAX_ZOOM, Number.isFinite(scale) ? scale : 1))
export function fitWorkflowViewport(bounds: WorkflowBounds, viewport: WorkflowBounds): WorkflowViewport {
  if (viewport.width <= 0 || viewport.height <= 0 || bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0, scale: 1 }
  const scale = clampZoom(Math.min(viewport.width / bounds.width, viewport.height / bounds.height, 1))
  return { x: (viewport.width - bounds.width * scale) / 2, y: (viewport.height - bounds.height * scale) / 2, scale }
}

/** Keep the world point under the anchor stationary while changing zoom. */
export function zoomWorkflowViewport(viewport: WorkflowViewport, factor: number, anchor: WorkflowPoint): WorkflowViewport {
  const oldScale = clampZoom(viewport.scale)
  const scale = clampZoom(oldScale * (Number.isFinite(factor) && factor > 0 ? factor : 1))
  return { x: anchor.x - (anchor.x - viewport.x) * scale / oldScale, y: anchor.y - (anchor.y - viewport.y) * scale / oldScale, scale }
}
