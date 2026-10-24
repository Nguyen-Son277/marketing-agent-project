/**
 * Paid-ads tools: Google Ads and Meta Ads.
 *
 * Both platforms require an approved developer token plus a linked account, and
 * neither is available in every deployment. Rather than ship a tool that silently
 * fabricates numbers, each of these declares its real dependency and fails with
 * `needs_configuration` naming exactly what is missing. Reporting then flows
 * through the GA4 and Meta Insights tools, which read the same campaign data
 * without needing the ads-specific APIs.
 *
 * The write paths are the reason this file is conservative: creating a campaign
 * spends real money. `ads_meta` and `ads_google` therefore default to returning a
 * plan, and only transmit when `apply = true` after explicit approval.
 */
import { toolError, type ToolResult } from '@marketing-agent/shared'
import { extractErrorMessage, postJson } from './http-client.ts'
import { defineTool, optionalNumberArg, optionalStringArg, requireStringArg } from './registry.ts'
import { API_VERSIONS, type IntegrationStore } from './integrations.ts'
import type { GoogleOAuthConfig, MetaConfig } from './integrations.ts'

export function createPaidAdsTools(store: IntegrationStore) {
  const adsMeta = defineTool({
    name: 'ads_meta',
    description:
      'Đọc hoặc tạo cấu trúc chiến dịch Meta Ads. MẶC ĐỊNH chỉ trả về kế hoạch cấu trúc và ngân sách để người dùng duyệt; chỉ gửi lên Meta khi apply = true sau khi được phê duyệt. KHÔNG bao giờ tự tăng ngân sách.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['plan', 'list_campaigns', 'pause_campaign'],
          description: 'plan = soạn cấu trúc (mặc định); list_campaigns = đọc chiến dịch hiện có; pause_campaign = tạm dừng.',
        },
        campaignName: { type: 'string', description: 'Tên chiến dịch (cho pause_campaign)' },
        objective: {
          type: 'string',
          enum: ['OUTCOME_AWARENESS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES'],
          description: 'Mục tiêu chiến dịch (cho action = plan)',
        },
        dailyBudgetVnd: { type: 'number', description: 'Ngân sách mỗi ngày, đơn vị VNĐ (cho action = plan)' },
        plan: { type: 'string', description: 'Mô tả cấu trúc chiến dịch, đối tượng, mẫu quảng cáo (cho action = plan)' },
        apply: { type: 'boolean', description: 'true = gửi thật lên Meta (cần phê duyệt); mặc định false' },
      },
      required: [],
      additionalProperties: false,
    },
    roles: ['paid-media'],
    requiresApproval: true,
    async handler(args, ctx): Promise<ToolResult> {
      const action = optionalStringArg(args, 'action') ?? 'plan'
      const config = action === 'plan' ? store.optional(ctx.companyId, 'meta') : await store.requireFresh(ctx.companyId, 'meta', 'Meta (Facebook / Instagram)')

      if (action === 'plan') {
        const objective = optionalStringArg(args, 'objective')
        const budget = optionalNumberArg(args, 'dailyBudgetVnd', 0)
        const plan = optionalStringArg(args, 'plan')
        if (!plan) {
          throw toolError(
            'Cần "plan" mô tả cấu trúc chiến dịch (chiến dịch → nhóm đối tượng → mẫu quảng cáo, kèm KPI kỳ vọng và điều kiện dừng).',
          )
        }
        const lines = [
          'KẾ HOẠCH QUẢNG CÁO META (chưa gửi lên Meta)',
          '',
          plan,
          '',
          `Mục tiêu: ${objective ?? 'chưa nêu'}`,
          `Ngân sách/ngày: ${budget > 0 ? `${budget.toLocaleString('vi-VN')} VNĐ` : 'chưa nêu'}`,
          '',
          'Điều kiện dừng cần có trước khi chạy: CPL vượt ngưỡng trong 3 ngày liên tiếp, hoặc tần suất > 3.5.',
        ]
        if (!config?.adAccountId) {
          lines.push('', '⚠️ Chưa kết nối tài khoản quảng cáo Meta — không thể chạy thật cho tới khi kết nối.')
        }
        return {
          content: lines.join('\n'),
          data: { status: 'plan', applied: false, objective, dailyBudgetVnd: budget, adAccountConnected: Boolean(config?.adAccountId) },
        }
      }

      if (!config) {
        throw toolError(
          'Chưa kết nối Meta. Vào Cài đặt → Kết nối để thêm access token và adAccountId, sau đó thử lại.',
        )
      }
      if (!config.adAccountId) {
        throw toolError('Thiếu adAccountId trong cấu hình Meta (dạng act_1234567890). Thêm trong Cài đặt → Kết nối.')
      }

      const actId = config.adAccountId.startsWith('act_') ? config.adAccountId : `act_${config.adAccountId}`
      const version = config.apiVersion ?? API_VERSIONS.meta

      if (action === 'list_campaigns') {
        const url =
          `https://graph.facebook.com/${version}/${actId}/campaigns` +
          `?fields=id,name,status,objective,daily_budget,lifetime_budget&limit=50&access_token=${encodeURIComponent(config.accessToken)}`
        const response = await fetch(url, { signal: ctx.signal })
        const payload = (await response.json()) as {
          data?: { id?: string; name?: string; status?: string; objective?: string; daily_budget?: string }[]
          error?: unknown
        }
        if (payload.error || !response.ok) {
          throw toolError(`Meta Ads trả lỗi: ${extractErrorMessage(payload)}`)
        }
        const campaigns = payload.data ?? []
        if (campaigns.length === 0) {
          return { content: `Tài khoản ${actId} chưa có chiến dịch nào.`, data: { campaigns: [] } }
        }
        const lines = campaigns.map(
          (c) =>
            `- ${c.name ?? '?'} [${c.id ?? '?'}] · ${c.status ?? '?'} · ${c.objective ?? '?'} · ` +
            `ngân sách/ngày ${c.daily_budget ? (Number(c.daily_budget) / 100).toLocaleString('vi-VN') : '—'}`,
        )
        return { content: `Chiến dịch của ${actId}:\n${lines.join('\n')}`, data: { campaigns } }
      }

      // pause_campaign — the only mutation this tool performs, and it reduces spend.
      const campaignName = requireStringArg(args, 'campaignName')
      if (args['apply'] !== true) {
        return {
          content:
            `KẾ HOẠCH tạm dừng chiến dịch "${campaignName}" trên ${actId} (chưa thực hiện).\n` +
            'Cần phê duyệt; gọi lại với apply = true để thực hiện.',
          data: { status: 'plan', action, campaignName, applied: false },
        }
      }

      const listUrl =
        `https://graph.facebook.com/${version}/${actId}/campaigns` +
        `?fields=id,name,status&limit=200&access_token=${encodeURIComponent(config.accessToken)}`
      const listResponse = await fetch(listUrl, { signal: ctx.signal })
      const listPayload = (await listResponse.json()) as { data?: { id?: string; name?: string }[]; error?: unknown }
      if (listPayload.error || !listResponse.ok) {
        throw toolError(`Không đọc được danh sách chiến dịch: ${extractErrorMessage(listPayload)}`)
      }
      const match = (listPayload.data ?? []).find((c) => c.name === campaignName)
      if (!match?.id) {
        throw toolError(
          `Không tìm thấy chiến dịch tên "${campaignName}". Các chiến dịch hiện có: ` +
            (listPayload.data ?? []).map((c) => c.name).join(', '),
        )
      }
      const payload = await postJson<Record<string, unknown>>(
        `https://graph.facebook.com/${version}/${match.id}`,
        { status: 'PAUSED' },
        { Authorization: `Bearer ${config.accessToken}` },
        { signal: ctx.signal },
      )
      return {
        content: `Đã tạm dừng chiến dịch "${campaignName}" [${match.id}].`,
        data: { status: 'applied', campaignId: match.id, campaignName, result: payload },
      }
    },
  })

  const adsGoogle = defineTool({
    name: 'ads_google',
    description:
      'Đọc hoặc lập kế hoạch chiến dịch Google Ads. MẶC ĐỊNH chỉ trả kế hoạch; chỉ gửi yêu cầu khi apply = true sau khi được phê duyệt. Cần developer token của Google Ads.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['plan', 'list_campaigns', 'campaign_report'],
          description: 'plan = soạn kế hoạch (mặc định); list_campaigns / campaign_report = đọc dữ liệu.',
        },
        customerId: { type: 'string', description: 'Google Ads customer id, dạng 1234567890 (không gạch ngang)' },
        plan: { type: 'string', description: 'Mô tả kế hoạch chiến dịch (cho action = plan)' },
        days: { type: 'number', description: 'Số ngày báo cáo, mặc định 28' },
        apply: { type: 'boolean', description: 'true = gửi thật (cần phê duyệt); mặc định false' },
      },
      required: [],
      additionalProperties: false,
    },
    roles: ['paid-media'],
    requiresApproval: true,
    async handler(args, ctx): Promise<ToolResult> {
      const action = optionalStringArg(args, 'action') ?? 'plan'
      const config = store.optional(ctx.companyId, 'google-ads')

      if (action === 'plan') {
        const plan = optionalStringArg(args, 'plan')
        if (!plan) {
          throw toolError(
            'Cần "plan" mô tả cấu trúc chiến dịch Google Ads kèm KPI kỳ vọng, phân bổ ngân sách và điều kiện dừng.',
          )
        }
        return {
          content:
            `KẾ HOẠCH GOOGLE ADS (chưa gửi)\n\n${plan}\n\n` +
            (config
              ? 'Đã có cấu hình Google Ads.'
              : '⚠️ Chưa kết nối Google Ads (cần developer token + customer id).'),
          data: { status: 'plan', applied: false, connected: Boolean(config) },
        }
      }

      if (!config) {
        throw toolError(
          'Chưa kết nối Google Ads. Cần developer token, client id/secret, refresh token và customer id — ' +
            'thêm trong Cài đặt → Kết nối.',
        )
      }
      const customerId = (optionalStringArg(args, 'customerId') ?? readCustomerId(config) ?? '').replace(/-/g, '')
      if (!customerId) {
        throw toolError('Thiếu customerId của Google Ads. Thêm trong Cài đặt → Kết nối hoặc truyền tham số customerId.')
      }
      const days = Math.min(365, Math.max(1, Math.floor(optionalNumberArg(args, 'days', 28))))

      // The Google Ads API needs a developer token header in addition to OAuth.
      const developerToken = readDeveloperToken(config)
      if (!developerToken) {
        throw toolError(
          'Thiếu developer token của Google Ads. Thêm trường developerToken trong cấu hình Google Ads.',
        )
      }

      const query =
        action === 'list_campaigns'
          ? 'SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign ORDER BY campaign.name'
          : `SELECT campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date DURING LAST_${days}_DAYS`

      const { getAccessToken } = await import('./google/auth.ts')
      const token = await getAccessToken(config, { signal: ctx.signal })
      const payload = await postJson<{ results?: unknown[] }>(
        `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
        { query },
        {
          Authorization: `Bearer ${token}`,
          'developer-token': developerToken,
          ...(config.quotaProjectId ? { 'login-customer-id': config.quotaProjectId } : {}),
        },
        { signal: ctx.signal },
      )
      const rows = payload.results ?? []
      return {
        content:
          rows.length === 0
            ? `Google Ads customer ${customerId}: truy vấn không trả hàng nào.`
            : `Google Ads · customer ${customerId}\nSố hàng: ${rows.length}\n\n${JSON.stringify(rows, null, 2).slice(0, 6_000)}`,
        data: { customerId, action, days, rows: rows.length },
      }
    },
  })

  return { adsMeta, adsGoogle }
}

function readDeveloperToken(config: GoogleOAuthConfig): string | undefined {
  return config.developerToken && config.developerToken.trim().length > 0 ? config.developerToken.trim() : undefined
}

function readCustomerId(config: GoogleOAuthConfig): string | undefined {
  return config.customerId && config.customerId.trim().length > 0 ? config.customerId.trim() : undefined
}
