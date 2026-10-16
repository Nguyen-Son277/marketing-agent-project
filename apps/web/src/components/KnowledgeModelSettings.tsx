import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ModelOptionView, ProviderView } from '@marketing-agent/shared'
import { ApiError, api, type ClassificationModelSettings } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { useSettingsNotifications } from '../lib/settings-notifications.ts'
import { Card, DangTai, Nut, OChon, ThongBao, Truong } from './ui.tsx'

const EMPTY_SETTINGS: ClassificationModelSettings = { mode: 'leader', modelFk: null, fallbackModelFks: [] }

/** Model selection for automatic company knowledge classification. */
export function KnowledgeModelSettings({ companyId }: { companyId: string }): ReactNode {
  const { t } = useI18n()
  const { begin } = useSettingsNotifications(companyId)
  const activeCompany=useRef(companyId)
  activeCompany.current=companyId
  const [providers, setProviders] = useState<readonly ProviderView[]>([])
  const [saved, setSaved] = useState<ClassificationModelSettings>(EMPTY_SETTINGS)
  const [draft, setDraft] = useState<ClassificationModelSettings>(EMPTY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [issues, setIssues] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSaving(false);setTesting(false);setIssues([]);setProviders([])
    setError(null)
    Promise.all([api.providers(companyId), api.classificationModelSettings(companyId)])
      .then(([providerResponse, response]) => {
        if (cancelled) return
        setProviders(providerResponse.providers)
        setSaved(response.settings)
        setDraft({ ...response.settings, fallbackModelFks: [...response.settings.fallbackModelFks] })
        setIssues(response.issues)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof ApiError ? cause.message : t('settings.knowledgeModel.loadFailed'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [companyId, t, loadAttempt])

  const models = useMemo<readonly ModelOptionView[]>(
    () => providers.filter((provider) => provider.enabled).flatMap((provider) => provider.models.filter((model) => model.enabled)),
    [providers],
  )
  const changed = draft.mode !== saved.mode || draft.modelFk !== saved.modelFk ||
    draft.fallbackModelFks.length !== saved.fallbackModelFks.length ||
    draft.fallbackModelFks.some((id, index) => id !== saved.fallbackModelFks[index])

  function updateFallback(index: number, modelFk: string): void {
    const next = [...draft.fallbackModelFks]
    if (modelFk) next[index] = modelFk
    else next.splice(index, 1)
    setDraft({ ...draft, fallbackModelFks: next })
  }

  async function save(): Promise<void> {
    if (!changed || (draft.mode === 'custom' && (!draft.modelFk || draft.fallbackModelFks.some((id) => !id)))) return
    const finish = begin('knowledgeModel.save')
    const requestCompany = companyId
    setSaving(true)
    try {
      const response = await api.saveClassificationModelSettings(requestCompany, draft)
      if (activeCompany.current === requestCompany) {
        setSaved(response.settings)
        setDraft({ ...response.settings, fallbackModelFks: [...response.settings.fallbackModelFks] })
        setIssues(response.issues)
      }
      finish(response.issues.length > 0 ? 'warning' : 'success')
    } catch {
      finish('error')
    } finally { if (activeCompany.current === requestCompany) setSaving(false) }
  }

  async function test(): Promise<void> {
    const finish = begin('knowledgeModel.test')
    const requestCompany = companyId
    setTesting(true)
    try {
      const result = await api.testClassificationModelSettings(requestCompany)
      finish(result.ok ? 'success' : 'error')
    } catch {
      finish('error')
    } finally { if (activeCompany.current === requestCompany) setTesting(false) }
  }

  return (
    <Card tieuDe={t('settings.knowledgeModel.title')} phu={t('settings.knowledgeModel.subtitle')}>
      {loading ? <DangTai nhan={t('common.loading')} /> : <>
        {error ? <><ThongBao loai="loi">{error}</ThongBao><Nut bien="phu" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t('common.retry')}</Nut></> : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <Truong nhan={t('settings.knowledgeModel.mode')}>
            <OChon value={draft.mode} onChange={(value) => { setDraft({ ...draft, mode: value as 'leader' | 'custom' }) }} options={[
              { value: 'leader', label: t('settings.knowledgeModel.modeLeader') },
              { value: 'custom', label: t('settings.knowledgeModel.modeCustom') },
            ]} />
          </Truong>
          {draft.mode === 'custom' ? <>
            <Truong nhan={t('settings.knowledgeModel.primary')}>
              <OChon value={draft.modelFk ?? ''} onChange={(value) => { setDraft({ ...draft, modelFk: value || null, fallbackModelFks: draft.fallbackModelFks.filter((id) => id !== value) }) }} options={[
                { value: '', label: t('settings.knowledgeModel.chooseModel') },
                ...models.filter((model) => !draft.fallbackModelFks.includes(model.id)).map((model) => ({ value: model.id, label: `${model.providerName} · ${model.label} (${model.modelId})` })),
              ]} />
            </Truong>
            {draft.fallbackModelFks.map((id, index) => <Truong key={`${index}-${id}`} nhan={t('settings.knowledgeModel.fallback', { number: index + 1 })}>
              <OChon value={id} onChange={(value) => updateFallback(index, value)} options={[
                { value: '', label: t('settings.knowledgeModel.chooseModel') },
                ...models.filter((model) => model.id === id || (model.id !== draft.modelFk && !draft.fallbackModelFks.some((other, i) => i !== index && other === model.id))).map((model) => ({ value: model.id, label: `${model.providerName} · ${model.label} (${model.modelId})` })),
              ]} />
            </Truong>)}
            {draft.fallbackModelFks.length < 3 ? <div style={{ alignSelf: 'end' }}><Nut bien="phu" nho disabled={models.length === 0} onClick={() => { setDraft({ ...draft, fallbackModelFks: [...draft.fallbackModelFks, ''] }) }}>{t('settings.knowledgeModel.addFallback')}</Nut></div> : null}
          </> : null}
        </div>
        <p className="card__phu" style={{ marginTop: 12 }}>{t('settings.knowledgeModel.costWarning')}</p>
        {issues.map((issue, index) => <ThongBao key={`${index}-${issue}`} loai="canh-bao">{issue}</ThongBao>)}
        <div className="hang" style={{ marginTop: 12 }}>
          <Nut onClick={() => void save()} dangTai={saving} disabled={!changed || (draft.mode === 'custom' && (!draft.modelFk || draft.fallbackModelFks.some((id) => !id)))}>{t('settings.knowledgeModel.save')}</Nut>
          <Nut bien="phu" onClick={() => void test()} dangTai={testing} disabled={changed}>{t('settings.knowledgeModel.test')}</Nut>
        </div>
      </>}
    </Card>
  )
}

export default KnowledgeModelSettings
