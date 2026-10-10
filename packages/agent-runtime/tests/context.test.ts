/**
 * Test nén context.
 *
 * Trọng tâm: chỉ nén khi vượt ngưỡng, giữ nguyên nhiệm vụ và kết quả công cụ gần nhất,
 * và không bao giờ để lại `tool` message mồ côi — lỗi khiến cả OpenAI lẫn Anthropic
 * từ chối request với 400 khó lần.
 */
import { describe, expect, it } from 'vitest'
import type { LlmMessage } from '@marketing-agent/shared'
import { compactMessages, estimateMessagesTokens } from '../src/context.ts'

function longConversation(): LlmMessage[] {
  const messages: LlmMessage[] = [
    { role: 'system', content: 'Bạn là agent marketing.' },
    { role: 'user', content: 'Nhiệm vụ: viết bài SEO về sản phẩm A. '.repeat(10) },
  ]
  for (let index = 0; index < 40; index += 1) {
    messages.push({
      role: 'assistant',
      content: `Bước ${index}: ${'phân tích từ khoá '.repeat(30)}`,
      toolCalls: [{ id: `call_${index}`, name: 'kb.search', argumentsJson: '{"q":"seo"}' }],
    })
    messages.push({
      role: 'tool',
      toolCallId: `call_${index}`,
      name: 'kb.search',
      content: `Kết quả ${index}: ${'dữ liệu thị trường '.repeat(30)}`,
    })
  }
  messages.push({
    role: 'tool',
    toolCallId: 'call_last',
    name: 'kb.read',
    content: 'KẾT QUẢ CUỐI CÙNG CẦN GIỮ NGUYÊN',
  })
  return messages
}

describe('compactMessages', () => {
  it('không nén khi còn dưới 70% ngân sách', () => {
    const messages: LlmMessage[] = [
      { role: 'system', content: 'Bạn là agent.' },
      { role: 'user', content: 'Câu hỏi ngắn' },
    ]
    const result = compactMessages(messages, { budgetTokens: 60_000 })

    expect(result.compacted).toBe(false)
    expect(result.record).toBeNull()
    expect(result.messages).toEqual(messages)
  })

  it('nén khi vượt ngưỡng, giữ brief và kết quả công cụ gần nhất', () => {
    const messages = longConversation()
    const before = estimateMessagesTokens(messages)
    const result = compactMessages(messages, { budgetTokens: 2_000 })

    expect(result.compacted).toBe(true)
    const record = result.record
    expect(record).not.toBeNull()
    expect(record?.reason).toContain('ngân sách')
    expect(record?.beforeTokens).toBe(before)
    expect(record?.afterTokens).toBeLessThan(before)
    expect(record?.compactedMessages).toBeGreaterThan(0)
    expect(record?.summary).toContain('Tóm tắt ngữ cảnh')

    // System gốc và brief ban đầu vẫn còn.
    expect(result.messages[0]?.content).toBe('Bạn là agent marketing.')
    expect(result.messages.some((message) => message.content.includes('viết bài SEO về sản phẩm A'))).toBe(true)
    // Kết quả công cụ gần nhất được giữ nguyên nội dung.
    expect(result.messages.some((message) => message.content.includes('KẾT QUẢ CUỐI CÙNG CẦN GIỮ NGUYÊN'))).toBe(true)
    // Bản tóm tắt có cấu trúc được chèn ngay sau system gốc.
    expect(result.messages[1]?.content).toContain('Tóm tắt ngữ cảnh')
  })

  it('không để lại tool message mồ côi hay assistant có tool call treo', () => {
    const result = compactMessages(longConversation(), { budgetTokens: 2_000 })

    expect(result.messages.every((message) => message.role !== 'tool')).toBe(true)
    expect(result.messages.every((message) => (message.toolCalls?.length ?? 0) === 0)).toBe(true)
  })

  it('trả nguyên trạng khi lịch sử quá ngắn để nén có ý nghĩa', () => {
    const messages: LlmMessage[] = [
      { role: 'system', content: `System dài. ${'x'.repeat(20_000)}` },
      { role: 'user', content: 'Việc cần làm' },
      { role: 'tool', toolCallId: 'c1', content: 'kết quả' },
    ]
    const result = compactMessages(messages, { budgetTokens: 100 })
    expect(result.compacted).toBe(false)
    expect(result.messages).toEqual(messages)
  })

  it('ước lượng token tăng theo nội dung', () => {
    expect(estimateMessagesTokens([{ role: 'user', content: 'a'.repeat(400) }])).toBeGreaterThan(50)
  })
})
