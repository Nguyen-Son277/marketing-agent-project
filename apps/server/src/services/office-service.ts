import {
  notFound,
  vietnamDate,
  OFFICE_ROOMS,
  type AgentOfficeStatus,
  type AgentOfficeState,
  type OfficeCampusStats,
  type OfficeOverviewResponse,
  type OfficeAgentDeskResponse,
  type OfficeRoom,
  type AgentDefRecord,
  type AgentMessageRecord,
  type AgentPresetRecord,
  type AgentPresetToolRecord,
  type AgentSkillRecord,
  type ArtifactRecord,
  type KbAclRecord,
  type TaskRecord,
} from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { getRoomWorkstation } from './office-layout-service.ts'
import { deriveAgentActivity } from './office-activity-service.ts'

export { OFFICE_ROOMS }
export type {
  OfficeRoom,
  AgentOfficeStatus,
  AgentOfficeState,
  OfficeCampusStats,
  OfficeOverviewResponse,
  OfficeAgentDeskResponse,
}

const DEFAULT_ROOM: OfficeRoom = OFFICE_ROOMS[0]!
const ACTIVE_TASK_STATUSES = new Set(['assigned', 'in_progress', 'review', 'blocked'])


function taskForAgent(tasks: readonly TaskRecord[], agentDefId: string): TaskRecord | undefined {
  return tasks
    .filter((task) => task.assigneeAgentDefId === agentDefId && ACTIVE_TASK_STATUSES.has(task.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

/** Assemble the live office map, agent activity and company-wide daily totals. */
export function getOfficeOverview(companyId: string, repos: Repos): OfficeOverviewResponse {
  const defs = repos.team.listAgentDefs()
  const presets = repos.team.listPresets(companyId)
  const presetByDef = new Map(presets.map((preset) => [preset.agentDefId, preset]))
  const tasks = repos.work.listTasks(companyId, { limit: 100 })
  const today = vietnamDate()
  const usage = repos.accounting.dailyUsage(companyId, { from: today, to: today })
  const agents = defs.map((def) => {
    const preset = presetByDef.get(def.id) ?? null
    const room = OFFICE_ROOMS.find((candidate) => candidate.role === def.role || (candidate as OfficeRoom & { department?: string }).department === def.role) ?? DEFAULT_ROOM
    const task = taskForAgent(tasks, def.id)
    const agentUsage = usage.filter((entry) => entry.agentDefId === def.id)
    const completedTasks = tasks.filter((entry) => entry.assigneeAgentDefId === def.id && entry.status === 'done' && entry.updatedAt.slice(0, 10) === today).length
    const activity = deriveAgentActivity(task, preset?.enabled === true)
    const tokens = agentUsage.reduce((sum, item) => sum + item.tokensIn + item.tokensOut, 0)
    const costUsd = agentUsage.reduce((sum, item) => sum + item.costUsd, 0)
    const model = preset?.modelFk ? repos.llm.findModel(preset.modelFk) : null

    return {
      agentDefId: def.id,
      role: def.role,
      department: room.role,
      name: def.name,
      displayName: preset?.displayName || def.name,
      isLeader: def.isLeader,
      enabled: preset?.enabled === true,
      tier: preset?.tier ?? 'standard',
      modelLabel: model?.label ?? null,
      room,
      status: activity.status,
      activityState: activity.activityState,
      screenMode: activity.screenMode,
      currentTaskId: task?.id ?? null,
      currentTaskTitle: task?.title ?? null,
      currentActionVi: activity.currentActionVi,
      currentActionEn: activity.currentActionEn,
      workstation: { ...getRoomWorkstation(def.role), decor: getRoomWorkstation(def.role).decorations },
      activeTools: preset ? repos.team.listPresetTools(preset.id).map((t) => t.toolName) : [],
      preset,
      deskPosition: { x: room.gridX + room.width / 2, y: room.gridY + room.height / 2, z: 0 },
      today: { tokens, costUsd, completedTasks },
      stats: { tasksCompletedToday: completedTasks, tokensUsedToday: tokens, costUsdToday: costUsd },
    }
  })
  const costToday = usage.reduce((sum, item) => sum + item.costUsd, 0)
  const completedToday = agents.reduce((sum, agent) => sum + agent.today.completedTasks, 0)
  const busyCount = agents.filter((agent) => agent.status === 'working' || agent.status === 'reviewing' || agent.status === 'blocked').length
  const enabledCount = agents.filter((agent) => agent.enabled).length

  return {
    campus: {
      width: 1300,
      height: 1100,
      rooms: OFFICE_ROOMS,
    },
    rooms: OFFICE_ROOMS,
    agents,
    stats: {
      totalAgents: agents.length,
      activeAgents: enabledCount,
      enabledAgents: enabledCount,
      busyAgents: busyCount,
      workingAgents: busyCount,
      tasksToday: completedToday,
      tasksCompletedToday: completedToday,
      costUsdToday: costToday,
      totalCostTodayUsd: costToday,
    },
    recentTasks: tasks.slice(0, 10) as unknown as OfficeOverviewResponse['recentTasks'],
  }
}

/** Return one agent's configured desk, grants and recent company activity. */
export function getAgentDeskDetail(companyId: string, role: string, repos: Repos): OfficeAgentDeskResponse {
  const def = repos.team.findAgentDefByRole(role)
  if (!def) throw notFound('Không tìm thấy agent')
  const preset = repos.team.findPreset(companyId, def.id) ?? null
  const relatedTaskIds = new Set(repos.work.listTasks(companyId, { assigneeAgentDefId: def.id, limit: 1000 }).map((task) => task.id))
  const artifacts = repos.work.listArtifacts(companyId, { limit: 1000 })
    .filter((artifact) => artifact.taskId !== null && relatedTaskIds.has(artifact.taskId))
    .slice(0, 5)
  // The repository's default ordering is oldest-first; fetch a bounded recent window,
  // then order it newest-first here before selecting the agent's messages.
  const messages = repos.work.listAgentMessages(companyId, { limit: 1000 })
  const relatedMessages = messages
    .filter((message) => message.fromAgent === def.id || message.toAgent === def.id || message.fromAgent === def.role || message.toAgent === def.role)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)

  const room = OFFICE_ROOMS.find((r) => r.role === def.role) ?? DEFAULT_ROOM
  const tasks = repos.work.listTasks(companyId, { limit: 100 })
  const task = taskForAgent(tasks, def.id)
  const activity = deriveAgentActivity(task, preset?.enabled === true)
  const today = vietnamDate()
  const usage = repos.accounting.dailyUsage(companyId, { from: today, to: today })
  const agentUsage = usage.filter((entry) => entry.agentDefId === def.id)
  const completedTasks = tasks.filter((entry) => entry.assigneeAgentDefId === def.id && entry.status === 'done' && entry.updatedAt.slice(0, 10) === today).length
  const tokens = agentUsage.reduce((sum, item) => sum + item.tokensIn + item.tokensOut, 0)
  const costUsd = agentUsage.reduce((sum, item) => sum + item.costUsd, 0)
  const model = preset?.modelFk ? repos.llm.findModel(preset.modelFk) : null
  const presetTools = preset ? repos.team.listPresetTools(preset.id) : []
  const presetSkills = preset ? repos.team.listSkillsForPreset(preset.id) : []
  const knowledgeAccess = repos.team.listKnowledgeAcl(companyId, def.id)
  const tools = presetTools.map((t) => t.toolName)
  const skills = presetSkills.map((s) => ({ name: s.name, description: s.description, category: s.category }))
  const knowledge = knowledgeAccess.map((acl) => ({ category: acl.category, canRead: Boolean(acl.canRead), canWrite: Boolean(acl.canWrite) }))

  const agentState: AgentOfficeState & { id: string } = {
    id: def.id,
    agentDefId: def.id,
    role: def.role,
    department: room.role,
    name: def.name,
    displayName: preset?.displayName || def.name,
    isLeader: def.isLeader,
    enabled: preset?.enabled === true,
    tier: preset?.tier ?? 'standard',
    modelLabel: model?.label ?? null,
    status: activity.status,
    activityState: activity.activityState,
    screenMode: activity.screenMode,
    currentTaskId: task?.id ?? null,
    currentTaskTitle: task?.title ?? null,
    currentActionVi: activity.currentActionVi,
    currentActionEn: activity.currentActionEn,
    deskPosition: { x: room.gridX + room.width / 2, y: room.gridY + room.height / 2, z: 0 },
    workstation: { ...getRoomWorkstation(def.role), decor: getRoomWorkstation(def.role).decorations },
    today: { tokens, costUsd, completedTasks },
    stats: { tasksCompletedToday: completedTasks, tokensUsedToday: tokens, costUsdToday: costUsd },
    activeTools: tools,
  }

  return {
    agent: agentState as any,
    workstation: { ...getRoomWorkstation(def.role), decor: getRoomWorkstation(def.role).decorations },
    preset,
    tools: presetTools,
    skills: presetSkills,
    knowledgeAccess,
    artifacts,
    messages: relatedMessages,
    ...( {
      recentArtifacts: artifacts.map((a) => ({ id: a.id, taskId: a.taskId, name: a.name, kind: a.kind, createdAt: a.createdAt })),
      recentMessages: relatedMessages.map((m) => ({ id: m.id, fromAgent: m.fromAgent, toAgent: m.toAgent, contentMd: m.contentMd, createdAt: m.createdAt })),
      knowledge,
    } as any),
  }
}


export {
  dispatchOfficeTask,
  listOfficeTasks,
  pingAgentDesk,
} from './office-dispatch-service.ts'

