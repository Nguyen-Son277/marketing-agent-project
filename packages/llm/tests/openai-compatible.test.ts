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
import { collectChunks, doneOf, reasoningOf, sseBody, streamResponse, stubFetch, textOf, toolCallsOf } from './helpers.ts'

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
              tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'kb_search', arguments: '' } }],
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
          name: 'kb_search',
          description: 'Tìm trong kho kiến thức',
          parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
      ],
    })

    expect(toolCallsOf(chunks)).toEqual([
      { id: 'call_1', name: 'kb_search', argumentsJson: '{"q":"giá"}' },
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

  it.each([undefined, 'application/json', 'text/event-stream', 'text/plain'])('accepts JSON despite Content-Type %s', async (header) => {
    const payload = {
      object: 'chat.completion',
      choices: [{ message: { role: 'assistant', content: [{ type: 'text', text: 'Xin ' }, { type: 'text', text: 'chào 🌏' }], reasoning_content: 'private reasoning' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 12, completion_tokens: 9, cache_read_input_tokens: 4 },
    }
    const response = streamResponse('\ufeff  ' + JSON.stringify(payload), 1)
    response.headers.delete('content-type')
    if (header) response.headers.set('content-type', header)
    const mock = stubFetch(() => response)
    const chunks = await collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), { ...request, maxTokens: 37 })
    expect(textOf(chunks)).toBe('Xin chào 🌏')
    expect(reasoningOf(chunks)).toBe('private reasoning')
    expect(doneOf(chunks)).toEqual({ type: 'done', finishReason: 'length', usage: { promptTokens: 12, completionTokens: 9, cachedTokens: 4 } })
    expect(mock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(mock.mock.calls[0]![1]?.body))).toMatchObject({ stream: true, max_tokens: 37 })
    expect(JSON.parse(String(mock.mock.calls[0]![1]?.body))).not.toHaveProperty('json_mode')
  })

  it('maps complete JSON tool calls independently, including missing ids/default arguments', async () => {
    stubFetch(() => Response.json({ choices: [{ message: { content: null, reasoning: 'thinking', tool_calls: [
      { id: 'first', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } },
      { type: 'function', function: { name: 'read', arguments: '' } },
    ] }, finish_reason: 'tool_calls' }] }))
    const chunks = await collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), request)
    expect(textOf(chunks)).toBe('')
    expect(reasoningOf(chunks)).toBe('thinking')
    expect(toolCallsOf(chunks)).toEqual([{ id: 'first', name: 'search', argumentsJson: '{"q":"x"}' }, { id: 'call_1', name: 'read', argumentsJson: '{}' }])
    expect(doneOf(chunks).finishReason).toBe('tool_calls')
    expect(doneOf(chunks).usage).toEqual({ promptTokens: 0, completionTokens: 0, cachedTokens: 0 })
  })

  it.each([undefined, 'application/json', 'text/event-stream', 'text/plain'])('sniffs SSE despite Content-Type %s', async (header) => {
    const response = streamResponse(': heartbeat\r\n\r\n' + sseBody([
      JSON.stringify({ choices: [{ delta: { reasoning: 'plan' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'answer' }, finish_reason: 'length' }] }), '[DONE]',
    ]), 1)
    response.headers.delete('content-type')
    if (header) response.headers.set('content-type', header)
    stubFetch(() => response)
    const chunks = await collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), request)
    expect(textOf(chunks)).toBe('answer')
    expect(reasoningOf(chunks)).toBe('plan')
    expect(doneOf(chunks).finishReason).toBe('length')
  })

  it('emits SSE text before connection ends and cancels on early return', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(sseBody([JSON.stringify({ choices: [{ delta: { content: 'early' } }] })]))) },
      cancel,
    })
    stubFetch(() => new Response(stream, { headers: { 'content-type': 'application/json' } }))
    const generator = new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }).chat(request)
    expect(await generator.next()).toEqual({ done: false, value: { type: 'text', text: 'early' } })
    await generator.return(undefined)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each([
    '', '<html>gateway failed</html>', '{broken', '{}', '[]', '{"choices":[]}',
    '{"error":{"message":"secret"}}',
    '{"choices":[{"message":{"content":"truncated"}}]}',
    'data: {"choices":[{"delta":{"content":"truncated"}}]}\n\n',
    '{"choices":[{"message":{}}]}',
    '{"choices":[{"message":{"content":123}}]}',
    '{"choices":[{"message":{"content":[{"type":"image_url","image_url":"x"}]}}]}',
    '{"choices":[{"message":{"tool_calls":[{"function":{"arguments":"{}"}}]}}]}',
    '{"choices":[{"message":{"content":"ok"},"finish_reason":9}]}',
    '{"choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":"12"}}',
    'data: [DONE]\n\n', 'data: {broken\n\n', 'data: {}\n\n',
    'data: {"choices":[]}\n\n', 'data: {"choices":[{"delta":{}}]}\n\n',
    'data: {"error":{"message":"secret"}}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{}"}}]}}]}\n\n',
  ])('rejects malformed/unrecognized HTTP 200 response %s', async (body) => {
    const mock = stubFetch(() => streamResponse(body, 3))
    await expect(collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), request)).rejects.toMatchObject({ code: 'provider_error' })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('bounds unknown prefix sniffing and cancels reader', async () => {
    let pulls = 0
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode(' '.repeat(512))) }, cancel })
    stubFetch(() => new Response(stream))
    await expect(collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), request)).rejects.toMatchObject({ code: 'provider_error' })
    expect(pulls).toBeLessThanOrEqual(9)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('bounds JSON body buffering and cancels oversized response', async () => {
    let pulls = 0
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode(pulls === 1 ? '{' : ' '.repeat(1024 * 1024))) }, cancel })
    stubFetch(() => new Response(stream))
    await expect(collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), request)).rejects.toMatchObject({ code: 'provider_error' })
    expect(pulls).toBeLessThanOrEqual(11)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('accepts DONE marker without finish_reason and preserves empty valid completions', async () => {
    stubFetch(() => streamResponse(sseBody([JSON.stringify({ choices: [{ delta: { content: 'answer' } }] }), '[DONE]'])))
    expect(doneOf(await collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), request)).finishReason).toBe('stop')
    stubFetch(() => Response.json({ choices: [{ message: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens_details: null } }))
    expect(textOf(await collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), request))).toBe('')
  })

  it('retains known usage in safe invalid_response error details on malformed tail', async () => {
    stubFetch(() => streamResponse(sseBody([
      JSON.stringify({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } }), '{broken',
    ])))
    await expect(collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), request)).rejects.toMatchObject({
      code: 'provider_error', details: { reason: 'invalid_response', usage: { promptTokens: 7, completionTokens: 2, cachedTokens: 0 } },
    })
  })

  it.each(['', '\n\r\r\n'])('bounds SSE frames even with false delimiter %j', async (falseDelimiter) => {
    let pulls = 0
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode(pulls === 1 ? 'data: ' : (' '.repeat(1024 * 1024) + falseDelimiter))) }, cancel })
    stubFetch(() => new Response(stream))
    await expect(collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), request)).rejects.toMatchObject({ code: 'provider_error' })
    expect(pulls).toBeLessThanOrEqual(11)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('keeps transport failures transient after usage and preserves AbortError', async () => {
    for (const error of [new TypeError('network reset'), new DOMException('cancelled', 'AbortError')]) {
      let reads = 0
      const stream = new ReadableStream<Uint8Array>({ pull(controller) {
        if (reads++ === 0) controller.enqueue(new TextEncoder().encode(sseBody([JSON.stringify({ choices: [], usage: { prompt_tokens: 7 } })])))
        else controller.error(error)
      } })
      stubFetch(() => new Response(stream))
      const promise = collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), request)
      if (error.name === 'AbortError') await expect(promise).rejects.toBe(error)
      else await expect(promise).rejects.toMatchObject({ code: 'provider_error', details: { reason: 'transport_error', usage: { promptTokens: 7 } } })
    }
  })

  it('rejects absent body and propagates transport failure without success', async () => {
    stubFetch(() => new Response(null))
    await expect(collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), request)).rejects.toMatchObject({ code: 'provider_error' })
    stubFetch(() => new Response(new ReadableStream({ start(controller) { controller.error(new Error('connection lost')) } })))
    await expect(collectChunks(new OpenAiCompatibleAdapter({ baseUrl: 'http://gateway.test' }), request)).rejects.toThrow('connection lost')
  })

  it('dịch message nội bộ sang schema OpenAI, gồm tool_calls và tool result', () => {
    expect(
      toOpenAiMessages([
        { role: 'system', content: 'Bạn là trợ lý' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'kb_read', argumentsJson: '{"id":"d1"}' }] },
        { role: 'tool', toolCallId: 'c1', name: 'kb_read', content: 'Nội dung tài liệu' },
      ]),
    ).toEqual([
      { role: 'system', content: 'Bạn là trợ lý' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'kb_read', arguments: '{"id":"d1"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'Nội dung tài liệu' },
    ])
  })
})
