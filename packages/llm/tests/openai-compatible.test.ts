/**
 * Test adapter OpenAI-compatible bằng `fetch` giả — không chạm mạng.
 *
 * Trọng tâm: body SSE bị cắt vụn vẫn phải ghép đúng câu, và `tool_calls` đến từng mảnh
 * JSON vẫn phải được dựng lại thành một lời gọi hoàn chỉnh.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '@marketing-agent/shared'
import { OpenAiCompatibleAdapter, toOpenAiMessages } from '../src/adapters/openai-compatible.ts'
import { isRetryableProviderError } from '../src/provider.ts'
import { collectChunks, doneOf, sseBody, streamResponse, stubFetch, textOf, toolCallsOf } from './helpers.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const request = { model: 'deepseek-v4-flash', messages: [{ role: 'user' as const, content: 'Chào bạn' }] }

describe('OpenAiCompatibleAdapter', () => {
  it('ghép text delta thành câu hoàn chỉnh dù frame bị cắt qua nhiều chunk', async () => {
    const body = sseBody([
      JSON.stringify({ choices: [{ delta: { content: 'Xin ' }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ delta: { content: 'chào ' }, finish_reason: null }] }),
      JSON.stringify({ choices: [{ delta: { content: 'bạn' }, finish_reason: 'stop' }] }),
      JSON.stringify({
        choices: [],
        usage: { prompt_tokens: 11, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 5 } },
      }),
    ])
    const mock = stubFetch(() => streamResponse(body, 7))
    const adapter = new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test/v1/', apiKey: 'sk-test' })

    const chunks = await collectChunks(adapter, { ...request, maxTokens: 64, tools: [] })

    expect(textOf(chunks)).toBe('Xin chào bạn')
    expect(toolCallsOf(chunks)).toEqual([])
    expect(doneOf(chunks).finishReason).toBe('stop')
    expect(doneOf(chunks).usage).toEqual({ promptTokens: 11, completionTokens: 3, cachedTokens: 5 })

    expect(mock).toHaveBeenCalledTimes(1)
    const [url, init] = mock.mock.calls[0]!
    expect(url).toBe('http://gateway.test/v1/chat/completions')
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    const sent = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(sent.stream).toBe(true)
    expect(sent.max_tokens).toBe(64)
    expect(sent.messages).toEqual([{ role: 'user', content: 'Chào bạn' }])
  })

  it('dựng lại tool_call từ nhiều mảnh arguments và giữ nguyên id', async () => {
    const body = sseBody([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'kb.search', arguments: '' } }],
            },
            finish_reason: null,
          },
        ],
      }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"giá"}' } }] } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      JSON.stringify({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 8 } }),
    ])
    stubFetch(() => streamResponse(body, 5))
    const adapter = new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test/v1' })

    const chunks = await collectChunks(adapter, {
      ...request,
      tools: [
        {
          name: 'kb.search',
          description: 'Tìm trong kho kiến thức',
          parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
      ],
    })

    expect(toolCallsOf(chunks)).toEqual([
      { id: 'call_1', name: 'kb.search', argumentsJson: '{"q":"giá"}' },
    ])
    expect(doneOf(chunks).finishReason).toBe('tool_calls')
    expect(doneOf(chunks).usage).toEqual({ promptTokens: 20, completionTokens: 8, cachedTokens: 0 })
  })

  it('ném provider_error kèm status khi gateway trả 401, và không retry lỗi cấu hình', async () => {
    stubFetch(() => new Response('Missing API key', { status: 401 }))
    const adapter = new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test/v1' })

    const error = await adapter
      .chat(request)
      .next()
      .then(() => null)
      .catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('provider_error')
    expect((error as AppError).details).toMatchObject({ status: 401 })
    expect(isRetryableProviderError(error)).toBe(false)
    expect(isRetryableProviderError(new AppError('provider_error', 'x', { details: { status: 503 } }))).toBe(true)
  })

  it('dịch message nội bộ sang schema OpenAI, gồm tool_calls và tool result', () => {
    expect(
      toOpenAiMessages([
        { role: 'system', content: 'Bạn là trợ lý' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'kb.read', argumentsJson: '{"id":"d1"}' }] },
        { role: 'tool', toolCallId: 'c1', name: 'kb.read', content: 'Nội dung tài liệu' },
      ]),
    ).toEqual([
      { role: 'system', content: 'Bạn là trợ lý' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'kb.read', arguments: '{"id":"d1"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'Nội dung tài liệu' },
    ])
  })
})
