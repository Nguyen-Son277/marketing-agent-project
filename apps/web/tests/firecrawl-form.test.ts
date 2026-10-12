/** Kiểm payload thật của form, không chỉ thứ tự chuỗi JSX. */
import { describe, expect, it } from 'vitest'
import { buildFirecrawlConfig, firecrawlConnectionName } from '../src/lib/firecrawl-form.ts'
import { upsertIntegrationSchema } from '@marketing-agent/shared'

describe('form Firecrawl chỉ nhập key', () => {
  it('cloud chỉ gửi key đã trim; không cần tên hoặc URL', () => {
    expect(buildFirecrawlConfig(' fc-test ', ' ').data).toEqual({ apiKey: 'fc-test' })
    expect(firecrawlConnectionName(' ')).toBe('Firecrawl')
    expect(firecrawlConnectionName(' Custom ')).toBe('Custom')
  })
  it('không bắt prefix fc-, hỗ trợ endpoint riêng', () => {
    expect(buildFirecrawlConfig('private-key', ' https://crawler.example/ ').data).toEqual({ apiKey: 'private-key', baseUrl: 'https://crawler.example' })
  })
  it('chặn key rỗng và URL chứa thông tin không an toàn', () => {
    expect(buildFirecrawlConfig(' ', '').success).toBe(false)
    for (const url of ['ftp://example.com', 'abc', 'https://a:b@example.com', 'https://example.com/?a=1', 'https://example.com/#secret']) {
      expect(buildFirecrawlConfig('test', url).success, url).toBe(false)
    }
  })
  it('API trực tiếp cũng chặn key số, rỗng và cấu hình trống', () => {
    for (const config of [{}, { apiKey: 123 }, { apiKey: ' ' }, { apiKey: 'x', baseUrl: 'file:///tmp' }]) {
      expect(upsertIntegrationSchema.safeParse({ kind: 'firecrawl', name: 'Firecrawl', config }).success).toBe(false)
    }
    expect(upsertIntegrationSchema.parse({ kind: 'firecrawl', name: 'Firecrawl', config: { apiKey: ' test ' } }).config).toEqual({ apiKey: 'test' })
  })
  it('các loại khác giữ hợp đồng config object', () => {
    expect(upsertIntegrationSchema.safeParse({ kind: 'meta', name: 'Meta', config: { accessToken: 'token' } }).success).toBe(true)
  })
})
