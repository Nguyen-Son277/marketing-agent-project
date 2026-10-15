/**
 * Test tầng điều phối với model được kịch bản hoá (không gọi mạng).
 *
 * Trọng tâm là những bất biến mà nếu sai sẽ làm hệ thống vô dụng hoặc nguy hiểm:
 *  - BriefGate không cho lập kế hoạch khi brief còn thiếu;
 *  - kế hoạch có chu trình bị từ chối trước khi giao việc;
 *  - việc phụ thuộc chỉ chạy sau khi việc trước xong;
 *  - một việc hỏng không kéo sập các việc độc lập;
 *  - ReviewGate phát hiện việc "xong" mà không có đầu ra;
 *  - trần chi phí chặn trước khi tốn token.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRepos, type Repos } from '@marketing-agent/db'
import { seedCatalog, seedCompany } from '@marketing-agent/seed'
import { ToolRegistry } from '@marketing-agent/tools'
import type { LlmChunk } from '@marketing-agent/shared'
import type { ChatAdapter } from '@marketing-agent/agent-runtime'
import { buildToolRegistry } from '@marketing-agent/tools'
import {
  checkBrief,
  composeReport,
  dispatchPlan,
  mechanicalChecks,
  parsePlanTable,
  parseDependencies,
  normalizeDependencies,
  resolveRole,
  normalizeRole,
  planLevels,
  hasSourceEvidence,
  reviewOutcomes,
  validatePlan,
  ConversationOrchestrator,
} from '../src/index.ts'
import type { DispatchSummary, PlanResult, TaskOutcome } from '../src/types.ts'

let repos: Repos
let companyId: string
let tempRoot: string

beforeEach(() => {
  repos = createRepos({ file: ':memory:', allowWeakSecret: true })
  seedCatalog(repos)
  companyId = seedCompany(repos, { companyName: 'Orchestrator Co' }).company.id
  // Hệ thống không tự gắn model cho agent nữa, nên test phải chọn tường minh như
  // người dùng: tạo một provider + model rồi gán cho mọi preset của công ty.
  const provider = repos.llm.createProvider({
    companyId,
    name: 'Provider test',
    kind: 'openai_compatible',
    baseUrl: 'http://localhost:1/v1',
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
  tempRoot = '/tmp/ma-orchestrator-test'
})

/* ------------------------------------------------------------------ adapter */

/** Adapter kịch bản: trả lần lượt các lượt đã định, lặp lại lượt cuối. */
function scripted(chunksPerTurn: readonly (readonly LlmChunk[])[]): ChatAdapter {
  let index = 0
  return {
    async *chat(): AsyncGenerator<LlmChunk> {
      const turn = chunksPerTurn[Math.min(index, chunksPerTurn.length - 1)] ?? []
      index += 1
      for (const chunk of turn) yield chunk
    },
  }
}

function textTurn(text: string): LlmChunk[] {
  return [
    { type: 'text', text },
    { type: 'done', finishReason: 'stop', usage: { promptTokens: 100, completionTokens: 50, cachedTokens: 0 } },
  ]
}

function buildTools(): ToolRegistry {
  return buildToolRegistry({ repos, coreOptions: { companiesRoot: tempRoot } }).registry
}

/* --------------------------------------------------------------- BriefGate */

describe('BriefGate', () => {
  it('coi brief rỗng là thiếu cả sáu trường', () => {
    const check = checkBrief(undefined)
    expect(check.complete).toBe(false)
    expect(check.missing).toEqual(['objective', 'kpi', 'scope', 'deadline', 'budget', 'constraints'])
  })

  it('chấp nhận brief đủ sáu trường', () => {
    const check = checkBrief({
      objective: 'Tăng đăng ký dùng thử',
      kpi: '50 lead mỗi tháng',
      scope: 'Chỉ kênh Facebook',
      deadline: '2026-11-30',
      budget: '20 triệu VNĐ',
      constraints: 'Không dùng ảnh khách hàng',
    })
    expect(check.complete).toBe(true)
    expect(check.missing).toEqual([])
  })

  it('coi trường có giá trị quá ngắn là chưa điền, các trường khác vẫn hợp lệ', () => {
    const check = checkBrief({
      objective: 'Tăng đăng ký dùng thử',
      kpi: 'ok',
      scope: 'Chỉ kênh Facebook',
      deadline: '2026-11-30',
      budget: '20 triệu',
      constraints: 'Không dùng ảnh khách hàng',
    })
    expect(check.complete).toBe(false)
    // `objective` dài 21 ký tự nên hợp lệ; chỉ `kpi` ("ok") bị coi là chưa điền.
    expect(check.missing).toEqual(['kpi'])
  })

  it('hỏi lại thay vì lập kế hoạch khi brief còn thiếu', async () => {
    const user = repos.auth.createUser({ email: 'gate@example.com', password: 'matkhau-rat-dai-123', name: 'Gate' })
    const conversation = repos.work.createConversation({ companyId, userId: user.id, title: 'Thử' })
    const orchestrator = new ConversationOrchestrator({ repos, tools: buildTools(), log: () => {} })

    const turn = await orchestrator.sendMessage({
      companyId,
      conversationId: conversation.id,
      userId: user.id,
      content: 'Làm marketing cho tôi',
    })

    expect(turn.briefComplete).toBe(false)
    expect(turn.phase).toBe('clarify')
    expect(turn.reply).toContain('Mục tiêu')
    expect(turn.missingFields.length).toBeGreaterThan(0)
    // Không được tiêu token nào cho một lượt chỉ để hỏi lại.
    expect(turn.costUsd).toBe(0)
  })
})

