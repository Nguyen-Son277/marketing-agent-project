/**
 * Chạy một agent chuyên môn cho một công việc cụ thể.
 *
 * Đây là điểm duy nhất biết cách ghép mọi thứ lại cho một lượt chạy: cấu hình
 * agent đã resolve, tool đã lọc theo grant, kho kiến thức, ngân sách và sổ chi phí.
 * Nhờ tập trung một chỗ, thay đổi cách chạy agent không phải sửa dispatcher hay
 * orchestrator.
 */
import {
  toolError,
  type AgentRole,
  type ToolContext,
  type ToolDefinition,
  type RuntimeObserver,
  type TaskStatus,
} from '@marketing-agent/shared'
import type { Locale } from '@marketing-agent/i18n'
import type { Repos } from '@marketing-agent/db'
import type { EmbeddingProvider } from '@marketing-agent/kb'
import { createKbTools } from '@marketing-agent/kb'
import type { ToolRegistry } from '@marketing-agent/tools'
import {
  createRuntimeDeps,
  runAgent,
  type AgentRunResult,
  type AgentRuntimeDeps,
} from '@marketing-agent/agent-runtime'

import type { AppEvent } from './events.ts'

export interface RunAgentForTaskInput {
  readonly repos: Repos
  readonly tools: ToolRegistry
  readonly embedding?: EmbeddingProvider | undefined
  readonly runtimeOverrides?: Partial<AgentRuntimeDeps> | undefined
  readonly companyId: string
  readonly role: AgentRole
  readonly taskId: string | null
  readonly conversationId: string | null
  readonly taskBrief: string
  readonly images?: readonly import('@marketing-agent/shared').LlmImage[]
  readonly actorUserId?: string
  readonly requestId?: string
  /** Chế độ việc nhân viên thu hẹp tool để không chạy kế hoạch marketing ngoài ý muốn. */
  readonly toolNames?: readonly string[]
  /** Ngữ cảnh bổ sung: kết quả các việc phụ thuộc, hướng dẫn của Leader. */
  readonly extraContext?: string | undefined
  /** Ngôn ngữ của cuộc trao đổi; mặc định tiếng Việt để giữ hành vi cũ. */
  readonly locale?: Locale | undefined
  readonly maxSteps?: number
  readonly signal?: AbortSignal | undefined
  readonly log?: ((message: string, data?: unknown) => void) | undefined
  readonly publish?: ((event: AppEvent) => void) | undefined
  readonly productImageContext?: ((companyId: string, query: string, includeImages: boolean, limit: number) => Promise<{ context: string; images: readonly import('@marketing-agent/shared').LlmImage[] }>) | undefined
}

export interface RunAgentForTaskResult {
  readonly run: AgentRunResult
  readonly resolvedDisplayName: string
  readonly modelId: string | null
  readonly providerId: string | null
  /** Lý do dừng đã diễn giải thành câu cho người đọc. */
  readonly summary: string
  readonly toolCalls: readonly { name: string; ok: boolean; durationMs: number }[]
}

/** Tool chuẩn của kho kiến thức; thiếu embedding thì vẫn tìm được theo từ khoá. */
export function buildKbToolsFor(repos: Repos, embedding?: EmbeddingProvider): ToolDefinition[] {
  return createKbTools({ repos, embeddingProvider: embedding })
}

/**
 * Ghép tool grant thật của agent với tool khả dụng.
 *
 * Thứ tự quan trọng: `grantedFor` trả về giao giữa grant của preset và tool hệ
 * thống biết. Tool `kb.*` không nằm trong registry nên được thêm vào sau, nhưng
 * vẫn chỉ khi preset có tên chúng trong grant.
 */
export function resolveAgentTools(input: {
  registry: ToolRegistry
  tools: readonly ToolDefinition[]
  role: AgentRole
  grantedNames: readonly string[]
}): ToolDefinition[] {
  const byName = new Map(input.tools.map((tool) => [tool.name, tool]))
  const fromRegistry = input.registry.grantedFor(input.role, input.grantedNames)
  const extra = input.grantedNames
    .map((name) => byName.get(name))
    .filter((tool): tool is ToolDefinition => tool !== undefined)
  const merged = new Map<string, ToolDefinition>()
  for (const tool of [...fromRegistry, ...extra]) merged.set(tool.name, tool)
  return [...merged.values()]
}

