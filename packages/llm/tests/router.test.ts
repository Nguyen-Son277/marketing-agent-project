/**
 * Test router trên SQLite thật.
 *
 * Trọng tâm: KHÔNG tự gắn model (chưa cấu hình thì báo lỗi cấu hình), thứ tự ưu tiên
 * preset → route theo tier → model dự phòng, capability guard khi model không hỗ trợ
 * tool, và chuyển model sau lỗi nhà cung cấp. Đây là các quyết định ảnh hưởng trực
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
    companyId: 'c1',
    name: 'Gateway nội bộ',
    kind: 'openai_compatible',
    baseUrl: 'http://localhost:20128/v1',
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
  // Không gắn model: mỗi test tự chọn tường minh như người dùng làm trong Cài đặt.
  repos.team.ensurePreset('c1', def.id, { tier: 'standard' })
  agent = repos.team.resolveAgent('c1', 'content-writer')
  router = new ModelRouter(new ModelRegistry(repos.llm), repos.llm)
})

afterEach(() => {
  repos.db.close()
})

describe('ModelRouter.chooseForAgent', () => {
  it('uses only configured vision-capable fallbacks and preserves vision on escalation', () => {
    repos.team.updatePreset('c1', agent.agentDef.id, { modelFk: noToolsId })
    repos.llm.updateModel(withToolsId, { supportsVision: true })
    repos.llm.updateModel(deepId, { supportsVision: true })
    const updated = repos.team.resolveAgent('c1', 'content-writer')
    // A vision model existing at the same provider is not permission to select it.
    expect(() => router.chooseForAgent(updated, { needsVision: true })).toThrow(/vision/)
    repos.llm.setModelFallbacks('c1', agent.agentDef.id, [withToolsId, noToolsId, deepId])
    expect(router.chooseForAgent(updated, { needsVision: true }).model.id).toBe(withToolsId)
    expect(router.escalate(updated, withToolsId, { needsVision: true }).model.id).toBe(deepId)
  })
  it('báo lỗi cấu hình thay vì tự chọn một model cho agent', () => {
    expect(() => router.chooseForAgent(agent)).toThrow(AppError)
    expect(() => router.chooseForAgent(agent)).toThrow(/chưa được chọn model/i)
  })

  it('ưu tiên model chỉ định trong preset hơn route', () => {
    repos.team.updatePreset('c1', agent.agentDef.id, { modelFk: deepId })
    repos.llm.upsertRoute({ companyId: 'c1', agentDefId: agent.agentDef.id, tier: 'standard', modelFk: withToolsId })
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

  it('capability guard đổi sang model cùng provider có hỗ trợ tool và ghi rõ lý do', () => {
    repos.team.updatePreset('c1', agent.agentDef.id, { modelFk: noToolsId })
    const updated = repos.team.resolveAgent('c1', 'content-writer')
    const choice = router.chooseForAgent(updated, { needsTools: true })
    expect(choice.model.supportsTools).toBe(true)
    expect(choice.source).toBe('capability_guard')
    expect(choice.reason).toContain('không hỗ trợ công cụ')
  })

  it('capability guard ưu tiên model dự phòng người dùng đã chọn', () => {
    repos.team.updatePreset('c1', agent.agentDef.id, { modelFk: noToolsId })
    repos.llm.setModelFallbacks('c1', agent.agentDef.id, [deepId])
    const updated = repos.team.resolveAgent('c1', 'content-writer')
    const choice = router.chooseForAgent(updated, { needsTools: true })
    expect(choice.model.id).toBe(deepId)
    expect(choice.source).toBe('capability_guard')
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
      companyId: 'c2',
      name: 'Gateway',
      kind: 'openai_compatible',
      baseUrl: 'http://localhost:20128/v1',
    })
    const chatOnly = repos2.llm.createModel({
      providerId: provider.id,
      modelId: 'chat-only',
      label: 'Chat-only',
      supportsTools: false,
    })
    repos2.team.ensurePreset('c2', def.id, { tier: 'standard', modelFk: chatOnly.id })
    const localRouter = new ModelRouter(new ModelRegistry(repos2.llm), repos2.llm)
    const localAgent = repos2.team.resolveAgent('c2', 'email-crm')

    expect(() => localRouter.chooseForAgent(localAgent, { needsTools: true })).toThrow(AppError)
    repos2.db.close()
  })
})

describe('ModelRouter.escalate', () => {
  it('chuyển lần lượt qua các model dự phòng theo thứ tự đã cấu hình', () => {
    repos.team.updatePreset('c1', agent.agentDef.id, { modelFk: noToolsId })
    repos.llm.setModelFallbacks('c1', agent.agentDef.id, [withToolsId, deepId])
    const updated = repos.team.resolveAgent('c1', 'content-writer')

    const second = router.escalate(updated, noToolsId)
    expect(second.source).toBe('escalation')
    expect(second.model.id).toBe(withToolsId)

    const third = router.escalate(updated, withToolsId)
    expect(third.model.id).toBe(deepId)
  })

  it('dùng route của tier cao hơn khi đã hết model dự phòng', () => {
    repos.llm.upsertRoute({ companyId: 'c1', agentDefId: agent.agentDef.id, tier: 'light', modelFk: withToolsId })
    repos.llm.upsertRoute({ companyId: 'c1', agentDefId: agent.agentDef.id, tier: 'deep', modelFk: deepId })
    repos.team.updatePreset('c1', agent.agentDef.id, { tier: 'light', modelFk: withToolsId })
    const updated = repos.team.resolveAgent('c1', 'content-writer')

    const escalated = router.escalate(updated, withToolsId)
    expect(escalated.model.id).toBe(deepId)
    expect(escalated.source).toBe('escalation')
  })

  it('báo lỗi cấu hình khi không còn model nào để chuyển', () => {
    repos.team.updatePreset('c1', agent.agentDef.id, { tier: 'deep', modelFk: deepId })
    const updated = repos.team.resolveAgent('c1', 'content-writer')
    expect(() => router.escalate(updated, deepId)).toThrow(/Không còn model dự phòng/)
  })

  it('nextTier đi đúng chuỗi light → standard → deep', () => {
    expect(nextTier('light')).toBe('standard')
    expect(nextTier('standard')).toBe('deep')
    expect(nextTier('deep')).toBeNull()
  })
})
