/**
 * `ConversationOrchestrator` — bộ điều phối một phiên làm việc.
 *
 * Vai trò: điểm vào duy nhất cho mọi thao tác nghiệp vụ của một cuộc trao đổi. Nó
 * giữ state machine của phiên, thi hành BriefGate, gọi Planner/Dispatcher/Review/
 * Reporter, và không để lộ chi tiết nào của các tầng đó ra ngoài.
 *
 * Vì sao gom vào một lớp: server chỉ cần biết bốn thao tác (gửi tin, lập kế hoạch,
 * chạy kế hoạch, viết báo cáo). Nếu để server tự ghép các bước, mọi thay đổi quy
 * trình — thêm một cổng kiểm tra chẳng hạn — sẽ phải sửa ở tầng HTTP.
 */
import { budgetExceeded, conflict, notFound, type AgentRole } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import type { AgentRuntimeDeps } from '@marketing-agent/agent-runtime'
import type { EmbeddingProvider } from '@marketing-agent/kb'
import type { CoordinationHost, PlannedTaskInput, ToolRegistry } from '@marketing-agent/tools'
import { runAgentForTask } from './agent-runner.ts'
import { dispatchPlan } from './dispatcher.ts'
import { event, type AppEvent } from './events.ts'
import {
  checkBrief,
  clarifyingQuestions,
  parseBrief,
  validatePlan,
  type RawPlan,
} from './planner.ts'
import { composeReport, persistReport } from './reporter.ts'
import { reviewOutcomes } from './review.ts'
import {
  BRIEF_FIELD_LABELS,
  DEFAULT_LIMITS,
  type Brief,
  type DispatchSummary,
  type LeaderTurnResult,
  type OrchestratorDeps,
  type OrchestratorLimits,
  type PlanResult,
  type ReportResult,
  type ReviewDecision,
} from './types.ts'

export interface SendMessageInput {
  readonly companyId: string
  readonly conversationId: string
  readonly userId: string
  readonly content: string
  /** Khi true, Leader lập kế hoạch ngay nếu brief đã đủ. */
  readonly autoPlan?: boolean
}

export interface PlanInput {
  readonly companyId: string
  readonly conversationId: string
}

export class ConversationOrchestrator implements CoordinationHost {
  readonly repos: Repos
  private readonly tools: ToolRegistry
  private readonly embedding: EmbeddingProvider | undefined
  private readonly limits: OrchestratorLimits
  private readonly publish: ((event: AppEvent) => void) | undefined
  private readonly log: ((message: string, data?: unknown) => void) | undefined
  private readonly runtimeOverrides: Partial<AgentRuntimeDeps> | undefined

  constructor(deps: OrchestratorDeps) {
    this.repos = deps.repos
    this.tools = deps.tools
    this.embedding = deps.embedding
    this.limits = { ...DEFAULT_LIMITS, ...(deps.limits ?? {}) }
    this.publish = deps.publish
    this.log = deps.log
    this.runtimeOverrides = deps.runtimeOverrides
  }

  /* ------------------------------------------------------------ public API */

