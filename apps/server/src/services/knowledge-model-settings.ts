import { needsConfiguration, validation, type AgentDefRecord, type LlmModelRecord, type LlmProviderRecord } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { z } from 'zod'
import { resolvePresetModel } from './view-mappers.ts'

export interface KnowledgeModelSettings {
  readonly mode: 'leader' | 'custom'
  readonly modelFk: string | null
  readonly fallbackModelFks: string[]
}

export interface KnowledgeModelSettingsView {
  readonly settings: KnowledgeModelSettings
  readonly effectiveModels: Array<{
    readonly id: string
    readonly modelId: string
    readonly label: string
    readonly providerId: string
    readonly providerName: string
  }>
  readonly valid: boolean
  readonly issues: string[]
  readonly source: 'leader' | 'custom'
}

const DEFAULT_SETTINGS: KnowledgeModelSettings = { mode: 'leader', modelFk: null, fallbackModelFks: [] }
const settingsSchema = z.object({
  mode: z.enum(['leader', 'custom']),
  modelFk: z.string().min(1).nullable(),
  fallbackModelFks: z.array(z.string().min(1)).max(3),
}).strict().superRefine((value, ctx) => {
  if (value.mode === 'custom' && !value.modelFk) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['modelFk'], message: 'A primary model is required in custom mode' })
  }
  if (new Set(value.fallbackModelFks).size !== value.fallbackModelFks.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fallbackModelFks'], message: 'Fallback models must be unique' })
  }
  if (value.modelFk && value.fallbackModelFks.includes(value.modelFk)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fallbackModelFks'], message: 'Fallback models cannot include the primary model' })
  }
})

const settingKey = (companyId: string): string => `knowledge-classification:${companyId}`

function leaderDefinition(repos: Repos): AgentDefRecord {
  const def = repos.team.listAgentDefs().find((entry) => entry.isLeader)
  if (!def) throw needsConfiguration('Marketing Leader is not configured for knowledge classification')
  return def
}

function validateModel(repos: Repos, companyId: string, modelFk: string): { model: LlmModelRecord; provider: LlmProviderRecord } {
  const model = repos.llm.findModel(modelFk)
  if (!model) throw validation(`Model ${modelFk} does not exist`)
  const provider = repos.llm.findProvider(model.providerId)
  if (!provider || provider.companyId !== companyId) throw validation(`Model ${modelFk} is not owned by this company`)
  if (!model.enabled || !provider.enabled) throw validation(`Model ${modelFk} and its provider must be enabled`)
  return { model, provider }
}

/** Read persisted settings and report unavailable references without substituting another model. */
export function readKnowledgeModelSettings(repos: Repos, companyId: string): KnowledgeModelSettingsView {
  const stored = repos.accounting.getSetting<unknown>(settingKey(companyId))
  const parsed = settingsSchema.safeParse(stored)
  const settings: KnowledgeModelSettings = parsed.success
    ? { ...parsed.data, fallbackModelFks: [...parsed.data.fallbackModelFks] }
    : { ...DEFAULT_SETTINGS }
  const issues: string[] = parsed.success ? [] : stored === undefined ? [] : ['Saved knowledge model settings are invalid']
  const source = settings.mode
  const refs = source === 'custom'
    ? [settings.modelFk, ...settings.fallbackModelFks].filter((id): id is string => id !== null)
    : leaderModelRefs(repos, companyId, issues)
  const effectiveModels: KnowledgeModelSettingsView['effectiveModels'] = []
  for (const id of refs) {
    const model = repos.llm.findModel(id)
    const provider = model ? repos.llm.findProvider(model.providerId) : undefined
    if (!model) {
      issues.push(`Configured model ${id} is missing`)
      effectiveModels.push({ id, modelId: '', label: id, providerId: '', providerName: '' })
      continue
    }
    effectiveModels.push({ id: model.id, modelId: model.modelId, label: model.label, providerId: model.providerId, providerName: provider?.name ?? '' })
    if (!provider || provider.companyId !== companyId) issues.push(`Configured model ${id} is not owned by this company`)
    else {
      if (!model.enabled) issues.push(`Configured model ${id} is disabled`)
      if (!provider.enabled) issues.push(`Provider for model ${id} is disabled`)
      if (provider.enabled && repos.llm.listProviderKeys(provider.id, { includeDisabled: true }).length > 0 && repos.llm.listProviderKeys(provider.id).length === 0) {
        issues.push(`Provider for model ${id} has no enabled API key`)
      }
    }
  }
  return { settings, effectiveModels, valid: issues.length === 0, issues: [...new Set(issues)], source }
}

