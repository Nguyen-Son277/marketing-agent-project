/**
 * Test câu hỏi làm rõ có cấu trúc và việc áp câu trả lời vào brief.
 *
 * Vì sao tách khỏi test orchestrator: `buildClarification` và `applyClarificationAnswers` là
 * hai hàm thuần, quyết định trực tiếp brief cuối cùng. Sai ở đây không làm test nào khác đỏ,
 * nhưng làm hệ thống hiểu sai yêu cầu của người dùng — kiểu lỗi nguy hiểm nhất.
 *
 * Bất biến quan trọng nhất: thẻ chọn KHÔNG BAO GIỜ rỗng vì lỗi model, và câu trả lời
 * "không làm X" phải thành "X nằm NGOÀI phạm vi".
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createRepos, type Repos } from '@marketing-agent/db'
import { seedCatalog, seedCompany } from '@marketing-agent/seed'
import { buildToolRegistry } from '@marketing-agent/tools'
import type { ChatAdapter } from '@marketing-agent/agent-runtime'
import type { ClarificationRequest } from '@marketing-agent/shared'
import {
  applyClarificationAnswers,
  buildClarification,
  buildClarificationRewriteInstruction,
  CLARIFY_REWRITE_MARKER,
  parseClarificationRewrite,
} from '../src/planner.ts'
import { ConversationOrchestrator } from '../src/index.ts'
import type { Brief } from '../src/types.ts'

let repos: Repos
let companyId: string
let conversationId: string
let userId: string

beforeEach(() => {
  repos = createRepos({ file: ':memory:', allowWeakSecret: true })
  seedCatalog(repos)
  companyId = seedCompany(repos, { companyName: 'Clarify Co' }).company.id
  // Seed không tạo provider/model nữa: test phải chọn model tường minh như người dùng.
  const provider = repos.llm.createProvider({
    companyId,
    name: 'Provider test',
    kind: 'openai_compatible',
    baseUrl: 'http://127.0.0.1:1/v1',
  })
  const model = repos.llm.createModel({
    providerId: provider.id,
    modelId: 'test-model',
    label: 'Test model',
    supportsTools: true,
  })
  for (const preset of repos.team.listPresets(companyId)) {
    repos.team.updatePreset(companyId, preset.agentDefId, { modelFk: model.id })
  }
  const user = repos.auth.createUser({ email: 'clarify@example.com', password: 'matkhau-rat-dai-123', name: 'Clarify' })
  userId = user.id
  conversationId = repos.work.createConversation({ companyId, userId, title: 'Hỏi lại' }).id
})

function tools() {
  return buildToolRegistry({ repos, coreOptions: { companiesRoot: '/tmp/ma-clarify-test' } }).registry
}

/** Adapter trả lần lượt các câu đã định; hết kịch bản thì lặp lại câu cuối. */
function scripted(outputs: readonly string[]): ChatAdapter {
  let index = 0
  return {
    async *chat() {
      const output = outputs[Math.min(index, outputs.length - 1)] ?? ''
      index += 1
      yield { type: 'text', text: output }
      yield {
        type: 'done',
        finishReason: 'stop',
        usage: { promptTokens: 20, completionTokens: 10, cachedTokens: 0 },
      }
    },
  }
}

/* --------------------------------------------------------- tầng 1 tất định */

