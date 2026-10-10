/**
 * Test router trên SQLite thật.
 *
 * Trọng tâm: ba quy tắc chọn model (preset → route → rẻ nhất), capability guard khi
 * model không hỗ trợ tool, và nâng tier sau lỗi. Đây là các quyết định ảnh hưởng trực
 * tiếp tới chi phí và độ đúng, nên phải khoá bằng test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError, type ResolvedAgent } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { ModelRegistry } from '../src/registry.ts'
import { ModelRouter, nextTier } from '../src/router.ts'
import { createCompany, createTestRepos } from './fixtures.ts'

let repos: Repos
let router: ModelRouter
let agent: ResolvedAgent
let noToolsId: string
let withToolsId: string
let deepId: string

beforeEach(() => {
  repos = createTestRepos()
  createCompany(repos, 'c1')
  const def = repos.team.upsertAgentDef({
    role: 'content-writer',
    name: 'Viết nội dung',
    description: 'Viết nội dung marketing',
    systemPrompt: '# Vai trò',
    defaultSkills: [],
    defaultTools: ['kb_search'],
  })
  const provider = repos.llm.createProvider({
    companyId: null,
    name: 'Gateway nội bộ',
    kind: 'openai_compatible',
    baseUrl: 'http://localhost:20128/v1',
    apiKeyRef: 'TEST_KEY',
  })
  noToolsId = repos.llm.createModel({
    providerId: provider.id,
    modelId: 'chat-only',
    label: 'Chat-only',
    supportsTools: false,
    costInPerMtok: 1,
    costOutPerMtok: 1,
  }).id
  withToolsId = repos.llm.createModel({
    providerId: provider.id,
    modelId: 'tool-model',
    label: 'Tool model',
    supportsTools: true,
    costInPerMtok: 2,
    costOutPerMtok: 2,
  }).id
  deepId = repos.llm.createModel({
    providerId: provider.id,
    modelId: 'deep-model',
    label: 'Deep model',
    supportsTools: true,
    costInPerMtok: 9,
    costOutPerMtok: 9,
  }).id
  repos.team.ensurePreset('c1', def.id, { tier: 'standard' })
  agent = repos.team.resolveAgent('c1', 'content-writer')
  router = new ModelRouter(new ModelRegistry(repos.llm), repos.llm)
})

afterEach(() => {
  repos.db.close()
})

describe('ModelRouter.chooseForAgent', () => {
  it('giữ model rẻ nhất khi lượt chạy không cần công cụ', () => {
    const choice = router.chooseForAgent(agent)
    expect(choice.model.id).toBe(noToolsId)
    expect(choice.source).toBe('cheapest')
  })

  it('capability guard đổi sang model cùng provider có hỗ trợ tool và ghi rõ lý do', () => {
    const choice = router.chooseForAgent(agent, { needsTools: true })
    expect(choice.model.id).toBe(withToolsId)
    expect(choice.source).toBe('capability_guard')
    expect(choice.model.supportsTools).toBe(true)
    expect(choice.reason).toContain('không hỗ trợ công cụ')
  })

  it('ưu tiên model chỉ định trong preset hơn route và model rẻ nhất', () => {
    repos.team.updatePreset('c1', agent.agentDef.id, { modelFk: deepId })
    const updated = repos.team.resolveAgent('c1', 'content-writer')
    const choice = router.chooseForAgent(updated)
    expect(choice.model.id).toBe(deepId)
    expect(choice.source).toBe('preset')
  })

  it('dùng route của tier preset khi không có chỉ định riêng', () => {
    repos.llm.upsertRoute({ companyId: 'c1', agentDefId: agent.agentDef.id, tier: 'standard', modelFk: deepId })
    const choice = router.chooseForAgent(agent)
    expect(choice.model.id).toBe(deepId)
    expect(choice.source).toBe('route')
  })

  it('báo lỗi cấu hình khi không có model nào hỗ trợ tool mà lượt chạy cần tool', () => {
    const repos2 = createTestRepos()
    createCompany(repos2, 'c2')
    const def = repos2.team.upsertAgentDef({
      role: 'email-crm',
      name: 'Email',
      description: 'Email',
      systemPrompt: '# Vai trò',
    })
    const provider = repos2.llm.createProvider({
      companyId: null,
      name: 'Gateway',
      kind: 'openai_compatible',
      baseUrl: 'http://localhost:20128/v1',
      apiKeyRef: 'TEST_KEY',
    })
    repos2.llm.createModel({ providerId: provider.id, modelId: 'chat-only', label: 'Chat-only', supportsTools: false })
    repos2.team.ensurePreset('c2', def.id, { tier: 'standard' })
    const localRouter = new ModelRouter(new ModelRegistry(repos2.llm), repos2.llm)
    const localAgent = repos2.team.resolveAgent('c2', 'email-crm')

    expect(() => localRouter.chooseForAgent(localAgent, { needsTools: true })).toThrow(AppError)
    repos2.db.close()
  })
})

describe('ModelRouter.escalate', () => {
  it('nâng từ tier light lên tier mạnh hơn sau lỗi nhà cung cấp', () => {
    repos.llm.upsertRoute({ companyId: 'c1', agentDefId: agent.agentDef.id, tier: 'light', modelFk: withToolsId })
    repos.team.updatePreset('c1', agent.agentDef.id, { tier: 'light', modelFk: null })
    const updated = repos.team.resolveAgent('c1', 'content-writer')
    const first = router.chooseForAgent(updated, { needsTools: true })
    expect(first.model.id).toBe(withToolsId)

    const escalated = router.escalate(updated, first.model.id)
    expect(escalated.source).toBe('escalation')
    expect(escalated.tier).toBe('standard')
    // Không có route tier standard nên lùi về model mạnh nhất còn dùng được.
    expect(escalated.model.id).toBe(deepId)
    expect(escalated.reason).toContain('Nâng từ tier light')
  })

  it('giữ nguyên tier deep (cao nhất) và ghi rõ không thể nâng thêm', () => {
    repos.llm.upsertRoute({ companyId: 'c1', agentDefId: agent.agentDef.id, tier: 'deep', modelFk: deepId })
    repos.team.updatePreset('c1', agent.agentDef.id, { tier: 'deep', modelFk: null })
    const updated = repos.team.resolveAgent('c1', 'content-writer')
    const escalated = router.escalate(updated, deepId)
    expect(escalated.model.id).toBe(deepId)
    expect(escalated.tier).toBe('deep')
    expect(escalated.reason).toContain('cao nhất')
  })

  it('nextTier đi đúng chuỗi light → standard → deep', () => {
    expect(nextTier('light')).toBe('standard')
    expect(nextTier('standard')).toBe('deep')
    expect(nextTier('deep')).toBeNull()
  })
})