/* ----------------------------------------------------------- plan validation */

describe('validatePlan', () => {
  const role = 'content-writer' as const
  const available = ['marketing-leader', 'content-writer', 'seo-technical', 'analytics'] as const

  it('chấp nhận kế hoạch hợp lệ và trả thứ tự thi hành', () => {
    const result = validatePlan({
      availableRoles: [...available],
      plan: {
        tasks: [
          { title: 'B', briefMd: 'Viết bài dựa trên từ khoá', assigneeRole: 'content-writer', dependsOnTitles: ['A'] },
          { title: 'A', briefMd: 'Nghiên cứu từ khoá', assigneeRole: 'seo-technical' },
        ],
      },
    })
    expect(result.order).toEqual(['A', 'B'])
  })

  it('từ chối vai trò không tồn tại', () => {
    expect(() =>
      validatePlan({
        availableRoles: [...available],
        plan: { tasks: [{ title: 'X', briefMd: 'Mô tả đủ dài cho việc này', assigneeRole: 'khong-co' as never }] },
      }),
    ).toThrow(/không có chuyên môn/i)
  })

  it('từ chối kế hoạch có vòng phụ thuộc', () => {
    expect(() =>
      validatePlan({
        availableRoles: [...available],
        plan: {
          tasks: [
            { title: 'A', briefMd: 'Mô tả đủ dài cho việc A', assigneeRole: role, dependsOnTitles: ['B'] },
            { title: 'B', briefMd: 'Mô tả đủ dài cho việc B', assigneeRole: role, dependsOnTitles: ['A'] },
          ],
        },
      }),
    ).toThrow(/vòng phụ thuộc/i)
  })

  it('từ chối phụ thuộc vào việc không tồn tại', () => {
    expect(() =>
      validatePlan({
        availableRoles: [...available],
        plan: {
          tasks: [
            { title: 'A', briefMd: 'Mô tả đủ dài cho việc A', assigneeRole: role, dependsOnTitles: ['Không có'] },
          ],
        },
      }),
    ).toThrow(/không có việc nào tên đó/i)
  })

  it('từ chối tiêu đề trùng', () => {
    expect(() =>
      validatePlan({
        availableRoles: [...available],
        plan: {
          tasks: [
            { title: 'A', briefMd: 'Mô tả đủ dài cho việc A', assigneeRole: role },
            { title: 'A', briefMd: 'Mô tả đủ dài cho việc A lần hai', assigneeRole: role },
          ],
        },
      }),
    ).toThrow(/trùng/i)
  })

  it('cắt bớt thay vì từ chối khi kế hoạch vượt trần số việc', () => {
    // Vượt trần không phải lỗi chặn: kế hoạch do model viết là văn bản hợp lệ, và
    // từ chối toàn bộ chỉ vì chia 12 việc thay vì 10 sẽ khiến người dùng nhận thông
    // báo lỗi mà không có gì để duyệt. Đã gặp thật với model 9 việc / trần 8.
    const tasks = Array.from({ length: 12 }, (_, index) => ({
      title: `Việc ${index + 1}`,
      briefMd: 'Mô tả đủ dài cho việc này',
      assigneeRole: role,
    }))
    const result = validatePlan({ availableRoles: [...available], plan: { tasks } })
    expect(result.tasks).toHaveLength(10)
    expect(result.dropped).toBe(2)
    expect(result.order).toHaveLength(10)
  })

  it('khi cắt bớt vẫn không để lại phụ thuộc trỏ tới việc đã bị bỏ', () => {
    // Chuỗi phụ thuộc A → B → C → D; trần 3 nên một việc phải bị bỏ, và việc giữ
    // lại cuối cùng không được trỏ tới việc đã bỏ.
    const tasks = [
      { title: 'A', briefMd: 'Mô tả đủ dài cho việc A', assigneeRole: role },
      { title: 'B', briefMd: 'Mô tả đủ dài cho việc B', assigneeRole: role, dependsOnTitles: ['A'] },
      { title: 'C', briefMd: 'Mô tả đủ dài cho việc C', assigneeRole: role, dependsOnTitles: ['B'] },
      { title: 'D', briefMd: 'Mô tả đủ dài cho việc D', assigneeRole: role, dependsOnTitles: ['C'] },
    ]
    const result = validatePlan({ availableRoles: [...available], plan: { tasks }, maxTasks: 3 })
    const giu = new Set(result.tasks.map((task) => task.title))
    for (const task of result.tasks) {
      for (const dependency of task.dependsOn) {
        expect(giu.has(dependency), `${task.title} trỏ tới ${dependency} đã bị bỏ`).toBe(true)
      }
    }
  })
})