  /**
   * Một lượt trao đổi với người dùng.
   *
   * Luôn trả lời — kể cả khi brief còn thiếu, và khi đó hỏi đúng trường còn thiếu.
   * Không bao giờ ném lỗi vì thiếu thông tin: thiếu thông tin là trạng thái bình
   * thường của một cuộc trao đổi, không phải ngoại lệ.
   */
  async sendMessage(input: SendMessageInput): Promise<LeaderTurnResult> {
    const conversation = this.requireConversation(input.companyId, input.conversationId)
    this.assertBudget(input.companyId)

    this.repos.work.addMessage({
      conversationId: conversation.id,
      companyId: input.companyId,
      role: 'user',
      authorKind: 'user',
      contentMd: input.content,
    })

    const brief = parseBrief(conversation.briefJson)
    const check = checkBrief(brief)
    this.publish?.(event('leader.thinking', input.companyId, { conversationId: conversation.id }))

    // Chưa đủ brief: hỏi lại. Đây là hành vi rẻ nhất và đúng nhất.
    if (!check.complete) {
      const questions = clarifyingQuestions(check.missing)
      const reply = [
        'Trước khi lập kế hoạch, tôi cần chốt thêm vài điểm để đội làm đúng việc:',
        '',
        ...questions.map((q, index) => `${index + 1}. ${q}`),
        '',
        `_Còn thiếu: ${check.missing.map((field) => BRIEF_FIELD_LABELS[field]).join(' · ')}_`,
      ].join('\n')

      this.repos.work.addMessage({
        conversationId: conversation.id,
        companyId: input.companyId,
        role: 'assistant',
        authorKind: 'leader',
        authorAgent: 'marketing-leader',
        contentMd: reply,
        meta: { missingFields: check.missing },
      })
      this.repos.work.updateConversation(conversation.id, input.companyId, { phase: 'clarify' })
      this.publish?.(event('brief.updated', input.companyId, { conversationId: conversation.id, missing: check.missing }))

      return {
        reply,
        phase: 'clarify',
        briefComplete: false,
        missingFields: check.missing,
        runId: null,
        costUsd: 0,
      }
    }

    // Đã đủ brief: ghi lại brief và để Leader quyết định bước tiếp theo.
    const merged = mergeBrief(brief, input.content)
    this.repos.work.updateConversation(conversation.id, input.companyId, { phase: 'brief', brief: merged })
    this.publish?.(event('brief.updated', input.companyId, { conversationId: conversation.id, complete: true }))

    const turn = await this.runLeaderTurn(input.companyId, conversation.id, 'plan-request')
    const reply = turn.output.trim()

    this.repos.work.addMessage({
      conversationId: conversation.id,
      companyId: input.companyId,
      role: 'assistant',
      authorKind: 'leader',
      authorAgent: 'marketing-leader',
      contentMd: reply.length > 0 ? reply : 'Đã ghi nhận yêu cầu. Tôi sẽ lập kế hoạch và trình bạn duyệt.',
    })
    this.repos.work.updateConversation(conversation.id, input.companyId, { phase: 'plan' })
    this.publish?.(event('leader.replied', input.companyId, { conversationId: conversation.id }))

    return {
      reply: reply.length > 0 ? reply : 'Đã ghi nhận yêu cầu. Tôi sẽ lập kế hoạch và trình bạn duyệt.',
      phase: 'brief',
      briefComplete: true,
      missingFields: [],
      runId: turn.runId,
      costUsd: turn.costUsd,
    }
  }

  /** Lập kế hoạch từ brief đã chốt. Trả lỗi rõ ràng nếu brief còn thiếu. */
  async plan(input: PlanInput): Promise<PlanResult> {
    const conversation = this.requireConversation(input.companyId, input.conversationId)
    const brief = parseBrief(conversation.briefJson)
    const check = checkBrief(brief)
    if (!check.complete || !brief) {
      throw conflict(
        `Chưa chốt đủ thông tin để lập kế hoạch. Còn thiếu: ${check.missing
          .map((field) => BRIEF_FIELD_LABELS[field])
          .join(', ')}`,
      )
    }

    const turn = await this.runLeaderTurn(input.companyId, conversation.id, 'create-plan')
    const rows = parsePlanTable(turn.output)
    if (rows.length === 0) {
      throw conflict(
        'Không đọc được kế hoạch dạng bảng từ câu trả lời của Leader. ' +
          'Hãy yêu cầu Leader trình bày lại theo bảng: Công việc | Chuyên môn | Phụ thuộc | Đầu ra.',
      )
    }
    const plan = validatePlan({
      plan: {
        tasks: rows.map((row) => ({
          title: row.title,
          briefMd: row.deliverable.length > 0 ? `${row.title}. Đầu ra: ${row.deliverable}` : row.title,
          assigneeRole: row.assigneeRole,
          dependsOnTitles: row.dependsOn,
        })),
      },
      availableRoles: this.availableRoles(input.companyId),
    })

    // Ghi kế hoạch vào cơ sở dữ liệu, gồm cả cạnh phụ thuộc. Dùng chính văn bản
    // Leader đã viết làm brief của việc, thay vì đọc lại từ một chỗ lưu tạm.
    const created = await this.createTasks(
      { companyId: input.companyId, conversationId: conversation.id },
      rows.map((row) => ({
        title: row.title,
        briefMd: row.deliverable.length > 0 ? `${row.title}. Đầu ra: ${row.deliverable}` : row.title,
        assigneeRole: row.assigneeRole,
        dependsOnTitles: row.dependsOn,
      })),
    )

    this.repos.work.updateConversation(conversation.id, input.companyId, { phase: 'assign' })
    this.publish?.(
      event('plan.created', input.companyId, {
        conversationId: conversation.id,
        tasks: created,
      }),
    )
    return plan
  }

