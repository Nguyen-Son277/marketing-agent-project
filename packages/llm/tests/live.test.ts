/**
 * Smoke test tuỳ chọn chạy thật với gateway nội bộ.
 *
 * Vì sao tách khỏi bộ test thường: CI không được phụ thuộc mạng hay khoá API. Chỉ chạy
 * khi đặt `LLM_LIVE=1`, và cần `DEEPSEEK_API_KEY` trong môi trường.
 */
import { describe, expect, it } from 'vitest'
import { OpenAiCompatibleAdapter } from '../src/adapters/openai-compatible.ts'

const live = process.env.LLM_LIVE === '1'

describe('gateway nội bộ (tuỳ chọn)', () => {
  it.skipIf(!live)('stream một câu trả lời ngắn từ gateway OpenAI-compatible', async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY
    expect(apiKey, 'cần DEEPSEEK_API_KEY để chạy test live').toBeTruthy()

    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: process.env.DEFAULT_LLM_BASE_URL ?? 'http://localhost:20128/v1',
      apiKey,
    })

    let text = ''
    let sawDone = false
    for await (const chunk of adapter.chat({
      model: 'deepseek-v4-flash',
      maxTokens: 64,
      messages: [{ role: 'user', content: 'Trả lời đúng một từ tiếng Việt: xin chào' }],
    })) {
      if (chunk.type === 'text') text += chunk.text
      if (chunk.type === 'done') {
        sawDone = true
        expect(chunk.usage.promptTokens).toBeGreaterThan(0)
      }
    }

    expect(text.trim().length).toBeGreaterThan(0)
    expect(sawDone).toBe(true)
  })

  it.skipIf(!live)('gateway trả tool_calls đúng schema khi được cấp công cụ', async () => {
    const apiKey = process.env.DEEPSEEK_API_KEY
    const adapter = new OpenAiCompatibleAdapter({
      baseUrl: process.env.DEFAULT_LLM_BASE_URL ?? 'http://localhost:20128/v1',
      apiKey,
    })

    const calls = []
    for await (const chunk of adapter.chat({
      model: 'deepseek-v4-flash',
      maxTokens: 256,
      messages: [{ role: 'user', content: 'Tìm giúp tôi tài liệu về SEO. Hãy gọi công cụ kb.search.' }],
      tools: [
        {
          name: 'kb.search',
          description: 'Tìm tài liệu trong kho kiến thức công ty',
          parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        },
      ],
    })) {
      if (chunk.type === 'tool_call') calls.push(chunk.call)
    }

    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0]?.name).toBe('kb.search')
    expect(JSON.parse(calls[0]?.argumentsJson ?? '{}')).toHaveProperty('q')
  })
})