describe('buildClarification', () => {
  const fields = ['objective', 'kpi', 'scope', 'deadline', 'budget', 'constraints'] as const

  it('mỗi trường đơn lẻ trả đúng field, inputMode và mã phương án', () => {
    for (const field of fields) {
      const result = buildClarification([field], 'vi')
      expect(result.questions, `thiếu câu hỏi cho ${field}`).toHaveLength(1)
      const question = result.questions[0]!
      expect(question.field).toBe(field)
      expect(question.allowCustom).toBe(true)
      expect(question.question.length).toBeGreaterThan(0)
      expect(question.options.length).toBeGreaterThan(0)
      expect(['single', 'multi']).toContain(question.inputMode)
      for (const option of question.options) {
        expect(option.id.startsWith(`${field}-`), `mã lạ ${option.id}`).toBe(true)
        expect(option.label.length).toBeGreaterThan(0)
      }
      if (field === 'scope' || field === 'constraints') {
        expect(question.inputMode).toBe('multi')
      } else {
        expect(question.inputMode).toBe('single')
      }
    }
  })

  it('scope là chọn-nhiều và mọi phương án scope-no-* đều exclusive', () => {
    const result = buildClarification(['scope'], 'vi')
    const question = result.questions[0]!
    expect(question.inputMode).toBe('multi')
    const exclusive = question.options.filter((option) => option.exclusive === true).map((option) => option.id)
    expect(exclusive).toContain('scope-no-tiktok')
    expect(exclusive).not.toContain('scope-facebook')
    for (const id of exclusive) expect(id.startsWith('scope-no-')).toBe(true)
  })

  it('giữ hành vi cũ: tối đa 3 câu hỏi mỗi lượt', () => {
    const result = buildClarification([...fields], 'vi')
    expect(result.questions).toHaveLength(3)
    expect(result.intro.length).toBeGreaterThan(0)
  })

  it('ở locale en thì câu hỏi và nhãn là tiếng Anh, vi là tiếng Việt', () => {
    const vi = buildClarification(['objective'], 'vi').questions[0]!
    const en = buildClarification(['objective'], 'en').questions[0]!
    expect(vi.question).toContain('Kết quả')
    expect(vi.options.find((option) => option.id === 'objective-trial')?.label).toBe('Tăng số đăng ký dùng thử')
    expect(en.question).toContain('business result')
    expect(en.options.find((option) => option.id === 'objective-trial')?.label).toBe('Increase trial sign-ups')
    // Mã phương án KHÔNG đổi theo ngôn ngữ: server ánh xạ câu trả lời bằng mã.
    expect(en.options.map((option) => option.id)).toEqual(vi.options.map((option) => option.id))
  })
})

/* ---------------------------------------------- áp câu trả lời tất định */

describe('applyClarificationAnswers', () => {
  const empty: Partial<Brief> = {}

  it('chọn một: lấy nhãn của phương án làm nội dung trường', () => {
    const brief = applyClarificationAnswers(empty, [{ field: 'objective', optionIds: ['objective-lead'] }], 'vi')
    expect(brief.objective).toContain('Tăng số lead chất lượng')
  })

  it('chọn nhiều: ghép các nhãn đã chọn', () => {
    const brief = applyClarificationAnswers(
      empty,
      [{ field: 'constraints', optionIds: ['constraints-brand-guidelines', 'constraints-legal-review'] }],
      'vi',
    )
    expect(brief.constraints).toContain('hướng dẫn thương hiệu')
    expect(brief.constraints).toContain('kiểm duyệt pháp lý')
  })

  it('custom được nối thêm và ghi rõ là phần bổ sung', () => {
    const brief = applyClarificationAnswers(
      empty,
      [{ field: 'kpi', optionIds: ['kpi-leads'], custom: '30 lead mỗi tháng' }],
      'vi',
    )
    expect(brief.kpi).toContain('Số lead mỗi tháng')
    expect(brief.kpi).toContain('30 lead mỗi tháng')
    expect(brief.kpi).toContain('Bổ sung từ người dùng')
  })

  it('optionIds lạ bị bỏ qua riêng lẻ, phần còn lại vẫn được áp', () => {
    const brief = applyClarificationAnswers(
      empty,
      [{ field: 'objective', optionIds: ['objective-khong-ton-tai', 'objective-trial'] }],
      'vi',
    )
    expect(brief.objective).toContain('Tăng số đăng ký dùng thử')
  })

  it('field lạ bị bỏ qua hoàn toàn', () => {
    const brief = applyClarificationAnswers(
      empty,
      [{ field: 'khong-phai-truong-brief', optionIds: ['objective-trial'] }],
      'vi',
    )
    expect(brief.objective).toBe('')
    expect(brief.kpi).toBe('')
  })

  it('KHÔNG ghi đè trường đã có giá trị từ lượt trước', () => {
    const existing: Partial<Brief> = { objective: 'Mục tiêu người dùng đã chốt' }
    const brief = applyClarificationAnswers(
      existing,
      [{ field: 'objective', optionIds: ['objective-trial'] }],
      'vi',
    )
    expect(brief.objective).toBe('Mục tiêu người dùng đã chốt')
  })

  it('chọn "không chạy TikTok" thì brief phải nêu TikTok NGOÀI phạm vi', () => {
    const brief = applyClarificationAnswers(empty, [{ field: 'scope', optionIds: ['scope-no-tiktok'] }], 'vi')
    expect(brief.scope.toLowerCase()).toContain('ngoài phạm vi')
    expect(brief.scope).toContain('TikTok')
    expect(brief.scope).not.toContain('TRONG phạm vi')
  })

  it('scope vừa trong vừa ngoài: nêu rõ cả hai nhóm', () => {
    const brief = applyClarificationAnswers(
      empty,
      [{ field: 'scope', optionIds: ['scope-facebook', 'scope-no-tiktok'] }],
      'vi',
    )
    expect(brief.scope).toContain('TRONG phạm vi')
    expect(brief.scope).toContain('Chạy quảng cáo Facebook')
    expect(brief.scope).toContain('NGOÀI phạm vi')
    expect(brief.scope).toContain('TikTok')
  })

  it('custom tiếng Anh cũng được ghi rõ là phần bổ sung', () => {
    const brief = applyClarificationAnswers(
      empty,
      [{ field: 'kpi', optionIds: ['kpi-leads'], custom: '30 leads/month' }],
      'en',
    )
    expect(brief.kpi).toContain('Leads per month')
    expect(brief.kpi).toContain('User addition')
  })
})

