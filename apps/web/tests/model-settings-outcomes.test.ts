import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const source = (name: string): string => readFileSync(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8')
const knowledge = source('KnowledgeModelSettings')
const dialog = source('HopThoaiChonModel')
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<void>

function handler(text: string, name: string, context: Record<string, unknown>): () => Promise<void> {
  const body = text.split(`async function ${name}(): Promise<void> {`)[1]!.split('\n  }')[0]!
  return () => new AsyncFunction(...Object.keys(context), body)(...Object.values(context))
}

function setup() {
  const finish = vi.fn()
  const begin = vi.fn(() => finish)
  const context = {
    begin, companyId: 'company-a', activeCompany: { current: 'company-a' },
    changed: true, draft: { mode: 'custom', modelFk: 'model-a', fallbackModelFks: [] },
    setSaving: vi.fn(), setTesting: vi.fn(), setSaved: vi.fn(), setDraft: vi.fn(), setIssues: vi.fn(),
    providerIdChon: 'provider-a', keyId: '', daChon: ['model-a'], tatCaModel: [{ modelId: 'model-a', label: 'Model A' }],
    setDangFetch: vi.fn(), setDangNhap: vi.fn(), setDaChon: vi.fn(), setKetQuaFetch: vi.fn(), onDaNhap: vi.fn(),
    api: {
      saveClassificationModelSettings: vi.fn().mockResolvedValue({ settings: {}, issues: [] }),
      testClassificationModelSettings: vi.fn().mockResolvedValue({ ok: true, message: 'secret provider response' }),
      fetchProviderModels: vi.fn().mockResolvedValue({ ok: true, models: [] }),
      importProviderModels: vi.fn().mockResolvedValue({ created: [{}], skipped: [] }),
    },
  }
  return { context, begin, finish }
}

describe('model settings action outcomes', () => {
  for (const [text, name, operation, apiName] of [
    [knowledge, 'save', 'knowledgeModel.save', 'saveClassificationModelSettings'],
    [knowledge, 'test', 'knowledgeModel.test', 'testClassificationModelSettings'],
    [dialog, 'layDanhSach', 'model.fetch', 'fetchProviderModels'],
    [dialog, 'nhapDaChon', 'model.save', 'importProviderModels'],
  ] as const) {
    it(`${operation} captures scope before the request and finishes once on success`, async () => {
      const { context, begin, finish } = setup()
      context.api[apiName].mockImplementationOnce(async () => {
        expect(begin).toHaveBeenCalledExactlyOnceWith(operation)
        context.activeCompany.current = 'company-b'
        return { settings: {}, issues: [], ok: true, models: [], created: [{}], skipped: [] }
      })
      await handler(text, name, context)()
      expect(finish).toHaveBeenCalledExactlyOnceWith('success')
    })
    it(`${operation} reports a generic error without clearing the form`, async () => {
      const { context, finish } = setup()
      context.api[apiName].mockRejectedValueOnce(new Error('secret provider response'))
      await handler(text, name, context)()
      expect(finish).toHaveBeenCalledExactlyOnceWith('error')
      expect(context.setDraft).not.toHaveBeenCalled()
      if (name === 'nhapDaChon') expect(context.setDaChon).not.toHaveBeenCalled()
    })
  }

  it('does not begin invalid save/import/fetch actions', async () => {
    const { context, begin } = setup()
    context.draft.modelFk = ''
    await handler(knowledge, 'save', context)()
    context.daChon = []
    await handler(dialog, 'nhapDaChon', context)()
    context.providerIdChon = ''
    await handler(dialog, 'layDanhSach', context)()
    expect(begin).not.toHaveBeenCalled()
  })

  it('reports unsuccessful test/fetch results without forwarding provider messages', async () => {
    for (const [text, name, apiName] of [
      [knowledge, 'test', 'testClassificationModelSettings'],
      [dialog, 'layDanhSach', 'fetchProviderModels'],
    ] as const) {
      const { context, finish } = setup()
      context.api[apiName].mockResolvedValueOnce({ ok: false, message: 'secret', models: [] })
      await handler(text, name, context)()
      expect(finish).toHaveBeenCalledExactlyOnceWith('error')
    }
  })

  it('reports configuration issues and skipped imports as warnings', async () => {
    const { context, finish } = setup()
    context.api.saveClassificationModelSettings.mockResolvedValueOnce({ settings: { fallbackModelFks: [] }, issues: ['configuration issue'] })
    await handler(knowledge, 'save', context)()
    expect(finish).toHaveBeenLastCalledWith('warning')
    context.api.importProviderModels.mockResolvedValueOnce({ created: [], skipped: ['existing'] })
    await handler(dialog, 'nhapDaChon', context)()
    expect(finish).toHaveBeenLastCalledWith('warning')
  })

  it('keeps load errors, retry and configuration warnings but removes action banners', () => {
    for (const text of [knowledge, dialog]) {
      expect(text).toContain('useSettingsNotifications(companyId)')
      expect(text).toContain("t('common.retry')")
      expect(text).not.toContain('loai="thanh-cong"')
    }
    expect(knowledge).toContain('{error}')
    expect(knowledge).toContain('issues.map')
    expect(dialog).toContain('{loiProvider}')
    expect(dialog).toContain("t('settings.models.fetch.noProviders')")
    expect(dialog).not.toContain('ketQuaFetch.message')
    expect(dialog).not.toContain('setLoiNhap')
    expect(knowledge).not.toContain('result.message')
  })
})