describe('planLevels', () => {
  it('nhóm việc độc lập vào cùng một mức', () => {
    const levels = planLevels([
      { id: 'A', title: 'A', assigneeRole: 'content-writer', dependsOn: [] },
      { id: 'B', title: 'B', assigneeRole: 'content-writer', dependsOn: [] },
      { id: 'C', title: 'C', assigneeRole: 'content-writer', dependsOn: ['A'] },
    ])
    expect(levels[0]?.map((t) => t.title).sort()).toEqual(['A', 'B'])
    expect(levels[1]?.map((t) => t.title)).toEqual(['C'])
  })
})

/* ------------------------------------------------------------ plan parsing */

describe('parsePlanTable', () => {
  it('đọc bảng Markdown có tiêu đề tiếng Việt', () => {
    const markdown = [
      'Dưới đây là kế hoạch:',
      '',
      '| Công việc | Chuyên môn | Phụ thuộc | Đầu ra |',
      '|---|---|---|---|',
      '| Nghiên cứu từ khoá | SEO kỹ thuật | — | Danh sách cluster |',
      '| Viết 5 bài SEO | content-writer | Nghiên cứu từ khoá | 5 bài đăng |',
      '',
      'Kế hoạch này đạt mục tiêu vì...',
    ].join('\n')

    const rows = parsePlanTable(markdown)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.title).toBe('Nghiên cứu từ khoá')
    // Tên chuyên môn giữ nguyên văn tại đây; việc resolve sang role thật do
    // `resolveRole` làm ở bước lập kế hoạch (xem bài test bên dưới).
    // `parsePlanTable` giữ nguyên văn tên chuyên môn; `resolveRole` mới là nơi
    // chuyển nó thành role thật (xem bài test riêng bên dưới).
    expect(rows[0]?.assigneeRaw).toBe('SEO kỹ thuật')
    expect(rows[0]?.dependsOn).toEqual([])
    expect(rows[1]?.assigneeRaw).toBe('content-writer')
    expect(rows[1]?.dependsOn).toEqual(['Nghiên cứu từ khoá'])
  })

  it('đọc được bảng có cột số thứ tự ở đầu', () => {
    // Ca này đã làm hỏng luồng thật: model thêm cột "#", parser coi dòng tiêu đề là
    // một công việc tên "#" với chuyên môn "Công việc", rồi cả kế hoạch bị từ chối.
    const md = [
      '| # | Công việc | Chuyên môn | Phụ thuộc | Đầu ra |',
      '|---|---|---|---|---|',
      '| 1 | Nghiên cứu từ khoá | SEO kỹ thuật | không | Danh sách cluster |',
      '| 2 | Viết bài | content-writer | Nghiên cứu từ khoá | 5 bài |',
    ].join('\n')
    const rows = parsePlanTable(md)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.title).toBe('Nghiên cứu từ khoá')
    expect(rows[0]?.assigneeRaw).toBe('SEO kỹ thuật')
    expect(rows[1]?.dependsOn).toEqual(['Nghiên cứu từ khoá'])
  })

  it('đọc được bảng khi cột chuyên môn đứng trước cột công việc', () => {
    const md = [
      '| Chuyên môn | Công việc | Đầu ra | Phụ thuộc |',
      '|---|---|---|---|',
      '| analytics | Đo KPI | Bảng chỉ số | không |',
    ].join('\n')
    const rows = parsePlanTable(md)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('Đo KPI')
    expect(rows[0]?.assigneeRaw).toBe('analytics')
  })

  it('không lấy dòng dữ liệu có tiêu đề chứa từ khoá làm dòng tiêu đề', () => {
    // Tiêu đề "Nghiên cứu từ khoá" chứa "nghiên cứu"; nếu luật nhận dòng tiêu đề
    // chỉ cần "một ô chứa từ khoá" thì dòng dữ liệu này bị mất.
    const md = [
      '| Công việc | Chuyên môn | Phụ thuộc | Đầu ra |',
      '|---|---|---|---|',
      '| Nghiên cứu từ khoá | SEO kỹ thuật | — | Danh sách cluster |',
    ].join('\n')
    const rows = parsePlanTable(md)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('Nghiên cứu từ khoá')
  })

  it('giải mã phụ thuộc ghi bằng số thứ tự thành tiêu đề công việc', () => {
    // Đã gặp thật: Leader viết "phụ thuộc: 1" nghĩa là "sau việc số 1". Giữ nguyên
    // số thì bước xác thực báo "không có việc nào tên 1" và cả kế hoạch bị từ chối.
    const md = [
      '| # | Công việc | Chuyên môn | Phụ thuộc | Đầu ra |',
      '|---|---|---|---|---|',
      '| 1 | Nghiên cứu từ khoá | SEO kỹ thuật | không | Cluster |',
      '| 2 | Viết bài | content-writer | 1 | 5 bài |',
      '| 3 | Đo lường | analytics | 2 | Bảng số |',
    ].join('\n')
    const rows = parsePlanTable(md)
    expect(rows).toHaveLength(3)
    expect(rows[1]?.dependsOn).toEqual(['Nghiên cứu từ khoá'])
    expect(rows[2]?.dependsOn).toEqual(['Viết bài'])
  })

  it('giữ nguyên số phụ thuộc không khớp dòng nào ở tầng parse', () => {
    const md = [
      '| Công việc | Chuyên môn | Phụ thuộc | Đầu ra |',
      '|---|---|---|---|',
      '| Viết bài | content-writer | 99 | 5 bài |',
    ].join('\n')
    const rows = parsePlanTable(md)
    // Tầng parse giữ nguyên văn; việc phán quyết thuộc `normalizeDependencies`.
    expect(rows[0]?.dependsOn).toEqual(['99'])
  })

  it('tách được ô phụ thuộc gộp nhiều việc bằng "&" và "+"', () => {
    // Đã gặp thật: Leader ghi "Thiết kế bộ sáng tạo & landing + Thiết lập đo lường"
    // trong một ô, và bước xác thực từ chối cả kế hoạch vì không có việc nào tên đó.
    const md = [
      '| Công việc | Chuyên môn | Phụ thuộc | Đầu ra |',
      '|---|---|---|---|',
      '| Nghiên cứu từ khoá | seo-technical | không | Cluster |',
      '| Thiết kế bộ sáng tạo & landing | design-video | Nghiên cứu từ khoá | Bộ ảnh |',
      '| Thiết lập đo lường | analytics | Nghiên cứu từ khoá | Sơ đồ tracking |',
      '| Chạy chiến dịch | paid-media | Thiết kế bộ sáng tạo & landing + Thiết lập đo lường | Báo cáo |',
    ].join('\n')
    const rows = normalizeDependencies(parsePlanTable(md))
    expect(rows).toHaveLength(4)
    expect([...rows[3]!.dependsOn].sort()).toEqual(['Thiết kế bộ sáng tạo & landing', 'Thiết lập đo lường'])
  })

  it('bỏ phụ thuộc không khớp việc nào, và báo lại qua callback', () => {
    // Phụ thuộc sai khiến một việc chạy hơi sớm; từ chối cả kế hoạch khiến người
    // dùng không có gì để duyệt. Chọn cách ít thiệt hại hơn, nhưng phải báo lại.
    const md = [
      '| Công việc | Chuyên môn | Phụ thuộc | Đầu ra |',
      '|---|---|---|---|',
      '| Việc A | content-writer | Việc không tồn tại | Bài viết |',
    ].join('\n')
    const bo: string[] = []
    const rows = normalizeDependencies(parsePlanTable(md), (task, dependency) => {
      bo.push(`${task}→${dependency}`)
    })
    expect(rows[0]?.dependsOn).toEqual([])
    expect(bo).toEqual(['Việc A→Việc không tồn tại'])
  })

  it('trả mảng rỗng khi không có bảng, để caller báo lỗi rõ', () => {
    expect(parsePlanTable('Xin chào, tôi sẽ lập kế hoạch sau.')).toEqual([])
  })

  it('bỏ qua dòng tiêu đề và dòng phân cách', () => {
    const rows = parsePlanTable(['| Công việc | Chuyên môn |', '|---|---|'].join('\n'))
    expect(rows).toEqual([])
  })
})

