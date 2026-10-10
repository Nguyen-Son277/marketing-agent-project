/**
 * Test adapter Anthropic bằng `fetch` giả.
 *
 * Trọng tâm: dịch đúng hai vocabulary khác nhau — `tool_use`/`tool_result` và system
 * prompt riêng — mà không làm lộ chi tiết đó ra vòng lặp tool.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnthropicAdapter, mapStopReason, toAnthropicMessages } from '../src/adapters/anthropic.ts'
import { collectChunks, doneOf, sseBody, stubFetch, textOf, toolCallsOf } from './helpers.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AnthropicAdapter', () => {
  it('stream text + tool_use và gộp usage từ message_start/message_delta', async () => {
    const body = sseBody([
      JSON.stringify({
        type: 'message_start',
        message: { usage: { input_tokens: 30, output_tokens: 0, cache_read_input_tokens: 10 } },
      }),
      JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Đang tra ' } }),
      JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'kb.search' } }),
      JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":"seo"}' } }),
      JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'cứu.' } }),
      JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 42 } }),
    ])
    const mock = stubFetch(() => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const adapter = new AnthropicAdapter({ baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant' })

    const chunks = await collectChunks(adapter, {
      model: 'claude-sonnet-5-5',
      maxTokens: 512,
      messages: [
        { role: 'system', content: 'Bạn là chuyên viên SEO.' },
        { role: 'user', content: 'Nghiên cứu từ khoá' },
        { role: 'assistant', content: '', toolCalls: [{ id: 't0', name: 'kb.read', argumentsJson: '{"id":"d1"}' }] },
        { role: 'tool', toolCallId: 't0', name: 'kb.read', content: 'Tài liệu cũ' },
      ],
      tools: [
        {
          name: 'kb.search',
          description: 'Tìm kiến thức',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ],
    })

    expect(textOf(chunks)).toBe('Đang tra cứu.')
    expect(toolCallsOf(chunks)).toEqual([{ id: 'toolu_1', name: 'kb.search', argumentsJson: '{"q":"seo"}' }])
    expect(doneOf(chunks).finishReason).toBe('tool_calls')
    expect(doneOf(chunks).usage).toEqual({ promptTokens: 40, completionTokens: 42, cachedTokens: 10 })

    const [url, init] = mock.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(sent.max_tokens).toBe(512)
    expect(sent.system).toBe('Bạn là chuyên viên SEO.')
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe('sk-ant')
    const tools = sent.tools as { name: string; input_schema: unknown }[]
    expect(tools[0]?.name).toBe('kb.search')
    expect(tools[0]?.input_schema).toMatchObject({ type: 'object' })
  })

  it('không thêm /v1 khi baseUrl đã kết thúc bằng /v1', () => {
    const adapter = new AnthropicAdapter({ baseUrl: 'http://gateway.test/v1/' })
    const body = sseBody([JSON.stringify({ type: 'message_stop' })])
    const mock = stubFetch(() => new Response(body, { status: 200 }))
    return collectChunks(adapter, { model: 'claude', messages: [] }).then(() => {
      expect(String(mock.mock.calls[0]?.[0])).toBe('http://gateway.test/v1/messages')
    })
  })

  it('gộp nhiều tool_result liên tiếp vào một message user và tách system', () => {
    const mapped = toAnthropicMessages([
      { role: 'system', content: 'Phần một' },
      { role: 'system', content: 'Phần hai' },
      { role: 'user', content: 'Câu hỏi' },
      { role: 'assistant', content: 'Gọi hai công cụ', toolCalls: [{ id: 'a', name: 'kb.read', argumentsJson: '{}' }, { id: 'b', name: 'kb.read', argumentsJson: '{}' }] },
      { role: 'tool', toolCallId: 'a', content: 'Kết quả A' },
      { role: 'tool', toolCallId: 'b', content: 'Kết quả B' },
    ])

    expect(mapped.system).toBe('Phần một\n\nPhần hai')
    expect(mapped.messages).toHaveLength(3)
    expect(mapped.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Câu hỏi' }] })
    expect(mapped.messages[1]?.role).toBe('assistant')
    expect(mapped.messages[2]?.role).toBe('user')
    expect(mapped.messages[2]?.content).toHaveLength(2)
  })

  it('quy đổi stop_reason sang vocabulary chung', () => {
    expect(mapStopReason('tool_use')).toBe('tool_calls')
    expect(mapStopReason('end_turn')).toBe('stop')
    expect(mapStopReason('max_tokens')).toBe('length')
    expect(mapStopReason(null)).toBe('stop')
  })
})
