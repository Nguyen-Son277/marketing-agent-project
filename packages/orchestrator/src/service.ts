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
import { budgetExceeded, conflict, notFound, truncate, type AgentRole } from '@marketing-agent/shared'
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
import { BRIEF_EXTRACTION_INSTRUCTION, extractLabeledBrief, mergeBriefFields, parseExtractedBrief } from './brief.ts'
import { composeReport, persistReport } from './reporter.ts'
import { reviewOutcomes } from './review.ts'
import {
  BRIEF_FIELD_LABELS,
  BRIEF_FIELDS,
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
  private readonly writeDiagnostic:
    | ((name: string, content: string) => void | Promise<void>)
    | undefined

  constructor(deps: OrchestratorDeps) {
    this.repos = deps.repos
    this.tools = deps.tools
    this.embedding = deps.embedding
    this.limits = { ...DEFAULT_LIMITS, ...(deps.limits ?? {}) }
    this.publish = deps.publish
    this.log = deps.log
    this.runtimeOverrides = deps.runtimeOverrides
    this.writeDiagnostic = deps.writeDiagnostic
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

    // Trích brief từ toàn bộ hội thoại người dùng, rồi gộp với brief đã lưu.
    // Phải chạy TRƯỚC khi kiểm tra, vì đây là bước biến lời nói thành 6 trường.
    const lichSu = this.repos.work.listMessages(conversation.id, input.companyId, 40)
    const nguoiDungNoi = lichSu
      .filter((message) => message.authorKind === 'user')
      .map((message) => message.contentMd)
      .join('\n\n')

    const labeled = extractLabeledBrief(nguoiDungNoi.length > 0 ? nguoiDungNoi : input.content)
    let extracted = mergeBriefFields(parseBrief(conversation.briefJson), labeled)
    // Chỉ nhờ model khi lớp nhãn vẫn còn thiếu trường: lớp nhãn tất định và miễn phí.
    const conThieuSauNhan = BRIEF_FIELDS.filter((field) => extracted[field].trim().length === 0)
    if (conThieuSauNhan.length > 0) {
      try {
        const output = await this.extractBriefWithModel(
          input.companyId,
          conversation.id,
          nguoiDungNoi || input.content,
        )
        extracted = mergeBriefFields(extracted, parseExtractedBrief(output))
      } catch (error) {
        this.log?.('Không trích được brief bằng model, chỉ dùng lớp nhãn', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const brief = extracted
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
      // Lưu phần đã trích được: người dùng trả lời từng câu qua nhiều lượt, nên
      // brief phải tích luỹ chứ không được hỏi lại từ đầu.
      this.repos.work.updateConversation(conversation.id, input.companyId, { phase: 'clarify', brief })
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

    // Đã đủ brief: lưu lại và để Leader quyết định bước tiếp theo.
    this.repos.work.updateConversation(conversation.id, input.companyId, { phase: 'brief', brief })
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
    // Nếu Leader gọi công cụ thay vì trả bảng, kết quả thường rỗng. Nói rõ nguyên nhân
    // thay vì chỉ báo "không đọc được bảng" — đây là kiểu hỏng đã gặp thật.
    if (turn.output.trim().length === 0) {
      throw conflict(
        'Leader không trả về nội dung kế hoạch' +
          (turn.toolCalls.length > 0 ? ` (đã gọi công cụ: ${turn.toolCalls.join(', ')})` : '') +
          '. Leader phải trình bày kế hoạch dưới dạng BẢNG Markdown bốn cột, không được gọi công cụ để tạo việc.',
      )
    }
    const rows = parsePlanTable(turn.output)
    if (rows.length === 0) {
      // Ghi nguyên văn câu trả lời: đây là điểm dễ vỡ nhất khi đổi model, và không
      // có log thì chỉ thấy "không đọc được bảng" mà không biết vì sao.
      // Ghi nguyên văn bảng kế hoạch qua sink chẩn đoán (nếu nơi gọi cấp). Đây là
      // điểm dễ vỡ nhất khi đổi model, và log console không đủ chỗ cho một bảng
      // Markdown. Lỗi khi ghi chẩn đoán không được làm hỏng luồng chính.
      try {
        await this.writeDiagnostic?.(
          `leader-plan-${Date.now()}.txt`,
          [
            `toolCalls: ${turn.toolCalls.join(', ') || '(none)'}`,
            `status: ${turn.status}`,
            `stopReason: ${turn.stopReason}`,
            '',
            turn.output,
          ].join('\n'),
        )
      } catch (error) {
        this.log?.('Không ghi được chẩn đoán bảng kế hoạch', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      this.log?.('Không đọc được bảng kế hoạch từ Leader', {
        outputLength: turn.output.length,
        output: turn.output,
        status: turn.status,
        stopReason: turn.stopReason,
        error: turn.error,
      })
      throw conflict(
        'Không đọc được kế hoạch dạng bảng từ câu trả lời của Leader. ' +
          'Hãy yêu cầu Leader trình bày lại theo bảng: Công việc | Chuyên môn | Phụ thuộc | Đầu ra.',
      )
    }
    const vaiTro = this.availableRoles(input.companyId)
    // Chuẩn hoá phụ thuộc TRƯỚC khi xác thực: chuyển tham chiếu số/gộp về tiêu đề
    // thật, và bỏ những phụ thuộc không khớp việc nào (kèm ghi chú) thay vì để bước
    // xác thực từ chối cả kế hoạch.
    const boPhuThuoc: string[] = []
    const rowsDaChuanHoa = normalizeDependencies(rows, (task, dependency) => {
      boPhuThuoc.push(`${task} → ${dependency}`)
    })
    if (boPhuThuoc.length > 0) {
      this.log?.('Đã bỏ phụ thuộc không khớp việc nào', { bo: boPhuThuoc })
    }

    const plan = validatePlan({
      plan: {
        tasks: rowsDaChuanHoa.map((row) => {
          const role = resolveRole(row.assigneeRaw, vaiTro)
          if (!role) {
            throw conflict(
              `Không xác định được chuyên môn cho việc "${row.title}" — Leader ghi "${row.assigneeRaw}". ` +
                `Các chuyên môn hợp lệ: ${vaiTro.join(', ')}.`,
            )
          }
          return {
            title: row.title,
            briefMd: row.deliverable.length > 0 ? `${row.title}. Đầu ra: ${row.deliverable}` : row.title,
            assigneeRole: role,
            dependsOnTitles: row.dependsOn,
          }
        }),
      },
      availableRoles: vaiTro,
    })

    // Ghi kế hoạch vào cơ sở dữ liệu, gồm cả cạnh phụ thuộc. Dùng chính văn bản
    // Leader đã viết làm brief của việc, thay vì đọc lại từ một chỗ lưu tạm.
    // Dùng lại kế hoạch đã xác thực ở trên (vai trò đã được resolve), thay vì dựng
    // lại từ `rows`: nếu dựng lại thì phải resolve vai trò lần thứ hai và hai chỗ có
    // thể lệch nhau.
    // Dùng lại vai trò đã resolve trong `plan` (một nguồn sự thật), nhưng lấy phần
    // mô tả từ `rows` vì `PlannedTask` cố ý chỉ mang cấu trúc, không mang văn xuôi.
    const rowByTitle = new Map(rowsDaChuanHoa.map((row) => [row.title, row]))
    const created = await this.createTasks(
      { companyId: input.companyId, conversationId: conversation.id },
      plan.tasks.map((task) => {
        const row = rowByTitle.get(task.title)
        return {
          title: task.title,
          briefMd:
            row && row.deliverable.length > 0
              ? `${row.title}. Đầu ra: ${row.deliverable}`
              : task.title,
          assigneeRole: task.assigneeRole,
          dependsOnTitles: task.dependsOn,
        }
      }),
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
      maxTasks: 10,
    })
    if (checked.dropped > 0) {
      this.log?.(`Kế hoạch vượt trần, đã bỏ ${checked.dropped} việc ít phụ thuộc nhất`, {
        giuLai: checked.tasks.length,
      })
    }

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

  /**
   * Nhờ Leader trích 6 trường brief từ hội thoại.
   *
   * Chạy với một bước và không cấp tool: đây là việc đọc-hiểu-và-trả-JSON, cấp tool
   * chỉ làm model phân tâm và tốn thêm lượt gọi.
   */
  private async extractBriefWithModel(
    companyId: string,
    conversationId: string,
    text: string,
  ): Promise<string> {
    const result = await runAgentForTask({
      repos: this.repos,
      tools: this.tools,
      embedding: this.embedding,
      runtimeOverrides: this.runtimeOverrides,
      companyId,
      role: 'marketing-leader',
      taskId: null,
      conversationId,
      maxSteps: 1,
      taskBrief: [BRIEF_EXTRACTION_INSTRUCTION, '', '## Hội thoại', truncate(text, 6_000)].join('\n'),
      ...(this.log ? { log: this.log } : {}),
    })
    return result.run.output
  }

  /** Một lượt chạy của Leader với vai trò điều hành. */
  private async runLeaderTurn(
    companyId: string,
    conversationId: string,
    mode: 'plan-request' | 'create-plan',
  ): Promise<{
    output: string
    runId: string | null
    costUsd: number
    status: string
    stopReason: string
    error: string | null
    toolCalls: readonly string[]
  }> {
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
            'QUAN TRỌNG: câu trả lời của bạn PHẢI chứa bảng Markdown, vì đó là thứ',
            'hệ thống đọc để tạo công việc. KHÔNG gọi công cụ nào cho việc lập kế hoạch.',
            '',
            'Yêu cầu bắt buộc:',
            '- Tối đa 10 việc; mỗi việc giao cho MỘT chuyên môn.',
            '- Nêu rõ đầu ra kiểm chứng được của từng việc.',
            '- Nêu thứ tự phụ thuộc thật, ghi ĐÚNG TIÊU ĐỀ của việc phải xong trước.',
            '- Mỗi tiêu đề công việc phải khác nhau (không trùng).',
            '- Trình bày DUY NHẤT một bảng với đúng bốn cột, theo thứ tự:',
            '  | Công việc | Chuyên môn | Phụ thuộc | Đầu ra |',
            '- Cột "Chuyên môn" ghi đúng mã vai trò, ví dụ: market-research, seo-technical,',
            '  content-writer, social-media, paid-media, email-crm, design-video,',
            '  analytics, community-care.',
            '- Ô "Phụ thuộc" ghi "không" nếu không phụ thuộc việc nào.',
            '- Không thêm cột khác, không thêm dòng ghi chú hay nhóm việc bên trong bảng.',
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
      status: result.run.status,
      stopReason: result.run.stopReason,
      error: result.run.error,
      toolCalls: result.run.toolCalls.map((call) => call.name),
    }
  }

}

export interface PlanRow {
  readonly title: string
  /** Tên chuyên môn nguyên văn Leader viết; chưa chuẩn hoá. */
  readonly assigneeRaw: string
  readonly dependsOn: readonly string[]
  readonly deliverable: string
  /** Số thứ tự do Leader ghi ở cột đầu, nếu có. */
  readonly soThuTu?: number | undefined
}

/**
 * Đọc bảng kế hoạch từ Markdown.
 *
 * Hai lượt, vì cột số thứ tự chỉ nhận diện được khi nhìn toàn bảng:
 *  - Lượt 1: tách mọi dòng thành các ô, bỏ dòng tiêu đề/phân cách, xác định cột
 *    chuyên môn theo NỘI DUNG (không theo vị trí).
 *  - Lượt 2: biết cột nào là số thứ tự, rồi giải mã tham chiếu phụ thuộc kiểu "1".
 *
 * Đây là điểm dễ vỡ nhất khi đổi model: định dạng bảng do model quyết định, và nó
 * thay đổi giữa các model và giữa các lần gọi. Bám vị trí cột sẽ vỡ ngay.
 */
export function parsePlanTable(markdown: string): PlanRow[] {
  interface Tho {
    readonly cells: readonly string[]
    readonly roleIndex: number
  }

  const tho: Tho[] = []
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    if (cells.length < 2) continue
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue
    if (laDongTieuDe(cells)) continue

    const roleIndex = cells.findIndex((cell) => laOTenChuyenMon(cell))
    if (roleIndex < 0) continue

    // Ô ngay trước cột chuyên môn là nhãn tiêu đề -> đây vẫn là dòng tiêu đề.
    if (roleIndex > 0) {
      const truoc = stripMarkdown(cells[roleIndex - 1] ?? '')
      if (/^(công việc|việc|task|hạng mục|nội dung|mục tiêu)$/i.test(truoc)) continue
    }

    tho.push({ cells, roleIndex })
  }
  if (tho.length === 0) return []

  // Cột số thứ tự: mọi dòng đều là số nguyên VÀ tạo thành dãy 1,2,3… tăng dần.
  //
  // Vì sao đòi hỏi dãy tăng dần: chỉ "mọi ô đều là số" là chưa đủ — một bảng có ô
  // phụ thuộc ghi số ("phụ thuộc: 99") cũng thoả điều kiện đó ở một cột, và khi ấy
  // con số phụ thuộc bị hiểu nhầm thành số thứ tự của dòng. Đã gặp thật.
  const soCot = tho[0]?.cells.length ?? 0
  let cotSo: number | undefined
  for (let column = 0; column < soCot; column += 1) {
    if (tho.some((row) => row.roleIndex === column)) continue
    const values = tho.map((row) => stripMarkdown(row.cells[column] ?? ''))
    if (!values.every((value) => /^\d+$/.test(value))) continue
    const so = values.map(Number)
    const laDayTangDan = so.every((value, index) => value === index + 1)
    if (laDayTangDan) {
      cotSo = column
      break
    }
  }

  const rows: PlanRow[] = []
  for (const row of tho) {
    const { cells, roleIndex } = row

    // Tiêu đề: ô chữ đầu tiên không phải cột số thứ tự và không phải cột chuyên môn.
    let title = ''
    for (let index = 0; index < cells.length; index += 1) {
      if (index === cotSo || index === roleIndex) continue
      const candidate = stripMarkdown(cells[index] ?? '')
      if (candidate.length === 0 || !/[\p{L}\p{N}]/u.test(candidate)) continue
      title = candidate
      break
    }
    // Bảng đặt cột chuyên môn ở đầu: lấy ô chữ đầu tiên SAU cột chuyên môn.
    if (title.length === 0) {
      for (let index = roleIndex + 1; index < cells.length; index += 1) {
        if (index === cotSo) continue
        const candidate = stripMarkdown(cells[index] ?? '')
        if (candidate.length === 0 || !/[\p{L}\p{N}]/u.test(candidate)) continue
        title = candidate
        break
      }
    }
    if (title.length === 0) continue

    // Phụ thuộc và đầu ra là hai ô đầu tiên còn lại, theo thứ tự trong bảng.
    const conLai: string[] = []
    for (let index = 0; index < cells.length; index += 1) {
      if (index === cotSo || index === roleIndex) continue
      const value = stripMarkdown(cells[index] ?? '')
      if (value === title) continue
      conLai.push(value)
    }

    rows.push({
      title,
      assigneeRaw: stripMarkdown(cells[roleIndex] ?? ''),
      dependsOn: parseDependencies(conLai[0] ?? ''),
      deliverable: conLai[1] ?? '',
      soThuTu: cotSo === undefined ? undefined : Number(stripMarkdown(cells[cotSo] ?? '')),
    })
  }

  return giaiMaPhuThuocSo(rows)
}

/**
 * Chuyển tham chiếu phụ thuộc bằng SỐ THỨ TỰ thành tiêu đề công việc.
 *
 * Người và model đều hay viết "phụ thuộc: 1" nghĩa là "sau việc số 1". Giữ nguyên
 * số thì bước xác thực báo "không có việc nào tên 1" và cả kế hoạch bị từ chối.
 * Chỉ ánh xạ khi bảng THẬT SỰ có cột số thứ tự; con số không khớp được giữ nguyên
 * để báo lỗi thay vì bị đoán thành một việc có thật.
 */
function giaiMaPhuThuocSo(rows: readonly PlanRow[]): PlanRow[] {
  const theoSo = new Map<number, string>()
  for (const row of rows) {
    if (row.soThuTu !== undefined && !theoSo.has(row.soThuTu)) theoSo.set(row.soThuTu, row.title)
  }
  // Không có cột số thứ tự thì không có gì để giải mã: giữ nguyên văn.
  if (theoSo.size === 0) return [...rows]

  return rows.map((row) => ({
    ...row,
    dependsOn: row.dependsOn.map((dependency) => {
      if (!/^\d+$/.test(dependency)) return dependency
      // Số khớp dòng nào thì thay bằng tiêu đề; không khớp thì giữ nguyên số để
      // `normalizeDependencies` phán quyết và báo lại — tầng parse không bỏ dữ liệu.
      return theoSo.get(Number(dependency)) ?? dependency
    }),
  }))
}

/**
 * Chuẩn hoá danh sách phụ thuộc của cả kế hoạch về tiêu đề công việc thật.
 *
 * Ba dạng được chấp nhận: tiêu đề chính xác, số thứ tự dòng, và ô gộp nhiều việc
 * ("A + B"). Phụ thuộc không khớp việc nào bị BỎ kèm ghi chú: giữ lại sẽ khiến bước
 * xác thực từ chối cả kế hoạch, và người dùng không còn gì để duyệt — trong khi hệ
 * quả của một phụ thuộc bị bỏ chỉ là một việc có thể chạy hơi sớm.
 */
export function normalizeDependencies(
  rows: readonly PlanRow[],
  onDropped?: (task: string, dependency: string) => void,
): PlanRow[] {
  const titles = rows.map((row) => row.title)
  const theoSo = new Map<number, string>()
  for (const row of rows) {
    if (row.soThuTu !== undefined && !theoSo.has(row.soThuTu)) theoSo.set(row.soThuTu, row.title)
  }

  return rows.map((row) => {
    const ketQua = new Set<string>()
    for (const dependency of row.dependsOn) {
      if (dependency === row.title) continue
      if (/^\d+$/.test(dependency)) {
        const title = theoSo.get(Number(dependency))
        if (title && title !== row.title) ketQua.add(title)
        else onDropped?.(row.title, dependency)
        continue
      }
      if (titles.includes(dependency)) {
        if (dependency !== row.title) ketQua.add(dependency)
        continue
      }
      // Ô gộp nhiều việc: tìm mọi tiêu đề xuất hiện bên trong.
      let khop = false
      for (const title of titles) {
        if (title !== row.title && dependency.includes(title)) {
          ketQua.add(title)
          khop = true
        }
      }
      if (khop) continue
      // Tách theo dấu phân tách rồi khớp từng mảnh.
      for (const phan of dependency.split(/[&+/]|\bvà\b/)) {
        const cleaned = phan.trim()
        if (cleaned.length === 0) continue
        const hit = titles.find(
          (title) => title === cleaned || (cleaned.length >= 4 && title.includes(cleaned)),
        )
        if (hit && hit !== row.title) {
          ketQua.add(hit)
          khop = true
        }
      }
      if (!khop) onDropped?.(row.title, dependency)
    }
    return { ...row, dependsOn: [...ketQua] }
  })
}

/**
 * Có phải dòng tiêu đề của bảng?
 *
 * Điều kiện phải CHẶT: chỉ cần một ô chứa từ khoá là đủ để loại thì sẽ loại oan dữ
 * liệu thật — đã gặp: tiêu đề "Nghiên cứu từ khoá" chứa "nghiên cứu" nên bị coi là
 * dòng tiêu đề và mất cả dòng. Vì vậy chỉ loại khi MỌI ô đều là nhãn tiêu đề, hoặc
 * khi có ít nhất hai ô là nhãn tiêu đề và mọi ô đều là nhãn ngắn.
 */
function laDongTieuDe(cells: readonly string[]): boolean {
  const tuKhoa =
    /^(#|stt|no\.?|tt|công việc|task|hạng mục|việc|nội dung|chuyên môn|phụ trách|agent|role|assignee|phụ thuộc|phụ thuộc vào|đầu ra|kết quả|ghi chú|mục tiêu)$/i
  const sach = cells.map((cell) => stripMarkdown(cell))
  if (sach.every((cell) => cell.length === 0 || tuKhoa.test(cell))) return true
  if (/^(#|stt|no\.?|tt)$/i.test(sach[0] ?? '')) {
    return sach.slice(1).every((cell) => cell.length === 0 || tuKhoa.test(cell))
  }
  const soTuKhoa = sach.filter((cell) => tuKhoa.test(cell)).length
  const toanNhanNgan = sach.every((cell) => cell.length <= 24 && !/\d{2,}|https?:/i.test(cell))
  return soTuKhoa >= 2 && toanNhanNgan
}

/** Tên canonical của mọi chuyên môn; dùng để nhận diện ô chuyên môn. */
const TEN_CANONICAL =
  /(marketing-leader|market-research|content-writer|seo-technical|social-media|paid-media|email-crm|design-video|analytics|community-care)/i

/**
 * Ô này có phải tên chuyên môn không (khớp TRỌN ô, không khớp một phần).
 *
 * Vì sao phải khớp trọn ô: "Công việc" chứa "việc", và nếu chỉ cần khớp một phần thì
 * ô tiêu đề bị nhận nhầm thành ô chuyên môn — đã gặp thật, parser tạo ra công việc
 * tên "#" với chuyên môn "Công việc" và cả kế hoạch bị từ chối.
 */
function laOTenChuyenMon(cell: string): boolean {
  const sach = stripMarkdown(cell)
  if (sach.length === 0) return false
  const tenViet = [
    'nghiên cứu thị trường', 'nghiên cứu', 'viết nội dung', 'seo kỹ thuật',
    'social media', 'quảng cáo trả phí', 'quảng cáo', 'email & crm', 'email và crm',
    'thiết kế & video', 'thiết kế và video', 'thiết kế', 'phân tích & báo cáo',
    'phân tích và báo cáo', 'phân tích', 'chăm sóc cộng đồng', 'cộng đồng',
    'content writer', 'seo technical', 'leader', 'social', 'email',
  ]
  const lower = sach.toLowerCase()
  // Khớp trọn ô với tên canonical hoặc tên tiếng Việt.
  if (TEN_CANONICAL.test(sach) || tenViet.includes(lower)) return true
  // Chấp nhận tiền tố như "1. content-writer" nhưng vẫn yêu cầu phần còn lại khớp.
  const boSo = lower.replace(/^\s*\d+\s*[.)-]\s*/, '')
  return boSo !== lower && (TEN_CANONICAL.test(boSo) || tenViet.includes(boSo))
}

/** Bỏ định dạng Markdown trong ô bảng để tiêu đề dùng được làm khoá. */
export function stripMarkdown(value: string): string {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\d+[.)]\s*/, '')
    .trim()
}

/** Bỏ dấu tiếng Việt và ký tự không phải chữ/số, để so khớp mờ. */
function khongDau(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Tìm vai trò hợp lệ gần nhất với một chuỗi tự do.
 *
 * Vì sao cần khớp mờ thay vì chỉ so bằng: Leader viết tên chuyên môn bằng lời
 * ("Nghiên cứu thị trường", "Viết nội dung", thậm chí "Content Writer"), và một
 * danh sách alias cố định sẽ luôn thiếu. Khớp theo tỉ lệ từ trùng với chính danh
 * sách vai trò đang bật khiến việc này chịu được cách viết khác nhau mà vẫn an
 * toàn: không có ứng viên nào đủ gần thì trả về undefined để báo lỗi rõ ràng.
 */
export function resolveRole(raw: string, available: readonly string[]): string | undefined {
  const target = khongDau(raw)
  if (target.length === 0) return undefined

  // 1) Khớp chính xác sau khi bỏ dấu và dấu câu.
  for (const role of available) {
    if (khongDau(role) === target) return role
  }
  // 2) Khớp theo alias đã biết.
  const alias = normalizeRole(raw)
  if (available.includes(alias)) return alias
  // 3) Khớp mờ: chọn vai trò có nhiều từ trùng nhất, yêu cầu tỉ lệ đủ cao để không
  //    nhận nhầm một ô tiêu đề bảng thành tên chuyên môn.
  const words = new Set(target.split(' '))
  let best: { role: string; score: number } | undefined
  for (const role of available) {
    const roleWords = khongDau(role).split(' ')
    const shared = roleWords.filter((word) => words.has(word)).length
    const score = shared / Math.max(roleWords.length, words.size)
    if (shared > 0 && (!best || score > best.score)) best = { role, score }
  }
  if (best && best.score >= 0.5) return best.role
  return undefined
}

/** Chuẩn hoá tên vai trò: bỏ khoảng trắng, hạ chữ, đổi khoảng trắng thành gạch. */
export function normalizeRole(value: string): string {
  // Bỏ số thứ tự đầu ô ("1. Content Writer") trước khi tra alias: model hay đánh
  // số cột này, và số thứ tự không phải phần của tên vai trò.
  const cleaned = stripMarkdown(value)
    .toLowerCase()
    .replace(/^\s*\d+\s*[.)-]\s*/, '')
    .trim()
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

