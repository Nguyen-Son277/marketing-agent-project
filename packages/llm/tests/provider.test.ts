/**
 * Hai nhóm hành vi của tầng provider:
 *
 * 1. `parseProviderExtra` — `extra_json` do người dùng nhập nên phải được kiểm tra,
 *    và một dòng cấu hình hỏng không được làm sập lượt chạy.
 * 2. `isRetryableProviderError` — chính sách thử lại. Ca quan trọng nhất là 400:
 *    gateway nội bộ có lúc trả 400 `bad_request` cho một request hợp lệ đang dùng
 *    công cụ (đã đo thực tế: 1–2 lần hỏng trong 3 lần gọi cùng payload), nên 400
 *    đó phải được thử lại — nhưng 400 do cấu hình sai thì KHÔNG, nếu không hệ thống
 *    lặp vô ích và che mất lỗi cấu hình thật.
 */
import { describe, expect, it } from 'vitest'
import { providerError } from '@marketing-agent/shared'
import { isRetryableProviderError, isTransientBadRequest, parseProviderExtra } from '../src/provider.ts'

describe('parseProviderExtra', () => {
  it('trả về object rỗng khi chưa cấu hình', () => {
    expect(parseProviderExtra(null)).toEqual({})
    expect(parseProviderExtra(undefined)).toEqual({})
    expect(parseProviderExtra('')).toEqual({})
  })

  it('đọc được headers, anthropicVersion và includeStreamUsage', () => {
    const parsed = parseProviderExtra(
      JSON.stringify({
        headers: { 'x-tenant': 'abc' },
        anthropicVersion: '2024-10-22',
        includeStreamUsage: false,
      }),
    )
    expect(parsed.headers).toEqual({ 'x-tenant': 'abc' })
    expect(parsed.anthropicVersion).toBe('2024-10-22')
    expect(parsed.includeStreamUsage).toBe(false)
  })

  it('bỏ qua JSON hỏng thay vì ném lỗi', () => {
    expect(parseProviderExtra('{khong-phai-json')).toEqual({})
  })

  it('bỏ TOÀN BỘ cấu hình khi một trường sai kiểu, để dùng mặc định an toàn', () => {
    // Hành vi có chủ đích: một `extra_json` hỏng phải rơi về mặc định hoàn toàn,
    // chứ không áp dụng nửa vời rồi gửi request sai cấu hình lên nhà cung cấp.
    const parsed = parseProviderExtra(JSON.stringify({ headers: 'khong-phai-object', includeStreamUsage: true }))
    expect(parsed).toEqual({})
  })

  it('bỏ qua trường lạ thay vì làm hỏng cấu hình', () => {
    const parsed = parseProviderExtra(JSON.stringify({ khongBiet: 1, includeStreamUsage: true }))
    expect(parsed.includeStreamUsage).toBe(true)
  })
})

/**
 * Chính sách retry cho lỗi gateway.
 *
 * Ca quan trọng nhất là 400: gateway nội bộ có lúc trả 400 `bad_request` cho một
 * request hợp lệ đang dùng công cụ (đã đo thực tế), nên 400 đó phải được thử lại.
 * Nhưng 400 do cấu hình sai thì KHÔNG được thử lại, nếu không hệ thống sẽ lặp vô
 * ích và che mất lỗi cấu hình thật.
 */
describe('isRetryableProviderError', () => {
  const providerErr = (status: number, body = '') =>
    providerError(`Nhà cung cấp LLM trả lỗi ${status}`, { details: { status, body } })

  it('thử lại 429 và 5xx', () => {
    expect(isRetryableProviderError(providerErr(429))).toBe(true)
    expect(isRetryableProviderError(providerErr(500))).toBe(true)
    expect(isRetryableProviderError(providerErr(503))).toBe(true)
  })

  it('thử lại 400 bad_request tạm thời của gateway', () => {
    const body = '{"error":{"message":"[400]: {\\"model\\":\\"deepseek-v4.1-flash\\"}","type":"invalid_request_error","code":"bad_request"}}'
    expect(isTransientBadRequest(body)).toBe(true)
    expect(isRetryableProviderError(providerErr(400, body))).toBe(true)
  })

  it('KHÔNG thử lại 400 do cấu hình sai', () => {
    const cases = [
      '{"error":{"code":"bad_request","message":"Incorrect API key provided"}}',
      '{"error":{"code":"bad_request","message":"model not found: gpt-9"}}',
      '{"error":{"code":"bad_request","message":"This model does not exist"}}',
      '{"error":{"code":"bad_request","message":"maximum context length exceeded"}}',
      '{"error":{"code":"bad_request","message":"insufficient quota"}}',
    ]
    for (const body of cases) {
      expect(isTransientBadRequest(body), body).toBe(false)
      expect(isRetryableProviderError(providerErr(400, body)), body).toBe(false)
    }
  })

  it('KHÔNG thử lại lỗi 4xx khác', () => {
    expect(isRetryableProviderError(providerErr(401))).toBe(false)
    expect(isRetryableProviderError(providerErr(403))).toBe(false)
    expect(isRetryableProviderError(providerErr(404))).toBe(false)
  })

  it('KHÔNG thử lại khi bị huỷ', () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    expect(isRetryableProviderError(abort)).toBe(false)
  })

  it('thử lại lỗi không rõ loại (mạng)', () => {
    expect(isRetryableProviderError(new Error('ECONNRESET'))).toBe(true)
  })
})
