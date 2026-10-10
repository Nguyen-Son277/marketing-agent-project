/**
 * Vòng lặp model ⇄ công cụ — trái tim của một agent.
 *
 * Vì sao thiết kế như sau:
 *  - Mỗi bước gọi model một lần, thực thi song song các công cụ trong cùng bước: model
 *    thường xin nhiều kết quả độc lập, chạy tuần tự chỉ làm chậm mà không thêm an toàn.
 *  - Lỗi công cụ trở thành dữ liệu cho model, không phải lỗi của run: agent phải có cơ
 *    hội tự thoái lui, còn người dùng vẫn nhận được kết quả.
 *  - Công cụ ngoài grant bị chặn trước khi chạm vào handler, vì đây là biên bảo mật giữa
 *    các tenant và vai trò.
 *  - Lỗi nhà cung cấp thì retry rồi nâng tier; chỉ khi cả hai thất bại mới đánh dấu run
 *    hỏng. Ngân sách được kiểm tra trước mỗi lượt gọi để không tiêu thêm tiền.
 */
import {
  estimateTokens,
  isAppError,
  truncate,
  withRetry,
  type LlmChatRequest,
  type LlmMessage,
  type LlmToolCall,
  type LlmToolDefinition,
  type LlmUsage,
  type RunStatus,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from '@marketing-agent/shared'
import { isRetryableProviderError } from '@marketing-agent/llm'
import { compactMessages } from './context.ts'
import { buildSystemPrompt } from './prompt.ts'
import type {
  AgentRunInput,
  AgentRunResult,
  AgentRuntimeDeps,
  AgentStopReason,
  AgentToolCallLog,
  ChatAdapter,
  CompactionRecord,
} from './types.ts'

const DEFAULT_MAX_STEPS = 12
const DEFAULT_TOOL_TIMEOUT_MS = 30_000
const RETRY_ATTEMPTS = 3
/** Chỉ nâng model một lần mỗi run: nâng mãi sẽ đốt tiền mà không sửa được lỗi gốc. */
const MAX_ESCALATIONS = 1

const ZERO_USAGE: LlmUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }

interface ModelTurn {
  readonly text: string
  readonly toolCalls: readonly LlmToolCall[]
  readonly finishReason: string | null
  readonly usage: LlmUsage
}

interface ToolOutcome {
  readonly callId: string
  readonly name: string
  readonly content: string
}

