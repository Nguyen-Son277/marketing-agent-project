/**
 * Google Search Console tools.
 *
 * The point of these tools is that they return **real query data**, so the SEO
 * agent's recommendations rest on measured impressions and positions instead of
 * invented numbers. When the integration is missing, the tool fails with
 * `needs_configuration` — which the agent is instructed to relay as "hãy kết nối
 * Search Console", never to paper over.
 */
import { toolError, type ToolResult } from '@marketing-agent/shared'
import {
  defineTool,
  optionalNumberArg,
  optionalStringArg,
  optionalStringArrayArg,
  requireStringArg,
} from '../registry.ts'
import type { IntegrationStore } from '../integrations.ts'
import type { GoogleOAuthConfig } from '../integrations.ts'
import { googleJson, normalizeSearchConsoleSite, resolveDateRange } from './auth.ts'

const GSC_BASE = 'https://searchconsole.googleapis.com/webmasters/v3'

interface SearchAnalyticsResponse {
  readonly rows?: {
    readonly keys?: string[]
    readonly clicks?: number
    readonly impressions?: number
    readonly ctr?: number
    readonly position?: number
  }[]
  readonly responseAggregationType?: string
}

/** Dimension names the API accepts, kept to the useful set. */
const ALLOWED_DIMENSIONS = ['query', 'page', 'country', 'device', 'date', 'searchAppearance'] as const
type Dimension = (typeof ALLOWED_DIMENSIONS)[number]