describe('resolveRole', () => {
  const co = ['marketing-leader', 'market-research', 'content-writer', 'seo-technical', 'analytics', 'paid-media']

  it('khớp tên viết đúng', () => {
    expect(resolveRole('content-writer', co)).toBe('content-writer')
    expect(resolveRole('analytics', co)).toBe('analytics')
  })

  it('khớp tên tiếng Việt có dấu', () => {
    expect(resolveRole('SEO kỹ thuật', co)).toBe('seo-technical')
    expect(resolveRole('Nghiên cứu thị trường', co)).toBe('market-research')
    expect(resolveRole('Quảng cáo trả phí', co)).toBe('paid-media')
  })

  it('bỏ số thứ tự ở đầu ô', () => {
    expect(resolveRole('1. Content Writer', co)).toBe('content-writer')
    expect(resolveRole('2) SEO kỹ thuật', co)).toBe('seo-technical')
  })

  it('khớp mờ khi Leader viết khác đi', () => {
    expect(resolveRole('Content Writer', co)).toBe('content-writer')
    expect(resolveRole('SEO Technical', co)).toBe('seo-technical')
    expect(resolveRole('Phân tích', co)).toBe('analytics')
  })

  it('trả về undefined khi không đủ gần, để caller báo lỗi rõ', () => {
    // Ô tiêu đề bảng từng bị nhận nhầm thành chuyên môn; đây là ca bảo vệ.
    expect(resolveRole('Công việc', co)).toBeUndefined()
    expect(resolveRole('Đầu ra', co)).toBeUndefined()
    expect(resolveRole('', co)).toBeUndefined()
  })
})