/* ------------------------------------------------- tầng 2: viết lại */

describe('parseClarificationRewrite', () => {
  const base = buildClarification(['objective'], 'vi')

  it('JSON hỏng trả undefined để nơi gọi dùng tầng 1', () => {
    expect(parseClarificationRewrite('không phải JSON', base, 'vi')).toBeUndefined()
    expect(parseClarificationRewrite('{"questions": "sai"}', base, 'vi')).toBeUndefined()
  })

  it('nhận phần chữ nhưng giữ nguyên cấu trúc tất định', () => {
    const output = JSON.stringify({
      questions: [
        {
          field: 'objective',
          question: 'Mục tiêu riêng của công ty bạn là gì?',
          options: [{ id: 'objective-trial', label: 'Đăng ký dùng thử gói Pro' }],
        },
      ],
    })
    const rewritten = parseClarificationRewrite(output, base, 'vi')
    expect(rewritten).toBeDefined()
    const question = rewritten!.questions[0]!
    expect(question.question).toBe('Mục tiêu riêng của công ty bạn là gì?')
    expect(question.field).toBe('objective')
    expect(question.inputMode).toBe('single')
    expect(question.allowCustom).toBe(true)
    expect(question.options.map((option) => option.id)).toEqual(base.questions[0]!.options.map((option) => option.id))
    expect(question.options.find((option) => option.id === 'objective-trial')?.label).toBe('Đăng ký dùng thử gói Pro')
    expect(rewritten!.intro).toContain('ngữ cảnh công ty')
  })

  it('JSON không đổi gì thì trả undefined (giữ nguyên văn bản tầng 1)', () => {
    const output = JSON.stringify({ questions: [{ field: 'objective', options: [] }] })
    expect(parseClarificationRewrite(output, base, 'vi')).toBeUndefined()
  })

  it('prompt tầng 2 mang dấu nhận dạng và JSON của tầng 1', () => {
    const instruction = buildClarificationRewriteInstruction(base)
    expect(instruction).toContain(CLARIFY_REWRITE_MARKER)
    expect(instruction).toContain('objective-trial')
    expect(instruction).toContain('Giữ nguyên')
  })
})

/* ------------------------------------- tích hợp orchestrator: dự phòng */

