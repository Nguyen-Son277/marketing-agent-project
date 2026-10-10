/**
 * Test đầu-cuối THẬT qua HTTP: gửi tin → lập kế hoạch → chạy kế hoạch → viết báo cáo.
 *
 * Vì sao cần một test xuyên suốt như vậy: từng route riêng lẻ có thể đúng mà ghép
 * lại vẫn sai — state machine của phiên, việc lưu `summary`/`review` giữa `/run` và
 * `/report`, và hình dạng báo cáo bảy mục chỉ lộ ra khi chạy hết luồng.
 *
 * Không gọi mạng: adapter LLM được kịch bản hoá và tiêm qua `runtimeOverrides`.
 * Lượt lập kế hoạch trả về đúng một bảng Markdown bốn cột mà `parsePlanTable` đọc được.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatAdapter } from '@marketing-agent/agent-runtime'
import { createRoutesTestContext, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'
import { setAgentRuntimeOverrides } from '../src/services/agent-services.ts'

/** Đúng bảng mà Leader phải trình bày; header khớp yêu cầu của orchestrator. */
const PLAN_TABLE = [
  '| Công việc | Chuyên môn | Phụ thuộc | Đầu ra |',
  '|---|---|---|---|',
  '| Nghiên cứu từ khoá | market-research | không | Danh sách 20 từ khoá kèm lượng tìm kiếm |',
  '| Viết bài chuẩn SEO | content-writer | Nghiên cứu từ khoá | Bản nháp 1.500 từ tối ưu từ khoá |',
  '| Đo lường hiệu suất | analytics | Viết bài chuẩn SEO | Bảng chỉ số và đề xuất tối ưu |',
].join('\n')

/** Kết quả chuyên môn: đủ dài và có nguồn để cổng kiểm tra chất lượng không chặn. */
const TASK_RESULT = [
  'Kết quả công việc: đã hoàn thành theo đúng brief đã chốt với người dùng.',
  'Phân tích dựa trên tài liệu nội bộ và dữ liệu hiện có; các giả định được ghi rõ ở phần cuối.',
  'Cần xác nhận: ngân sách quảng cáo tháng tới và thời điểm go-live chính thức.',
  'Nguồn: https://example.com/du-lieu-noi-bo',
].join('\n')

const BRIEF = {
  objective: 'Tăng 30% đăng ký dùng thử trong quý 4',
  kpi: '150 lead chất lượng mỗi tháng, CPL ≤ 120.000đ',
  scope: 'Chỉ kênh Facebook và SEO; không chạy TikTok lần này',
  deadline: '2026-12-31',
  budget: '80.000.000 VNĐ tiền quảng cáo',
  constraints: 'Không dùng ảnh khách hàng chưa xin phép; giữ giọng thương hiệu hiện tại',
}

function scriptedAdapter(): ChatAdapter {
  return {
    async *chat(request) {
      const prompt = request.messages.map((message) => message.content).join('\n')
      const output = prompt.includes('Lập kế hoạch công việc') ? PLAN_TABLE : TASK_RESULT
      yield { type: 'text', text: output }
      yield {
        type: 'done',
        finishReason: 'stop',
        usage: { promptTokens: 150, completionTokens: 90, cachedTokens: 0 },
      }
    },
  }
}

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

describe('end-to-end: gửi tin → plan → run → report', () => {
  it('chạy hết luồng với LLM giả và tạo báo cáo đủ bảy mục', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'e2e-owner@example.com', 'E2E Co')

    const created = await ctx.client.request('POST', `/api/companies/${company.id}/conversations`, {
      headers: ownerCookie,
      body: { title: 'Chiến dịch quý 4' },
    })
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id

    // Chốt brief trực tiếp trong kho dữ liệu: luồng hỏi-đáp từng bước là việc của
    // test chat; ở đây ta cần brief đã đủ để đo phần plan → run → report.
    ctx.repos.work.updateConversation(conversationId, company.id, { brief: BRIEF })
    setAgentRuntimeOverrides(ctx.repos, { adapter: scriptedAdapter() })

    const message = await ctx.client.request('POST', `/api/conversations/${conversationId}/messages`, {
      headers: ownerCookie,
      body: { content: 'Chốt brief như trên, hãy lập kế hoạch.' },
    })
    expect(message.status).toBe(200)
    expect(message.json<{ briefComplete: boolean }>().briefComplete).toBe(true)

    const plan = await ctx.client.request('POST', `/api/conversations/${conversationId}/plan`, {
      headers: ownerCookie,
      body: {},
    })
    expect(plan.status).toBe(200)
    const planBody = plan.json<{ tasks: { title: string; assigneeRole: string }[]; order: string[] }>()
    expect(planBody.tasks).toHaveLength(3)
    expect(planBody.tasks.map((task) => task.assigneeRole)).toEqual([
      'market-research',
      'content-writer',
      'analytics',
    ])

    const run = await ctx.client.request('POST', `/api/conversations/${conversationId}/run`, {
      headers: ownerCookie,
      body: {},
    })
    expect(run.status).toBe(200)
    const runBody = run.json<{ summary: { completed: number; failed: number }; review: { verdict: string } }>()
    expect(runBody.summary.completed).toBe(3)
    expect(runBody.summary.failed).toBe(0)

    const report = await ctx.client.request('POST', `/api/conversations/${conversationId}/report`, {
      headers: ownerCookie,
      body: {},
    })
    expect(report.status).toBe(200)
    const reportBody = report.json<{ artifactId: string; markdown: string }>()
    for (const section of [1, 2, 3, 4, 5, 6, 7]) {
      expect(reportBody.markdown).toContain(`## ${section}.`)
    }
    expect(reportBody.markdown).toContain('Tóm tắt điều hành')
    expect(reportBody.markdown).toContain('Phụ lục')

    // Tài sản báo cáo phải tồn tại thật trong sổ tài sản của công ty.
    const artifacts = ctx.repos.work.listArtifacts(company.id)
    const artifact = artifacts.find((item) => item.id === reportBody.artifactId)
    expect(artifact).toBeDefined()
    expect(artifact?.content).toContain('## 1.')
    expect(artifact?.metaJson ?? '').toContain('final-report')

    const conversation = ctx.repos.work.requireConversation(conversationId, company.id)
    expect(conversation.phase).toBe('report')
  })
})
