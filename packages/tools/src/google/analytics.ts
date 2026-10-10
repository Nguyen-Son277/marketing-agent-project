/**
 * Google Analytics 4 and Google Sheets tools.
 *
 * GA4 reporting is where marketing numbers come from, so the tool returns both a
 * readable table and the structured payload: the agent writes the table into a
 * report, and the structured data lets it compute changes without re-parsing text.
 */
import { toolError, type ToolResult } from '@marketing-agent/shared'
import {
  defineTool,
  optionalNumberArg,
  optionalStringArg,
  optionalStringArrayArg,
  requireStringArg,
} from '../registry.ts'
import type { GoogleOAuthConfig, IntegrationStore } from '../integrations.ts'
import { googleJson, normalizeGa4Property, resolveDateRange } from './auth.ts'

const GA4_BASE = 'https://analyticsdata.googleapis.com/v1beta'

/** A small, useful metric vocabulary — GA4 has hundreds and a model should not guess names. */
const COMMON_METRICS = [
  'sessions',
  'totalUsers',
  'newUsers',
  'screenPageViews',
  'averageSessionDuration',
  'bounceRate',
  'conversions',
  'totalRevenue',
  'engagementRate',
  'eventCount',
] as const

const COMMON_DIMENSIONS = [
  'date',
  'sessionDefaultChannelGroup',
  'sessionSourceMedium',
  'landingPagePlusQueryString',
  'country',
  'deviceCategory',
  'pagePath',
  'eventName',
] as const

interface Ga4Response {
  readonly dimensionHeaders?: { readonly name: string }[]
  readonly metricHeaders?: { readonly name: string }[]
  readonly rows?: {
    readonly dimensionValues?: { readonly value?: string }[]
    readonly metricValues?: { readonly value?: string }[]
  }[]
  readonly rowCount?: number
}

