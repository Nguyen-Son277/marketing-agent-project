import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const doc = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const screen = doc('../src/screens/CaiDat.tsx')
const component = doc('../src/components/KnowledgeModelSettings.tsx')
const api = doc('../src/lib/api.ts')
const vi = doc('../../../packages/i18n/src/catalogs/vi/settings.ts')
const en = doc('../../../packages/i18n/src/catalogs/en/settings.ts')

describe('knowledge classification model settings', () => {
  it('has a dedicated knowledge tab on the settings screen', () => {
    expect(screen).toContain('knowledge: <KnowledgeModelSettings companyId={companyId} />')
    expect(component).toContain('api.providers(companyId)')
    expect(component).toContain("provider.enabled")
  })

  it('uses the classification settings GET, PUT and saved-settings test endpoints', () => {
    expect(api).toContain('/knowledge/classification/settings`')
    expect(api).toMatch(/method: ["']PUT["']/)
    expect(api).toContain('/knowledge/classification/settings/test')
    expect(component).toContain('api.testClassificationModelSettings(requestCompany)')
    expect(component).toContain('disabled={changed}')
  })

  it('offers leader/custom mode and up to three ordered fallbacks', () => {
    expect(component).toContain("value: 'leader', label: t('settings.knowledgeModel.modeLeader')")
    expect(component).toContain("value: 'custom', label: t('settings.knowledgeModel.modeCustom')")
    expect(component).toContain('draft.fallbackModelFks.length < 3')
    expect(component).toContain('settings.knowledgeModel.costWarning')
  })

  it('contains translations for all referenced knowledge model settings keys', () => {
    const keys = [...component.matchAll(/t\('(settings\.knowledgeModel\.[^']+)'/g)].map((match) => match[1])
    for (const key of keys) {
      expect(vi, `Vietnamese missing ${key}`).toContain(`'${key}'`)
      expect(en, `English missing ${key}`).toContain(`'${key}'`)
    }
  })
})
