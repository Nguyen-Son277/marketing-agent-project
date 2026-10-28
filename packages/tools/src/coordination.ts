/**
 * Coordination tools: task creation/assignment and agent-to-agent messaging.
 *
 * These are what make the team a team rather than ten isolated chatbots. The
 * implementation deliberately does NOT live here: the orchestrator owns planning
 * and dispatch, so this file only declares the surface it must implement. That
 * keeps `packages/tools` free of a dependency on `packages/orchestrator` and
 * lets both be tested in isolation.
 */
import { toolError, type AgentRole, type ToolResult } from '@marketing-agent/shared'
import { defineTool, optionalStringArg, optionalStringArrayArg, requireStringArg } from './registry.ts'

/** One planned task a leader agent asks the orchestrator to create. */
export interface PlannedTaskInput {
  readonly title: string
  readonly briefMd: string
  readonly assigneeRole: string
  readonly dependsOnTitles?: readonly string[]
  readonly deliverableSpec?: string | null
  readonly priority?: number
  readonly deadline?: string | null
}

export interface PlannedTaskResult {
  readonly taskId: string
  readonly title: string
  readonly assigneeRole: string
}

/**
 * What the orchestrator must provide for the coordination tools to work.
 * Every method is company-scoped by the caller's identity, never by an argument
 * the model controls.
 */
export interface CoordinationHost {
  /** Create the plan's tasks and dependency edges; returns ids in input order. */
  createTasks(ctx: { companyId: string; conversationId: string | null; actorUserId?: string }, tasks: readonly PlannedTaskInput[]): Promise<PlannedTaskResult[]>
  /** Dispatch one task to its assigned agent and wait for the handoff result. */
  dispatchTask(ctx: { companyId: string; conversationId: string | null; actorUserId?: string }, taskId: string): Promise<{ status: string; resultMd: string; artifactIds: readonly string[] }>
  /** Deliver a peer question and return the peer's answer. */
  askPeer(input: {
    actorUserId?: string
    companyId: string
    conversationId: string | null
    taskId: string | null
    fromRole: string
    toRole: string
    question: string
  }): Promise<{ answer: string; roundsUsed: number; limitReached: boolean }>
  /** Escalate to the leader; the leader decides, the orchestrator records it. */
  escalate(input: {
    companyId: string
    conversationId: string | null
    taskId: string | null
    fromRole: string
    reason: string
    attempts: string
    options?: readonly string[]
  }): Promise<{ acknowledged: boolean; guidance: string }>
  /** Roles that exist and are enabled for this company. */
  availableRoles(companyId: string): readonly AgentRole[]
}