/**
 * Chạy một agent cho một công việc.
 *
 * Ngân sách được kiểm tra trước khi bắt đầu: vượt trần thì không tốn thêm token nào
 * để rồi thất bại.
 */
export async function runAgentForTask(input: RunAgentForTaskInput): Promise<RunAgentForTaskResult> {
  const resolved = input.repos.team.resolveAgent(input.companyId, input.role)
  const registry = input.tools
  const kbTools = buildKbToolsFor(input.repos, input.embedding)
  const granted = resolveAgentTools({
    registry,
    tools: kbTools,
    role: resolved.role,
    grantedNames: input.toolNames ? resolved.toolNames.filter(n=>input.toolNames!.includes(n)) : resolved.toolNames,
  })

  const toolContext: ToolContext = {
    companyId: input.companyId,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
    agentRole: resolved.role,
    agentDefId: resolved.agentDef.id,
    taskId: input.taskId,
    conversationId: input.conversationId,
    ...(input.signal ? { signal: input.signal } : {}),
    log: (message, data) => input.log?.(`[${resolved.role}] ${message}`, data),
  }

  const runtimeDeps = mergeRuntimeDeps(createRuntimeDeps(input.repos), input.runtimeOverrides)

  if (granted.length === 0) {
    // Không có tool nào là dấu hiệu cấu hình sai; nói thẳng thay vì chạy mù.
    input.log?.(`Agent ${resolved.role} không có công cụ nào được cấp`)
  }

  let imageContext = ''
  let productImages: readonly import('@marketing-agent/shared').LlmImage[] = []
  if (input.productImageContext) {
    try {
      const matched = await input.productImageContext(input.companyId, input.taskBrief, resolved.model?.supportsVision === true, 3)
      imageContext = matched.context
      productImages = matched.images
    } catch (error) {
      input.log?.('Không nạp được ngữ cảnh ảnh sản phẩm; tiếp tục bằng metadata', { error: error instanceof Error ? error.message : String(error) })
    }
  }
  const taskPrompt = composeTaskPrompt({
    role: resolved.role,
    displayName: resolved.displayName,
    taskBrief: input.taskBrief,
    extraContext: [input.extraContext, imageContext].filter((value): value is string => Boolean(value && value.trim())).join('\n\n'),
    ...(input.locale ? { locale: input.locale } : {}),
  })

  // Runtime owns trusted scope and metadata. A telemetry sink must never fail work,
  // and an unscoped run must not leak onto a company-wide conversation stream.
  const observe: RuntimeObserver = (observation) => {
    if (!input.conversationId || observation.conversationId !== input.conversationId) return
    try {
      const published: unknown = input.publish?.({
        type: observation.type,
        companyId: input.companyId,
        payload: observation,
        at: observation.at,
      })
      if (published instanceof Promise) void published.catch(() => undefined)
    } catch {
      // Observability is best-effort, not part of agent success.
    }
  }

  const run = await runAgent(
    {
      agent: resolved,
      context: toolContext,
      messages: [{ role: 'user', content: taskPrompt, ...((input.images?.length || productImages.length) ? { images: [...(input.images ?? []), ...productImages] } : {}) }],
      tools: granted,
      observe,
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    },
    runtimeDeps,
  )

  return {
    run,
    resolvedDisplayName: resolved.displayName,
    modelId: resolved.model?.id ?? null,
    providerId: resolved.provider?.id ?? null,
    summary: summarizeRun(run, resolved.displayName, input.locale ?? 'vi'),
    toolCalls: run.toolCalls.map((call) => ({ name: call.name, ok: call.ok, durationMs: call.durationMs })),
  }
}

/** A successful run cannot erase an explicit task blocker or cancellation. */
export function taskStatusForRun(
  run: AgentRunResult,
  storedStatus?: TaskStatus,
): 'done' | 'blocked' | 'failed' | 'cancelled' {
  if (storedStatus === 'cancelled' || run.status === 'cancelled' || run.stopReason === 'cancelled') return 'cancelled'
  if (storedStatus === 'blocked') return 'blocked'
  return run.status === 'succeeded' ? 'done' : run.status === 'budget_exceeded' ? 'blocked' : 'failed'
}