  /** Thi hành kế hoạch đã tạo. */
  async runPlan(input: PlanInput): Promise<{ summary: DispatchSummary; review: ReviewDecision }> {
    const conversation = this.requireConversation(input.companyId, input.conversationId)
    const tasks = this.repos.work.listTasks(input.companyId, { conversationId: conversation.id, limit: 200 })
    if (tasks.length === 0) {
      throw conflict('Chưa có kế hoạch nào để chạy. Hãy lập kế hoạch trước.')
    }

    this.repos.work.updateConversation(conversation.id, input.companyId, { phase: 'execute' })

    const dependencies = this.repos.work.listDependencies(
      input.companyId,
      tasks.map((task) => task.id),
    )
    const titleById = new Map(tasks.map((task) => [task.id, task.title]))
    const roleByDefId = new Map(this.repos.team.listAgentDefs().map((def) => [def.id, def.role]))

    const plan: PlanResult = {
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        assigneeRole: (task.assigneeAgentDefId && roleByDefId.get(task.assigneeAgentDefId)) || 'marketing-leader',
        dependsOn: dependencies
          .filter((dep) => dep.taskId === task.id)
          .map((dep) => titleById.get(dep.dependsOnTaskId) ?? '')
          .filter((title) => title.length > 0),
      })),
      order: tasks.map((task) => task.title),
    }

    const summary = await dispatchPlan({
      repos: this.repos,
      tools: this.tools,
      embedding: this.embedding,
      runtimeOverrides: this.runtimeOverrides,
      companyId: input.companyId,
      conversationId: conversation.id,
      plan,
      limits: this.limits,
      publish: this.publish,
      log: this.log,
    })

    this.repos.work.updateConversation(conversation.id, input.companyId, { phase: 'review' })
    const brief = parseBrief(conversation.briefJson)
    const review = await reviewOutcomes({
      repos: this.repos,
      tools: this.tools,
      embedding: this.embedding,
      runtimeOverrides: this.runtimeOverrides,
      companyId: input.companyId,
      conversationId: conversation.id,
      brief: brief ? formatBrief(brief) : conversation.title,
      summary,
      limits: this.limits,
      ...(this.log ? { log: this.log } : {}),
    })

    this.publish?.(
      event('review.completed', input.companyId, {
        conversationId: conversation.id,
        verdict: review.verdict,
        issues: review.issues,
      }),
    )
    return { summary, review }
  }

  /** Viết và lưu báo cáo cuối cùng. */
  async report(input: {
    companyId: string
    conversationId: string
    title?: string
    summary: DispatchSummary
    review: ReviewDecision
  }): Promise<ReportResult> {
    const conversation = this.requireConversation(input.companyId, input.conversationId)
    const brief = parseBrief(conversation.briefJson)
    const costUsd = this.repos.accounting.summaryForConversation(input.companyId, conversation.id).costUsd

    const reportInput = {
      repos: this.repos,
      companyId: input.companyId,
      conversationId: conversation.id,
      title: input.title ?? conversation.title,
      brief: brief ? formatBrief(brief) : conversation.title,
      summary: input.summary,
      review: input.review,
      costUsd,
    }
    const markdown = composeReport(reportInput)
    const result = persistReport(reportInput, markdown)

    this.repos.work.addMessage({
      conversationId: conversation.id,
      companyId: input.companyId,
      role: 'assistant',
      authorKind: 'leader',
      authorAgent: 'marketing-leader',
      contentMd: markdown,
      meta: { artifactId: result.artifactId, kind: 'final-report' },
      costUsd,
    })
    this.repos.work.updateConversation(conversation.id, input.companyId, { phase: 'report' })
    this.publish?.(
      event('report.created', input.companyId, {
        conversationId: conversation.id,
        artifactId: result.artifactId,
        costUsd,
      }),
    )
    return result
  }

  /* ------------------------------------------------- CoordinationHost impl */

  /**
   * Tạo task từ kế hoạch, gồm cả cạnh phụ thuộc. Chạy trong một transaction để
   * một kế hoạch nửa vời không bao giờ trở thành trạng thái nhìn thấy được.
   */
  async createTasks(
    ctx: { companyId: string; conversationId: string | null },
    tasks: readonly PlannedTaskInput[],
  ): Promise<{ taskId: string; title: string; assigneeRole: string }[]> {
    const roles = this.availableRoles(ctx.companyId)
    const checked = validatePlan({
      plan: { tasks },
      availableRoles: roles,
      maxTasks: 8,
    })

    return this.repos.db.tx(() => {
      const idByTitle = new Map<string, string>()
      const created: { taskId: string; title: string; assigneeRole: string }[] = []

      for (const task of checked.tasks) {
        const def = this.repos.team.findAgentDefByRole(task.assigneeRole)
        if (!def) throw notFound(`Không có chuyên môn ${task.assigneeRole}`)
        const record = this.repos.work.createTask({
          companyId: ctx.companyId,
          conversationId: ctx.conversationId,
          title: task.title,
          briefMd: String(tasks.find((t) => t.title === task.title)?.briefMd ?? task.title),
          assigneeAgentDefId: def.id,
          status: 'assigned',
        })
        idByTitle.set(task.title, record.id)
        created.push({ taskId: record.id, title: task.title, assigneeRole: task.assigneeRole })
        this.repos.work.addTaskEvent(record.id, ctx.companyId, 'created', { assigneeRole: task.assigneeRole })
      }

      for (const task of checked.tasks) {
        const taskId = idByTitle.get(task.title)
        if (!taskId) continue
        for (const dependency of task.dependsOn) {
          const dependencyId = idByTitle.get(dependency)
          if (dependencyId) this.repos.work.addDependency(taskId, dependencyId)
        }
      }

      return created
    })
  }

  async dispatchTask(
    ctx: { companyId: string; conversationId: string | null },
    taskId: string,
  ): Promise<{ status: string; resultMd: string; artifactIds: readonly string[] }> {
    const task = this.repos.work.findTask(taskId, ctx.companyId)
    if (!task) throw notFound('Không tìm thấy công việc')
    const def = task.assigneeAgentDefId ? this.repos.team.findAgentDef(task.assigneeAgentDefId) : undefined
    const role = def?.role ?? 'marketing-leader'

    const result = await runAgentForTask({
      repos: this.repos,
      tools: this.tools,
      embedding: this.embedding,
      runtimeOverrides: this.runtimeOverrides,
      companyId: ctx.companyId,
      role,
      taskId,
      conversationId: ctx.conversationId,
      taskBrief: `${task.title}\n\n${task.briefMd}`,
      maxSteps: this.limits.maxStepsPerRun,
      ...(this.log ? { log: this.log } : {}),
    })

    const artifactIds = this.repos.work
      .listArtifacts(ctx.companyId, { taskId, limit: 50 })
      .map((artifact) => artifact.id)
    const status =
      result.run.status === 'succeeded' ? 'done' : result.run.status === 'budget_exceeded' ? 'blocked' : 'failed'
    return { status, resultMd: result.run.output, artifactIds }
  }

  /**
   * Hỏi một chuyên môn khác. Giới hạn số vòng để hai agent lịch sự không hỏi qua
   * lại mãi: quá giới hạn thì trả về tín hiệu để agent tự báo blocker.
   */
  async askPeer(input: {
    companyId: string
    conversationId: string | null
    taskId: string | null
    fromRole: string
    toRole: string
    question: string
  }): Promise<{ answer: string; roundsUsed: number; limitReached: boolean }> {
    const roundsUsed = input.taskId
      ? this.repos.work.countPeerRounds(input.taskId, input.fromRole, input.toRole) + 1
      : 1

    if (roundsUsed > this.limits.maxPeerRounds) {
      return {
        answer: '',
        roundsUsed: roundsUsed - 1,
        limitReached: true,
      }
    }

    this.repos.work.addAgentMessage({
      companyId: input.companyId,
      fromAgent: input.fromRole,
      toAgent: input.toRole,
      taskId: input.taskId,
      kind: 'request',
      contentMd: input.question,
    })
    this.publish?.(
      event('agent.message', input.companyId, {
        from: input.fromRole,
        to: input.toRole,
        kind: 'request',
        taskId: input.taskId,
      }),
    )

    // Lượt chạy ngắn, không giao việc: chỉ trả lời câu hỏi.
    const peer = await runAgentForTask({
      repos: this.repos,
      tools: this.tools,
      embedding: this.embedding,
      runtimeOverrides: this.runtimeOverrides,
      companyId: input.companyId,
      role: input.toRole as never,
      taskId: input.taskId,
      conversationId: input.conversationId,
      taskBrief: [
        `Chuyên môn ${input.fromRole} đang cần thông tin từ bạn để hoàn thành công việc của họ.`,
        '',
        '## Câu hỏi',
        input.question,
        '',
        'Trả lời trực tiếp, ngắn gọn, kèm nguồn nếu có số liệu. Nếu bạn không có thông tin, nói rõ là không có.',
      ].join('\n'),
      maxSteps: 3,
      ...(this.log ? { log: this.log } : {}),
    })

    const answer = peer.run.output.trim() || 'Không có thông tin để trả lời.'
    this.repos.work.addAgentMessage({
      companyId: input.companyId,
      fromAgent: input.toRole,
      toAgent: input.fromRole,
      taskId: input.taskId,
      kind: 'reply',
      contentMd: answer,
    })
    this.publish?.(
      event('agent.message', input.companyId, {
        from: input.toRole,
        to: input.fromRole,
        kind: 'reply',
        taskId: input.taskId,
      }),
    )
    return { answer, roundsUsed, limitReached: false }
  }

  async escalate(input: {
    companyId: string
    conversationId: string | null
    taskId: string | null
    fromRole: string
    reason: string
    attempts: string
    options?: readonly string[]
  }): Promise<{ acknowledged: boolean; guidance: string }> {
    const content = [
      `Bị chặn: ${input.reason}`,
      '',
      `Đã thử: ${input.attempts}`,
    ]
    if (input.options && input.options.length > 0) {
      content.push('', 'Phương án đề xuất:', ...input.options.map((option, index) => `${index + 1}. ${option}`))
    }

    this.repos.work.addAgentMessage({
      companyId: input.companyId,
      fromAgent: input.fromRole,
      toAgent: 'marketing-leader',
      taskId: input.taskId,
      kind: 'blocker',
      contentMd: content.join('\n'),
    })
    if (input.taskId) {
      this.repos.work.updateTask(input.taskId, input.companyId, { status: 'blocked', resultMd: content.join('\n') })
      this.repos.work.addTaskEvent(input.taskId, input.companyId, 'escalated', { reason: input.reason })
    }
    this.publish?.(
      event('agent.message', input.companyId, {
        from: input.fromRole,
        to: 'marketing-leader',
        kind: 'blocker',
        taskId: input.taskId,
      }),
    )

    return {
      acknowledged: true,
      guidance:
        'Đã ghi nhận và chuyển cho Leader. Dừng công việc hiện tại và chờ hướng dẫn mới; ' +
        'không tự suy diễn phần còn thiếu.',
    }
  }

  availableRoles(companyId: string): readonly AgentRole[] {
    return this.repos.team
      .listAgentDefs()
      .filter((def) => {
        const preset = this.repos.team.findPreset(companyId, def.id)
        return preset?.enabled === true
      })
      .map((def) => def.role)
  }

  /* ------------------------------------------------------------- internals */

  private requireConversation(companyId: string, conversationId: string) {
    const conversation = this.repos.work.findConversation(conversationId, companyId)
    if (!conversation) throw notFound('Không tìm thấy cuộc trao đổi')
    return conversation
  }

  /** Chặn trước khi tốn token: vượt trần ngày thì không bắt đầu việc mới. */
  private assertBudget(companyId: string): void {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const usage = this.repos.accounting.usageSince(companyId, since)
    if (usage.costUsd >= this.limits.dailyCostUsd) {
      throw budgetExceeded(
        `Đã đạt trần chi phí ${this.limits.dailyCostUsd} USD trong 24 giờ qua (đã dùng ${usage.costUsd.toFixed(4)} USD). ` +
          'Hãy tăng trần trong Cài đặt hoặc chờ chu kỳ tiếp theo.',
        { used: usage.costUsd, limit: this.limits.dailyCostUsd },
      )
    }
  }

  /** Một lượt chạy của Leader với vai trò điều hành. */
  private async runLeaderTurn(
    companyId: string,
    conversationId: string,
    mode: 'plan-request' | 'create-plan',
  ): Promise<{ output: string; runId: string | null; costUsd: number }> {
    const conversation = this.repos.work.findConversation(conversationId, companyId)
    if (!conversation) throw notFound('Không tìm thấy cuộc trao đổi')
    const brief = parseBrief(conversation.briefJson)
    const history = this.repos.work.listMessages(conversationId, companyId, 40)

    const historyText = history
      .slice(-12)
      .map((message) => `${message.authorKind === 'user' ? 'Người dùng' : 'Leader'}: ${message.contentMd}`)
      .join('\n\n')

    const instruction =
      mode === 'create-plan'
        ? [
            'Lập kế hoạch công việc cho mục tiêu dưới đây.',
            '',
            'Yêu cầu bắt buộc:',
            '- Tối đa 8 việc; mỗi việc giao cho MỘT chuyên môn.',
            '- Nêu rõ đầu ra kiểm chứng được của từng việc.',
            '- Nêu thứ tự phụ thuộc thật (việc nào phải xong trước).',
            '- Trình bày kế hoạch dưới dạng bảng: Công việc | Chuyên môn | Phụ thuộc | Đầu ra.',
            '- Sau bảng, nêu ngắn gọn vì sao kế hoạch này đạt được mục tiêu.',
          ].join('\n')
        : [
            'Người dùng vừa cung cấp bối cảnh cho một yêu cầu marketing.',
            'Hãy xác nhận bạn đã hiểu đúng mục tiêu và tóm tắt lại trong 3–5 dòng:',
            '- Mục tiêu và KPI',
            '- Phạm vi (làm và không làm)',
            '- Cách tiếp cận đề xuất ở mức cao',
            'Kết thúc bằng câu hỏi duy nhất: người dùng có muốn bạn lập kế hoạch chi tiết không.',
            'Không lập bảng kế hoạch ở bước này.',
          ].join('\n')

    const result = await runAgentForTask({
      repos: this.repos,
      tools: this.tools,
      embedding: this.embedding,
      runtimeOverrides: this.runtimeOverrides,
      companyId,
      role: 'marketing-leader',
      taskId: null,
      conversationId,
      maxSteps: mode === 'create-plan' ? 6 : 4,
      taskBrief: [
        instruction,
        '',
        '## Brief đã chốt',
        brief ? formatBrief(brief) : '(chưa có)',
        '',
        '## Diễn biến gần đây',
        historyText,
      ].join('\n'),
      ...(this.log ? { log: this.log } : {}),
    })

    return {
      output: result.run.output,
      runId: result.run.runId,
      costUsd: result.run.usage.costUsd,
    }
  }

}

