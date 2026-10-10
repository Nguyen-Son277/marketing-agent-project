/**
 * Test vòng lặp model ⇄ công cụ với model kịch bản và công cụ giả.
 *
 * Trọng tâm: điều kiện dừng, xử lý lỗi công cụ như dữ liệu, chặn công cụ ngoài grant,
 * guard ngân sách/token và chính sách retry–escalate khi nhà cung cấp lỗi.
 */
import { describe, expect, it, vi } from 'vitest'
import { AppError, budgetExceeded, sleep, type ToolResult } from '@marketing-agent/shared'
import { createRepos } from '@marketing-agent/db'
import { createRuntimeDeps, runAgent } from '../src/index.ts'
import type { AdapterResolver, AgentRuntimeDeps } from '../src/types.ts'
import {
  buildResolvedAgent,
  fakeMeter,
  fakeRouter,
  scriptedAdapter,
  testContext,
  testTool,
  textTurn,
  toolTurn,
  usage,
  type FakeMeter,
  type FakeRouter,
  type ScriptedAdapter,
} from './fixtures.ts'

function depsFor(
  adapter: ScriptedAdapter,
  options: { router?: FakeRouter; meter?: FakeMeter } = {},
): { deps: AgentRuntimeDeps; router: FakeRouter; meter: FakeMeter } {
  const router = options.router ?? fakeRouter()
  const meter = options.meter ?? fakeMeter()
  const adapters: AdapterResolver = {
    adapterFor: () => {
      throw new Error('không được gọi adapterFor khi test đã truyền adapter cố định')
    },
  }
  return { deps: { router, adapters, meterFactory: meter.factory, adapter }, router, meter }
}

describe('runAgent — vòng lặp cơ bản', () => {
  it('chạy hai bước: gọi công cụ rồi trả câu trả lời cuối', async () => {
    const search = vi.fn(async (args: Record<string, unknown>, ctx) => ({
      content: `Kết quả cho ${String(args.q)} tại ${ctx.companyId}`,
    }))
    const adapter = scriptedAdapter([
      toolTurn([{ id: 'call_1', name: 'kb_search', argumentsJson: '{"q":"seo"}' }]),
      textTurn('Đã tổng hợp xong báo cáo.'),
    ])
    const { deps, meter } = depsFor(adapter)

    const result = await runAgent(
      {
        agent: buildResolvedAgent(),
        context: testContext(),
        messages: [{ role: 'user', content: 'Tìm tài liệu SEO' }],
        tools: [testTool('kb_search', search)],
      },
      deps,
    )

    expect(result.status).toBe('succeeded')
    expect(result.stopReason).toBe('completed')
    expect(result.steps).toBe(2)
    expect(result.output).toBe('Đã tổng hợp xong báo cáo.')
    expect(result.toolCalls).toEqual([expect.objectContaining({ name: 'kb_search', ok: true })])
    expect(search).toHaveBeenCalledTimes(1)
    expect(search.mock.calls[0]?.[0]).toEqual({ q: 'seo' })
    expect(search.mock.calls[0]?.[1]?.companyId).toBe('c1')

    expect(adapter.requests).toHaveLength(2)
    const second = adapter.requests[1]!
    expect(second.messages[0]?.role).toBe('system')
    expect(second.messages.some((message) => message.role === 'assistant' && (message.toolCalls?.length ?? 0) === 1)).toBe(true)
    expect(second.messages.some((message) => message.role === 'tool' && message.content.includes('Kết quả cho seo'))).toBe(true)

    expect(meter.state.finishCalls[0]?.status).toBe('succeeded')
    expect(meter.state.finishCalls[0]?.steps).toBe(2)
    expect(meter.state.addedUsage).toHaveLength(2)
  })

  it('thực thi song song các công cụ trong cùng một bước', async () => {
    let active = 0
    let maxActive = 0
    const makeHandler = (label: string) =>
      vi.fn(async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await sleep(15)
        active -= 1
        return { content: label }
      })

    const adapter = scriptedAdapter([
      toolTurn([
        { id: 'c1', name: 'kb_search', argumentsJson: '{"q":"a"}' },
        { id: 'c2', name: 'kb_read', argumentsJson: '{"id":"d1"}' },
      ]),
      textTurn('Xong cả hai.'),
    ])
    const { deps } = depsFor(adapter)

    const result = await runAgent(
      {
        agent: buildResolvedAgent(),
        context: testContext(),
        tools: [testTool('kb_search', makeHandler('search')), testTool('kb_read', makeHandler('read'))],
      },
      deps,
    )

    expect(result.status).toBe('succeeded')
    expect(maxActive).toBe(2)
    expect(result.toolCalls).toHaveLength(2)
  })
})