describe('role and dependency parsing', () => {
  it('chuẩn hoá tên vai trò tiếng Việt', () => {
    expect(normalizeRole('SEO kỹ thuật')).toBe('seo-technical')
    expect(normalizeRole('content-writer')).toBe('content-writer')
    expect(normalizeRole('Phân tích & Báo cáo')).toBe('analytics')
    expect(normalizeRole('Quảng cáo trả phí')).toBe('paid-media')
  })

  it('đọc phụ thuộc nhiều dạng', () => {
    expect(parseDependencies('—')).toEqual([])
    expect(parseDependencies('không')).toEqual([])
    expect(parseDependencies('A, B')).toEqual(['A', 'B'])
    expect(parseDependencies('A và B')).toEqual(['A', 'B'])
    expect(parseDependencies('**A**; B')).toEqual(['A', 'B'])
  })
})

/* --------------------------------------------------------------- dispatcher */

function makePlan(): PlanResult {
  return {
    tasks: [
      { id: 'Nghiên cứu', title: 'Nghiên cứu', assigneeRole: 'market-research', dependsOn: [] },
      { id: 'Viết', title: 'Viết', assigneeRole: 'content-writer', dependsOn: ['Nghiên cứu'] },
      { id: 'Đo', title: 'Đo', assigneeRole: 'analytics', dependsOn: [] },
    ],
    order: ['Nghiên cứu', 'Đo', 'Viết'],
  }
}

function seedTasks(plan: PlanResult): void {
  for (const task of plan.tasks) {
    const def = repos.team.findAgentDefByRole(task.assigneeRole)
    repos.work.createTask({
      companyId,
      conversationId: null,
      title: task.title,
      briefMd: `Làm việc ${task.title}`,
      assigneeAgentDefId: def?.id ?? null,
      status: 'assigned',
    })
  }
}