export interface PlanRow {
  readonly title: string
  readonly assigneeRole: string
  readonly dependsOn: readonly string[]
  readonly deliverable: string
}

/**
 * Đọc bảng kế hoạch từ Markdown.
 *
 * Chấp nhận cả tiêu đề tiếng Việt và tiếng Anh, và chấp nhận nhiều dạng phân tách
 * phụ thuộc (dấu phẩy, dấu chấm phẩy, hoặc "không"). Mục tiêu là đọc được kế hoạch
 * thật thay vì bắt model khớp một định dạng duy nhất.
 */
export function parsePlanTable(markdown: string): PlanRow[] {
  const lines = markdown.split('\n')
  const rows: PlanRow[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (cells.length < 2) continue
    // Bỏ dòng phân cách và dòng tiêu đề.
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue
    const first = cells[0] ?? ''
    if (/^(công việc|task|hạng mục|việc)$/i.test(first)) continue

    const title = stripMarkdown(first)
    if (title.length === 0) continue
    const assigneeRole = normalizeRole(cells[1] ?? '')
    if (assigneeRole.length === 0) continue
    rows.push({
      title,
      assigneeRole,
      dependsOn: parseDependencies(cells[2] ?? ''),
      deliverable: stripMarkdown(cells[3] ?? ''),
    })
  }
  return rows
}

