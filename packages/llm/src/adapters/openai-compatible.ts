/**
 * Adapter cho mọi gateway OpenAI-compatible (bao gồm gateway nội bộ ở :20128).
 *
 * Vì sao gọi `stream: true` ngay từ đầu: người dùng thấy chữ chạy dần, và quan
 * trọng hơn là vòng lặp tool chỉ tốn một lượt gọi cho cả text lẫn tool_calls. Tool
 * call được gom theo `index` rồi chỉ phát ra khi luồng kết thúc, vì các gateway
 * bắn `arguments` thành nhiều mảnh JSON không thể parse riêng lẻ.
 */
import { AppError, providerError, type LlmChatRequest, type LlmChunk, type LlmMessage, type LlmToolCall, type LlmUsage } from '@marketing-agent/shared'
import { httpProviderError, type ProviderAdapter, type ProviderRuntimeConfig } from '../provider.ts'
import { parseSseStream } from '../sse.ts'

interface OpenAiDelta {
  readonly content?: string | readonly { readonly type: string; readonly text?: string }[] | null
  readonly reasoning_content?: string | null
  readonly reasoning?: string | null
  readonly tool_calls?: readonly OpenAiToolCallDelta[]
}

interface OpenAiToolCallDelta {
  readonly index?: number
  readonly id?: string
  readonly function?: { readonly name?: string; readonly arguments?: string }
}

interface OpenAiStreamChunk {
  readonly choices?: readonly { readonly delta?: OpenAiDelta; readonly finish_reason?: string | null }[]
  readonly usage?: {
    readonly prompt_tokens?: number
    readonly completion_tokens?: number
    readonly prompt_tokens_details?: { readonly cached_tokens?: number }
    readonly cache_read_input_tokens?: number
  } | null
}

interface PendingToolCall {
  id: string
  name: string
  args: string
}

const ZERO_USAGE: LlmUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
const MAX_SNIFF_BYTES = 4096
const MAX_JSON_BYTES = 8 * 1024 * 1024

type JsonObject = Record<string, unknown>
function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidResponse(): never {
  throw providerError('Nhà cung cấp trả về phản hồi ChatCompletion không hợp lệ', { details: { reason: 'invalid_response' } })
}

function contentText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return invalidResponse()
  return value.map((part: unknown) => {
    if (!object(part) || part.type !== 'text' || typeof part.text !== 'string') return invalidResponse()
    return part.text
  }).join('')
}

function validateDelta(value: unknown, full: boolean): OpenAiDelta {
  if (!object(value)) return invalidResponse()
  contentText(value.content)
  for (const key of ['reasoning_content', 'reasoning']) {
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string') invalidResponse()
  }
  if (value.tool_calls !== undefined) {
    if (!Array.isArray(value.tool_calls)) return invalidResponse()
    for (const call of value.tool_calls as unknown[]) {
      if (!object(call)) return invalidResponse()
      if (call.index !== undefined && (!Number.isInteger(call.index) || Number(call.index) < 0)) invalidResponse()
      if (call.id !== undefined && typeof call.id !== 'string') invalidResponse()
      if (call.function !== undefined && !object(call.function)) return invalidResponse()
      const fn = call.function as JsonObject | undefined
      if (fn?.name !== undefined && typeof fn.name !== 'string') invalidResponse()
      if (fn?.arguments !== undefined && typeof fn.arguments !== 'string') invalidResponse()
      if (full && (typeof fn?.name !== 'string' || !fn.name)) invalidResponse()
    }
  }
  return value as OpenAiDelta
}

function validateUsage(value: unknown): OpenAiStreamChunk['usage'] {
  if (value === undefined || value === null) return null
  if (!object(value)) return invalidResponse()
  for (const key of ['prompt_tokens', 'completion_tokens', 'cache_read_input_tokens']) {
    if (value[key] !== undefined && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || Number(value[key]) < 0)) invalidResponse()
  }
  if (value.prompt_tokens_details !== undefined && value.prompt_tokens_details !== null) {
    if (!object(value.prompt_tokens_details)) return invalidResponse()
    const cached = value.prompt_tokens_details.cached_tokens
    if (cached !== undefined && (typeof cached !== 'number' || !Number.isFinite(cached) || cached < 0)) invalidResponse()
  }
  return value as OpenAiStreamChunk['usage']
}

