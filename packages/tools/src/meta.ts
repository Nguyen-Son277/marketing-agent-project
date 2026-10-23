/**
 * Meta (Facebook/Instagram) tools: Page insights and publishing.
 *
 * Publishing is the one place where a model can act on the outside world, so it
 * is guarded twice: the tool declares `requiresApproval`, and the orchestrator
 * keeps it in a draft state until a human approves. The tool itself never
 * decides that a post is safe to publish.
 */
import { toolError, truncate, type ToolResult } from '@marketing-agent/shared'
import { extractErrorMessage, fetchWithTimeout, parseJsonResponse } from './http-client.ts'
import {
  defineTool,
  optionalNumberArg,
  optionalStringArg,
  requireStringArg,
} from './registry.ts'
import { API_VERSIONS, type IntegrationStore } from './integrations.ts'
import type { MetaConfig } from './integrations.ts'

interface GraphError {
  readonly error?: { readonly message?: string; readonly code?: number; readonly type?: string }
}

export function createMetaTools(store: IntegrationStore) {
  /** Call the Graph API and surface Meta's own error text, which is usually specific. */
  async function graph<T>(
    config: MetaConfig,
    path: string,
    init: { method?: string; body?: Record<string, unknown>; query?: Record<string, string> } = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const version = config.apiVersion ?? API_VERSIONS.meta
    const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\/+/, '')}`)
    for (const [key, value] of Object.entries(init.query ?? {})) {
      url.searchParams.set(key, value)
    }
    url.searchParams.set('access_token', config.accessToken)
    if (init.body) url.searchParams.set('access_token', config.accessToken)

    const response = await fetchWithTimeout(
      url.toString(),
      {
        method: init.method ?? 'GET',
        ...(init.body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) }
          : {}),
      },
      30_000,
      signal,
    )
    const parsed = await parseJsonResponse<GraphError & T>(response)
    if (!response.ok || parsed.error) {
      throw toolError(`Meta Graph API lỗi (HTTP ${response.status}): ${truncate(extractErrorMessage(parsed), 300)}`)
    }
    return parsed as T
  }

  const metaInsights = defineTool({
    name: 'meta_insights',
    description:
      'Lấy chỉ số hiệu suất từ Facebook Page / Instagram / tài khoản quảng cáo Meta: reach, impressions, engagement, chi tiêu, kết quả. Dùng để báo cáo kết quả thật của kênh social và quảng cáo.',
    parameters: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          enum: ['page', 'instagram', 'ad_account'],
          description: 'Nguồn dữ liệu. Mặc định "page".',
        },
        metrics: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Chỉ số cần lấy. Page: page_impressions, page_reach, page_engaged_users, page_post_engagements. ' +
            'Ad account: spend, impressions, clicks, ctr, cpc, cpm, reach, actions.',
        },
        since: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD' },
        until: { type: 'string', description: 'Ngày kết thúc YYYY-MM-DD' },
        days: { type: 'number', description: 'Nếu không có since/until: số ngày gần đây, mặc định 28' },
        period: { type: 'string', enum: ['day', 'week', 'month', 'days_28'], description: 'Mặc định "day"' },
        limit: { type: 'number', description: 'Số hàng tối đa, mặc định 50' },
      },
      required: [],
      additionalProperties: false,
    },
    roles: ['social-media', 'paid-media', 'community-care', 'analytics'],
    async handler(args, ctx): Promise<ToolResult> {
      const config = store.require(ctx.companyId, 'meta', 'Meta (Facebook / Instagram)')
      const target = optionalStringArg(args, 'target') ?? 'page'
      const requestedMetrics = readStringList(args['metrics'])
      const period = optionalStringArg(args, 'period') ?? 'day'
      const limit = Math.min(500, Math.max(1, Math.floor(optionalNumberArg(args, 'limit', 50))))
      const range = metaDateRange(args)

      if (target === 'ad_account') {
        const adAccountId = config.adAccountId
        if (!adAccountId) {
          throw toolError(
            'Chưa cấu hình adAccountId cho Meta. Thêm adAccountId (dạng act_1234567890) trong Cài đặt → Kết nối.',
          )
        }
        const metrics = requestedMetrics ?? ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'reach']
        const payload = await graph<{ data?: Record<string, unknown>[] }>(
          config,
          `${normalizeActId(adAccountId)}/insights`,
          {
            query: {
              level: 'account',
              fields: metrics.join(','),
              time_range: JSON.stringify({ since: range.since, until: range.until }),
              limit: String(limit),
            },
          },
          ctx.signal,
        )
        const rows = payload.data ?? []
        if (rows.length === 0) {
          return {
            content: `Không có dữ liệu quảng cáo Meta cho ${range.since} → ${range.until}.`,
            data: { target, range, rows: 0 },
          }
        }
        const header = ['date_start', 'date_stop', ...metrics].join(' | ')
        const lines = rows.map((row) =>
          ['date_start', 'date_stop', ...metrics].map((key) => String(row[key] ?? '')).join(' | '),
        )
        const spend = rows.reduce((sum, row) => sum + Number(row['spend'] ?? 0), 0)
        return {
          content:
            `Meta Ads · ${adAccountId}\nKhoảng: ${range.since} → ${range.until}\n` +
            `Tổng chi tiêu: ${spend.toFixed(2)}\n\n${header}\n${lines.join('\n')}`,
          data: { target, adAccountId, range, rows, totalSpend: spend },
        }
      }

      const pageId = config.pageId
      if (!pageId) {
        throw toolError(
          'Chưa cấu hình pageId cho Meta. Thêm pageId trong Cài đặt → Kết nối.',
        )
      }
      const metrics =
        requestedMetrics ??
        (target === 'instagram'
          ? ['impressions', 'reach', 'profile_views']
          : ['page_impressions', 'page_reach', 'page_engaged_users', 'page_post_engagements'])

      const payload = await graph<{
        data?: { name?: string; period?: string; values?: { value?: unknown; end_time?: string }[] }[]
      }>(
        config,
        target === 'instagram' ? `${pageId}/insights` : `${pageId}/insights`,
        {
          query: {
            metric: metrics.join(','),
            period,
            since: range.since,
            until: range.until,
            limit: String(limit),
          },
        },
        ctx.signal,
      )
      const items = payload.data ?? []
      if (items.length === 0) {
        return {
          content: `Không có chỉ số Meta (${target}) cho ${range.since} → ${range.until}.`,
          data: { target, range, metrics: 0 },
        }
      }
      const blocks = items.map((item) => {
        const values = (item.values ?? [])
          .slice(-Math.min(31, limit))
          .map((v) => `${v.end_time?.slice(0, 10) ?? '?'}: ${formatValue(v.value)}`)
        return `${item.name ?? '?'} (${item.period ?? period}):\n  ${values.join('\n  ')}`
      })
      return {
        content:
          `Meta (${target}) · page ${pageId}\nKhoảng: ${range.since} → ${range.until}\n\n${blocks.join('\n\n')}`,
        data: { target, pageId, range, metrics: items, raw: payload },
      }
    },
  })

  const metaPublish = defineTool({
    name: 'meta_publish',
    description:
      'Tạo bài đăng lên Facebook Page. MẶC ĐỊNH chỉ tạo bản nháp và cần người dùng phê duyệt trước khi đăng thật. Trả về nội dung đã soạn cùng trạng thái phê duyệt.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Nội dung bài đăng' },
        link: { type: 'string', description: 'URL đính kèm (tuỳ chọn)' },
        published: {
          type: 'boolean',
          description: 'true = đăng ngay; false = lưu nháp (mặc định false, và cần phê duyệt)',
        },
        scheduledAt: { type: 'string', description: 'Thời điểm đăng theo ISO 8601 (tuỳ chọn)' },
      },
      required: ['message'],
      additionalProperties: false,
    },
    roles: ['social-media', 'community-care'],
    requiresApproval: true,
    async handler(args, ctx): Promise<ToolResult> {
      const config = store.require(ctx.companyId, 'meta', 'Meta (Facebook / Instagram)')
      const message = requireStringArg(args, 'message')
      const link = optionalStringArg(args, 'link')
      const published = args['published'] === true || ctx.automation !== undefined
      const scheduledAt = optionalStringArg(args, 'scheduledAt')

      if (!published) {
        // Draft mode is the default: the content is real work, the side effect is not.
        return {
          content:
            `BẢN NHÁP bài đăng Facebook Page (chưa đăng).\n\n${message}` +
            (link ? `\n\nLiên kết: ${link}` : '') +
            (scheduledAt ? `\n\nDự kiến đăng: ${scheduledAt}` : '') +
            '\n\nĐể đăng thật, người dùng cần phê duyệt và gọi lại với published = true.',
          data: { status: 'draft', message, link, scheduledAt, requiresApproval: true },
        }
      }

      if (!config.pageId) {
        throw toolError('Chưa cấu hình pageId cho Meta, không thể đăng bài.')
      }
      const payload = await graph<{ id?: string }>(
        config,
        `${config.pageId}/feed`,
        {
          method: 'POST',
          body: {
            message,
            ...(link ? { link } : {}),
            ...(scheduledAt ? { published: false, scheduled_publish_time: Math.floor(new Date(scheduledAt).getTime() / 1000) } : {}),
          },
        },
        ctx.signal,
      )
      return {
        content: `Đã đăng lên Facebook Page ${config.pageId}. ID bài viết: ${payload.id ?? 'không rõ'}.`,
        data: { status: 'published', postId: payload.id, pageId: config.pageId },
      }
    },
  })

  return { metaInsights, metaPublish }
}

function metaDateRange(args: Record<string, unknown>): { since: string; until: string } {
  const since = optionalStringArg(args, 'since')
  const until = optionalStringArg(args, 'until')
  if (since && until) return { since, until }
  const days = Math.min(365, Math.max(1, Math.floor(optionalNumberArg(args, 'days', 28))))
  const end = new Date()
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
  return { since: start.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) }
}

/** Meta accepts `act_123` or a bare id; normalise to the prefixed form. */
function normalizeActId(value: string): string {
  const trimmed = value.trim()
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`
}

function readStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  return out.length > 0 ? out : undefined
}

function formatValue(value: unknown): string {
  if (typeof value === 'number') return value.toLocaleString('vi-VN')
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

