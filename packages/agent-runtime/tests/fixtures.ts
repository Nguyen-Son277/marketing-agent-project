/**
 * Đối tượng giả và nhà máy dữ liệu cho test agent-runtime.
 *
 * Vì sao mock thay vì DB thật: phần dễ sai nhất của vòng lặp là *thứ tự và điều kiện
 * dừng* — số bước, xử lý lỗi công cụ, chặn công cụ ngoài grant. Những thứ đó kiểm tra
 * chính xác hơn nhiều khi model trả về kịch bản cố định, không phụ thuộc mạng.
 */
import type {
  AgentSkillRecord,
  LlmChatRequest,
  LlmChunk,
  LlmModelRecord,
  LlmProviderRecord,
  LlmUsage,
  ResolvedAgent,
  ToolContext,
  ToolDefinition,
} from '@marketing-agent/shared'
import type {
  ChatAdapter,
  MeterFinishInput,
  MeterStartInput,
  ModelChoice,
  ModelChooser,
  RunMeter,
} from '../src/types.ts'

export const ZERO_USAGE: LlmUsage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }

export function usage(promptTokens: number, completionTokens: number, cachedTokens = 0): LlmUsage {
  return { promptTokens, completionTokens, cachedTokens }
}

export function testModel(overrides: Partial<LlmModelRecord> = {}): LlmModelRecord {
  return {
    id: 'model-standard',
    providerId: 'provider-1',
    modelId: 'test-model',
    label: 'Test model',
    contextWindow: 128_000,
    maxOutput: 4_096,
    supportsTools: true,
    supportsVision: false,
    costInPerMtok: 1,
    costOutPerMtok: 2,
    enabled: true,
    ...overrides,
  }
}

