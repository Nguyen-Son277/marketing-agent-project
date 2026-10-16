import { useEffect, useRef, useState } from 'react'
import type { ModelOptionView } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import { parseModelPricing } from '../lib/model-pricing.ts'
import { useI18n } from '../lib/i18n.tsx'
import { useSettingsNotifications } from '../lib/settings-notifications.ts'
import { HopThoai, HopThoaiXacNhan } from './HopThoai.tsx'
import { Nut, ThongBao } from './ui.tsx'

export function ModelPricingDialog({ companyId, model, onClose, onSaved }: {
  companyId: string
  model: ModelOptionView
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const { begin } = useSettingsNotifications(companyId)
  const [input, setInput] = useState(String(model.costInPerMtok))
  const [output, setOutput] = useState(String(model.costOutPerMtok))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const lock = useRef(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])

  async function save(reset: boolean) {
    if (lock.current) return
    const prices = reset ? { costInPerMtok: 0, costOutPerMtok: 0 } : parseModelPricing(input, output)
    if (!prices) { setError(t('settings.models.pricing.invalid')); return }
    lock.current = true
    setBusy(true)
    setError(null)
    const finish = begin('model.save')
    try {
      await api.updateModelPricing(companyId, model.id, prices)
      finish('success')
      if (active.current) { onSaved(); onClose() }
    } catch (cause) {
      finish('error')
      if (active.current) {
        setConfirmReset(false)
        setError(cause instanceof ApiError ? cause.message : t('common.cannotConnectServer'))
      }
    } finally {
      lock.current = false
      if (active.current) setBusy(false)
    }
  }

  return <>
    <HopThoai mo tieuDe={t('settings.models.pricing.title')} onDong={() => { if (!lock.current) onClose() }}
      chanDung={<>
        <Nut nho bien="nguy-hiem" disabled={busy} onClick={() => setConfirmReset(true)}>{t('settings.models.pricing.reset')}</Nut>
        <Nut nho bien="phu" disabled={busy} onClick={onClose}>{t('common.cancel')}</Nut>
        <Nut nho dangTai={busy} onClick={() => void save(false)}>{t('settings.models.pricing.save')}</Nut>
      </>}>
      <div className="cot" style={{ gap: 12 }}>
        <strong>{model.label} · {model.providerName}</strong>
        <p className="card__phu">{t('settings.models.pricing.hint')}</p>
        {error ? <ThongBao loai="loi">{error}</ThongBao> : null}
        <label className="cot">{t('settings.models.pricing.input')}
          <input className="o-nhap" inputMode="decimal" value={input} disabled={busy} onChange={e => setInput(e.target.value)} />
        </label>
        <label className="cot">{t('settings.models.pricing.output')}
          <input className="o-nhap" inputMode="decimal" value={output} disabled={busy} onChange={e => setOutput(e.target.value)} />
        </label>
      </div>
    </HopThoai>
    <HopThoaiXacNhan mo={confirmReset} tieuDe={t('settings.models.pricing.reset')}
      moTa={t('settings.models.pricing.resetConfirm', { name: model.label })}
      nhanXacNhan={t('settings.models.pricing.reset')} dangXuLy={busy}
      onHuy={() => { if (!lock.current) setConfirmReset(false) }} onXacNhan={() => void save(true)} />
  </>
}
