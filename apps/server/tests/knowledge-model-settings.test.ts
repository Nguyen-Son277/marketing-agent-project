import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '@marketing-agent/shared'
import { createRoutesTestContext, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'
import {
  readKnowledgeModelSettings,
  resolveKnowledgeClassificationModels,
  saveKnowledgeModelSettings,
} from '../src/services/knowledge-model-settings.ts'

let ctx: RoutesTestContext
let companyId: string
let modelA: { id: string }
let modelB: { id: string }

beforeEach(async () => {
  ctx = await createRoutesTestContext()
  companyId = (await tenant(ctx, `knowledge-settings-${Date.now()}@example.com`, 'Knowledge settings')).company.id
  const provider = ctx.repos.llm.createProvider({ companyId, name: 'Internal gateway', kind: 'openai_compatible', baseUrl: 'http://localhost/v1' })
  modelA = ctx.repos.llm.createModel({ providerId: provider.id, modelId: 'primary', label: 'Primary' })
  modelB = ctx.repos.llm.createModel({ providerId: provider.id, modelId: 'fallback', label: 'Fallback' })
  const leader = ctx.repos.team.listAgentDefs().find((def) => def.isLeader)!
  ctx.repos.team.updatePreset(companyId, leader.id, { modelFk: modelA.id })
})

afterEach(async () => { await ctx.close() })

describe('knowledge classification model settings', () => {
  it('defaults to Marketing Leader preset and its existing fallbacks', () => {
    expect(readKnowledgeModelSettings(ctx.repos, companyId)).toMatchObject({
      settings: { mode: 'leader', modelFk: null, fallbackModelFks: [] },
      source: 'leader', valid: true,
      effectiveModels: [{ id: modelA.id, modelId: 'primary', label: 'Primary' }],
    })
    const resolved = resolveKnowledgeClassificationModels(ctx.repos, companyId)
    expect(resolved.map(({ model }) => model.id)).toEqual([modelA.id])
    expect(resolved[0]?.provider.name).toBe('Internal gateway')
  })

  it('saves and resolves custom primary and fallbacks, without exposing keys', () => {
    const saved = saveKnowledgeModelSettings(ctx.repos, companyId, {
      mode: 'custom', modelFk: modelB.id, fallbackModelFks: [modelA.id],
    })
    expect(saved).toEqual({ mode: 'custom', modelFk: modelB.id, fallbackModelFks: [modelA.id] })
    expect(readKnowledgeModelSettings(ctx.repos, companyId)).toMatchObject({
      source: 'custom', valid: true,
      effectiveModels: [{ id: modelB.id }, { id: modelA.id }],
    })
    expect(resolveKnowledgeClassificationModels(ctx.repos, companyId).map(({ model }) => model.id)).toEqual([modelB.id, modelA.id])
    expect(JSON.stringify(readKnowledgeModelSettings(ctx.repos, companyId))).not.toContain('apiKey')
    expect(JSON.stringify(readKnowledgeModelSettings(ctx.repos, companyId))).not.toContain('secret')
  })

  it('keeps dedicated selection independent from subsequent Leader changes',()=>{
    saveKnowledgeModelSettings(ctx.repos,companyId,{mode:'custom',modelFk:modelB.id,fallbackModelFks:[]})
    const leader=ctx.repos.team.listAgentDefs().find(def=>def.isLeader)!
    ctx.repos.team.updatePreset(companyId,leader.id,{modelFk:null})
    expect(resolveKnowledgeClassificationModels(ctx.repos,companyId).map(entry=>entry.model.id)).toEqual([modelB.id])
  })

  it('rejects malformed config, duplicate fallbacks, and fallbacks equal to primary', () => {
    expect(() => saveKnowledgeModelSettings(ctx.repos, companyId, { mode: 'custom', modelFk: null, fallbackModelFks: [] })).toThrow(AppError)
    expect(() => saveKnowledgeModelSettings(ctx.repos, companyId, { mode: 'custom', modelFk: modelA.id, fallbackModelFks: [modelB.id, modelB.id] })).toThrow(AppError)
    expect(() => saveKnowledgeModelSettings(ctx.repos, companyId, { mode: 'custom', modelFk: modelA.id, fallbackModelFks: [modelA.id] })).toThrow(AppError)
    expect(() => saveKnowledgeModelSettings(ctx.repos, companyId, { mode: 'custom', modelFk: modelA.id, fallbackModelFks: [modelB.id, modelA.id, modelB.id, modelA.id] })).toThrow(AppError)
  })

  it('rejects cross-company, deleted, and disabled references on save', async () => {
    const other = (await tenant(ctx, `knowledge-settings-other-${Date.now()}@example.com`, 'Other company')).company.id
    const provider = ctx.repos.llm.createProvider({ companyId: other, name: 'Other', kind: 'openai_compatible', baseUrl: 'http://localhost/v1' })
    const foreign = ctx.repos.llm.createModel({ providerId: provider.id, modelId: 'foreign', label: 'Foreign' })
    for (const fk of [foreign.id, 'deleted-model-id']) {
      expect(() => saveKnowledgeModelSettings(ctx.repos, companyId, { mode: 'custom', modelFk: fk, fallbackModelFks: [] })).toThrow(AppError)
    }
    ctx.repos.llm.updateModel(modelA.id, { enabled: false })
    expect(() => saveKnowledgeModelSettings(ctx.repos, companyId, { mode: 'custom', modelFk: modelA.id, fallbackModelFks: [] })).toThrow(AppError)
  })

  it('reports saved deleted model refs and resolver fails with needs_configuration', () => {
    saveKnowledgeModelSettings(ctx.repos, companyId, { mode: 'custom', modelFk: modelA.id, fallbackModelFks: [modelB.id] })
    ctx.repos.llm.deleteModel(modelB.id)
    const view = readKnowledgeModelSettings(ctx.repos, companyId)
    expect(view.valid).toBe(false)
    expect(view.settings.fallbackModelFks).toEqual([modelB.id])
    expect(view.issues.join(' ')).toContain('missing')
    try {
      resolveKnowledgeClassificationModels(ctx.repos, companyId)
      throw new Error('Expected resolver to reject missing reference')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('needs_configuration')
    }
  })

  it('does not auto-select a model when leader preset is unset', () => {
    const leader = ctx.repos.team.listAgentDefs().find((def) => def.isLeader)!
    ctx.repos.team.updatePreset(companyId, leader.id, { modelFk: null })
    expect(readKnowledgeModelSettings(ctx.repos, companyId).valid).toBe(false)
    expect(() => resolveKnowledgeClassificationModels(ctx.repos, companyId)).toThrow(AppError)
  })
})

// Keep the compile-time payload shape explicit for service callers.
void (null as unknown as Parameters<typeof saveKnowledgeModelSettings>[2])