/** Ghi đè chỉ những mảnh được chỉ định, giữ phần thật cho phần còn lại. */
function mergeRuntimeDeps(base: AgentRuntimeDeps, overrides: Partial<AgentRuntimeDeps> | undefined): AgentRuntimeDeps {
  if (!overrides) return base
  return {
    router: overrides.router ?? base.router,
    adapters: overrides.adapters ?? base.adapters,
    meterFactory: overrides.meterFactory ?? base.meterFactory,
    ...(overrides.adapter ? { adapter: overrides.adapter } : base.adapter ? { adapter: base.adapter } : {}),
  }
}

/**
 * Prompt giao việc. Cố ý nêu rõ yêu cầu bàn giao để kết quả dùng được ở bước sau,
 * và nhắc lại giới hạn để agent báo blocker thay vì bịa.
 */
/**
 * Khối chữ của prompt giao việc, theo ngôn ngữ.
 *
 * Vì sao đặt hai biến thể CẠNH NHAU thay vì tách ra hai file: đây là chỉ dẫn nghiệp vụ,
 * và người sửa cần nhìn thấy cả hai bản cùng lúc để không làm lệch nghĩa. Tách xa nhau
 * thì bản này sẽ trôi khỏi bản kia mà không ai phát hiện.
 */
const HANDOFF_TEXT: Record<Locale, {
  readonly intro: (displayName: string) => string
  readonly briefHeading: string
  readonly contextHeading: string
  readonly requirementsHeading: string
  readonly requirements: readonly string[]
  readonly needConfirmation: string
}> = {
  vi: {
    intro: (displayName) => `Bạn nhận một công việc từ Leader với vai trò ${displayName}.`,
    briefHeading: '## Nội dung công việc',
    contextHeading: '## Ngữ cảnh kèm theo (kết quả các việc trước, hướng dẫn của Leader)',
    requirementsHeading: '## Yêu cầu bàn giao',
    requirements: [
      '1. Kết quả phải trả lời trực tiếp công việc trên, không lan sang việc của chuyên môn khác.',
      '2. Mọi số liệu phải kèm nguồn: đường dẫn tài liệu trong kho kiến thức, hoặc kết quả công cụ.',
      '3. Dùng `artifact_publish` để công bố tài sản chính (báo cáo, kế hoạch, lịch, bảng) kèm tóm tắt ngắn.',
      '4. Kết thúc bằng mục "Cần xác nhận" liệt kê giả định và câu hỏi mở, nếu có.',
      '5. Nếu thiếu dữ liệu hoặc bị chặn: dùng `agent_escalate` nêu rõ đang thiếu gì, đã thử gì, và 2 phương án.',
      '6. Nếu cần thông tin mà chuyên môn khác đang giữ: dùng `agent_ask` thay vì tự suy đoán.',
    ],
    needConfirmation: 'Cần xác nhận',
  },
  en: {
    intro: (displayName) => `You have received a task from the Leader in the role of ${displayName}.`,
    briefHeading: '## The task',
    contextHeading: '## Attached context (results of earlier tasks, the Leader’s guidance)',
    requirementsHeading: '## Delivery requirements',
    requirements: [
      '1. The result must answer the task above directly; do not stray into another specialism’s work.',
      '2. Every figure must cite its source: a knowledge base document path, or a tool result.',
      '3. Use `artifact_publish` to publish the main asset (report, plan, schedule, table) with a short summary.',
      '4. End with a "Needs confirmation" section listing assumptions and open questions, if any.',
      '5. If data is missing or you are blocked: use `agent_escalate` to state what is missing, what you tried, and 2 options.',
      '6. If you need information another specialism holds: use `agent_ask` instead of guessing.',
    ],
    needConfirmation: 'Needs confirmation',
  },
}

