/**
 * Standardized error vocabulary. Every layer throws `AppError` subclasses so the
 * HTTP boundary can map failures to stable status codes without string matching.
 */

export type AppErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'provider_error'
  | 'tool_error'
  | 'needs_configuration'
  | 'budget_exceeded'
  | 'internal'

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
  conflict: 409,
  rate_limited: 429,
  provider_error: 502,
  tool_error: 502,
  needs_configuration: 424,
  budget_exceeded: 429,
  internal: 500,
}

export interface AppErrorOptions {
  /** Non-sensitive diagnostic detail; never include secrets or raw API keys. */
  readonly details?: unknown
  readonly cause?: unknown
  /**
   * Khoá dịch cho thông báo này, ví dụ `errors.auth.invalidCredentials`.
   *
   * Vì sao vừa có `message` vừa có `messageKey`: `message` là câu tiếng Việt mặc định
   * nên mọi chỗ chưa kịp gắn khoá vẫn hiển thị được, không bao giờ trắng chữ. Khi có
   * khoá, tầng biên HTTP dịch lại theo ngôn ngữ của yêu cầu, và trả khoá về cho trình
   * duyệt để nó dịch theo ngôn ngữ giao diện. Nhờ vậy không phải sửa toàn bộ call site
   * cùng lúc.
   */
  readonly messageKey?: string
  /** Tham số nội suy cho `messageKey`, ví dụ `{ limit: 20 }`. */
  readonly messageParams?: Record<string, string | number>
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly status: number
  readonly details: unknown
  readonly messageKey: string | undefined
  readonly messageParams: Record<string, string | number> | undefined

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AppError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = options.details
    this.messageKey = options.messageKey
    this.messageParams = options.messageParams
  }
}

/**
 * Tạo `AppError` có khoá dịch, kèm câu tiếng Việt làm mặc định.
 *
 * Vì sao tham số thứ ba là `key` mà không phải `message`: bắt buộc nơi gọi phải nghĩ
 * tới bản dịch ngay khi tạo lỗi. Nếu để `message` trước thì rất dễ thêm lỗi mới mà
 * quên khoá, và lỗi đó sẽ mãi chỉ có tiếng Việt.
 */
export function appError(
  code: AppErrorCode,
  key: string,
  options: AppErrorOptions & { readonly message: string },
): AppError {
  return new AppError(code, options.message, {
    messageKey: key,
    ...(options.messageParams ? { messageParams: options.messageParams } : {}),
    ...(options.details === undefined ? {} : { details: options.details }),
    ...(options.cause === undefined ? {} : { cause: options.cause }),
  })
}

export const unauthorized = (m = 'Cần đăng nhập') => new AppError('unauthorized', m)
export const forbidden = (m = 'Không có quyền truy cập') => new AppError('forbidden', m)
export const notFound = (m = 'Không tìm thấy') => new AppError('not_found', m)
export const validation = (m: string, details?: unknown) => new AppError('validation', m, { details })
export const conflict = (m: string) => new AppError('conflict', m)
export const needsConfiguration = (m: string, details?: unknown) =>
  new AppError('needs_configuration', m, { details })
export const providerError = (m: string, options?: AppErrorOptions) => new AppError('provider_error', m, options)
export const toolError = (m: string, options?: AppErrorOptions) => new AppError('tool_error', m, options)
export const budgetExceeded = (m: string, details?: unknown) => new AppError('budget_exceeded', m, { details })

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}

/** Normalize an unknown thrown value into an AppError-shaped result. */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e
  if (e instanceof Error) return new AppError('internal', e.message, { cause: e })
  return new AppError('internal', String(e))
}
