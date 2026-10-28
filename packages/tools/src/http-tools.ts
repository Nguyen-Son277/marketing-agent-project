/**
 * HTTP tools shared by the research and SEO roles.
 *
 * Two safeguards are non-negotiable here because the arguments come from a
 * language model: an outbound request must stay inside an operator-controlled
 * host allowlist, and every response is size- and time-bounded. Without the
 * allowlist, `http_fetch` is a server-side request forgery primitive pointed at
 * the deployment's own network.
 */
import { toolError, truncate, type ToolContext, type ToolResult } from '@marketing-agent/shared'
import { fetchWithTimeout, readBounded } from './http-client.ts'
import { defineTool, optionalNumberArg, optionalStringArg, requireStringArg } from './registry.ts'
import type { IntegrationStore } from './integrations.ts'
import { API_VERSIONS } from './integrations.ts'
import type { FirecrawlConfig } from './integrations.ts'

export interface HttpToolOptions {
  /** Hosts (or `*.suffix` patterns) the fetch tool may reach. Empty = public internet minus private ranges. */
  readonly allowedHosts?: readonly string[]
  readonly timeoutMs?: number
  readonly maxBytes?: number
  /** Max pages a single scrape may return, to bound token spend. */
  readonly maxScrapeChars?: number
  /** Override the Firecrawl endpoint, for a self-hosted instance. */
  readonly baseUrl?: string
}

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_MAX_BYTES = 2_000_000
const DEFAULT_MAX_SCRAPE_CHARS = 12_000

/** Verify a Firecrawl key with a bounded, minimal search request. */
export async function verifyFirecrawlConnection(config: FirecrawlConfig, timeoutMs = 8_000): Promise<void> {
  const base = (config.baseUrl ?? 'https://api.firecrawl.dev').replace(/\/+$/, '')
  const response = await fetchWithTimeout(
    `${base}/${API_VERSIONS.firecrawl}/search`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ query: 'marketing-agent connection test', limit: 1 }),
    },
    timeoutMs,
  )
  const text = await readBounded(response, 4_000)
  if (!response.ok) throw toolError(`Firecrawl trả lỗi HTTP ${response.status}: ${truncate(text, 300)}`)
}

/** Private/link-local ranges a server-side fetch must never reach. */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?fc/i,
  /^\[?fe80/i,
  /\.internal$/i,
  /\.local$/i,
]

export function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(hostname))
}

/**
 * Whether an outbound fetch may target this URL.
 *
 * Private and link-local hosts are refused **unconditionally** — an allowlist
 * entry naming one must not re-open it, or a single misconfigured operator entry
 * would turn `http_fetch` into a request-forgery primitive against the
 * deployment's own network.
 */
export function isHostAllowed(url: URL, allowedHosts: readonly string[] | undefined): boolean {
  if (isBlockedHost(url.hostname)) return false
  if (!allowedHosts || allowedHosts.length === 0) return true
  return allowedHosts.some((pattern) => matchesHost(url.hostname, pattern))
}

function matchesHost(hostname: string, pattern: string): boolean {
  const normalized = pattern.trim().toLowerCase()
  if (normalized.startsWith('*.')) return hostname.toLowerCase().endsWith(normalized.slice(1))
  return hostname.toLowerCase() === normalized
}