function leaderModelRefs(repos: Repos, companyId: string, issues: string[]): string[] {
  const def = repos.team.listAgentDefs().find((entry) => entry.isLeader)
  if (!def) {
    issues.push('Marketing Leader is not configured')
    return []
  }
  const preset = repos.team.findPreset(companyId, def.id)
  if (!preset) {
    issues.push('Marketing Leader preset is not configured')
    return []
  }
  // resolvePresetModel intentionally follows the same direct preset / tier route precedence as the team UI.
  const primary = resolvePresetModel(repos, companyId, def, preset)?.id ?? preset.modelFk
  const fallbacks = repos.llm.listModelFallbacks(companyId, def.id).map((item) => item.modelFk)
  if (!primary) issues.push('Marketing Leader chưa được gán model. Hãy chọn model riêng trong Cài đặt → Model phân loại kiến thức.')
  return [...new Set([primary, ...fallbacks].filter((id): id is string => id !== null))]
}

/** Strictly validate configuration and all model ownership/readiness before persisting. */
export function saveKnowledgeModelSettings(repos: Repos, companyId: string, input: unknown): KnowledgeModelSettings {
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) throw validation('Invalid knowledge classification model settings', parsed.error.issues)
  if (parsed.data.mode === 'custom') {
    for (const modelFk of [parsed.data.modelFk!, ...parsed.data.fallbackModelFks]) validateModel(repos, companyId, modelFk)
  }
  const settings: KnowledgeModelSettings = { ...parsed.data, fallbackModelFks: [...parsed.data.fallbackModelFks] }
  repos.accounting.setSetting(settingKey(companyId), settings)
  return settings
}

/** Resolve only explicitly configured candidates; no automatic model selection is performed. */
export function resolveKnowledgeClassificationModels(
  repos: Repos,
  companyId: string,
  explicitFk?: string,
): Array<{ def: AgentDefRecord; model: LlmModelRecord; provider: LlmProviderRecord }> {
  const def = leaderDefinition(repos)
  const stored = repos.accounting.getSetting<unknown>(settingKey(companyId))
  const parsed = settingsSchema.safeParse(stored)
  const settings = parsed.success ? parsed.data : DEFAULT_SETTINGS
  let primary: string | null
  let fallbackFks: string[]
  if (explicitFk !== undefined) {
    primary = explicitFk
    fallbackFks = settings.mode === 'custom' ? settings.fallbackModelFks : []
  } else if (settings.mode === 'custom') {
    primary = settings.modelFk
    fallbackFks = settings.fallbackModelFks
  } else {
    const preset = repos.team.findPreset(companyId, def.id)
    if (!preset) throw needsConfiguration('Marketing Leader preset is not configured for knowledge classification')
    primary = resolvePresetModel(repos, companyId, def, preset)?.id ?? preset.modelFk
    fallbackFks = repos.llm.listModelFallbacks(companyId, def.id).map((item) => item.modelFk)
  }
  if (!primary) throw needsConfiguration('Chưa chọn model phân loại kiến thức. Vào Cài đặt → Model phân loại kiến thức để chọn model riêng hoặc gán model cho Marketing Leader.')
  const candidates = [...new Set([primary, ...fallbackFks])]
  const resolved: Array<{ def: AgentDefRecord; model: LlmModelRecord; provider: LlmProviderRecord }> = []
  for (const id of candidates) {
    const model = repos.llm.findModel(id)
    if (!model) throw needsConfiguration(`Configured knowledge classification model ${id} is missing`)
    const provider = repos.llm.findProvider(model.providerId)
    if (!provider || provider.companyId !== companyId) throw needsConfiguration(`Configured knowledge classification model ${id} is not owned by this company`)
    if (!model.enabled) throw needsConfiguration(`Configured knowledge classification model ${id} is disabled`)
    if (!provider.enabled) throw needsConfiguration(`Provider for knowledge classification model ${id} is disabled`)
    const allKeys = repos.llm.listProviderKeys(provider.id, { includeDisabled: true })
    if (allKeys.length > 0 && repos.llm.listProviderKeys(provider.id).length === 0) {
      throw needsConfiguration(`Provider for knowledge classification model ${id} has no enabled API key`)
    }
    resolved.push({ def, model, provider })
  }
  return resolved
}

export type KnowledgeModelSettingsInput = z.infer<typeof settingsSchema>
export { settingsSchema as knowledgeModelSettingsSchema }