export function testProvider(overrides: Partial<LlmProviderRecord> = {}): LlmProviderRecord {
  return {
    id: 'provider-1',
    companyId: null,
    name: 'Gateway test',
    kind: 'openai_compatible',
    baseUrl: 'http://localhost:20128/v1',
    keyUsageMode: 'failover',
    extraJson: null,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

export function testSkill(overrides: Partial<AgentSkillRecord> = {}): AgentSkillRecord {
  return {
    id: 'skill-1',
    name: 'copywriting',
    description: 'Viết nội dung theo cấu trúc hook–vấn đề–giải pháp',
    category: 'content',
    bodyMd: 'Luôn bắt đầu bằng nỗi đau của khách hàng.',
    origin: 'builtin',
    ...overrides,
  }
}

export interface ResolvedAgentOptions {
  readonly model?: LlmModelRecord
  readonly skills?: readonly AgentSkillRecord[]
  readonly knowledgeRead?: readonly string[]
  readonly knowledgeWrite?: readonly string[]
  readonly systemPrompt?: string
  readonly systemPromptOverride?: string | null
  readonly contextBudgetTokens?: number
  readonly maxTokens?: number | null
  readonly reasoningEffort?: string | null
}

export function buildResolvedAgent(options: ResolvedAgentOptions = {}): ResolvedAgent {
  const model = options.model ?? testModel()
  return {
    companyId: 'c1',
    agentDef: {
      id: 'def-1',
      role: 'content-writer',
      name: 'Viết nội dung',
      description: 'Viết nội dung marketing',
      systemPrompt: options.systemPrompt ?? '# Vai trò\nBạn viết nội dung đúng brand voice.',
      defaultSkillsJson: '[]',
      defaultToolsJson: '[]',
      isLeader: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    preset: {
      id: 'preset-1',
      companyId: 'c1',
      agentDefId: 'def-1',
      displayName: null,
      enabled: true,
      modelFk: model.id,
      tier: 'standard',
      reasoningEffort: options.reasoningEffort ?? null,
      maxTokens: options.maxTokens ?? 1_024,
      contextBudgetTokens: options.contextBudgetTokens ?? 60_000,
      systemPromptOverride: options.systemPromptOverride ?? null,
      requireApproval: true,
    },
    role: 'content-writer',
    displayName: 'Viết nội dung',
    model,
    provider: testProvider(),
    skills: options.skills ?? [],
    toolNames: [],
    knowledgeRead: options.knowledgeRead ?? ['10-brand'],
    knowledgeWrite: options.knowledgeWrite ?? [],
  }
}

export function testTool(
  name: string,
  handler: ToolDefinition['handler'],
  overrides: Partial<ToolDefinition> = {},
): ToolDefinition {
  return {
    name,
    description: `Công cụ ${name}`,
    parameters: { type: 'object', properties: { q: { type: 'string' } } },
    handler,
    ...overrides,
  }
}

export function testContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    companyId: 'c1',
    agentRole: 'content-writer',
    agentDefId: 'def-1',
    taskId: null,
    conversationId: null,
    log: () => undefined,
    ...overrides,
  }
}

/* -------------------------------------------------------------- scripted model */

export interface ScriptedTurn {
  readonly chunks?: readonly LlmChunk[]
  readonly error?: unknown
}

export interface ScriptedAdapter extends ChatAdapter {
  readonly requests: LlmChatRequest[]
}

/** Adapter trả lần lượt các kịch bản; hết kịch bản thì lặp lại cái cuối. */
export function scriptedAdapter(turns: readonly ScriptedTurn[]): ScriptedAdapter {
  const requests: LlmChatRequest[] = []
  let index = 0
  return {
    requests,
    async *chat(request: LlmChatRequest): AsyncGenerator<LlmChunk> {
      requests.push(request)
      const turn = turns[Math.min(index, turns.length - 1)]
      index += 1
      if (!turn) throw new Error('scriptedAdapter: không có kịch bản nào')
      if (turn.error !== undefined) throw turn.error
      for (const chunk of turn.chunks ?? []) yield chunk
    },
  }
}

export function textTurn(text: string, tokens = usage(100, 20)): ScriptedTurn {
  return {
    chunks: [
      { type: 'text', text },
      { type: 'done', finishReason: 'stop', usage: tokens },
    ],
  }
}

export function toolTurn(calls: readonly { id: string; name: string; argumentsJson: string }[], tokens = usage(120, 30)): ScriptedTurn {
  return {
    chunks: [
      ...calls.map((call): LlmChunk => ({ type: 'tool_call', call })),
      { type: 'done', finishReason: 'tool_calls', usage: tokens },
    ],
  }
}

/* --------------------------------------------------------------- router & meter */

export interface FakeRouter extends ModelChooser {
  readonly escalations: () => number
}

export function fakeRouter(model: LlmModelRecord = testModel()): FakeRouter {
  const escalated = testModel({ id: 'model-deep', modelId: 'test-model-deep', label: 'Deep model' })
  let escalationCount = 0
  return {
    escalations: () => escalationCount,
    chooseForAgent: (): ModelChoice => ({
      model,
      provider: testProvider(),
      tier: 'standard',
      source: 'preset',
      reason: 'router giả',
    }),
    escalate: (): ModelChoice => {
      escalationCount += 1
      return { model: escalated, provider: testProvider(), tier: 'deep', source: 'escalation', reason: 'nâng tier giả' }
    },
  }
}

export interface FakeMeterState {
  readonly finishCalls: MeterFinishInput[]
  readonly addedUsage: LlmUsage[]
  readonly budgetChecks: () => number
}

export interface FakeMeter {
  readonly factory: (input: MeterStartInput) => RunMeter
  readonly state: FakeMeterState
}

export function fakeMeter(options: { budgetError?: Error } = {}): FakeMeter {
  const finishCalls: MeterFinishInput[] = []
  const addedUsage: LlmUsage[] = []
  let checks = 0
  const totals = { tokensIn: 0, tokensOut: 0, cachedTokens: 0, costUsd: 0, calls: 0 }

  const factory = (_input: MeterStartInput): RunMeter => ({
    runId: 'run-fake',
    addUsage: (_model, value) => {
      addedUsage.push(value)
      totals.tokensIn = totals.tokensIn + value.promptTokens
      totals.tokensOut = totals.tokensOut + value.completionTokens
      totals.calls = totals.calls + 1
      return { ...totals }
    },
    checkBudget: () => {
      checks += 1
      if (options.budgetError) throw options.budgetError
      return { allowed: true }
    },
    snapshot: () => ({ ...totals }),
    finish: (input) => {
      finishCalls.push(input)
    },
  })

  return {
    factory,
    state: { finishCalls, addedUsage, budgetChecks: () => checks },
  }
}