/** Turn HTML into readable text, keeping the parts a model needs. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function createHttpTools(options: HttpToolOptions = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const allowedHosts = options.allowedHosts

  const httpFetch = defineTool({
    name: 'http_fetch',
    description:
      'Tải nội dung một URL công khai và trả về văn bản đã lược bỏ HTML. Dùng để kiểm tra trang, robots.txt, sitemap hoặc API công khai. Không truy cập được địa chỉ nội bộ.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL đầy đủ, gồm http:// hoặc https://' },
        method: { type: 'string', enum: ['GET', 'HEAD'], description: 'Mặc định GET' },
        maxChars: { type: 'number', description: 'Giới hạn ký tự trả về, mặc định 8000' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    roles: ['market-research', 'seo-technical', 'web-technical', 'design-video', 'analytics', 'paid-media'],
    async handler(args, ctx): Promise<ToolResult> {
      const raw = requireStringArg(args, 'url')
      let url: URL
      try {
        url = new URL(raw)
      } catch {
        throw toolError(`URL không hợp lệ: ${raw}`)
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw toolError('Chỉ hỗ trợ http:// và https://')
      }
      if (!isHostAllowed(url, allowedHosts)) {
        throw toolError(
          `Không được phép truy cập "${url.hostname}" (địa chỉ nội bộ hoặc không nằm trong danh sách cho phép).`,
        )
      }
      const method = optionalStringArg(args, 'method') === 'HEAD' ? 'HEAD' : 'GET'
      const maxChars = optionalNumberArg(args, 'maxChars', 8_000)
      const response = await fetchWithTimeout(
        url.toString(),
        { method, redirect: 'follow', headers: { 'User-Agent': 'MarketingAgentBot/0.1 (+self-hosted)' } },
        timeoutMs,
        ctx.signal,
      )
      const raw2 = method === 'HEAD' ? '' : await readBounded(response, maxBytes)
      const contentType = response.headers.get('content-type') ?? ''
      const text = contentType.includes('html') ? htmlToText(raw2) : raw2
      const header = `HTTP ${response.status} · ${contentType || 'không rõ loại'} · ${url.toString()}`
      return {
        content: `${header}\n\n${truncate(text, maxChars)}`,
        isError: !response.ok,
        data: { status: response.status, contentType, url: url.toString() },
      }
    },
  })

  return { httpFetch }
}

/**
 * Firecrawl-backed research tools. Firecrawl does the rendering, so a
 * JavaScript-heavy page still yields markdown.
 */