export function createAnalyticsTools(store: IntegrationStore) {
  const ga4Report = defineTool({
    name: 'ga4.report',
    description:
      'Chạy báo cáo Google Analytics 4: sessions, users, pageviews, conversions, doanh thu — theo chiều như kênh, trang, thiết bị hoặc ngày. Dùng để lấy số liệu thật thay vì phỏng đoán.',
    parameters: {
      type: 'object',
      properties: {
        propertyId: {
          type: 'string',
          description: 'GA4 property id, ví dụ "123456789". Bỏ trống để dùng giá trị đã cấu hình.',
        },
        metrics: {
          type: 'array',
          items: { type: 'string' },
          description: `Chỉ số cần lấy. Phổ biến: ${COMMON_METRICS.join(', ')}. Mặc định ["sessions","totalUsers","conversions"].`,
        },
        dimensions: {
          type: 'array',
          items: { type: 'string' },
          description: `Chiều phân tích. Phổ biến: ${COMMON_DIMENSIONS.join(', ')}. Mặc định ["date"].`,
        },
        days: { type: 'number', description: 'Số ngày gần đây, mặc định 28, tối đa 365' },
        startDate: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD' },
        endDate: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD' },
        limit: { type: 'number', description: 'Số hàng tối đa, mặc định 50, tối đa 1000' },
        orderByMetric: { type: 'string', description: 'Sắp xếp giảm dần theo chỉ số này' },
      },
      required: [],
      additionalProperties: false,
    },
    roles: ['analytics', 'paid-media', 'seo-technical', 'social-media', 'email-crm'],
    async handler(args, ctx): Promise<ToolResult> {
      const config = store.require(ctx.companyId, 'google-analytics', 'Google Analytics 4')
      const propertyId = normalizeGa4Property(optionalStringArg(args, 'propertyId') ?? requireProperty(config))
      const metrics = optionalStringArrayArg(args, 'metrics') ?? ['sessions', 'totalUsers', 'conversions']
      const dimensions = optionalStringArrayArg(args, 'dimensions') ?? ['date']
      const range = resolveDateRange({
        startDate: optionalStringArg(args, 'startDate'),
        endDate: optionalStringArg(args, 'endDate'),
        days: optionalNumberArg(args, 'days', 28),
      })
      const limit = Math.min(1_000, Math.max(1, Math.floor(optionalNumberArg(args, 'limit', 50))))
      const orderByMetric = optionalStringArg(args, 'orderByMetric')

      const payload = await googleJson<Ga4Response>(config, `${GA4_BASE}/${propertyId}:runReport`, {
        method: 'POST',
        body: {
          dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
          metrics: metrics.map((name) => ({ name })),
          dimensions: dimensions.map((name) => ({ name })),
          limit,
          ...(orderByMetric
            ? { orderBys: [{ metric: { metricName: orderByMetric }, desc: true }] }
            : {}),
        },
        signal: ctx.signal,
      })

      const rows = payload.rows ?? []
      if (rows.length === 0) {
        return {
          content:
            `GA4 property ${propertyId} không trả hàng nào cho ${range.startDate} → ${range.endDate}.\n` +
            'Kiểm tra: property id đúng chưa, khoảng thời gian có dữ liệu không, và tài khoản dịch vụ ' +
            'đã được cấp quyền xem property chưa.',
          data: { propertyId, range, rowCount: 0 },
        }
      }

      const metricNames = payload.metricHeaders?.map((h) => h.name ?? '') ?? metrics
      const dimensionNames = payload.dimensionHeaders?.map((h) => h.name ?? '') ?? dimensions
      const header = [...dimensionNames, ...metricNames].join(' | ')
      const lines = rows.map((row) => {
        const dims = (row.dimensionValues ?? []).map((v) => v.value ?? '')
        const values = (row.metricValues ?? []).map((v) => formatNumber(v.value))
        return [...dims, ...values].join(' | ')
      })

      return {
        content:
          `Google Analytics 4 · ${propertyId}\n` +
          `Khoảng: ${range.startDate} → ${range.endDate} · ${rows.length} hàng` +
          (payload.rowCount !== undefined && payload.rowCount > rows.length
            ? ` (tổng ${payload.rowCount}, đã giới hạn ${limit})`
            : '') +
          `\n\n${header}\n${lines.join('\n')}`,
        data: {
          propertyId,
          range,
          dimensions: dimensionNames,
          metrics: metricNames,
          rows: rows.map((row) => ({
            dimensions: (row.dimensionValues ?? []).map((v) => v.value ?? ''),
            metrics: (row.metricValues ?? []).map((v) => Number(v.value ?? 0)),
          })),
          rowCount: payload.rowCount ?? rows.length,
        },
      }
    },
  })

  const sheetsWrite = defineTool({
    name: 'sheets.write',
    description:
      'Ghi dữ liệu vào một Google Sheet để người dùng xem lại. Dùng khi cần bàn giao bảng số liệu hoặc lịch nội dung cho người dùng ngoài hệ thống.',
    parameters: {
      type: 'object',
      properties: {
        spreadsheetId: { type: 'string', description: 'ID của Google Sheet (phần giữa /d/ và /edit trong URL)' },
        range: { type: 'string', description: 'Vùng ghi theo A1, ví dụ "Sheet1!A1" hoặc "Báo cáo!A1:C1"' },
        values: {
          type: 'array',
          items: { type: 'array', items: { type: 'string' } },
          description: 'Mảng hai chiều: mỗi phần tử là một hàng.',
        },
        mode: {
          type: 'string',
          enum: ['overwrite', 'append'],
          description: 'overwrite ghi đè vùng (mặc định); append thêm xuống dưới dữ liệu có sẵn.',
        },
      },
      required: ['spreadsheetId', 'range', 'values'],
      additionalProperties: false,
    },
    roles: ['analytics', 'email-crm', 'seo-technical', 'paid-media'],
    requiresApproval: true,
    async handler(args, ctx): Promise<ToolResult> {
      const config = store.require(ctx.companyId, 'google-sheets', 'Google Sheets')
      const spreadsheetId = requireStringArg(args, 'spreadsheetId')
      const range = requireStringArg(args, 'range')
      const rawValues = args['values']
      if (!Array.isArray(rawValues) || rawValues.length === 0) {
        throw toolError('Thiếu tham số "values" (mảng hai chiều)')
      }
      const values = rawValues.map((row) =>
        Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : [String(row ?? '')],
      )
      const append = optionalStringArg(args, 'mode') === 'append'
      const method = append ? 'POST' : 'PUT'
      const suffix = append ? ':append' : ''
      const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
        `/values/${encodeURIComponent(range)}${suffix}?valueInputOption=USER_ENTERED`

      const payload = await googleJson<{ updates?: { updatedRows?: number; updatedCells?: number } }>(
        config,
        url,
        { method, body: { values }, signal: ctx.signal },
      )

      const updated = payload.updates?.updatedCells ?? values.reduce((n, row) => n + row.length, 0)
      return {
        content:
          `Đã ${append ? 'thêm' : 'ghi'} ${values.length} hàng (${updated} ô) vào Sheet ${spreadsheetId}, vùng ${range}.`,
        data: { spreadsheetId, range, rows: values.length, updatedCells: updated, mode: append ? 'append' : 'overwrite' },
      }
    },
  })

  return { ga4Report, sheetsWrite }
}

function requireProperty(config: GoogleOAuthConfig): string {
  if (typeof config.propertyId === 'string' && config.propertyId.trim().length > 0) return config.propertyId
  throw toolError(
    'Chưa biết GA4 property nào cần truy vấn. Hãy truyền "propertyId", ' +
      'hoặc thêm propertyId vào cấu hình kết nối Google Analytics.',
  )
}

/** GA4 returns every value as a string and uses fractions for rates. */
function formatNumber(value: string | undefined): string {
  if (value === undefined) return ''
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value
  if (Number.isInteger(parsed)) return parsed.toLocaleString('vi-VN')
  return parsed.toFixed(2)
}
