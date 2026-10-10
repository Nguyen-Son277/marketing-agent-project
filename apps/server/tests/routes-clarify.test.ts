/**
 * Test tích hợp HTTP cho luồng hỏi lại có cấu trúc.
 *
 * Vì sao cần test ở tầng HTTP chứ không chỉ ở orchestrator: thẻ chọn phải đi hết chuỗi
 * `sendMessage → meta → readClarification → MessageView.clarify`, và câu trả lời phải đi
 * ngược từ body xuống `applyClarificationAnswers`. Sai một khớp nối ở giữa thì unit test
 * vẫn xanh nhưng màn Trao đổi không vẽ được thẻ.
 *
 * LLM được thay bằng adapter trả chuỗi rỗng: tầng 1 phải đủ dùng khi model không giúp gì.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatAdapter } from '@marketing-agent/agent-runtime'
import type { ClarificationAnswer } from '@marketing-agent/shared'
import {
  configureCompanyModel,
  createRoutesTestContext,
  tenant,
  type RoutesTestContext,
} from './helpers/routes-helpers.ts'
import { setAgentRuntimeOverrides } from '../src/services/agent-services.ts'

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

/** Model trả chuỗi rỗng: trích brief và viết lại câu hỏi đều thất bại mềm. */
const emptyAdapter: ChatAdapter = {
  async *chat() {
    yield { type: 'text', text: '' }
    yield { type: 'done', finishReason: 'stop', usage: { promptTokens: 4, completionTokens: 0, cachedTokens: 0 } }
  },
}

const ANSWERS: ClarificationAnswer[] = [
  { field: 'objective', optionIds: ['objective-trial'] },
  { field: 'kpi', optionIds: ['kpi-signups'], custom: '50 đăng ký mỗi tháng' },
  { field: 'scope', optionIds: ['scope-facebook', 'scope-no-tiktok'] },
  { field: 'deadline', optionIds: ['deadline-60'] },
  { field: 'budget', optionIds: ['budget-20-50m'] },
  { field: 'constraints', optionIds: ['constraints-brand-guidelines'] },
]

describe('clarify qua HTTP', () => {
  it('tin thiếu thông tin trả câu hỏi có cấu trúc, tin trả lời làm brief đủ', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'clarify-http@example.com', 'Clarify HTTP')
    configureCompanyModel(ctx, company.id)
    setAgentRuntimeOverrides(ctx.repos, { adapter: emptyAdapter })

    const created = await ctx.client.request('POST', `/api/companies/${company.id}/conversations`, {
      headers: ownerCookie,
      body: { title: 'Chiến dịch mới' },
    })
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id

    /* Lượt 1: thiếu thông tin → phải có thẻ chọn, không chỉ văn bản liệt kê. */
    const first = await ctx.client.request('POST', `/api/conversations/${conversationId}/messages`, {
      headers: ownerCookie,
      body: { content: 'Tôi cần làm marketing cho sản phẩm mới' },
    })
    expect(first.status).toBe(200)
    const firstBody = first.json<{
      briefComplete: boolean
      missingFields: string[]
      clarify?: {
        intro: string
        questions: {
          field: string
          inputMode: string
          allowCustom: boolean
          options: { id: string; label: string; exclusive?: boolean }[]
        }[]
      }
      reply: { clarify?: { questions: unknown[] } }
    }>()
    expect(firstBody.briefComplete).toBe(false)
    expect(firstBody.missingFields.length).toBeGreaterThan(0)
    expect(firstBody.clarify).toBeDefined()
    expect(firstBody.clarify!.questions.length).toBeGreaterThan(0)
    expect(firstBody.clarify!.questions.length).toBeLessThanOrEqual(3)

    const scope = firstBody.clarify!.questions.find((question) => question.field === 'scope')
    expect(scope).toBeDefined()
    expect(scope!.inputMode).toBe('multi')
    expect(scope!.allowCustom).toBe(true)
    expect(scope!.options.find((option) => option.id === 'scope-no-tiktok')?.exclusive).toBe(true)

    // `readClarification` ở tầng API phải đọc được meta của tin nhắn Leader.
    expect(firstBody.reply.clarify).toBeDefined()
    expect(firstBody.reply.clarify!.questions.length).toBeGreaterThan(0)

    /* Lượt 2: trả lời bằng mã phương án → brief đủ ngay, không cần đoán từ câu chữ. */
    const second = await ctx.client.request('POST', `/api/conversations/${conversationId}/messages`, {
      headers: ownerCookie,
      body: { content: 'Đây là câu trả lời của tôi', answers: ANSWERS },
    })
    expect(second.status).toBe(200)
    const secondBody = second.json<{ briefComplete: boolean; missingFields: string[] }>()
    expect(secondBody.briefComplete).toBe(true)
    expect(secondBody.missingFields).toEqual([])

    const conversation = ctx.repos.work.requireConversation(conversationId, company.id)
    const brief = JSON.parse(conversation.briefJson ?? '{}') as Record<string, string>
    expect(brief['objective']).toContain('Tăng số đăng ký dùng thử')
    expect(brief['kpi']).toContain('50 đăng ký mỗi tháng')
    expect(brief['scope']).toContain('TRONG phạm vi')
    expect(brief['scope']).toContain('NGOÀI phạm vi')
    expect(brief['scope']).toContain('TikTok')
    expect(brief['deadline']).toBeTruthy()
    expect(brief['budget']).toBeTruthy()
    expect(brief['constraints']).toContain('hướng dẫn thương hiệu')

    /* Lịch sử: thẻ chọn phải còn đọc được, và tin người dùng phải ghi lại mã đã chọn. */
    const detail = await ctx.client.request('GET', `/api/conversations/${conversationId}`, {
      headers: ownerCookie,
    })
    expect(detail.status).toBe(200)
    const messages = detail.json<{
      messages: { authorKind: string; contentMd: string; clarify?: { questions: unknown[] }; meta: { answers?: unknown[] } }[]
    }>().messages
    const leaderMessage = messages.find((message) => message.authorKind === 'leader')
    expect(leaderMessage?.clarify).toBeDefined()
    const lastUser = [...messages].reverse().find((message) => message.authorKind === 'user')
    expect(lastUser?.meta.answers).toHaveLength(6)
  })
})
