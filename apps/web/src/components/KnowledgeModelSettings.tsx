import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ModelOptionView, ProviderView } from '@marketing-agent/shared'
import { ApiError, api, type ClassificationModelSettings } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { Card, DangTai, Nut, OChon, ThongBao, Truong } from './ui.tsx'

const EMPTY_SETTINGS: ClassificationModelSettings = { mode: 'leader', modelFk: null, fallbackModelFks: [] }

/** Model selection for automatic company knowledge classification. */
export function KnowledgeModelSettings({ companyId }: { companyId: string }): ReactNode {
  const { t } = useI18n()
  const activeCompany=useRef(companyId)
  activeCompany.current=companyId
  const [providers, setProviders] = useState<readonly ProviderView[]>([])
  const [saved, setSaved] = useState<ClassificationModelSettings>(EMPTY_SETTINGS)
  const [draft, setDraft] = useState<ClassificationModelSettings>(EMPTY_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setSaving(false);setTesting(false);setIssues([]);setProviders([])
    setError(null)
    setNotice(null)
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
  }, [companyId, t])

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
    setNotice(null)
  }

  async function save(): Promise<void> {
    setSaving(true); setError(null); setNotice(null)
    try {
      const requestCompany = companyId
      const response = await api.saveClassificationModelSettings(requestCompany, draft)
      if (activeCompany.current !== requestCompany) return
      setSaved(response.settings)
      setDraft({ ...response.settings, fallbackModelFks: [...response.settings.fallbackModelFks] })
      setIssues(response.issues)
      setNotice(t('settings.knowledgeModel.saved'))
    } catch (cause) {
      if (activeCompany.current === companyId) setError(cause instanceof ApiError ? cause.message : t('settings.knowledgeModel.saveFailed'))
    } finally { if (activeCompany.current === companyId) setSaving(false) }
  }

  async function test(): Promise<void> {
    const requestCompany = companyId
    setTesting(true); setError(null); setNotice(null)
    try {
      const result = await api.testClassificationModelSettings(requestCompany)
      if (activeCompany.current !== requestCompany) return
      if (result.ok) setNotice(result.message)
      else setError(result.message)
    } catch (cause) {
      if (activeCompany.current === requestCompany) setError(cause instanceof ApiError ? cause.message : t('settings.knowledgeModel.testFailed'))
    } finally { if (activeCompany.current === requestCompany) setTesting(false) }
  }

  return (
    <Card tieuDe={t('settings.knowledgeModel.title')} phu={t('settings.knowledgeModel.subtitle')}>
      {loading ? <DangTai nhan={t('common.loading')} /> : <>
        {error ? <ThongBao loai="loi">{error}</ThongBao> : null}
        {notice ? <ThongBao loai="thanh-cong">{notice}</ThongBao> : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <Truong nhan={t('settings.knowledgeModel.mode')}>
            <OChon value={draft.mode} onChange={(value) => { setDraft({ ...draft, mode: value as 'leader' | 'custom' }); setNotice(null) }} options={[
              { value: 'leader', label: t('settings.knowledgeModel.modeLeader') },
              { value: 'custom', label: t('settings.knowledgeModel.modeCustom') },
            ]} />
          </Truong>
          {draft.mode === 'custom' ? <>
            <Truong nhan={t('settings.knowledgeModel.primary')}>
              <OChon value={draft.modelFk ?? ''} onChange={(value) => { setDraft({ ...draft, modelFk: value || null, fallbackModelFks: draft.fallbackModelFks.filter((id) => id !== value) }); setNotice(null) }} options={[
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
            {draft.fallbackModelFks.length < 3 ? <div style={{ alignSelf: 'end' }}><Nut bien="phu" nho disabled={models.length === 0} onClick={() => { setDraft({ ...draft, fallbackModelFks: [...draft.fallbackModelFks, ''] }); setNotice(null) }}>{t('settings.knowledgeModel.addFallback')}</Nut></div> : null}
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