describe('runAgent — lỗi công cụ không làm chết run', () => {
  it('công cụ ném lỗi thì trả kết quả [LỖI] cho model và agent vẫn hoàn thành', async () => {
    const failing = vi.fn(async () => {
      throw new Error('mất kết nối kho kiến thức')
    })
    const adapter = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'kb_search', argumentsJson: '{"q":"seo"}' }]),
      textTurn('Không lấy được dữ liệu; đây là blocker cần Leader xử lý.'),
    ])
    const { deps, meter } = depsFor(adapter)

    const result = await runAgent(
      {
        agent: buildResolvedAgent(),
        context: testContext(),
        tools: [testTool('kb_search', failing)],
      },
      deps,
    )

    expect(result.status).toBe('succeeded')
    expect(result.output).toContain('blocker')
    expect(result.toolCalls[0]).toEqual(expect.objectContaining({ name: 'kb_search', ok: false }))
    expect(result.toolCalls[0]?.error).toContain('mất kết nối')

    const second = adapter.requests[1]!
    const toolMessage = second.messages.find((message) => message.role === 'tool')
    expect(toolMessage?.content.startsWith('[LỖI]')).toBe(true)
    expect(meter.state.finishCalls[0]?.status).toBe('succeeded')
  })

  it('công cụ trả isError cũng được ghi nhận là thất bại', async () => {
    const notFoundTool = vi.fn(async () => ({ content: 'Không tìm thấy tài liệu', isError: true }))
    const adapter = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'kb_read', argumentsJson: '{"id":"d1"}' }]),
      textTurn('Báo chưa có dữ liệu.'),
    ])
    const { deps } = depsFor(adapter)

    const result = await runAgent(
      { agent: buildResolvedAgent(), context: testContext(), tools: [testTool('kb_read', notFoundTool)] },
      deps,
    )

    expect(result.status).toBe('succeeded')
    expect(result.toolCalls[0]?.ok).toBe(false)
  })

  it('công cụ treo quá thời gian bị cắt và run vẫn tiếp tục', async () => {
    const hanging = vi.fn(() => new Promise<ToolResult>(() => undefined))
    const adapter = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'kb_search', argumentsJson: '{}' }]),
      textTurn('Bỏ qua công cụ treo và báo blocker.'),
    ])
    const { deps } = depsFor(adapter)

    const result = await runAgent(
      {
        agent: buildResolvedAgent(),
        context: testContext(),
        tools: [testTool('kb_search', hanging)],
        toolTimeoutMs: 20,
      },
      deps,
    )

    expect(result.status).toBe('succeeded')
    expect(result.toolCalls[0]?.ok).toBe(false)
    expect(result.toolCalls[0]?.error).toContain('quá thời gian')
  })
})

describe('runAgent — guard', () => {
  it('dừng đúng ở maxSteps khi model liên tục gọi công cụ', async () => {
    const handler = vi.fn(async () => ({ content: 'ok' }))
    const adapter = scriptedAdapter([toolTurn([{ id: 'c1', name: 'kb_search', argumentsJson: '{}' }])])
    const { deps, meter } = depsFor(adapter)

    const result = await runAgent(
      {
        agent: buildResolvedAgent(),
        context: testContext(),
        tools: [testTool('kb_search', handler)],
        maxSteps: 3,
      },
      deps,
    )

    expect(result.status).toBe('failed')
    expect(result.stopReason).toBe('max_steps')
    expect(result.steps).toBe(3)
    expect(adapter.requests).toHaveLength(3)
    expect(result.error).toContain('3 bước')
    expect(meter.state.finishCalls[0]?.status).toBe('failed')
  })

  it('vượt ngân sách thì dừng với budget_exceeded và không gọi model', async () => {
    const meter = fakeMeter({ budgetError: budgetExceeded('vượt hạn mức thử nghiệm') })
    const adapter = scriptedAdapter([textTurn('không bao giờ chạy')])
    const { deps } = depsFor(adapter, { meter })

    const result = await runAgent(
      {
        agent: buildResolvedAgent(),
        context: testContext(),
        tools: [],
        budget: { dailyCostUsd: 0.0001 },
      },
      deps,
    )

    expect(result.status).toBe('budget_exceeded')
    expect(result.stopReason).toBe('budget')
    expect(result.steps).toBe(0)
    expect(adapter.requests).toHaveLength(0)
    expect(result.error).toContain('vượt hạn mức')
  })

  it('vượt giới hạn token đầu ra thì dừng với output_limit', async () => {
    const handler = vi.fn(async () => ({ content: 'ok' }))
    const adapter = scriptedAdapter([toolTurn([{ id: 'c1', name: 'kb_search', argumentsJson: '{}' }], usage(100, 50))])
    const { deps } = depsFor(adapter)

    const result = await runAgent(
      {
        agent: buildResolvedAgent(),
        context: testContext(),
        tools: [testTool('kb_search', handler)],
        maxOutputTokens: 40,
      },
      deps,
    )

    expect(result.status).toBe('budget_exceeded')
    expect(result.stopReason).toBe('output_limit')
    expect(result.steps).toBe(1)
  })

  it('tôn trọng signal đã bị huỷ', async () => {
    const adapter = scriptedAdapter([textTurn('không chạy')])
    const { deps } = depsFor(adapter)
    const controller = new AbortController()
    controller.abort()

    const result = await runAgent(
      { agent: buildResolvedAgent(), context: testContext(), tools: [], signal: controller.signal },
      deps,
    )

    expect(result.status).toBe('cancelled')
    expect(result.stopReason).toBe('cancelled')
    expect(adapter.requests).toHaveLength(0)
  })
})

