/**
 * Adapter cho mọi gateway OpenAI-compatible (bao gồm gateway nội bộ ở :20128).
 *
 * Vì sao gọi `stream: true` ngay từ đầu: người dùng thấy chữ chạy dần, và quan
 * trọng hơn là vòng lặp tool chỉ tốn một lượt gọi cho cả text lẫn tool_calls. Tool
 * call được gom theo `index` rồi chỉ phát ra khi luồng kết thúc, vì các gateway
 * bắn `arguments` thành nhiều mảnh JSON không thể parse riêng lẻ.
 */
import { providerError, type LlmChatRequest, type LlmChunk, type LlmMessage, type LlmToolCall, type LlmUsage } from '@marketing-agent/shared'
import { httpProviderError, type ProviderAdapter, type ProviderRuntimeConfig } from '../provider.ts'
import { parseSseStream } from '../sse.ts'

interface OpenAiDelta {
  readonly content?: string | null
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
    if (!response.body) throw providerError('Nhà cung cấp không trả về luồng dữ liệu')

    const pending = new Map<number, PendingToolCall>()
    let finishReason: string | null = null
    let usage: LlmUsage | null = null

    for await (const event of parseSseStream(response.body)) {
      const data = event.data.trim()
      if (data.length === 0) continue
      if (data === '[DONE]') break
      let payload: OpenAiStreamChunk
      try {
        payload = JSON.parse(data) as OpenAiStreamChunk
      } catch {
        // Gateway có thể chèn frame không phải JSON (keep-alive). Bỏ qua thay vì làm chết run.
        continue
      }

      const choice = payload.choices?.[0]
      const delta = choice?.delta
      if (delta?.content) yield { type: 'text', text: delta.content }
      const reasoning = delta?.reasoning_content ?? delta?.reasoning
      if (reasoning) yield { type: 'reasoning', text: reasoning }
      for (const fragment of delta?.tool_calls ?? []) {
        const index = fragment.index ?? 0
        const entry = pending.get(index) ?? { id: '', name: '', args: '' }
        if (fragment.id) entry.id = fragment.id
        if (fragment.function?.name) entry.name = fragment.function.name
        if (fragment.function?.arguments) entry.args += fragment.function.arguments
        pending.set(index, entry)
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason
      if (payload.usage) usage = mapOpenAiUsage(payload.usage)
    }

    const calls = [...pending.entries()].sort((a, b) => a[0] - b[0])
    for (const [index, entry] of calls) {
      // Mảnh thiếu tên là dữ liệu hỏng; phát ra sẽ khiến model gọi công cụ rỗng.
      if (entry.name.length === 0) continue
      const call: LlmToolCall = {
        id: entry.id.length > 0 ? entry.id : `call_${index}`,
        name: entry.name,
        argumentsJson: entry.args.length > 0 ? entry.args : '{}',
      }
      yield { type: 'tool_call', call }
    }

    yield {
      type: 'done',
      finishReason: finishReason ?? (pending.size > 0 ? 'tool_calls' : 'stop'),
      usage: usage ?? ZERO_USAGE,
    }
  }
}