describe('dispatchPlan', () => {
  it('chạy việc phụ thuộc sau khi việc trước xong và truyền kết quả sang', async () => {
    const plan = makePlan()
    seedTasks(plan)
    const adapter = scripted([
      textTurn('NGHIÊN CỨU: từ khoá chính là "quản lý tồn kho".'),
      textTurn('ĐO: chỉ số chưa có dữ liệu.'),
      textTurn('VIẾT: đã viết 5 bài dựa trên nghiên cứu.'),
    ])

    const summary = await dispatchPlan({
      repos,
      tools: buildTools(),
      companyId,
      conversationId: null,
      plan,
      limits: { dailyCostUsd: 100, taskCostUsd: 10, maxStepsPerRun: 4, maxPeerRounds: 3, maxRevisionsPerTask: 2, maxParallelTasks: 2 },
      runtimeOverrides: { adapter },
      log: () => {},
    })

    expect(summary.completed).toBe(3)
    expect(summary.failed).toBe(0)
    // Việc "Viết" phải chạy sau "Nghiên cứu".
    const order = summary.outcomes.map((o) => o.title)
    expect(order.indexOf('Viết')).toBeGreaterThan(order.indexOf('Nghiên cứu'))
  })

  it('đánh dấu blocked cho việc phụ thuộc khi việc trước thất bại', async () => {
    const plan: PlanResult = {
      tasks: [
        { id: 'A', title: 'A', assigneeRole: 'market-research', dependsOn: [] },
        { id: 'B', title: 'B', assigneeRole: 'content-writer', dependsOn: ['A'] },
      ],
      order: ['A', 'B'],
    }
    seedTasks(plan)
    // Lượt chạy của A thất bại vì model trả về lỗi nhà cung cấp liên tục.
    const adapter: ChatAdapter = {
      async *chat() {
        throw new Error('gateway sập')
        // eslint-disable-next-line no-unreachable
        yield { type: 'done' as const, finishReason: null, usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0 } }
      },
    }

    const summary = await dispatchPlan({
      repos,
      tools: buildTools(),
      companyId,
      conversationId: null,
      plan,
      limits: { dailyCostUsd: 100, taskCostUsd: 10, maxStepsPerRun: 2, maxPeerRounds: 3, maxRevisionsPerTask: 2, maxParallelTasks: 1 },
      runtimeOverrides: { adapter },
      log: () => {},
    })

    const failed = summary.outcomes.find((o) => o.title === 'A')
    const blocked = summary.outcomes.find((o) => o.title === 'B')
    expect(failed?.status).not.toBe('done')
    expect(blocked?.status).toBe('blocked')
    expect(blocked?.reason).toMatch(/phụ thuộc/i)
  })

  it('không phát sự kiện của task thiếu scope sang stream cuộc trao đổi', async () => {
    const plan = makePlan()
    seedTasks(plan)
    const events: string[] = []
    const adapter = scripted([textTurn('Xong việc, kết quả đủ dài để dùng được cho bước sau.')])

    await dispatchPlan({
      repos,
      tools: buildTools(),
      companyId,
      conversationId: null,
      plan,
      limits: { dailyCostUsd: 100, taskCostUsd: 10, maxStepsPerRun: 3, maxPeerRounds: 3, maxRevisionsPerTask: 2, maxParallelTasks: 2 },
      runtimeOverrides: { adapter },
      publish: (appEvent) => events.push(appEvent.type),
      log: () => {},
    })

    expect(events).not.toContain('agent.started')
    expect(events).not.toContain('task.updated')
  })
})

/* -------------------------------------------------------------- ReviewGate */

function outcome(overrides: Partial<TaskOutcome> = {}): TaskOutcome {
  return {
    taskId: 't1',
    title: 'Việc',
    assigneeRole: 'content-writer',
    status: 'done',
    resultMd: 'Kết quả đủ dài để coi là có nội dung thật và có nguồn: https://example.com/du-lieu',
    artifactIds: ['a1'],
    run: null,
    ...overrides,
  }
}

function summaryOf(outcomes: readonly TaskOutcome[]): DispatchSummary {
  return {
    outcomes,
    completed: outcomes.filter((o) => o.status === 'done').length,
    blocked: outcomes.filter((o) => o.status === 'blocked').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
  }
}