function parsePayload(data: string): JsonObject {
  let value: unknown
  try { value = JSON.parse(data) } catch { return invalidResponse() }
  if (!object(value) || value.error !== undefined || !Array.isArray(value.choices)) return invalidResponse()
  return value
}

/** Inspect at most a small prefix, regardless of unreliable gateway headers.
 * Replay bytes verbatim so an SSE connection is never buffered to completion. */
async function sniffProtocol(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{ json: boolean; chunks: Uint8Array[] }> {
  const chunks: Uint8Array[] = []
  const prefix = new Uint8Array(MAX_SNIFF_BYTES)
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (value) {
      chunks.push(value)
      const count = Math.min(value.byteLength, MAX_SNIFF_BYTES - size)
      prefix.set(value.subarray(0, count), size)
      size += count
    }
    const text = new TextDecoder().decode(prefix.subarray(0, size)).trimStart()
    if (text.startsWith('{') || text.startsWith('[')) return { json: true, chunks }
    if (/^(?:data:|event:|id:|retry:|:)/.test(text)) return { json: false, chunks }
    if (done || size === MAX_SNIFF_BYTES) return invalidResponse()
  }
}

/** Chuyển message nội bộ sang đúng schema OpenAI; chỉ thêm khoá khi thật sự có giá trị. */
export function toOpenAiMessages(messages: readonly LlmMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId ?? '',
        content: message.content.length > 0 ? message.content : '(không có nội dung)',
      }
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content.length > 0 ? message.content : null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.argumentsJson.length > 0 ? call.argumentsJson : '{}' },
        })),
      }
    }
    return { role: message.role, content: message.content }
  })
}