/** Một lượt chạy agent từ đầu tới cuối; không ném lỗi ra ngoài cho lỗi model/công cụ. */
export async function runAgent(input: AgentRunInput, deps: AgentRuntimeDeps): Promise<AgentRunResult> {
  const agent = input.agent
  const maxSteps = Math.max(1, input.maxSteps ?? DEFAULT_MAX_STEPS)
  const toolTimeoutMs = input.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
  const granted = new Map(input.tools.map((tool) => [tool.name, tool]))
  const needsTools = input.tools.length > 0
  const startedAt = Date.now()

  // Chọn model trước khi mở run: nếu cấu hình thiếu model, ta ném lỗi mà không để lại
  // một bản ghi run treo ở trạng thái `running`.
  let choice = deps.router.chooseForAgent(agent, { needsTools })
  let modelId: string | null = choice.model.id

  const meter = deps.meterFactory({
    companyId: agent.companyId,
    agentDefId: agent.agentDef.id,
    taskId: input.context.taskId,
    conversationId: input.context.conversationId,
    providerId: agent.provider?.id ?? null,
    modelId: agent.model?.id ?? null,
  })

  const compactions: CompactionRecord[] = []
  const toolCallLogs: AgentToolCallLog[] = []
  const systemPrompt = input.systemPrompt?.trim() || buildSystemPrompt(agent, input.tools)
  let conversation: LlmMessage[] = [{ role: 'system', content: systemPrompt }, ...(input.messages ?? [])]

  let steps = 0
  let output = ''
  let partialText = ''
  let stopReason: AgentStopReason = 'completed'
  let errorMessage: string | null = null
  let escalations = 0

  try {
    for (let step = 1; step <= maxSteps; step += 1) {
      if (input.signal?.aborted) {
        stopReason = 'cancelled'
        errorMessage = 'Lượt chạy đã bị huỷ theo yêu cầu'
        break
      }

      if (input.budget) meter.checkBudget(agent.companyId, input.budget)

      if (input.maxOutputTokens !== undefined && meter.snapshot().tokensOut >= input.maxOutputTokens) {
        stopReason = 'output_limit'
        errorMessage = `Đã đạt giới hạn token đầu ra của lượt chạy (${input.maxOutputTokens})`
        break
      }

      const context = compactMessages(conversation, { budgetTokens: agent.preset.contextBudgetTokens })
      if (context.compacted) {
        conversation = [...context.messages]
        if (context.record) compactions.push(context.record)
      }

      const request: LlmChatRequest = {
        model: choice.model.modelId,
        messages: conversation,
        maxTokens: agent.preset.maxTokens ?? choice.model.maxOutput,
        ...(needsTools ? { tools: input.tools.map(toLlmToolDefinition) } : {}),
        ...(agent.preset.reasoningEffort ? { reasoningEffort: agent.preset.reasoningEffort } : {}),
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      }

      // `steps` đếm số lần gọi model thật, không phải số vòng lặp, để bản ghi chi phí
      // không tính cả những vòng bị chặn bởi ngân sách trước khi gọi.
      steps += 1
      let turn: ModelTurn
      try {
        const adapter = deps.adapter ?? deps.adapters.adapterFor(choice.model)
        turn = await withRetry(() => collectTurn(adapter, request, input.signal), {
          attempts: RETRY_ATTEMPTS,
          isRetryable: isRetryableProviderError,
        })
      } catch (thrown) {
        if (input.signal?.aborted || isAbortError(thrown)) {
          stopReason = 'cancelled'
          errorMessage = 'Lượt chạy đã bị huỷ theo yêu cầu'
          break
        }
        if (escalations < MAX_ESCALATIONS) {
          escalations += 1
          try {
            choice = deps.router.escalate(agent, choice.model.id)
            modelId = choice.model.id
            continue
          } catch (escalationError) {
            stopReason = 'model_error'
            errorMessage = `Không thể nâng cấp model sau lỗi nhà cung cấp: ${describeError(escalationError)}`
            break
          }
        }
        stopReason = 'model_error'
        errorMessage = `Nhà cung cấp LLM thất bại: ${describeError(thrown)}`
        break
      }

      const usage = normalizeUsage(turn.usage, conversation, turn.text)
      meter.addUsage(choice.model, usage)
      if (turn.text.trim().length > 0) partialText = turn.text

      if (turn.toolCalls.length === 0) {
        output = turn.text
        stopReason = 'completed'
        break
      }

      conversation.push({ role: 'assistant', content: turn.text, toolCalls: turn.toolCalls })

      if (input.maxOutputTokens !== undefined && meter.snapshot().tokensOut >= input.maxOutputTokens) {
        output = turn.text
        stopReason = 'output_limit'
        errorMessage = `Đã đạt giới hạn token đầu ra của lượt chạy (${input.maxOutputTokens})`
        break
      }

      const outcomes = await executeToolCalls(
        turn.toolCalls,
        granted,
        input.context,
        toolTimeoutMs,
        input.signal,
        toolCallLogs,
      )
      for (const outcome of outcomes) {
        conversation.push({ role: 'tool', toolCallId: outcome.callId, name: outcome.name, content: outcome.content })
      }

      if (step === maxSteps) {
        stopReason = 'max_steps'
        errorMessage = `Agent vẫn yêu cầu gọi công cụ sau ${maxSteps} bước; dừng để tránh lặp vô hạn`
      }
    }
  } catch (thrown) {
    if (isAppError(thrown) && thrown.code === 'budget_exceeded') {
      stopReason = 'budget'
      errorMessage = thrown.message
    } else {
      stopReason = 'model_error'
      errorMessage = describeError(thrown)
    }
  }

  if (output.length === 0) output = partialText
  const status = statusFor(stopReason)
  const usageSnapshot = meter.snapshot()

  try {
    meter.finish({ status, steps, latencyMs: Date.now() - startedAt, error: errorMessage, modelId })
  } catch (thrown) {
    // Ghi sổ thất bại không được làm mất câu trả lời agent đã tạo ra.
    input.context.log('Không ghi được bản ghi lượt chạy', { error: describeError(thrown) })
  }

  return {
    status,
    stopReason,
    output,
    steps,
    toolCalls: toolCallLogs,
    usage: usageSnapshot,
    runId: meter.runId,
    modelId,
    error: errorMessage,
    compactions,
  }
}

/** `RunStatus` là vocabulary chung của hệ thống; `AgentStopReason` chi tiết hơn cho log. */
export function statusFor(reason: AgentStopReason): RunStatus {
  switch (reason) {
    case 'completed':
      return 'succeeded'
    case 'budget':
    case 'output_limit':
      return 'budget_exceeded'
    case 'cancelled':
      return 'cancelled'
    case 'max_steps':
    case 'model_error':
      return 'failed'
  }
}

/** Bỏ handler và metadata trước khi gửi tool cho model — model không cần hàm JS. */
export function toLlmToolDefinition(tool: ToolDefinition): LlmToolDefinition {
  return { name: tool.name, description: tool.description, parameters: tool.parameters }
}

