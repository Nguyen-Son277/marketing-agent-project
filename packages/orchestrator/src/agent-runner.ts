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
} from '@marketing-agent/shared'
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
  /** Ngữ cảnh bổ sung: kết quả các việc phụ thuộc, hướng dẫn của Leader. */
  readonly extraContext?: string | undefined
  readonly maxSteps?: number
  readonly signal?: AbortSignal | undefined
  readonly log?: ((message: string, data?: unknown) => void) | undefined
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
    grantedNames: resolved.toolNames,
  })

  const toolContext: ToolContext = {
    companyId: input.companyId,
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

  const taskPrompt = composeTaskPrompt({
    role: resolved.role,
    displayName: resolved.displayName,
    taskBrief: input.taskBrief,
    extraContext: input.extraContext,
  })

  const run = await runAgent(
    {
      agent: resolved,
      context: toolContext,
      messages: [{ role: 'user', content: taskPrompt }],
      tools: granted,
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
    summary: summarizeRun(run, resolved.displayName),
    toolCalls: run.toolCalls.map((call) => ({ name: call.name, ok: call.ok, durationMs: call.durationMs })),
  }
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
export function composeTaskPrompt(input: {
  role: AgentRole
  displayName: string
  taskBrief: string
  extraContext?: string | undefined
}): string {
  const lines = [
    `Bạn nhận một công việc từ Leader với vai trò ${input.displayName}.`,
    '',
    '## Nội dung công việc',
    input.taskBrief.trim(),
  ]
  if (input.extraContext && input.extraContext.trim().length > 0) {
    lines.push('', '## Ngữ cảnh kèm theo (kết quả các việc trước, hướng dẫn của Leader)', input.extraContext.trim())
  }
  lines.push(
    '',
    '## Yêu cầu bàn giao',
    '1. Kết quả phải trả lời trực tiếp công việc trên, không lan sang việc của chuyên môn khác.',
    '2. Mọi số liệu phải kèm nguồn: đường dẫn tài liệu trong kho kiến thức, hoặc kết quả công cụ.',
    '3. Dùng `artifact.publish` để công bố tài sản chính (báo cáo, kế hoạch, lịch, bảng) kèm tóm tắt ngắn.',
    '4. Kết thúc bằng mục "Cần xác nhận" liệt kê giả định và câu hỏi mở, nếu có.',
    '5. Nếu thiếu dữ liệu hoặc bị chặn: dùng `agent.escalate` nêu rõ đang thiếu gì, đã thử gì, và 2 phương án.',
    '6. Nếu cần thông tin mà chuyên môn khác đang giữ: dùng `agent.ask` thay vì tự suy đoán.',
  )
  return lines.join('\n')
}

/** Diễn giải kết quả lượt chạy thành một câu cho người đọc. */
export function summarizeRun(run: AgentRunResult, displayName: string): string {
  const tokens = run.usage.tokensIn + run.usage.tokensOut
  switch (run.stopReason) {
    case 'completed':
      return `${displayName} hoàn thành sau ${run.steps} bước (${tokens} token, ${run.toolCalls.length} lượt gọi công cụ).`
    case 'max_steps':
      return `${displayName} dừng vì chạm giới hạn ${run.steps} bước — có thể công việc cần chia nhỏ hơn.`
    case 'budget':
      return `${displayName} dừng vì vượt ngân sách: ${run.error ?? 'không rõ chi tiết'}`
    case 'output_limit':
      return `${displayName} dừng vì hết hạn mức token đầu ra: ${run.error ?? 'không rõ chi tiết'}`
    case 'cancelled':
      return `${displayName} đã bị huỷ theo yêu cầu.`
    case 'model_error':
      return `${displayName} thất bại do lỗi model: ${run.error ?? 'không rõ chi tiết'}`
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
