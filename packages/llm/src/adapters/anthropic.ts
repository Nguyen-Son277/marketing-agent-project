/**
 * Adapter cho Anthropic Messages API (`/v1/messages`).
 *
 * Vì sao cần riêng: Anthropic không dùng chung vocabulary với OpenAI — `tool_use`
 * và `tool_result` là content block, system prompt là trường riêng, `max_tokens`
 * bắt buộc. Adapter này dịch hai chiều về `LlmMessage`/`LlmChunk` để vòng lặp tool
 * không phải biết mình đang nói chuyện với nhà cung cấp nào.
 */
import { providerError, truncate, type LlmChatRequest, type LlmChunk, type LlmMessage, type LlmToolCall, type LlmUsage } from '@marketing-agent/shared'
import { httpProviderError, type ProviderAdapter, type ProviderRuntimeConfig } from '../provider.ts'
import { parseSseStream } from '../sse.ts'

type ContentBlock = Record<string, unknown>

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

interface AnthropicEvent {
  readonly type?: string
  readonly index?: number
  readonly message?: { readonly usage?: AnthropicUsage }
  readonly content_block?: { readonly type?: string; readonly id?: string; readonly name?: string }
  readonly delta?: {
    readonly type?: string
    readonly text?: string
    readonly thinking?: string
    readonly partial_json?: string
    readonly stop_reason?: string | null
  }
  readonly usage?: AnthropicUsage
  readonly error?: { readonly type?: string; readonly message?: string }
}

interface AnthropicUsage {
  readonly input_tokens?: number
  readonly output_tokens?: number
  readonly cache_read_input_tokens?: number
  readonly cache_creation_input_tokens?: number
}

const ZERO_USAGE: LlmUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }

/**
 * Tách system prompt khỏi luồng message, và gộp các `tool_result` liên tiếp vào một
 * message `user` — Anthropic yêu cầu vai trò luân phiên, còn vòng lặp tool của ta có
 * thể trả về nhiều kết quả song song trong cùng một bước.
 */
export function toAnthropicMessages(messages: readonly LlmMessage[]): {
  system: string
  messages: AnthropicMessage[]
} {
  const systemParts: string[] = []
  const out: AnthropicMessage[] = []

  const push = (role: 'user' | 'assistant', blocks: ContentBlock[]): void => {
    const last = out[out.length - 1]
    const onlyToolResults = blocks.every((block) => block.type === 'tool_result')
    const lastOnlyToolResults = last?.content.every((block) => block.type === 'tool_result') ?? false
    if (last && onlyToolResults && lastOnlyToolResults && last.role === role) {
      last.content.push(...blocks)
      return
    }
    out.push({ role, content: blocks })
  }

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim().length > 0) systemParts.push(message.content)
      continue
    }
    if (message.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId ?? '',
          content: [{ type: 'text', text: message.content.length > 0 ? message.content : '(không có nội dung)' }],
        },
      ])
      continue
    }
    if (message.role === 'assistant') {
      const blocks: ContentBlock[] = []
      if (message.content.trim().length > 0) blocks.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: safeParseJson(call.argumentsJson) })
      }
      if (blocks.length === 0) blocks.push({ type: 'text', text: '(không có nội dung)' })
      push('assistant', blocks)
      continue
    }
    push('user', [{ type: 'text', text: message.content }])
  }

  return { system: systemParts.join('\n\n'), messages: out }
}

/** `stop_reason` của Anthropic quy về vocabulary chung để vòng lặp tool xử lý một kiểu. */
export function mapStopReason(stopReason: string | null | undefined): string {
  switch (stopReason) {
    case 'tool_use':
      return 'tool_calls'
    case 'max_tokens':
      return 'length'
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    case undefined:
    case null:
      return 'stop'
    default:
      return stopReason
  }
}

function safeParseJson(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return {}
  }
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly kind = 'anthropic' as const

  constructor(private readonly config: ProviderRuntimeConfig) {}

  private endpoint(): string {
    const base = this.config.baseUrl.replace(/\/+$/, '')
    return /\/v1$/.test(base) ? `${base}/messages` : `${base}/v1/messages`
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'anthropic-version': this.config.anthropicVersion ?? '2023-06-01',
      ...(this.config.headers ?? {}),
    }
    if (this.config.apiKey) headers['x-api-key'] = this.config.apiKey
    return headers
  }

  private body(request: LlmChatRequest): Record<string, unknown> {
    const { system, messages } = toAnthropicMessages(request.messages)
    const body: Record<string, unknown> = {
      model: request.model,
      // Anthropic bắt buộc trường này; không có giá trị thì để mức an toàn.
      max_tokens: request.maxTokens ?? 4096,
      messages,
      stream: true,
    }
    if (system.length > 0) body.system = system
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }))
    }
    if (request.temperature !== undefined) body.temperature = request.temperature
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

    const pending = new Map<number, { id: string; name: string; args: string }>()
    let promptTokens = 0
    let cachedTokens = 0
    let completionTokens = 0
    let finishReason = 'stop'

    for await (const event of parseSseStream(response.body)) {
      const data = event.data.trim()
      if (data.length === 0) continue
      let payload: AnthropicEvent
      try {
        payload = JSON.parse(data) as AnthropicEvent
      } catch {
        continue
      }

      switch (payload.type) {
        case 'message_start': {
          const usage = payload.message?.usage
          promptTokens = usage?.input_tokens ?? 0
          cachedTokens = usage?.cache_read_input_tokens ?? 0
          completionTokens = usage?.output_tokens ?? 0
          break
        }
        case 'content_block_start': {
          if (payload.content_block?.type === 'tool_use') {
            pending.set(payload.index ?? 0, {
              id: payload.content_block.id ?? `toolu_${payload.index ?? 0}`,
              name: payload.content_block.name ?? '',
              args: '',
            })
          }
          break
        }
        case 'content_block_delta': {
          const delta = payload.delta
          if (delta?.type === 'text_delta' && delta.text) yield { type: 'text', text: delta.text }
          else if (delta?.type === 'thinking_delta' && delta.thinking) yield { type: 'reasoning', text: delta.thinking }
          else if (delta?.type === 'input_json_delta' && delta.partial_json) {
            const entry = pending.get(payload.index ?? 0)
            if (entry) entry.args += delta.partial_json
          }
          break
        }
        case 'message_delta': {
          if (payload.usage?.output_tokens !== undefined) completionTokens = payload.usage.output_tokens
          if (payload.delta?.stop_reason !== undefined) finishReason = mapStopReason(payload.delta.stop_reason)
          break
        }
        case 'error': {
          throw providerError(
            `Anthropic trả lỗi: ${truncate(payload.error?.message ?? payload.error?.type ?? 'không rõ', 300)}`,
            { details: { status: 502, type: payload.error?.type } },
          )
        }
        default:
          break
      }
    }

    const ordered = [...pending.entries()].sort((a, b) => a[0] - b[0]).map(([, entry]) => entry)
    for (const entry of ordered) {
      if (entry.name.length === 0) continue
      const call: LlmToolCall = {
        id: entry.id,
        name: entry.name,
        argumentsJson: entry.args.length > 0 ? entry.args : '{}',
      }
      yield { type: 'tool_call', call }
    }

    // Token đọc từ cache vẫn là token đầu vào phải trả tiền; tách riêng để báo cáo.
    const usage: LlmUsage = {
      promptTokens: promptTokens + cachedTokens,
      completionTokens,
      cachedTokens,
    }
    yield { type: 'done', finishReason, usage: usage.completionTokens + usage.promptTokens === 0 ? ZERO_USAGE : usage }
  }
}