export function createResearchTools(store: IntegrationStore, options: HttpToolOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 45_000
  const maxScrapeChars = options.maxScrapeChars ?? DEFAULT_MAX_SCRAPE_CHARS
  const baseUrlOverride = options.baseUrl

  async function callFirecrawl(
    ctx: ToolContext,
    endpoint: string,
    payload: unknown,
  ): Promise<Record<string, unknown>> {
    const config = store.require(ctx.companyId, 'firecrawl', 'Firecrawl (crawl & scrape)')
    // A deployment-level override wins over the per-company config.
    const base = (baseUrlOverride ?? config.baseUrl ?? 'https://api.firecrawl.dev').replace(/\/+$/, '')
    const response = await fetchWithTimeout(
      `${base}/${API_VERSIONS.firecrawl}/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
      },
      timeoutMs,
      ctx.signal,
    )
    const text = await readBounded(response, 4_000_000)
    if (!response.ok) {
      throw toolError(`Firecrawl trả lỗi HTTP ${response.status}: ${truncate(text, 500)}`)
    }
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      throw toolError('Firecrawl trả về dữ liệu không phải JSON')
    }
  }

  const webSearch = defineTool({
    name: 'web_search',
    description:
      'Tìm kiếm web và trả về danh sách kết quả kèm tiêu đề, URL và trích đoạn. Dùng để nghiên cứu thị trường, đối thủ, xu hướng. Mọi kết quả phải được ghi lại kèm URL và ngày truy cập.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Câu truy vấn tìm kiếm' },
        limit: { type: 'number', description: 'Số kết quả, mặc định 6, tối đa 15' },
        lang: { type: 'string', description: 'Mã ngôn ngữ, ví dụ vi hoặc en' },
        country: { type: 'string', description: 'Mã quốc gia, ví dụ vn' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    roles: ['market-research', 'seo-technical', 'web-technical', 'social-media', 'paid-media', 'content-writer'],
    async handler(args, ctx): Promise<ToolResult> {
      const query = requireStringArg(args, 'query')
      const limit = Math.min(15, Math.max(1, optionalNumberArg(args, 'limit', 6)))
      const result = await callFirecrawl(ctx, 'search', {
        query,
        limit,
        lang: optionalStringArg(args, 'lang'),
        country: optionalStringArg(args, 'country'),
      })
      const items = extractSearchItems(result)
      if (items.length === 0) {
        return { content: `Không tìm thấy kết quả cho "${query}".`, data: { query, count: 0 } }
      }
      const lines = items.map(
        (item, index) =>
          `${index + 1}. ${item.title}\n   ${item.url}\n   ${truncate(item.description, 300)}`,
      )
      const accessedAt = new Date().toISOString().slice(0, 10)
      return {
        content: `Kết quả cho "${query}" (truy cập ${accessedAt}):\n\n${lines.join('\n\n')}`,
        data: { query, count: items.length, items, accessedAt },
      }
    },
  })

  const webScrape = defineTool({
    name: 'web_scrape',
    description:
      'Lấy nội dung một trang web dưới dạng markdown sạch (đã xử lý JavaScript). Dùng để đọc chi tiết trang sản phẩm, bài viết, trang giá của đối thủ.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL trang cần lấy' },
        maxChars: { type: 'number', description: 'Giới hạn ký tự trả về' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    roles: ['market-research', 'seo-technical', 'web-technical', 'content-writer', 'paid-media', 'social-media'],
    async handler(args, ctx): Promise<ToolResult> {
      const url = requireStringArg(args, 'url')
      try {
        new URL(url)
      } catch {
        throw toolError(`URL không hợp lệ: ${url}`)
      }
      const maxChars = optionalNumberArg(args, 'maxChars', maxScrapeChars)
      const result = await callFirecrawl(ctx, 'scrape', { url, formats: ['markdown'] })
      const markdown = extractMarkdown(result)
      if (!markdown) {
        return { content: `Không lấy được nội dung từ ${url}.`, isError: true, data: { url } }
      }
      return {
        content: `Nội dung ${url} (truy cập ${new Date().toISOString().slice(0, 10)}):\n\n${truncate(markdown, maxChars)}`,
        data: { url, chars: markdown.length },
      }
    },
  })

  const competitorWatch = defineTool({
    name: 'competitor_watch',
    description:
      'Lấy nội dung một trang đối thủ (thường là trang giá hoặc trang sản phẩm) để so sánh theo thời gian. Trả về bản tóm tắt có cấu trúc; lần chạy sau có thể đối chiếu với ghi chú đã lưu trong kho kiến thức.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL trang cần theo dõi' },
        focus: { type: 'string', description: 'Điều cần chú ý, ví dụ "giá", "tính năng", "khuyến mãi"' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    roles: ['market-research', 'paid-media'],
    async handler(args, ctx): Promise<ToolResult> {
      const url = requireStringArg(args, 'url')
      const focus = optionalStringArg(args, 'focus') ?? 'thay đổi đáng chú ý về giá, sản phẩm, thông điệp'
      const result = await callFirecrawl(ctx, 'scrape', { url, formats: ['markdown'] })
      const markdown = extractMarkdown(result)
      if (!markdown) {
        throw toolError(`Không lấy được nội dung từ ${url}`)
      }
      // Long pages are noisy; keep the head, which is where positioning and pricing live.
      const excerpt = truncate(markdown, 6_000)
      return {
        content:
          `Theo dõi đối thủ: ${url}\nNgày lấy: ${new Date().toISOString().slice(0, 10)}\n` +
          `Trọng tâm: ${focus}\n\n--- Nội dung lấy được ---\n${excerpt}`,
        data: { url, focus, chars: markdown.length, capturedAt: new Date().toISOString() },
      }
    },
  })

  return { webSearch, webScrape, competitorWatch }
}

interface SearchItem {
  readonly title: string
  readonly url: string
  readonly description: string
}

/** Firecrawl's search payload has shifted shape between versions; accept both. */
export function extractSearchItems(payload: Record<string, unknown>): SearchItem[] {
  const candidates = Array.isArray(payload['data'])
    ? (payload['data'] as unknown[])
    : Array.isArray(payload['web'])
      ? (payload['web'] as unknown[])
      : []
  const items: SearchItem[] = []
  for (const entry of candidates) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const url = typeof record['url'] === 'string' ? record['url'] : undefined
    if (!url) continue
    items.push({
      title: typeof record['title'] === 'string' && record['title'].length > 0 ? record['title'] : url,
      url,
      description: typeof record['description'] === 'string' ? record['description'] : '',
    })
  }
  return items
}

export function extractMarkdown(payload: Record<string, unknown>): string {
  const data = payload['data']
  if (typeof data === 'object' && data !== null) {
    const record = data as Record<string, unknown>
    if (typeof record['markdown'] === 'string') return record['markdown']
    if (typeof record['content'] === 'string') return record['content']
  }
  if (typeof payload['markdown'] === 'string') return payload['markdown']
  return ''
}
