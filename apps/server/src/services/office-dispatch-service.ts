import type { Repos } from '@marketing-agent/db'
import { TASK_STATUSES, notFound, type TaskRecord, type TaskStatus } from '@marketing-agent/shared'

/** Input accepted when assigning a new task from the 3D office. */
export interface OfficeDispatchTaskInput {
  readonly assigneeRole: string
  readonly title: string
  readonly briefMd: string
  readonly priority?: number
  readonly deadline?: string | null
}

/** A compact snapshot of an agent's most recently updated office task. */
export interface OfficeAgentState {
  readonly status: TaskStatus | 'idle'
  readonly taskId: string | null
  readonly updatedAt: string | null
}

export interface OfficeDispatchTaskResponse {
  readonly task: TaskRecord
  readonly agentState: OfficeAgentState
}

export interface OfficeTasksResponse {
  readonly tasks: readonly TaskRecord[]
  readonly counts: Readonly<Record<TaskStatus, number>>
}

export interface OfficeDeskPingResponse {
  readonly role: string
  readonly agentName: string
  readonly message: string
}

/** Minimal event-bus contract keeps this service independent of the server context. */
export interface OfficeEventBus {
  publish(event: {
    readonly type: string
    readonly companyId: string
    readonly at: string
    readonly payload: unknown
  }): void
}

function latestAgentState(companyId: string, agentDefId: string, repos: Repos): OfficeAgentState {
  const recentTask = repos.work
    .listTasks(companyId, { assigneeAgentDefId: agentDefId, limit: 200 })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]

  return recentTask
    ? { status: recentTask.status, taskId: recentTask.id, updatedAt: recentTask.updatedAt }
    : { status: 'idle', taskId: null, updatedAt: null }
}

export async function dispatchOfficeTask(
  optionsOrCompanyId:
    | {
        companyId: string
        actorUserId?: string
        input: OfficeDispatchTaskInput
        repos: Repos
        events?: OfficeEventBus
      }
    | string,
  maybeInput?: OfficeDispatchTaskInput,
  maybeRepos?: Repos,
  maybeEvents?: OfficeEventBus,
): Promise<OfficeDispatchTaskResponse> {
  const options =
    typeof optionsOrCompanyId === 'string'
      ? {
          companyId: optionsOrCompanyId,
          input: maybeInput!,
          repos: maybeRepos!,
          events: maybeEvents,
        }
      : optionsOrCompanyId

  const { companyId, actorUserId, input, repos, events } = options
  const def = repos.team.findAgentDefByRole(input.assigneeRole)
  if (!def) throw notFound('Không tìm thấy vai trò agent')

  const task = repos.work.createTask({
    companyId,
    title: input.title,
    briefMd: input.briefMd,
    priority: input.priority ?? 5,
    status: 'assigned',
    assigneeAgentDefId: def.id,
    deadline: input.deadline ?? null,
  })

  repos.accounting.audit({
    companyId,
    userId: actorUserId,
    action: 'office.task_dispatched',
    target: task.id,
    payload: { role: input.assigneeRole, title: input.title },
  })

  events?.publish({
    type: 'office.task_dispatched',
    companyId,
    at: new Date().toISOString(),
    payload: { taskId: task.id, role: input.assigneeRole, title: input.title },
  })

  return { task, agentState: latestAgentState(companyId, def.id, repos) }
}


export function listOfficeTasks(
  companyId: string,
  filter: { role?: string; status?: string },
  repos: Repos,
): OfficeTasksResponse {
  let tasks = repos.work.listTasks(companyId, { limit: 200 })

  if (filter.role) {
    const def = repos.team.findAgentDefByRole(filter.role)
    tasks = def ? tasks.filter((task) => task.assigneeAgentDefId === def.id) : []
  }

  if (filter.status) tasks = tasks.filter((task) => task.status === filter.status)

  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])) as Record<TaskStatus, number>
  for (const task of tasks) counts[task.status] += 1

  return { tasks, counts }
}

export interface OfficeDeskPingInput {
  readonly message?: string
}

export function pingAgentDesk(
  optionsOrCompanyId:
    | {
        companyId: string
        actorUserId?: string
        role: string
        input?: OfficeDeskPingInput
        /** Backwards-compatible shorthand for input.message. */
        message?: string
        repos: Repos
        events?: OfficeEventBus
      }
    | string,
  maybeRole?: string,
  maybeInput?: OfficeDeskPingInput,
  maybeRepos?: Repos,
  maybeEvents?: OfficeEventBus,
): OfficeDeskPingResponse {
  const options =
    typeof optionsOrCompanyId === 'string'
      ? {
          companyId: optionsOrCompanyId,
          role: maybeRole!,
          input: maybeInput,
          repos: maybeRepos!,
          events: maybeEvents,
        }
      : optionsOrCompanyId
  const { companyId, role, repos, events } = options
  const inputMessage = options.input?.message ?? options.message

  const def = repos.team.findAgentDefByRole(role)
  if (!def) throw notFound('Không tìm thấy vai trò agent')

  const roleMessages: Readonly<Record<string, string>> = {
    'content-writer': 'đang trau chuốt nội dung để bài viết vừa cuốn hút vừa đúng giọng thương hiệu',
    'paid-media': 'đang tối ưu ROAS và phân bổ ngân sách quảng cáo hiệu quả hơn',
    'marketing-leader': 'đang điều hành chiến lược marketing và phối hợp các nhóm',
    'seo-technical': 'đang kiểm tra index, khả năng thu thập dữ liệu và sức khỏe kỹ thuật SEO',
    'web-technical': 'đang kiểm tra cấu hình website, mã tracking và hạ tầng kỹ thuật',
    'social-media': 'đang lên kế hoạch nội dung và tương tác trên các kênh xã hội',
    'analytics': 'đang phân tích dữ liệu để tìm ra insight và cơ hội tăng trưởng',
    'market-research': 'đang nghiên cứu thị trường, khách hàng và đối thủ cạnh tranh',
    'design-video': 'đang hoàn thiện ý tưởng hình ảnh và video cho chiến dịch',
    'email-crm': 'đang tối ưu hành trình email và hiệu quả chuyển đổi',
    'community-care': 'đang chuẩn bị hỗ trợ khách hàng nhanh chóng và chu đáo',
    'email-marketing': 'đang tối ưu hành trình email và hiệu quả chuyển đổi',
    'customer-support': 'đang chuẩn bị hỗ trợ khách hàng nhanh chóng và chu đáo',
  }
  const activity = roleMessages[role] ?? 'đang tập trung xử lý công việc chuyên môn'
  const message = `${def.name} đã nhận tín hiệu và ${activity}.${inputMessage ? ` Ghi chú của bạn: ${inputMessage}` : ''}`

  repos.accounting.audit({
    companyId,
    userId: options.actorUserId,
    action: 'office.desk_ping',
    target: role,
    payload: { meta: { message: inputMessage } },
  })

  events?.publish({
    type: 'office.agent_pinged',
    companyId,
    at: new Date().toISOString(),
    payload: { role, agentName: def.name, message },
  })

  return { role, agentName: def.name, message }
}