export function composeTaskPrompt(input: {
  role: AgentRole
  displayName: string
  taskBrief: string
  extraContext?: string | undefined
  /** Ngôn ngữ của cuộc trao đổi; quyết định cả prompt lẫn ngôn ngữ agent trả lời. */
  locale?: Locale | undefined
}): string {
  const locale: Locale = input.locale ?? 'vi'
  // `noUncheckedIndexedAccess` khiến `Record<Locale, T>[Locale]` là `T | undefined` dù
  // Record phủ đủ khoá; khẳng định tường minh ở đây thay vì để lỗi lan ra nơi gọi.
  const text = HANDOFF_TEXT[locale]!
  const lines = [text.intro(input.displayName), '', text.briefHeading, input.taskBrief.trim()]
  if (input.extraContext && input.extraContext.trim().length > 0) {
    lines.push('', text.contextHeading, input.extraContext.trim())
  }
  lines.push('', text.requirementsHeading, ...text.requirements)
  // Chỉ dẫn ngôn ngữ đặt CUỐI prompt và nói rõ ngôn ngữ hiệu lực. Câu này là thứ quyết
  // định agent trả lời bằng ngôn ngữ nào, thay cho việc phụ thuộc vào một câu cứng
  // trong prompt của seed — vốn luôn nói tiếng Việt.
  lines.push(
    '',
    '## Ngôn ngữ trả lời / Answer language',
    locale === 'en'
      ? 'Answer entirely in ENGLISH, including headings and the artifact summary. Knowledge base documents may be in Vietnamese or English; quote them as needed but write your own text in English.'
      : 'Trả lời hoàn toàn bằng TIẾNG VIỆT, kể cả tiêu đề và tóm tắt tài sản. Tài liệu trong kho kiến thức có thể là tiếng Việt hoặc tiếng Anh; được trích dẫn nguyên văn nhưng phần chữ của bạn phải là tiếng Việt.',
  )
  return lines.join('\n')
}

/**
 * Diễn giải kết quả lượt chạy thành một câu cho người đọc.
 *
 * Câu này hiện thẳng trong nhật ký công việc trên giao diện, nên phải theo ngôn ngữ
 * của phiên — nếu không thì giao diện tiếng Anh vẫn có nhật ký tiếng Việt.
 */
export function summarizeRun(run: AgentRunResult, displayName: string, locale: Locale = 'vi'): string {
  const tokens = run.usage.tokensIn + run.usage.tokensOut
  const chiTiet = locale === 'en' ? 'no further detail' : 'không rõ chi tiết'
  if (locale === 'en') {
    switch (run.stopReason) {
      case 'completed':
        return `${displayName} finished after ${run.steps} steps (${tokens} tokens, ${run.toolCalls.length} tool calls).`
      case 'max_steps':
        return `${displayName} stopped at the ${run.steps}-step limit — the task may need splitting.`
      case 'budget':
        return `${displayName} stopped: budget exceeded: ${run.error ?? chiTiet}`
      case 'output_limit':
        return `${displayName} stopped: output token limit reached: ${run.error ?? chiTiet}`
      case 'cancelled':
        return `${displayName} was cancelled on request.`
      case 'model_error':
        return `${displayName} failed due to a model error: ${run.error ?? chiTiet}`
    }
  }
  switch (run.stopReason) {
    case 'completed':
      return `${displayName} hoàn thành sau ${run.steps} bước (${tokens} token, ${run.toolCalls.length} lượt gọi công cụ).`
    case 'max_steps':
      return `${displayName} dừng vì chạm giới hạn ${run.steps} bước — có thể công việc cần chia nhỏ hơn.`
    case 'budget':
      return `${displayName} dừng vì vượt ngân sách: ${run.error ?? chiTiet}`
    case 'output_limit':
      return `${displayName} dừng vì hết hạn mức token đầu ra: ${run.error ?? chiTiet}`
    case 'cancelled':
      return `${displayName} đã bị huỷ theo yêu cầu.`
    case 'model_error':
      return `${displayName} thất bại do lỗi model: ${run.error ?? chiTiet}`
  }
}

/** Bọc lỗi chạy agent thành kết quả thất bại có lý do đọc được. */
export function describeRunFailure(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Dùng khi cần chắc chắn một giá trị không rỗng, kèm thông điệp tiếng Việt. */
export function requireNonEmpty(value: string | null | undefined, label: string): string {
  if (!value || value.trim().length === 0) throw toolError(`Thiếu ${label}`)
  return value.trim()
}