describe('runAgent — công cụ ngoài grant', () => {
  it('chặn công cụ không được cấp, không chạm handler, và vẫn hoàn thành run', async () => {
    const granted = vi.fn(async () => ({ content: 'được gọi' }))
    const secret = vi.fn(async () => ({ content: 'bí mật' }))
    const adapter = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'secret.tool', argumentsJson: '{}' }]),
      textTurn('Tôi sẽ báo blocker cho Leader.'),
    ])
    const { deps } = depsFor(adapter)

    const result = await runAgent(
      {
        agent: buildResolvedAgent(),
        context: testContext(),
        tools: [testTool('kb_search', granted)],
      },
      deps,
    )

    expect(result.status).toBe('succeeded')
    expect(secret).not.toHaveBeenCalled()
    expect(granted).not.toHaveBeenCalled()
    expect(result.toolCalls[0]).toEqual(expect.objectContaining({ name: 'secret.tool', ok: false, error: 'not_granted' }))
    const toolMessage = adapter.requests[1]?.messages.find((message) => message.role === 'tool')
    expect(toolMessage?.content).toContain('không nằm trong phạm vi')
  })
})

describe('runAgent — lỗi nhà cung cấp', () => {
  it('thử lại lỗi tạm thời rồi thành công, không cần nâng tier', async () => {
    const transient = new AppError('provider_error', 'gateway bận', { details: { status: 503 } })
    const adapter = scriptedAdapter([{ error: transient }, textTurn('Đã phục hồi.')])
    const { deps, router } = depsFor(adapter)

    const result = await runAgent({ agent: buildResolvedAgent(), context: testContext(), tools: [] }, deps)

    expect(result.status).toBe('succeeded')
    expect(result.output).toBe('Đã phục hồi.')
    expect(adapter.requests).toHaveLength(2)
    expect(router.escalations()).toBe(0)
  })

  it('lỗi không thử lại được thì nâng tier và chạy tiếp bằng model mạnh hơn', async () => {
    const fatal = new AppError('provider_error', 'model không tồn tại', { details: { status: 404 } })
    const adapter = scriptedAdapter([{ error: fatal }, textTurn('Chạy bằng model mạnh hơn.')])
    const { deps, router, meter } = depsFor(adapter)

    const result = await runAgent({ agent: buildResolvedAgent(), context: testContext(), tools: [] }, deps)

    expect(result.status).toBe('succeeded')
    expect(router.escalations()).toBe(1)
    expect(result.modelId).toBe('model-deep')
    expect(adapter.requests).toHaveLength(2)
    expect(meter.state.finishCalls[0]?.modelId).toBe('model-deep')
  })

  it('đánh dấu run hỏng khi đã nâng tier mà vẫn lỗi', async () => {
    const fatal = new AppError('provider_error', 'hỏng hoàn toàn', { details: { status: 404 } })
    const adapter = scriptedAdapter([{ error: fatal }, { error: fatal }])
    const { deps, router } = depsFor(adapter)

    const result = await runAgent({ agent: buildResolvedAgent(), context: testContext(), tools: [] }, deps)

    expect(result.status).toBe('failed')
    expect(result.stopReason).toBe('model_error')
    // Router được hỏi lần hai để phát hiện đã hết model mới; cùng một model quay lại
    // thì vòng lặp dừng ngay thay vì thử lại vô hạn.
    expect(router.escalations()).toBe(2)
    expect(result.error).toContain('hỏng hoàn toàn')
  })
})

