/**
 * Bộ đọc Server-Sent Events dùng chung cho mọi adapter.
 *
 * Vì sao tự viết thay vì dùng thư viện: chỉ cần vài chục dòng, không thêm phụ thuộc,
 * và quan trọng hơn là kiểm soát được việc gộp frame bị cắt qua nhiều gói TCP —
 * đây là lỗi phổ biến nhất khi tự parse SSE bằng `split('\n\n')` trên từng chunk.
 */
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

export interface SseEvent {
  /** Tên event nếu nhà cung cấp có khai báo (`event: ...`); Anthropic dùng trường này. */
  readonly event: string | null
  /** Nội dung `data:` đã gộp (nhiều dòng data ngăn bằng `\n`). */
  readonly data: string
}

/** Vị trí kết thúc một frame SSE và độ dài dấu phân cách, hỗ trợ cả LF và CRLF. */
function findFrameEnd(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n')
  const crlf = buffer.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return null
  if (crlf === -1 || (lf !== -1 && lf < crlf)) return { index: lf, length: 2 }
  return { index: crlf, length: 4 }
}

function parseFrame(frame: string): SseEvent | null {
  let event: string | null = null
  const data: string[] = []
  for (const rawLine of frame.split(/\r?\n/)) {
    // Dòng bắt đầu bằng ':' là comment/keep-alive — gateway hay gửi để giữ kết nối.
    if (rawLine.length === 0 || rawLine.startsWith(':')) continue
    const colon = rawLine.indexOf(':')
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon)
    let value = colon === -1 ? '' : rawLine.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0 && event === null) return null
  return { event, data: data.join('\n') }
}

/** Vòng lặp bất đồng bộ qua body, ưu tiên async iterator và lùi về reader khi cần. */
async function* iterateBody(body: WebReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const candidate = body as unknown as { [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array> }
  if (typeof candidate[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) yield chunk
    return
  }
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      if (value) yield value
    }
  } finally {
    reader.releaseLock()
  }
}

/** Phát ra từng frame SSE hoàn chỉnh; frame cuối không có dấu phân cách vẫn được xử lý. */
export async function* parseSseStream(body: WebReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of iterateBody(body)) {
    buffer += decoder.decode(chunk, { stream: true })
    for (;;) {
      const end = findFrameEnd(buffer)
      if (!end) break
      const frame = buffer.slice(0, end.index)
      buffer = buffer.slice(end.index + end.length)
      const parsed = parseFrame(frame)
      if (parsed) yield parsed
    }
  }
  buffer += decoder.decode()
  const tail = parseFrame(buffer)
  if (tail) yield tail
}