/** Bỏ định dạng Markdown trong ô bảng để tiêu đề dùng được làm khoá. */
export function stripMarkdown(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\d+[.)]\s*/, '')
    .trim()
}

/** Chuẩn hoá tên vai trò: bỏ khoảng trắng, hạ chữ, đổi khoảng trắng thành gạch. */
export function normalizeRole(value: string): string {
  const cleaned = stripMarkdown(value).toLowerCase()
  const aliases: Record<string, string> = {
    leader: 'marketing-leader',
    'trưởng phòng marketing': 'marketing-leader',
    'trưởng phòng': 'marketing-leader',
    'nghiên cứu thị trường': 'market-research',
    'nghiên cứu': 'market-research',
    'viết nội dung': 'content-writer',
    'nội dung': 'content-writer',
    'seo kỹ thuật': 'seo-technical',
    seo: 'seo-technical',
    'social media': 'social-media',
    social: 'social-media',
    'quảng cáo trả phí': 'paid-media',
    ads: 'paid-media',
    'email & crm': 'email-crm',
    'email-crm': 'email-crm',
    'thiết kế & video': 'design-video',
    'thiết kế': 'design-video',
    'phân tích & báo cáo': 'analytics',
    'phân tích': 'analytics',
    'chăm sóc cộng đồng': 'community-care',
  }
  const direct = aliases[cleaned]
  if (direct) return direct
  return cleaned.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

/** Phụ thuộc có thể viết bằng dấu phẩy, chấm phẩy, hoặc "không". */
export function parseDependencies(value: string): string[] {
  const cleaned = stripMarkdown(value)
  if (cleaned.length === 0) return []
  if (/^(không|none|n\/a|-|—)$/i.test(cleaned)) return []
  // KHÔNG dùng `\b` quanh "và": `\b` của JavaScript coi ký tự có dấu (à) là
  // non-word nên `\bvà\b` không bao giờ khớp trong văn bản tiếng Việt. Dùng
  // lookaround theo lớp ký tự Unicode để tách đúng.
  return cleaned
    .split(/[,;]|(?<![\p{L}\p{N}])và(?![\p{L}\p{N}])/u)
    .map((part) => stripMarkdown(part))
    .filter((part) => part.length > 0 && !/^(không|none|-|—)$/i.test(part))
}

/** Gộp brief đã lưu với nội dung người dùng vừa gửi, ưu tiên giá trị mới. */
export function mergeBrief(existing: Brief | undefined, userMessage: string): Brief {
  const base: Brief = existing ?? {
    objective: '',
    kpi: '',
    scope: '',
    deadline: '',
    budget: '',
    constraints: '',
  }
  // Câu trả lời của người dùng thường bổ sung cho các trường còn thiếu; nối vào
  // trường yếu nhất thay vì ghi đè mục tiêu đã chốt.
  const merged = { ...base }
  const record = merged as unknown as Record<string, string>
  if (record.objective?.trim().length === 0) record.objective = userMessage.slice(0, 500)
  else if (record.constraints?.trim().length === 0) record.constraints = userMessage.slice(0, 500)
  return merged
}

export function formatBrief(brief: Brief): string {
  return [
    `- Mục tiêu: ${brief.objective}`,
    `- KPI: ${brief.kpi}`,
    `- Phạm vi: ${brief.scope}`,
    `- Thời hạn: ${brief.deadline}`,
    `- Ngân sách: ${brief.budget}`,
    `- Ràng buộc: ${brief.constraints}`,
  ].join('\n')
}

