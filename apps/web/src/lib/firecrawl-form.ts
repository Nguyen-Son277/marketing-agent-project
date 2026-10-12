/** UI tự đóng gói cấu hình; người dùng không cần biết JSON hay khoá nội bộ. */
import { firecrawlConfigSchema } from '@marketing-agent/shared'

export function buildFirecrawlConfig(apiKey: string, baseUrl: string) {
  const config = { apiKey: apiKey.trim(), ...(baseUrl.trim() ? { baseUrl: baseUrl.trim().replace(/\/+$/, '') } : {}) }
  return firecrawlConfigSchema.safeParse(config)
}

export function firecrawlConnectionName(name: string): string {
  // Tên mặc định ổn định giữa VI/EN để upsert không sinh hai hàng sau khi đổi ngôn ngữ.
  return name.trim() || 'Firecrawl'
}
