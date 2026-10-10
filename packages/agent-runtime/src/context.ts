/**
 * Quản lý context: ước lượng token và nén lịch sử khi gần đầy.
 *
 * Vì sao cần nén thay vì cắt bừa: một run có thể gọi hàng chục công cụ với kết quả dài;
 * nếu cắt mất phần đầu, model quên mất brief và mục tiêu. Cách nén ở đây giữ nguyên
 * nhiệm vụ ban đầu, ghi lại diễn biến chính và giữ nguyên kết quả công cụ gần nhất —
 * đồng thời chuyển lịch sử cũ về dạng văn bản thuần để không bao giờ tạo ra `tool`
 * message mồ côi (lỗi 400 rất khó lần ở cả OpenAI lẫn Anthropic).
 */
import { estimateTokens, nowIso, truncate, type LlmMessage } from '@marketing-agent/shared'
import type { CompactionRecord } from './types.ts'

export interface CompactionOptions {
  /** Ngân sách context của preset (`context_budget_tokens`). */
  readonly budgetTokens: number
  /** Tỉ lệ ngân sách bắt đầu nén; mặc định 0,7 theo yêu cầu. */
  readonly thresholdRatio?: number
  /** Số message gần nhất giữ nguyên (đã chuyển về văn bản thuần). */
  readonly keepRecent?: number
}

export interface CompactionResult {
  readonly messages: readonly LlmMessage[]
  readonly compacted: boolean
  readonly record: CompactionRecord | null
}

/** Ước lượng token của một message, tính cả tool call vì chúng cũng chiếm context. */
export function estimateMessageTokens(message: LlmMessage): number {
  const toolCallTokens =
    message.toolCalls?.reduce((sum, call) => sum + estimateTokens(call.name) + estimateTokens(call.argumentsJson), 0) ?? 0
  return estimateTokens(message.content) + toolCallTokens + 4
}

export function estimateMessagesTokens(messages: readonly LlmMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0)
}

/** Tóm tắt có cấu trúc phần hội thoại bị bỏ lại phía sau. */
function buildSummary(task: LlmMessage, middle: readonly LlmMessage[]): string {
  const lines: string[] = ['## Tóm tắt ngữ cảnh (đã nén để tiết kiệm token)']
  lines.push(`- Nhiệm vụ/brief: ${truncate(task.content.trim() || '(không có nội dung)', 800)}`)

  const highlights = middle
    .filter((message) => message.role === 'assistant' || message.role === 'user')
    .slice(-10)
    .map((message, index) => {
      const who = message.role === 'assistant' ? 'agent' : 'người dùng'
      const called = message.toolCalls?.map((call) => call.name).join(', ')
      const suffix = called && called.length > 0 ? ` [đã gọi: ${called}]` : ''
      return `  ${index + 1}. ${who}: ${truncate(message.content.replace(/\s+/g, ' ').trim(), 200)}${suffix}`
    })
  if (highlights.length > 0) lines.push('- Diễn biến chính:', ...highlights)

  const toolResults = middle.filter((message) => message.role === 'tool')
  const lastTool = toolResults[toolResults.length - 1]
  if (lastTool) {
    lines.push(`- Kết quả công cụ đáng chú ý (${lastTool.name ?? 'không rõ tên'}): ${truncate(lastTool.content, 1_200)}`)
  }
  lines.push('- Lưu ý: hội thoại cũ đã được nén; nếu cần chi tiết, hãy gọi lại công cụ thay vì suy đoán.')
  return lines.join('\n')
}

/** Chuyển lịch sử về dạng chỉ có system/user/assistant, không còn tool call mồ côi. */
function toSafeHistory(messages: readonly LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = []
  for (const message of messages) {
    if (message.role === 'assistant') {
      const called = message.toolCalls?.map((call) => call.name) ?? []
      const suffix = called.length > 0 ? `\n[đã gọi công cụ: ${called.join(', ')}]` : ''
      const content = `${message.content}${suffix}`.trim()
      if (content.length > 0) out.push({ role: 'assistant', content })
      continue
    }
    if (message.role === 'tool') {
      const label = message.name ? ` ${message.name}` : ''
      out.push({ role: 'user', content: `[Kết quả công cụ${label}]\n${message.content}` })
      continue
    }
    out.push({ role: message.role, content: message.content })
  }
  return out
}

/**
 * Nén nếu vượt ngưỡng. Trả về cả `record` để caller ghi vào `messages.meta_json` —
 * nhờ vậy có thể giải thích về sau vì sao model "quên" một đoạn hội thoại.
 */
export function compactMessages(messages: readonly LlmMessage[], options: CompactionOptions): CompactionResult {
  const ratio = options.thresholdRatio ?? 0.7
  const before = estimateMessagesTokens(messages)
  const threshold = Math.floor(options.budgetTokens * ratio)

  if (messages.length === 0 || before <= threshold) {
    return { messages: [...messages], compacted: false, record: null }
  }

  const leading: LlmMessage[] = []
  let index = 0
  while (index < messages.length) {
    const message = messages[index]
    if (!message || message.role !== 'system') break
    leading.push(message)
    index += 1
  }

  const body = messages.slice(index)
  // Cần tối thiểu brief + phần ở giữa + phần giữ lại mới nén được.
  if (body.length <= 2) return { messages: [...messages], compacted: false, record: null }

  const keepRecent = Math.max(1, options.keepRecent ?? 6)
  const start = Math.max(1, body.length - keepRecent)
  const task = body[0]
  if (!task) return { messages: [...messages], compacted: false, record: null }
  const middle = body.slice(1, start)
  if (middle.length === 0) return { messages: [...messages], compacted: false, record: null }

  const summary = buildSummary(task, middle)
  const compactedMessages: LlmMessage[] = [
    ...leading,
    { role: 'system', content: summary },
    task,
    ...toSafeHistory(body.slice(start)),
  ]
  const after = estimateMessagesTokens(compactedMessages)

  return {
    messages: compactedMessages,
    compacted: true,
    record: {
      reason: `Vượt ${Math.round(ratio * 100)}% ngân sách context (${before}/${options.budgetTokens} token)`,
      beforeTokens: before,
      afterTokens: after,
      compactedMessages: middle.length,
      at: nowIso(),
      summary,
    },
  }
}