export function createSearchConsoleTools(store: IntegrationStore) {
  const gscQuery = defineTool({
    name: 'gsc.query',
    description:
      'Lấy dữ liệu hiệu suất tìm kiếm thật từ Google Search Console: impressions, clicks, CTR, vị trí trung bình. Dùng trước khi đưa ra bất kỳ khuyến nghị SEO nào.',
    parameters: {
      type: 'object',
      properties: {
        siteUrl: {
          type: 'string',
          description:
            'Tài sản trong Search Console, ví dụ "sc-domain:example.com" hoặc "https://example.com". Bỏ trống để dùng giá trị đã cấu hình.',
        },
        dimensions: {
          type: 'array',
          items: { type: 'string', enum: [...ALLOWED_DIMENSIONS] },
          description: 'Chiều phân tích, mặc định ["query"]. Ví dụ ["page"] hoặc ["query","page"].',
        },
        days: { type: 'number', description: 'Số ngày gần đây, mặc định 28, tối đa 365' },
        startDate: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD (dùng cùng endDate để ghi đè days)' },
        endDate: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD' },
        rowLimit: { type: 'number', description: 'Số hàng tối đa, mặc định 25, tối đa 200' },
        minImpressions: { type: 'number', description: 'Lọc bỏ truy vấn có ít hơn ngần này impression' },
        filterQuery: { type: 'string', description: 'Chỉ lấy truy vấn chứa chuỗi này (lọc phía máy chủ)' },
      },
      required: [],
      additionalProperties: false,
    },
    roles: ['seo-technical', 'analytics', 'content-writer', 'paid-media'],
    async handler(args, ctx): Promise<ToolResult> {
      const config = store.require(ctx.companyId, 'google-search-console', 'Google Search Console')
      const siteUrl = normalizeSearchConsoleSite(optionalStringArg(args, 'siteUrl') ?? requireSite(config))
      const dimensions = readDimensions(optionalStringArrayArg(args, 'dimensions'))
      const range = resolveDateRange({
        startDate: optionalStringArg(args, 'startDate'),
        endDate: optionalStringArg(args, 'endDate'),
        days: optionalNumberArg(args, 'days', 28),
      })
      const rowLimit = clamp(optionalNumberArg(args, 'rowLimit', 25), 1, 200)
      const minImpressions = optionalNumberArg(args, 'minImpressions', 0)
      const filterQuery = optionalStringArg(args, 'filterQuery')

      const filters = filterQuery
        ? [{ dimension: 'query', operator: 'contains', expression: filterQuery }]
        : undefined

      const payload = await googleJson<SearchAnalyticsResponse>(
        config,
        `${GSC_BASE}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
          method: 'POST',
          body: {
            startDate: range.startDate,
            endDate: range.endDate,
            dimensions,
            rowLimit,
            ...(filters ? { dimensionFilterGroups: [{ filters }] } : {}),
          },
          signal: ctx.signal,
        },
      )

      const rows = (payload.rows ?? []).filter((row) => (row.impressions ?? 0) >= minImpressions)
      if (rows.length === 0) {
        return {
          content:
            `Không có dữ liệu Search Console cho ${siteUrl} trong khoảng ${range.startDate} → ${range.endDate}` +
            (filterQuery ? ` với bộ lọc truy vấn chứa "${filterQuery}"` : '') +
            '.\n\nĐiều này có thể do: khoảng thời gian không có truy vấn nào, tài sản chưa được xác minh, ' +
            'hoặc dữ liệu GSC có độ trễ 2–3 ngày.',
          data: { siteUrl, range, rows: 0 },
        }
      }

      const totalClicks = rows.reduce((sum, row) => sum + (row.clicks ?? 0), 0)
      const totalImpressions = rows.reduce((sum, row) => sum + (row.impressions ?? 0), 0)
      const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0

      const header = dimensions.join(' | ')
      const lines = rows.map((row) => {
        const keys = (row.keys ?? []).join(' | ')
        const ctr = ((row.ctr ?? 0) * 100).toFixed(2)
        return `${keys} | ${Math.round(row.clicks ?? 0)} click | ${Math.round(row.impressions ?? 0)} imp | ${ctr}% | vị trí ${(row.position ?? 0).toFixed(1)}`
      })

      return {
        content:
          `Google Search Console · ${siteUrl}\n` +
          `Khoảng: ${range.startDate} → ${range.endDate} · ${rows.length} hàng\n` +
          `Tổng: ${Math.round(totalClicks)} click · ${Math.round(totalImpressions)} impression · CTR ${(avgCtr * 100).toFixed(2)}%\n\n` +
          `${header}\n${lines.join('\n')}`,
        data: {
          siteUrl,
          range,
          dimensions,
          rowCount: rows.length,
          totals: { clicks: totalClicks, impressions: totalImpressions, ctr: avgCtr },
          rows,
        },
      }
    },
  })

  const gscInspectUrl = defineTool({
    name: 'gsc.inspectUrl',
    description:
      'Kiểm tra trạng thái index của một URL trong Google Search Console: đã được index chưa, lần thu thập gần nhất, lỗi robots/canonical, và lý do nếu bị loại khỏi index.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL đầy đủ cần kiểm tra' },
        siteUrl: {
          type: 'string',
          description: 'Tài sản trong Search Console. Bỏ trống để dùng giá trị đã cấu hình.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    roles: ['seo-technical', 'content-writer'],
    async handler(args, ctx): Promise<ToolResult> {
      const config = store.require(ctx.companyId, 'google-search-console', 'Google Search Console')
      const url = requireStringArg(args, 'url')
      const siteUrl = normalizeSearchConsoleSite(optionalStringArg(args, 'siteUrl') ?? requireSite(config))

      const payload = await googleJson<{
        inspectionResult?: {
          indexStatusResult?: {
            verdict?: string
            coverageState?: string
            robotsTxtState?: string
            indexingState?: string
            lastCrawlTime?: string
            pageFetchState?: string
            googleCanonical?: string
            userCanonical?: string
          }
          mobileUsabilityResult?: { verdict?: string }
        }
      }>(config, `${GSC_BASE}/urlInspection/index:inspect`, {
        method: 'POST',
        body: { inspectionUrl: url, siteUrl },
        signal: ctx.signal,
      })

      const index = payload.inspectionResult?.indexStatusResult
      if (!index) {
        return {
          content:
            `Không lấy được kết quả kiểm tra cho ${url}. Kiểm tra lại URL có thuộc tài sản ${siteUrl} không.`,
          isError: true,
        }
      }

      const lines = [
        `URL: ${url}`,
        `Tài sản: ${siteUrl}`,
        `Kết luận: ${index.verdict ?? 'không rõ'}`,
        `Trạng thái index: ${index.indexingState ?? 'không rõ'}`,
        `Phủ sóng: ${index.coverageState ?? 'không rõ'}`,
        `robots.txt: ${index.robotsTxtState ?? 'không rõ'}`,
        `Trạng thái tải trang: ${index.pageFetchState ?? 'không rõ'}`,
        `Lần thu thập gần nhất: ${index.lastCrawlTime ?? 'chưa có'}`,
        `Canonical Google chọn: ${index.googleCanonical ?? 'không rõ'}`,
        `Canonical khai báo: ${index.userCanonical ?? 'không rõ'}`,
      ]
      if (index.googleCanonical && index.userCanonical && index.googleCanonical !== index.userCanonical) {
        lines.push(
          '\n⚠️ Google chọn canonical khác với khai báo. Đây thường là nguyên nhân URL không được index như mong đợi.',
        )
      }
      const mobile = payload.inspectionResult?.mobileUsabilityResult?.verdict
      if (mobile) lines.push(`Khả dụng trên di động: ${mobile}`)

      const indexed = index.verdict === 'PASS'
      return {
        content: lines.join('\n'),
        isError: !indexed,
        data: { url, siteUrl, indexed, indexStatus: index },
      }
    },
  })

  return { gscQuery, gscInspectUrl }
}

/** The site URL can live in the integration config so the agent need not repeat it. */
function requireSite(config: GoogleOAuthConfig): string {
  const site = config.siteUrl
  if (typeof site === 'string' && site.trim().length > 0) return site
  throw toolError(
    'Chưa biết tài sản Search Console nào cần truy vấn. Hãy truyền "siteUrl", ' +
      'hoặc thêm siteUrl vào cấu hình kết nối Google Search Console.',
  )
}

function readDimensions(value: string[] | undefined): Dimension[] {
  if (!value || value.length === 0) return ['query']
  const requested = value.filter((v): v is Dimension => ALLOWED_DIMENSIONS.includes(v as Dimension))
  if (requested.length === 0) {
    throw toolError(`dimensions chỉ nhận các giá trị: ${ALLOWED_DIMENSIONS.join(', ')}`)
  }
  return requested
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}