async function collectTurn(
  adapter: ChatAdapter,
  request: LlmChatRequest,
  signal: AbortSignal | undefined,
): Promise<ModelTurn> {
  let text = ''
  const toolCalls: LlmToolCall[] = []
  let finishReason: string | null = null
  let usage: LlmUsage = ZERO_USAGE

  for await (const chunk of adapter.chat(request)) {
    if (signal?.aborted) throw abortError()
    if (chunk.type === 'text') text += chunk.text
    else if (chunk.type === 'tool_call') toolCalls.push(chunk.call)
    else if (chunk.type === 'done') {
      finishReason = chunk.finishReason
      usage = chunk.usage
    }
  }

  return { text, toolCalls, finishReason, usage }
}

/**
 * Nhiều gateway không trả `usage` khi stream. Ước lượng tại chỗ để guard ngân sách không
 * bị vô hiệu một cách âm thầm — thà ước lượng thô còn hơn để chi phí trôi không kiểm soát.
 */
function normalizeUsage(usage: LlmUsage, messages: readonly LlmMessage[], text: string): LlmUsage {
  if (usage.promptTokens > 0 || usage.completionTokens > 0) return usage
  const promptText = messages.map((message) => messageContentForEstimate(message)).join('\n')
  return {
    promptTokens: estimateTokens(promptText),
    completionTokens: estimateTokens(text),
    cachedTokens: usage.cachedTokens,
  }
}

function messageContentForEstimate(message: LlmMessage): string {
  const calls = message.toolCalls?.map((call) => `${call.name} ${call.argumentsJson}`).join(' ') ?? ''
  return `${message.content} ${calls}`.trim()
}

async function executeToolCalls(
  calls: readonly LlmToolCall[],
  granted: ReadonlyMap<string, ToolDefinition>,
  context: ToolContext,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  logs: AgentToolCallLog[],
): Promise<ToolOutcome[]> {
  return Promise.all(
    calls.map(async (call): Promise<ToolOutcome> => {
      const startedAt = Date.now()
      const tool = granted.get(call.name)

      // Biên bảo mật: công cụ không được cấp thì không bao giờ chạm tới handler.
      if (!tool) {
        logs.push({ name: call.name, argumentsJson: call.argumentsJson, ok: false, durationMs: 0, error: 'not_granted' })
        return {
          callId: call.id,
          name: call.name,
          content: `[LỖI] Công cụ "${call.name}" không nằm trong phạm vi được cấp cho vai trò ${context.agentRole}. Hãy dùng công cụ đã cấp hoặc báo blocker cho Leader.`,
        }
      }

      let args: Record<string, unknown>
      try {
        args = parseArguments(call.argumentsJson)
      } catch (thrown) {
        logs.push({
          name: call.name,
          argumentsJson: call.argumentsJson,
          ok: false,
          durationMs: Date.now() - startedAt,
          error: describeError(thrown),
        })
        return {
          callId: call.id,
          name: call.name,
          content: `[LỖI] Không đọc được tham số của công cụ "${call.name}": ${describeError(thrown)}. Hãy gọi lại với JSON đúng schema.`,
        }
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const toolSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
        const result = await withTimeout(tool.handler(args, { ...context, signal: toolSignal }), timeoutMs)
        const durationMs = Date.now() - startedAt
        logs.push({
          name: call.name,
          argumentsJson: call.argumentsJson,
          ok: !result.isError,
          durationMs,
          error: result.isError ? truncate(result.content, 300) : null,
        })
        return { callId: call.id, name: call.name, content: formatToolResult(call.name, result) }
      } catch (thrown) {
        const durationMs = Date.now() - startedAt
        const message = controller.signal.aborted ? `quá thời gian ${timeoutMs}ms` : describeError(thrown)
        logs.push({ name: call.name, argumentsJson: call.argumentsJson, ok: false, durationMs, error: message })
        return {
          callId: call.id,
          name: call.name,
          content: `[LỖI] Công cụ "${call.name}" thất bại: ${message}. Hãy đổi cách tiếp cận hoặc báo blocker cho Leader thay vì thử lại y hệt.`,
        }
      } finally {
        clearTimeout(timer)
      }
    }),
  )
}

/**
 * `LlmMessage` không có trường `isError`, nên lỗi công cụ được mã hoá bằng tiền tố rõ
 * ràng để model phân biệt kết quả thật với thất bại.
 */
function formatToolResult(name: string, result: ToolResult): string {
  return result.isError ? `[LỖI] ${result.content}` : result.content
}

/**
 * Ép timeout kể cả khi handler bỏ qua `signal`: chỉ dựa vào abort thì một handler
 * không hợp tác sẽ treo cả lượt chạy.
 */
function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`quá thời gian ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function parseArguments(json: string): Record<string, unknown> {
  const trimmed = json.trim()
  if (trimmed.length === 0) return {}
  const parsed = JSON.parse(trimmed) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('tham số phải là một đối tượng JSON')
  }
  return parsed as Record<string, unknown>
}

function abortError(): Error {
  const error = new Error('Lượt chạy đã bị huỷ theo yêu cầu')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function describeError(error: unknown): string {
  if (isAppError(error)) return `${error.code}: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}
