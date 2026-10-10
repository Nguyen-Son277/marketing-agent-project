/**
 * Hợp đồng chung cho mọi adapter nhà cung cấp LLM.
 *
 * Vì sao tách riêng: registry, router và cost không cần biết wire protocol. Chúng
 * chỉ cần một đối tượng có `chat()` trả về luồng `LlmChunk`. Nhờ vậy thêm nhà cung
 * cấp mới chỉ là thêm một file adapter, không phải sửa vòng lặp tool hay router.
 */
import {
  isAppError,
  providerError,
  truncate,
  type LlmChunk,
  type LlmChatRequest,
  type ProviderKind,
} from '@marketing-agent/shared'
import { z } from 'zod'

/** Một nhà cung cấp đã được cấu hình đủ để gọi. */
export interface ProviderAdapter {
  readonly kind: ProviderKind
  chat(request: LlmChatRequest): AsyncIterable<LlmChunk>
}

/** Cấu hình runtime để dựng adapter: URL, khoá đã giải mã, header phụ. */
export interface ProviderRuntimeConfig {
  readonly baseUrl: string
  /** Khoá đã giải mã cho đúng request này; `undefined` là gateway nội bộ không cần khoá. */
  readonly apiKey?: string | undefined
  readonly headers?: Readonly<Record<string, string>> | undefined
  readonly anthropicVersion?: string | undefined
  /** Một số gateway chỉ trả `usage` khi bật `stream_options`; cho phép tắt nếu bị từ chối. */
  readonly includeStreamUsage?: boolean | undefined
}

/**
 * `extra_json` của provider là dữ liệu người dùng nhập, nên được kiểm tra thay vì
 * tin tưởng. Sai định dạng thì bỏ qua và dùng mặc định — một dòng cấu hình hỏng
 * không được làm sập cả lượt chạy.
 */
const ProviderExtraSchema = z
  .object({
    headers: z.record(z.string()).optional(),
    anthropicVersion: z.string().min(1).optional(),
    includeStreamUsage: z.boolean().optional(),
  })
  .passthrough()

export type ProviderExtra = z.infer<typeof ProviderExtraSchema>

export function parseProviderExtra(json: string | null | undefined): ProviderExtra {
  if (!json) return {}
  try {
    const parsed = ProviderExtraSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

/** Dựng `AppError` từ phản hồi HTTP lỗi, kèm status để retry biết có nên thử lại. */
export async function httpProviderError(response: Response): Promise<Error> {
  let body = ''
  try {
    body = await response.text()
  } catch {
    body = ''
  }
  return providerError(`Nhà cung cấp LLM trả lỗi ${response.status}`, {
    details: { status: response.status, body: truncate(body, 400) },
  })
}

/**
 * Lỗi tạm thời thì thử lại: mạng chập chờn, 429, 5xx. Lỗi 4xx do cấu hình (sai khoá,
 * sai model) không thử lại vì chỉ tốn thời gian và tiền.
 *
 * Ngoại lệ đã kiểm chứng: gateway định tuyến nội bộ có lúc trả 400 `bad_request`
 * cho một request hoàn toàn hợp lệ đang dùng công cụ (đo được 1–2 lần hỏng trong
 * 3 lần gọi cùng payload). Vì vậy 400 được thử lại CHỈ KHI thân lỗi mang dấu hiệu
 * `bad_request` của gateway VÀ không khớp các mẫu lỗi cấu hình đã biết. Nếu khớp
 * lỗi cấu hình thì vẫn không thử lại — thử lại một request sai chỉ tốn thời gian.
 */
const CONFIG_ERROR_PATTERNS = [
  /invalid[_ ]api[_ ]key/i,
  /incorrect api key/i,
  /model[_ ]not[_ ]found/i,
  /does not exist/i,
  /unsupported model/i,
  /no such model/i,
  /invalid[_ ]model/i,
  /context[_ ]length/i,
  /maximum context/i,
  /insufficient[_ ]quota/i,
  /billing/i,
]

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return false
  if (!isAppError(error)) return true
  if (error.code === 'rate_limited') return true
  if (error.code !== 'provider_error') return false
  const details = error.details as { status?: number; body?: string } | undefined
  const status = details?.status
  if (status === undefined) return true
  if (status === 408 || status === 409 || status === 429 || status >= 500) return true
  if (status === 400) return isTransientBadRequest(details?.body)
  return false
}

/** Gateway đôi khi trả 400 tạm thời; phân biệt với lỗi cấu hình thật. */
export function isTransientBadRequest(body: string | undefined): boolean {
  if (!body) return false
  const lowered = body.toLowerCase()
  if (!lowered.includes('bad_request')) return false
  return !CONFIG_ERROR_PATTERNS.some((pattern) => pattern.test(body))
}
