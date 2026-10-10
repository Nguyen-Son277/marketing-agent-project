/**
 * Shared HTTP plumbing for outbound integration calls.
 *
 * Every external call in this package goes through here so timeout, abort
 * propagation and response-size limits are uniform. A tool that forgets one of
 * these becomes a way for an unresponsive third party to hang a run.
 */
import { toolError, truncate } from '@marketing-agent/shared'

export const DEFAULT_TIMEOUT_MS = 30_000
export const DEFAULT_MAX_BYTES = 4_000_000

/**
 * Fetch with a hard timeout that also honours the caller's abort signal.
 * `AbortSignal.timeout` is avoided because combining it with a caller signal
 * needs `AbortSignal.any`, which is not available on every supported runtime.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  externalSignal?: AbortSignal,
): Promise<Response> {
  if (externalSignal?.aborted) {
    throw toolError('Yêu cầu đã bị huỷ trước khi gọi dịch vụ ngoài')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Hết thời gian chờ')), timeoutMs)
  const onAbort = () => controller.abort(externalSignal?.reason)
  externalSignal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw toolError(`Dịch vụ ngoài không phản hồi sau ${timeoutMs}ms`)
    }
    throw toolError(`Không gọi được dịch vụ ngoài: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onAbort)
  }
}

/** Read a response body with a byte cap, so a huge payload cannot exhaust memory. */
export async function readBounded(response: Response, maxBytes = DEFAULT_MAX_BYTES): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw toolError(`Phản hồi quá lớn (${declared} byte > giới hạn ${maxBytes} byte)`)
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > maxBytes) {
    throw toolError(`Phản hồi quá lớn (${buffer.byteLength} byte > giới hạn ${maxBytes} byte)`)
  }
  return new TextDecoder('utf-8').decode(buffer)
}

/**
 * Parse a JSON response, converting a non-JSON body into a tool error that
 * includes a short excerpt — an HTML error page is the usual cause.
 */
export async function parseJsonResponse<T>(response: Response, maxBytes = DEFAULT_MAX_BYTES): Promise<T> {
  const text = await readBounded(response, maxBytes)
  if (text.trim().length === 0) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw toolError(
      `Dịch vụ ngoài trả về dữ liệu không phải JSON (HTTP ${response.status}): ${truncate(text, 300)}`,
    )
  }
}

/** POST a JSON body and fail with the provider's own error text when it errors. */
export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  options: { timeoutMs?: number; signal?: AbortSignal; maxBytes?: number } = {},
): Promise<T> {
  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    options.timeoutMs,
    options.signal,
  )
  const payload = await parseJsonResponse<Record<string, unknown>>(response, options.maxBytes)
  if (!response.ok) {
    throw toolError(
      `Dịch vụ ngoài trả lỗi HTTP ${response.status}: ${truncate(extractErrorMessage(payload), 400)}`,
    )
  }
  return payload as T
}

/** Pull the most useful message out of an error payload, across common shapes. */
export function extractErrorMessage(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return String(payload)
  const record = payload as Record<string, unknown>
  const error = record['error']
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null) {
    const nested = error as Record<string, unknown>
    if (typeof nested['message'] === 'string') return nested['message']
    if (typeof nested['detail'] === 'string') return nested['detail']
  }
  if (typeof record['message'] === 'string') return record['message']
  if (typeof record['detail'] === 'string') return record['detail']
  return JSON.stringify(payload).slice(0, 300)
}