describe('ReviewGate mechanical checks', () => {
  it('phát hiện việc xong nhưng không có tài sản và kết quả quá ngắn', () => {
    const issues = mechanicalChecks(summaryOf([outcome({ artifactIds: [], resultMd: 'Xong.' })]))
    expect(issues.some((issue) => issue.kind === 'missing_artifact')).toBe(true)
  })

  it('phát hiện việc thất bại là blocker', () => {
    const issues = mechanicalChecks(summaryOf([outcome({ status: 'failed', run: null })]))
    expect(issues.some((issue) => issue.kind === 'failed_task' && issue.severity === 'blocker')).toBe(true)
  })

  it('phát hiện thiếu nguồn trong kết quả dài', () => {
    const text = 'Chúng tôi tăng trưởng mạnh trong kỳ này. '.repeat(10)
    expect(hasSourceEvidence(text)).toBe(false)
    expect(hasSourceEvidence('Theo GA4, sessions tăng 12%.')).toBe(true)
    expect(hasSourceEvidence('Chi tiết ở 40-du-lieu/kpi.md')).toBe(true)
  })

  it('trả lại khi có lỗi chặn, không cần gọi model', async () => {
    const decision = await reviewOutcomes({
      repos,
      tools: buildTools(),
      companyId,
      conversationId: null,
      brief: 'brief',
      summary: summaryOf([outcome({ status: 'failed', run: null })]),
      limits: { dailyCostUsd: 1, taskCostUsd: 1, maxStepsPerRun: 1, maxPeerRounds: 1, maxRevisionsPerTask: 1, maxParallelTasks: 1 },
    })
    expect(decision.verdict).toBe('revise')
  })

  it('duyệt khi mọi việc đạt yêu cầu', async () => {
    const decision = await reviewOutcomes({
      repos,
      tools: buildTools(),
      companyId,
      conversationId: null,
      brief: 'brief',
      summary: summaryOf([outcome()]),
      limits: { dailyCostUsd: 1, taskCostUsd: 1, maxStepsPerRun: 1, maxPeerRounds: 1, maxRevisionsPerTask: 1, maxParallelTasks: 1 },
    })
    expect(decision.verdict).toBe('pass')
  })
})

/* ---------------------------------------------------------------- reporter */

describe('composeReport', () => {
  it('luôn có đủ bảy mục và ghi rõ việc chưa xong', () => {
    const markdown = composeReport({
      repos,
      companyId,
      conversationId: null,
      title: 'Báo cáo thử',
      brief: 'Mục tiêu: tăng lead',
      summary: summaryOf([
        outcome({ title: 'Việc xong' }),
        outcome({ title: 'Việc chặn', status: 'blocked', run: null, reason: 'Thiếu kết nối GA4' }),
      ]),
      review: { verdict: 'pass', noteMd: 'ok', issues: [] },
      costUsd: 0.1234,
    })

    for (const heading of [
      '## 1. Tóm tắt điều hành',
      '## 2. Kết quả theo mục tiêu',
      '## 3. Bằng chứng & nguồn',
      '## 4. Chi phí & thời gian',
      '## 5. Rủi ro & giả định',
      '## 6. Đề xuất bước tiếp theo',
      '## 7. Phụ lục',
    ]) {
      expect(markdown, `thiếu mục ${heading}`).toContain(heading)
    }
    expect(markdown).toContain('Việc chặn')
    expect(markdown).toContain('Thiếu kết nối GA4')
    expect(markdown).toContain('0.1234')
  })
})

/* ------------------------------------------------------------ budget guard */

describe('budget guard', () => {
  it('chặn lượt mới khi công ty đã vượt trần chi phí trong ngày', async () => {
    const user = repos.auth.createUser({ email: 'budget@example.com', password: 'matkhau-rat-dai-123', name: 'B' })
    const conversation = repos.work.createConversation({ companyId, userId: user.id, title: 'Thử' })
    // Ghi một lượt chạy đắt để vượt trần.
    const runId = repos.accounting.startRun({ companyId, agentDefId: 'x', modelId: 'm' })
    repos.accounting.finishRun(runId, {
      status: 'succeeded',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 50,
      latencyMs: 1,
      steps: 1,
    })

    const orchestrator = new ConversationOrchestrator({
      repos,
      tools: buildTools(),
      limits: { dailyCostUsd: 1 },
      log: () => {},
    })

    await expect(
      orchestrator.sendMessage({ companyId, conversationId: conversation.id, userId: user.id, content: 'Chào' }),
    ).rejects.toThrow(/trần chi phí/i)
  })
})

/* --------------------------------------------------------- peer ask limits */