describe('clarification qua ConversationOrchestrator', () => {
  it('adapter lỗi liên tục vẫn trả câu hỏi tầng 1 và KHÔNG ném ra ngoài', async () => {
    const adapter: ChatAdapter = {
      async *chat() {
        throw new Error('gateway sập')
        // eslint-disable-next-line no-unreachable
        yield { type: 'done' as const, finishReason: null, usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0 } }
      },
    }
    const orchestrator = new ConversationOrchestrator({
      repos,
      tools: tools(),
      runtimeOverrides: { adapter },
      log: () => {},
    })

    const turn = await orchestrator.sendMessage({
      companyId,
      conversationId,
      userId,
      content: 'Tôi cần làm marketing cho sản phẩm mới',
    })

    expect(turn.briefComplete).toBe(false)
    expect(turn.clarify).toBeDefined()
    expect(turn.clarify!.questions.length).toBeGreaterThan(0)
    expect(turn.clarify!.questions.length).toBeLessThanOrEqual(3)
    expect(turn.reply).toContain(turn.clarify!.intro)

    // Thẻ chọn phải nằm trong `meta` để `readClarification` (view-mappers) đọc được.
    const messages = repos.work.listMessages(conversationId, companyId, 10)
    const leaderMessage = messages.find((message) => message.authorKind === 'leader')
    expect(leaderMessage).toBeDefined()
    const meta = JSON.parse(leaderMessage!.metaJson ?? '{}') as Record<string, unknown>
    expect(meta['missingFields']).toBeDefined()
    const stored = meta['clarify'] as ClarificationRequest
    expect(Array.isArray(stored.questions)).toBe(true)
    expect(stored.questions.length).toBeGreaterThan(0)
    expect(typeof stored.questions[0]!.field).toBe('string')
  })

  it('dùng được tầng 2 thì chỉ thay câu chữ, giữ nguyên field và mã phương án', async () => {
    const rewrite = JSON.stringify({
      questions: [
        {
          field: 'objective',
          question: 'Mục tiêu kinh doanh của công ty bạn trong quý này là gì?',
          options: [{ id: 'objective-trial', label: 'Tăng đăng ký dùng thử (theo ngữ cảnh công ty)' }],
        },
      ],
    })
    // Lượt 1 = trích brief (trả rỗng), lượt 2 = viết lại câu hỏi.
    const adapter = scripted(['', rewrite])
    const orchestrator = new ConversationOrchestrator({
      repos,
      tools: tools(),
      runtimeOverrides: { adapter },
      log: () => {},
    })

    const turn = await orchestrator.sendMessage({
      companyId,
      conversationId,
      userId,
      content: 'Tôi cần làm marketing cho sản phẩm mới',
    })

    expect(turn.clarify).toBeDefined()
    const objective = turn.clarify!.questions.find((question) => question.field === 'objective')
    expect(objective).toBeDefined()
    expect(objective!.question).toBe('Mục tiêu kinh doanh của công ty bạn trong quý này là gì?')
    expect(objective!.inputMode).toBe('single')
    expect(objective!.allowCustom).toBe(true)
    expect(objective!.options.find((option) => option.id === 'objective-trial')?.label).toBe(
      'Tăng đăng ký dùng thử (theo ngữ cảnh công ty)',
    )
    expect(turn.clarify!.intro).toContain('ngữ cảnh công ty')
  })

  it('câu trả lời thẻ chọn được áp trước lớp trích và đủ brief ngay', async () => {
    const adapter: ChatAdapter = {
      async *chat() {
        yield { type: 'text', text: 'Đã hiểu yêu cầu.' }
        yield { type: 'done', finishReason: 'stop', usage: { promptTokens: 5, completionTokens: 5, cachedTokens: 0 } }
      },
    }
    const orchestrator = new ConversationOrchestrator({
      repos,
      tools: tools(),
      runtimeOverrides: { adapter },
      log: () => {},
    })

    const turn = await orchestrator.sendMessage({
      companyId,
      conversationId,
      userId,
      content: 'Đây là câu trả lời của tôi',
      answers: [
        { field: 'objective', optionIds: ['objective-trial'] },
        { field: 'kpi', optionIds: ['kpi-signups'] },
        { field: 'scope', optionIds: ['scope-facebook', 'scope-no-tiktok'] },
        { field: 'deadline', optionIds: ['deadline-60'] },
        { field: 'budget', optionIds: ['budget-20-50m'] },
        { field: 'constraints', optionIds: ['constraints-brand-guidelines'] },
      ],
    })

    expect(turn.briefComplete).toBe(true)
    expect(turn.missingFields).toEqual([])
    const conversation = repos.work.requireConversation(conversationId, companyId)
    const brief = JSON.parse(conversation.briefJson ?? '{}') as Record<string, string>
    expect(brief['scope']).toContain('NGOÀI phạm vi')
    expect(brief['scope']).toContain('TikTok')
    expect(brief['objective']).toContain('Tăng số đăng ký dùng thử')

    // Mã phương án người dùng đã chọn phải được lưu ở tin nhắn người dùng.
    const lastUser = repos.work
      .listMessages(conversationId, companyId, 10)
      .filter((message) => message.authorKind === 'user')
      .pop()
    const meta = JSON.parse(lastUser?.metaJson ?? '{}') as { answers?: unknown[] }
    expect(meta.answers).toHaveLength(6)
  })
})