export function mapOpenAiUsage(usage: OpenAiStreamChunk['usage']): LlmUsage {
  if (!usage) return ZERO_USAGE
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0,
  }
}

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly kind = 'openai_compatible' as const

  constructor(private readonly config: ProviderRuntimeConfig) {}

  private endpoint(): string {
    return `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(this.config.headers ?? {}),
    }
    if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`
    return headers
  }

  private body(request: LlmChatRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAiMessages(request.messages),
      stream: true,
    }
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }))
    }
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
    if (request.temperature !== undefined) body.temperature = request.temperature
    if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort
    if (this.config.includeStreamUsage !== false) body.stream_options = { include_usage: true }
    return body
  }

  async *chat(request: LlmChatRequest): AsyncGenerator<LlmChunk> {
    const response = await fetch(this.endpoint(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(this.body(request)),
      ...(request.signal ? { signal: request.signal } : {}),
    })
    if (!response.ok) throw await httpProviderError(response)
    if (!response.body) throw providerError('Nhà cung cấp không trả về luồng dữ liệu', { details: { reason: 'invalid_response' } })

    const reader = response.body.getReader()
    let usage: LlmUsage | null = null
    try {
      const protocol = await sniffProtocol(reader)
      let bufferedIndex = 0
      let frameBytes = 0
      let delimiterTail = 0
      const checkFrameSize = (chunk: Uint8Array): void => {
        if (protocol.json) return
        for (const byte of chunk) {
          frameBytes++
          delimiterTail = ((delimiterTail << 8) | byte) >>> 0
          if ((delimiterTail & 0xffff) === 0x0a0a || delimiterTail === 0x0d0a0d0a) frameBytes = 0
          if (frameBytes > MAX_JSON_BYTES) throw providerError('Frame SSE của nhà cung cấp quá lớn', { details: { reason: 'invalid_response' } })
        }
      }
      // A pull-based replay keeps downstream cancellation and streaming backpressure.
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const buffered = protocol.chunks[bufferedIndex++]
          if (buffered) { checkFrameSize(buffered); controller.enqueue(buffered); return }
          const { done, value } = await reader.read()
          if (done) controller.close()
          else { checkFrameSize(value); controller.enqueue(value) }
        },
      }, { highWaterMark: 0 })
      const pending = new Map<number, PendingToolCall>()
      let finishReason: string | null = null
      let recognized = false
      let terminal = false

      const consume = function* (payload: JsonObject, full: boolean): Generator<LlmChunk> {
        const mappedUsage = validateUsage(payload.usage)
        if (mappedUsage) usage = mapOpenAiUsage(mappedUsage)
        const choices = payload.choices as unknown[]
        const choice = choices[0]
        if (choice !== undefined) {
          if (!object(choice)) return invalidResponse()
          const delta = validateDelta(full ? choice.message : choice.delta, full)
          if (choice.finish_reason !== undefined && choice.finish_reason !== null && typeof choice.finish_reason !== 'string') invalidResponse()
          if (full && !('content' in delta) && !('reasoning_content' in delta) && !('reasoning' in delta) && !delta.tool_calls?.length) invalidResponse()
          if (delta.content !== undefined || delta.reasoning_content !== undefined || delta.reasoning !== undefined || delta.tool_calls?.length || choice.finish_reason) recognized = true
          const text = contentText(delta.content)
          if (text) yield { type: 'text', text }
          const reasoning = delta.reasoning_content ?? delta.reasoning
          if (reasoning) yield { type: 'reasoning', text: reasoning }
          for (const [position, fragment] of (delta.tool_calls ?? []).entries()) {
            const index = full ? position : fragment.index ?? 0
            const entry = pending.get(index) ?? { id: '', name: '', args: '' }
            if (fragment.id) entry.id = fragment.id
            if (fragment.function?.name) entry.name = fragment.function.name
            if (fragment.function?.arguments) entry.args += fragment.function.arguments
            pending.set(index, entry)
          }
          if (choice.finish_reason) finishReason = choice.finish_reason as string
        } else if (full) invalidResponse()
      }

      if (protocol.json) {
        const jsonReader = body.getReader()
        const decoder = new TextDecoder()
        let data = ''
        let bytes = 0
        try {
          for (;;) {
            const { done, value } = await jsonReader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > MAX_JSON_BYTES) throw providerError('Phản hồi JSON của nhà cung cấp quá lớn', { details: { reason: 'invalid_response' } })
            data += decoder.decode(value, { stream: true })
          }
          data += decoder.decode()
        } finally { jsonReader.releaseLock() }
        yield* consume(parsePayload(data), true)
      } else {
        for await (const event of parseSseStream(body)) {
          const data = event.data.trim()
          if (!data) continue
          if (data === '[DONE]') { terminal = true; break }
          yield* consume(parsePayload(data), false)
        }
      }
      // A closed connection alone is not a successful completion: reject truncated
      // JSON/SSE instead of synthesizing stop (notably unsafe for structured output).
      if (!recognized || (!finishReason && !terminal)) {
        throw providerError('Nhà cung cấp trả về phản hồi ChatCompletion không hợp lệ', {
          details: { reason: 'invalid_response', ...(usage ? { usage } : {}) },
        })
      }
      const calls = [...pending.entries()].sort((a, b) => a[0] - b[0])
      for (const [index, entry] of calls) {
        if (!entry.name) invalidResponse()
        const call: LlmToolCall = {
          id: entry.id || `call_${index}`,
          name: entry.name,
          argumentsJson: entry.args || '{}',
        }
        yield { type: 'tool_call', call }
      }
      yield {
        type: 'done',
        finishReason: finishReason ?? (pending.size > 0 ? 'tool_calls' : 'stop'),
        usage: usage ?? ZERO_USAGE,
      }
    } catch (error) {
      if (usage && !(error instanceof Error && error.name === 'AbortError')) {
        const invalid = error instanceof AppError && object(error.details) && error.details.reason === 'invalid_response'
        throw providerError(invalid ? 'Nhà cung cấp trả về phản hồi ChatCompletion không hợp lệ' : 'Kết nối nhà cung cấp bị gián đoạn', {
          details: { reason: invalid ? 'invalid_response' : 'transport_error', usage },
          cause: error,
        })
      }
      throw error
    } finally {
      // An already-errored reader rejects cancel with its transport error; cleanup
      // must not replace the parsed protocol error (or its captured usage).
      try { await reader.cancel() } catch { /* preserve the original outcome */ }
      finally { reader.releaseLock() }
    }
  }
}