describe('peer ask limit', () => {
  it('từ chối sau khi vượt số vòng cho phép', async () => {
    const user = repos.auth.createUser({ email: 'peer@example.com', password: 'matkhau-rat-dai-123', name: 'P' })
    const conversation = repos.work.createConversation({ companyId, userId: user.id, title: 'Thử' })
    const task = repos.work.createTask({ companyId, title: 'Việc', briefMd: 'brief' })
    const orchestrator = new ConversationOrchestrator({
      repos,
      tools: buildTools(),
      limits: { maxPeerRounds: 1 },
      runtimeOverrides: { adapter: scripted([textTurn('Câu trả lời của chuyên môn.')]) },
      log: () => {},
    })

    const first = await orchestrator.askPeer({
      companyId,
      conversationId: conversation.id,
      taskId: task.id,
      fromRole: 'content-writer',
      toRole: 'market-research',
      question: 'Số liệu thị trường là gì?',
    })
    expect(first.limitReached).toBe(false)
    expect(first.answer).toContain('chuyên môn')

    const second = await orchestrator.askPeer({
      companyId,
      conversationId: conversation.id,
      taskId: task.id,
      fromRole: 'content-writer',
      toRole: 'market-research',
      question: 'Hỏi lại lần hai?',
    })
    expect(second.limitReached).toBe(true)
  })
})

/* -------------------------------------------------------------- escalation */

describe('escalation', () => {
  it('ghi lại blocker, chuyển task sang blocked và trả hướng dẫn dừng', async () => {
    const task = repos.work.createTask({ companyId, title: 'Việc bị chặn', briefMd: 'brief' })
    const orchestrator = new ConversationOrchestrator({ repos, tools: buildTools(), log: () => {} })

    const result = await orchestrator.escalate({
      companyId,
      conversationId: null,
      taskId: task.id,
      fromRole: 'analytics',
      reason: 'Chưa kết nối GA4',
      attempts: 'Đã thử ga4_report, nhận lỗi needs_configuration',
      options: ['Nhờ người dùng kết nối', 'Dùng dữ liệu GSC thay thế'],
    })

    expect(result.acknowledged).toBe(true)
    expect(result.guidance).toMatch(/chờ hướng dẫn/i)
    expect(repos.work.findTask(task.id, companyId)?.status).toBe('blocked')
    const messages = repos.work.listAgentMessages(companyId, { taskId: task.id })
    expect(messages.some((m) => m.kind === 'blocker')).toBe(true)
  })
})

/* -------------------------------------------------------- available roles */

describe('availableRoles', () => {
  it('chỉ trả về agent đang bật cho công ty', () => {
    const orchestrator = new ConversationOrchestrator({ repos, tools: buildTools(), log: () => {} })
    const roles = orchestrator.availableRoles(companyId)
    expect(roles).toContain('marketing-leader')
    expect(roles).toContain('content-writer')
    expect(roles).toHaveLength(10)

    const leader = repos.team.findAgentDefByRole('marketing-leader')!
    repos.team.updatePreset(companyId, leader.id, { enabled: false })
    expect(orchestrator.availableRoles(companyId)).not.toContain('marketing-leader')
  })
})

/* ------------------------------------------------------------ createTasks */

describe('createTasks', () => {
  it('tạo task kèm cạnh phụ thuộc trong một transaction', async () => {
    const orchestrator = new ConversationOrchestrator({ repos, tools: buildTools(), log: () => {} })
    const created = await orchestrator.createTasks(
      { companyId, conversationId: null },
      [
        { title: 'Bước 1', briefMd: 'Mô tả bước một đủ dài', assigneeRole: 'market-research' },
        { title: 'Bước 2', briefMd: 'Mô tả bước hai đủ dài', assigneeRole: 'content-writer', dependsOnTitles: ['Bước 1'] },
      ],
    )
    expect(created).toHaveLength(2)

    const tasks = repos.work.listTasks(companyId)
    const deps = repos.work.listDependencies(companyId, tasks.map((t) => t.id))
    expect(deps).toHaveLength(1)
    const step2 = tasks.find((t) => t.title === 'Bước 2')!
    expect(deps[0]?.taskId).toBe(step2.id)
  })

  it('không tạo gì khi kế hoạch không hợp lệ', async () => {
    const orchestrator = new ConversationOrchestrator({ repos, tools: buildTools(), log: () => {} })
    await expect(
      orchestrator.createTasks(
        { companyId, conversationId: null },
        [{ title: 'X', briefMd: 'Mô tả đủ dài cho việc này', assigneeRole: 'khong-ton-tai' }],
      ),
    ).rejects.toThrow()
    expect(repos.work.listTasks(companyId)).toHaveLength(0)
  })
})