describe('runAgent — xoay API key của cùng một model', () => {
  it('khoá 1 lỗi thì tự dùng khoá 2, không đổi model', async () => {
    const key1 = scriptedAdapter([
      { error: new AppError('provider_error', 'khoá 1 hỏng', { details: { status: 401 } }) },
    ])
    const key2 = scriptedAdapter([textTurn('Trả lời bằng khoá 2.')])
    const router = fakeRouter()
    const meter = fakeMeter()
    let adaptersForCalls = 0
    const deps: AgentRuntimeDeps = {
      router,
      adapters: {
        adapterFor: () => {
          throw new Error('phải dùng adaptersFor khi có nhiều khoá')
        },
        adaptersFor: () => {
          adaptersForCalls += 1
          return [key1, key2]
        },
      },
      meterFactory: meter.factory,
    }

    const result = await runAgent({ agent: buildResolvedAgent(), context: testContext(), tools: [] }, deps)

    expect(result.status).toBe('succeeded')
    expect(result.output).toContain('khoá 2')
    expect(key1.requests).toHaveLength(1)
    expect(key2.requests).toHaveLength(1)
    // Xoay khoá không phải là đổi model: router không được hỏi.
    expect(router.escalations()).toBe(0)
    expect(adaptersForCalls).toBe(1)
  })

  it('hết cả hai khoá thì mới chuyển sang model dự phòng', async () => {
    const fatal = new AppError('provider_error', 'hết khoá', { details: { status: 401 } })
    const key1 = scriptedAdapter([{ error: fatal }])
    const key2 = scriptedAdapter([{ error: fatal }])
    const router = fakeRouter()
    const meter = fakeMeter()
    const deps: AgentRuntimeDeps = {
      router,
      adapters: {
        adapterFor: () => {
          throw new Error('phải dùng adaptersFor khi có nhiều khoá')
        },
        adaptersFor: () => [key1, key2],
      },
      meterFactory: meter.factory,
    }

    const result = await runAgent({ agent: buildResolvedAgent(), context: testContext(), tools: [] }, deps)

    // Cả hai khoá đều hỏng -> router buộc phải được hỏi để đổi model.
    expect(router.escalations()).toBeGreaterThanOrEqual(1)
    expect(result.status).toBe('failed')
  })
})

describe('runAgent — ghép nối thật với repos', () => {
  it('chạy qua createRuntimeDeps và ghi đúng bản ghi run vào SQLite', async () => {
    const repos = createRepos({ file: ':memory:', allowWeakSecret: true })
    repos.db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)', [
      'c1',
      'Công ty thử',
      'cong-ty-thu',
      '2026-01-01T00:00:00.000Z',
    ])
    const def = repos.team.upsertAgentDef({
      role: 'content-writer',
      name: 'Viết nội dung',
      description: 'Viết nội dung',
      systemPrompt: '# Vai trò',
      defaultTools: ['kb_search'],
    })
    const provider = repos.llm.createProvider({
      companyId: 'c1',
      name: 'Gateway',
      kind: 'openai_compatible',
      baseUrl: 'http://localhost:20128/v1',
    })
    const model = repos.llm.createModel({
      providerId: provider.id,
      modelId: 'test-model',
      label: 'Test model',
      supportsTools: true,
      costInPerMtok: 1,
      costOutPerMtok: 2,
    })
    // Hệ thống không tự gắn model cho agent: test cũng phải chọn tường minh như người dùng.
    repos.team.ensurePreset('c1', def.id, { tier: 'standard', modelFk: model.id })
    const agent = repos.team.resolveAgent('c1', 'content-writer')

    const adapter = scriptedAdapter([
      toolTurn([{ id: 'c1', name: 'kb_search', argumentsJson: '{"q":"seo"}' }]),
      textTurn('Báo cáo hoàn tất.'),
    ])
    const deps: AgentRuntimeDeps = { ...createRuntimeDeps(repos), adapter }

    const result = await runAgent(
      {
        agent,
        context: testContext(),
        messages: [{ role: 'user', content: 'Tìm tài liệu SEO' }],
        tools: [testTool('kb_search', async () => ({ content: 'Tài liệu SEO' }))],
      },
      deps,
    )

    expect(result.status).toBe('succeeded')
    const runs = repos.accounting.listRuns('c1')
    expect(runs).toHaveLength(1)
    expect(runs[0]?.status).toBe('succeeded')
    expect(runs[0]?.steps).toBe(2)
    expect(runs[0]?.tokensIn).toBeGreaterThan(0)

    repos.db.close()
  })
})
