/**
 * LinkedIn tools.
 *
 * LinkedIn's API is the most restrictive of the integrations here: posting to an
 * organization requires an approved app and the correct `w:organization_social`
 * scope. Rather than hide that, the tool surfaces the API's own error text so the
 * operator knows whether the problem is scope, token expiry, or an unverified app.
 */
import { toolError, type ToolResult } from '@marketing-agent/shared'
import { extractErrorMessage, fetchWithTimeout, parseJsonResponse } from './http-client.ts'
import { defineTool, optionalNumberArg, optionalStringArg, requireStringArg } from './registry.ts'
import { API_VERSIONS, type IntegrationStore, type LinkedInConfig } from './integrations.ts'

const LINKEDIN_BASE = 'https://api.linkedin.com/rest'

export function createLinkedInTools(store: IntegrationStore) {
  async function call<T>(
    config: LinkedInConfig,
    path: string,
    init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const version = config.apiVersion ?? API_VERSIONS.linkedin
    const url = new URL(`${LINKEDIN_BASE}/${path.replace(/^\/+/, '')}`)
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value)

    const response = await fetchWithTimeout(
      url.toString(),
      {
        method: init.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'LinkedIn-Version': version,
          'X-Restli-Protocol-Version': '2.0.0',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      },
      30_000,
      signal,
    )
    const parsed = await parseJsonResponse<Record<string, unknown>>(response)
    if (!response.ok) {
      throw toolError(`LinkedIn API lỗi (HTTP ${response.status}): ${extractErrorMessage(parsed)}`)
    }
    return parsed as T
  }

  const linkedinPublish = defineTool({
    name: 'linkedin_publish',
    description:
      'Tạo bài đăng LinkedIn cho tổ chức hoặc cá nhân. MẶC ĐỊNH chỉ soạn bản nháp và cần người dùng phê duyệt trước khi đăng thật.',
    parameters: {
      type: 'object',
      properties: {
        commentary: { type: 'string', description: 'Nội dung bài đăng' },
        link: { type: 'string', description: 'URL chia sẻ kèm bài (tuỳ chọn)' },
        title: { type: 'string', description: 'Tiêu đề cho thẻ liên kết (tuỳ chọn)' },
        published: { type: 'boolean', description: 'true = đăng ngay; false = nháp (mặc định, cần phê duyệt)' },
      },
      required: ['commentary'],
      additionalProperties: false,
    },
    roles: ['social-media', 'content-writer'],
    requiresApproval: true,
    async handler(args, ctx): Promise<ToolResult> {
      const config = store.require(ctx.companyId, 'linkedin', 'LinkedIn')
      const commentary = requireStringArg(args, 'commentary')
      const link = optionalStringArg(args, 'link')
      const title = optionalStringArg(args, 'title')
      const published = args['published'] === true || ctx.automation !== undefined

      if (!published) {
        return {
          content:
            `BẢN NHÁP bài đăng LinkedIn (chưa đăng).\n\n${commentary}` +
            (link ? `\n\nLiên kết: ${link}` : '') +
            (title ? `\nTiêu đề thẻ: ${title}` : '') +
            '\n\nĐể đăng thật, người dùng cần phê duyệt và gọi lại với published = true.',
          data: { status: 'draft', commentary, link, title, requiresApproval: true },
        }
      }

      const author = config.organizationUrn
      if (!author) {
        throw toolError(
          'Chưa cấu hình organizationUrn cho LinkedIn, không thể đăng thay tổ chức. ' +
            'Thêm organizationUrn (dạng urn:li:organization:12345678) trong Cài đặt → Kết nối.',
        )
      }

      const payload = await call<{ id?: string }>(
        config,
        'posts',
        {
          method: 'POST',
          body: {
            author,
            commentary,
            visibility: 'PUBLIC',
            distribution: {
              feedDistribution: 'MAIN_FEED',
              targetEntities: [],
              thirdPartyDistributionChannels: [],
            },
            lifecycleState: 'PUBLISHED',
            isReshareDisabledByAuthor: false,
            ...(link
              ? {
                  content: {
                    article: {
                      source: link,
                      ...(title ? { title } : {}),
                    },
                  },
                }
              : {}),
          },
        },
        ctx.signal,
      )

      return {
        content: `Đã đăng lên LinkedIn với tư cách ${author}. ID bài viết: ${payload.id ?? 'không rõ'}.`,
        data: { status: 'published', postId: payload.id, author },
      }
    },
  })

  const linkedinInsights = defineTool({
    name: 'linkedin_insights',
    description:
      'Lấy chỉ số hiệu suất bài đăng LinkedIn của tổ chức: lượt hiển thị, người tiếp cận, tương tác, lượt bấm. Dùng để báo cáo hiệu quả kênh LinkedIn.',
    parameters: {
      type: 'object',
      properties: {
        postUrn: { type: 'string', description: 'URN bài viết cần lấy số liệu (tuỳ chọn)' },
        days: { type: 'number', description: 'Số ngày gần đây, mặc định 28' },
        limit: { type: 'number', description: 'Số bản ghi tối đa, mặc định 50' },
      },
      required: [],
      additionalProperties: false,
    },
    roles: ['social-media', 'analytics'],
    async handler(args, ctx): Promise<ToolResult> {
      const config = store.require(ctx.companyId, 'linkedin', 'LinkedIn')
      const organizationUrn = config.organizationUrn
      if (!organizationUrn) {
        throw toolError('Chưa cấu hình organizationUrn cho LinkedIn, không thể lấy số liệu tổ chức.')
      }
      const days = Math.min(365, Math.max(1, Math.floor(optionalNumberArg(args, 'days', 28))))
      const limit = Math.min(500, Math.max(1, Math.floor(optionalNumberArg(args, 'limit', 50))))
      const postUrn = optionalStringArg(args, 'postUrn')

      // The organizationalEntityShareStatistics endpoint takes an entity filter.
      const entity = postUrn ?? organizationUrn
      const payload = await call<{ elements?: Record<string, unknown>[] }>(
        config,
        'organizationalEntityShareStatistics',
        {
          query: {
            q: 'organizationalEntity',
            organizationalEntity: organizationUrn,
            'count': String(limit),
            ...(postUrn ? { 'shares[0]': postUrn } : {}),
          },
        },
        ctx.signal,
      )

      const elements = payload.elements ?? []
      if (elements.length === 0) {
        return {
          content:
            `LinkedIn không trả số liệu nào cho ${entity} trong ${days} ngày gần đây.\n` +
            'Có thể do: chưa có bài đăng nào, token thiếu scope, hoặc tổ chức chưa đủ điều kiện API.',
          data: { organizationUrn, postUrn, rows: 0 },
        }
      }

      const lines = elements.map((element) => {
        const stats = (element['totalShareStatistics'] as Record<string, unknown> | undefined) ?? {}
        return (
          `- ${String(element['share'] ?? element['organizationalEntity'] ?? '?')}: ` +
          `hiển thị ${String(stats['impressionCount'] ?? '?')}, ` +
          `tiếp cận ${String(stats['uniqueImpressionsCount'] ?? '?')}, ` +
          `tương tác ${String(stats['engagement'] ?? '?')}, ` +
          `bấm ${String(stats['clickCount'] ?? '?')}`
        )
      })

      return {
        content: `LinkedIn insights · ${organizationUrn}\n\n${lines.join('\n')}`,
        data: { organizationUrn, postUrn, days, elements },
      }
    },
  })

  return { linkedinPublish, linkedinInsights }
}
