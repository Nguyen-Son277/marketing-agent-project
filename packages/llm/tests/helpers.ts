/**
 * Tiện ích dùng chung cho test adapter.
 *
 * Vì sao cần: mọi test streaming đều phải giả lập một SSE body bị cắt thành nhiều gói
 * nhỏ — đúng cách mạng thật hành xử — để chứng minh bộ đọc frame không phụ thuộc việc
 * một frame nằm gọn trong một chunk.
 */
import type { LlmChatRequest, LlmChunk, LlmToolCall } from '@marketing-agent/shared'
import { ReadableStream } from 'node:stream/web'
import { vi, type Mock } from 'vitest'
import type { ProviderAdapter } from '../src/provider.ts'

export type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** Ghép các payload JSON thành body SSE với dấu phân cách chuẩn. */
export function sseBody(frames: readonly string[]): string {
  return frames.map((frame) => `data: ${frame}\n\n`).join('')
}

/** Response SSE phát body theo từng mảnh nhỏ để kiểm tra việc gộp frame. */
export function streamResponse(body: string, chunkSize = 9): Response {
  const bytes = new TextEncoder().encode(body)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.subarray(offset, offset + chunkSize))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

/** Thay `fetch` toàn cục bằng hàm giả, trả về mock để assert request đã gửi. */
export function stubFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>): Mock<FetchFn> {
  const mock = vi.fn<FetchFn>(async (input, init) => handler(String(input), init))
  vi.stubGlobal('fetch', mock)
  return mock
}

export async function collectChunks(adapter: ProviderAdapter, request: LlmChatRequest): Promise<LlmChunk[]> {
  const chunks: LlmChunk[] = []
  for await (const chunk of adapter.chat(request)) chunks.push(chunk)
  return chunks
}

export function textOf(chunks: readonly LlmChunk[]): string {
  return chunks
    .filter((chunk): chunk is Extract<LlmChunk, { type: 'text' }> => chunk.type === 'text')
    .map((chunk) => chunk.text)
    .join('')
}

export function reasoningOf(chunks: readonly LlmChunk[]): string {
  return chunks
    .filter((chunk): chunk is Extract<LlmChunk, { type: 'reasoning' }> => chunk.type === 'reasoning')
    .map((chunk) => chunk.text)
    .join('')
}

export function toolCallsOf(chunks: readonly LlmChunk[]): LlmToolCall[] {
  return chunks
    .filter((chunk): chunk is Extract<LlmChunk, { type: 'tool_call' }> => chunk.type === 'tool_call')
    .map((chunk) => chunk.call)
}

export function doneOf(chunks: readonly LlmChunk[]): Extract<LlmChunk, { type: 'done' }> {
  const done = chunks.find((chunk): chunk is Extract<LlmChunk, { type: 'done' }> => chunk.type === 'done')
  if (!done) throw new Error('Luồng thiếu chunk done')
  return done
}