export function createCoordinationTools(host: CoordinationHost) {
  const taskCreate = defineTool({
    name: 'task_create',
    description:
      'Tạo kế hoạch công việc: một danh sách việc, mỗi việc giao cho đúng một chuyên môn, kèm thứ tự phụ thuộc. Chỉ Leader được dùng. Việc không phụ thuộc nhau có thể chạy song song.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'Danh sách công việc, tối đa 8 việc.',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Tên việc, ngắn và cụ thể' },
              briefMd: { type: 'string', description: 'Mô tả việc: cần làm gì, dựa trên dữ liệu nào, đầu ra là gì' },
              assigneeRole: {
                type: 'string',
                description: 'Vai trò chuyên môn nhận việc, ví dụ content-writer, seo-technical, analytics',
              },
              dependsOnTitles: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tên các việc phải xong trước (phải trùng chính xác tiêu đề trong danh sách này)',
              },
              deliverableSpec: { type: 'string', description: 'Đầu ra kiểm chứng được' },
              deadline: { type: 'string', description: 'Hạn YYYY-MM-DD (tuỳ chọn)' },
            },
            required: ['title', 'briefMd', 'assigneeRole'],
          },
        },
      },
      required: ['tasks'],
      additionalProperties: false,
    },
    roles: ['marketing-leader'],
    async handler(args, ctx): Promise<ToolResult> {
      const raw = args['tasks']
      if (!Array.isArray(raw) || raw.length === 0) {
        throw toolError('Cần danh sách "tasks" không rỗng')
      }
      if (raw.length > 8) {
        throw toolError(`Kế hoạch tối đa 8 việc, nhận được ${raw.length}. Hãy gộp các việc nhỏ lại.`)
      }

      const available = new Set<string>(host.availableRoles(ctx.companyId))
      const planned: PlannedTaskInput[] = []
      const seenTitles = new Set<string>()

      for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null) throw toolError('Mỗi công việc phải là một object')
        const record = entry as Record<string, unknown>
        const title = requireStringArg(record, 'title')
        if (seenTitles.has(title)) throw toolError(`Tiêu đề công việc bị trùng: "${title}"`)
        seenTitles.add(title)
        const assigneeRole = requireStringArg(record, 'assigneeRole')
        if (!available.has(assigneeRole)) {
          throw toolError(
            `Không có chuyên môn "${assigneeRole}" đang bật cho công ty này. ` +
              `Các vai trò hợp lệ: ${[...available].join(', ')}`,
          )
        }
        planned.push({
          title,
          briefMd: requireStringArg(record, 'briefMd'),
          assigneeRole,
          dependsOnTitles: readStringList(record['dependsOnTitles']),
          deliverableSpec: optionalStringArg(record, 'deliverableSpec') ?? null,
          deadline: optionalStringArg(record, 'deadline') ?? null,
        })
      }

      // Validate every dependency name resolves before creating anything, so a
      // typo cannot leave a half-created plan behind.
      for (const task of planned) {
        for (const dependency of task.dependsOnTitles ?? []) {
          if (!seenTitles.has(dependency)) {
            throw toolError(
              `Công việc "${task.title}" phụ thuộc "${dependency}" nhưng không có việc nào tên đó trong kế hoạch.`,
            )
          }
          if (dependency === task.title) throw toolError(`Công việc "${task.title}" phụ thuộc chính nó`)
        }
      }
      if (hasCycle(planned)) {
        throw toolError('Kế hoạch có vòng phụ thuộc. Hãy sắp xếp lại để không việc nào phụ thuộc vòng tròn.')
      }

      const created = await host.createTasks(
        { companyId: ctx.companyId, conversationId: ctx.conversationId, actorUserId: ctx.actorUserId },
        planned,
      )
      const lines = created.map((task, index) => {
        const deps = planned[index]?.dependsOnTitles ?? []
        return (
          `${index + 1}. ${task.title} → ${task.assigneeRole}` +
          (deps.length > 0 ? ` (sau: ${deps.join(', ')})` : '') +
          ` [id ${task.taskId}]`
        )
      })
      return {
        content: `Đã tạo ${created.length} công việc:\n${lines.join('\n')}`,
        data: { tasks: created },
      }
    },
  })

  const taskAssign = defineTool({
    name: 'task_assign',
    description:
      'Giao một công việc đã tạo cho agent chuyên môn và chờ kết quả bàn giao. Chỉ Leader được dùng. Chỉ gọi được khi mọi việc phụ thuộc đã xong.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ID công việc, lấy từ kết quả task_create' },
      },
      required: ['taskId'],
      additionalProperties: false,
    },
    roles: ['marketing-leader'],
    async handler(args, ctx): Promise<ToolResult> {
      const taskId = requireStringArg(args, 'taskId')
      const outcome = await host.dispatchTask(
        { companyId: ctx.companyId, conversationId: ctx.conversationId, actorUserId: ctx.actorUserId },
        taskId,
      )
      const artifacts =
        outcome.artifactIds.length > 0 ? `\nTài sản đã tạo: ${outcome.artifactIds.join(', ')}` : ''
      return {
        content: `Công việc ${taskId} kết thúc với trạng thái "${outcome.status}".\n\n${outcome.resultMd}${artifacts}`,
        isError: outcome.status === 'failed',
        data: outcome,
      }
    },
  })

  const agentAsk = defineTool({
    name: 'agent_ask',
    description:
      'Hỏi một agent chuyên môn khác khi cần thông tin họ đang giữ. Dùng thay vì tự suy đoán. Giới hạn 3 vòng hỏi cho mỗi cặp trong một công việc.',
    parameters: {
      type: 'object',
      properties: {
        toRole: { type: 'string', description: 'Vai trò cần hỏi, ví dụ market-research' },
        question: { type: 'string', description: 'Câu hỏi cụ thể, nêu rõ cần dữ liệu gì và dùng làm gì' },
      },
      required: ['toRole', 'question'],
      additionalProperties: false,
    },
    roles: [],
    async handler(args, ctx): Promise<ToolResult> {
      const toRole = requireStringArg(args, 'toRole')
      const question = requireStringArg(args, 'question')
      if (toRole === ctx.agentRole) throw toolError('Không thể tự hỏi chính mình')

      const available = new Set<string>(host.availableRoles(ctx.companyId))
      if (!available.has(toRole)) {
        throw toolError(`Không có chuyên môn "${toRole}" đang bật. Các vai trò hợp lệ: ${[...available].join(', ')}`)
      }

      const outcome = await host.askPeer({
        actorUserId: ctx.actorUserId,
        companyId: ctx.companyId,
        conversationId: ctx.conversationId,
        taskId: ctx.taskId,
        fromRole: ctx.agentRole,
        toRole,
        question,
      })
      if (outcome.limitReached) {
        return {
          content:
            `Đã đạt giới hạn ${outcome.roundsUsed} vòng hỏi giữa bạn và ${toRole} trong công việc này. ` +
            'Hãy dùng thông tin đã có, hoặc báo blocker lên Leader.',
          isError: true,
          data: outcome,
        }
      }
      return {
        content: `${toRole} trả lời:\n\n${outcome.answer}`,
        data: outcome,
      }
    },
  })

  const agentEscalate = defineTool({
    name: 'agent_escalate',
    description:
      'Báo Leader khi bị chặn: thiếu dữ liệu, tool lỗi, hoặc cần quyết định vượt thẩm quyền. Nêu rõ đang thiếu gì, đã thử gì, và ít nhất 2 phương án.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Đang bị chặn bởi điều gì' },
        attempts: { type: 'string', description: 'Đã thử những gì và kết quả ra sao' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Các phương án đề xuất để Leader chọn',
        },
      },
      required: ['reason', 'attempts'],
      additionalProperties: false,
    },
    roles: [],
    async handler(args, ctx): Promise<ToolResult> {
      const reason = requireStringArg(args, 'reason')
      const attempts = requireStringArg(args, 'attempts')
      const options = readStringList(args['options'])
      const outcome = await host.escalate({
        companyId: ctx.companyId,
        conversationId: ctx.conversationId,
        taskId: ctx.taskId,
        fromRole: ctx.agentRole,
        reason,
        attempts,
        options,
      })
      return {
        content: outcome.guidance,
        isError: !outcome.acknowledged,
        data: outcome,
      }
    },
  })

  /**
   * Leader báo một việc không thể tiếp tục, cho NGƯỜI DÙNG.
   *
   * Vì sao Leader không dùng `agent_escalate`: escalation nghĩa là "trình lên cấp
   * trên để xin quyết định", và Leader không có cấp trên. Leader cần một cách nói
   * rõ với người dùng rằng việc đang dừng và cần gì — đó là hành vi khác, nên là
   * công cụ khác. Tách ra cũng khiến log đọc được: ai báo chặn cho ai.
   */
  const blockerReport = defineTool({
    name: 'blocker_report',
    description:
      'Báo cho NGƯỜI DÙNG rằng một phần công việc không thể tiếp tục, kèm lý do và đề xuất. Dùng khi thiếu dữ liệu, thiếu kết nối, hoặc cần người dùng quyết định. Chỉ Leader được dùng.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Vì sao không tiếp tục được' },
        impact: { type: 'string', description: 'Phần nào của mục tiêu bị ảnh hưởng' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Các phương án người dùng có thể chọn',
        },
      },
      required: ['reason'],
      additionalProperties: false,
    },
    roles: ['marketing-leader'],
    async handler(args, ctx): Promise<ToolResult> {
      const reason = requireStringArg(args, 'reason')
      const impact = optionalStringArg(args, 'impact')
      const options = readStringList(args['options'])
      const lines = [`⛔ **Cần bạn quyết định:** ${reason}`]
      if (impact) lines.push('', `Ảnh hưởng: ${impact}`)
      if (options && options.length > 0) {
        lines.push('', 'Phương án đề xuất:', ...options.map((option, index) => `${index + 1}. ${option}`))
      }
      ctx.log('Leader báo chặn cho người dùng', { reason })
      return {
        content: lines.join('\n'),
        data: { reported: true, reason, impact, options },
      }
    },
  })

  return { taskCreate, taskAssign, agentAsk, agentEscalate, blockerReport }
}

function readStringList(value: unknown): string[] | undefined {
  return optionalStringArrayArg({ value }, 'value')
}

/** Depth-first cycle detection over title-keyed dependencies. */
export function hasCycle(tasks: readonly PlannedTaskInput[]): boolean {
  const byTitle = new Map(tasks.map((task) => [task.title, task]))
  const state = new Map<string, 'visiting' | 'done'>()

  const visit = (title: string): boolean => {
    const current = state.get(title)
    if (current === 'visiting') return true
    if (current === 'done') return false
    state.set(title, 'visiting')
    const task = byTitle.get(title)
    for (const dependency of task?.dependsOnTitles ?? []) {
      if (byTitle.has(dependency) && visit(dependency)) return true
    }
    state.set(title, 'done')
    return false
  }

  for (const task of tasks) {
    if (visit(task.title)) return true
  }
  return false
}

/** Topological order over titles; returns undefined when the graph has a cycle. */
export function topologicalOrder(tasks: readonly PlannedTaskInput[]): PlannedTaskInput[] | undefined {
  if (hasCycle(tasks)) return undefined
  const byTitle = new Map(tasks.map((task) => [task.title, task]))
  const emitted = new Set<string>()
  const out: PlannedTaskInput[] = []

  const emit = (title: string): void => {
    if (emitted.has(title)) return
    const task = byTitle.get(title)
    if (!task) return
    for (const dependency of task.dependsOnTitles ?? []) emit(dependency)
    if (!emitted.has(title)) {
      emitted.add(title)
      out.push(task)
    }
  }

  for (const task of tasks) emit(task.title)
  return out
}

/** Highest-priority value seen in a plan, used to order the dispatch queue. */
export function planPriority(tasks: readonly PlannedTaskInput[]): number {
  return tasks.reduce((min, task) => Math.min(min, task.priority ?? 3), 3)
}
