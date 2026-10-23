import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CampaignLoopResponse, CampaignView } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { useSession } from '../lib/session.tsx'
import { Card, DangTai, Nhan, Nut, OChon, ONhap, OVanBan, ThongBao, TieuDeTrang, Trang } from '../components/ui.tsx'

const TIMEZONES = ['Asia/Ho_Chi_Minh', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'America/New_York', 'America/Los_Angeles']

export function CampaignLoop({ companyId }: { companyId: string }): ReactNode {
  const { t, translateError, formatDateTime, formatNumber } = useI18n()
  const { selectCompany } = useSession()
  const [data, setData] = useState<CampaignLoopResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [campaignName, setCampaignName] = useState('')
  const [campaignTimezone, setCampaignTimezone] = useState('Asia/Ho_Chi_Minh')
  const [channel, setChannel] = useState<'meta' | 'linkedin' | 'email'>('meta')
  const [content, setContent] = useState('')
  const [schedule, setSchedule] = useState('')
  const [audienceId, setAudienceId] = useState('')
  const [audienceName, setAudienceName] = useState('')
  const [csv, setCsv] = useState('')
  const [selectedAudience, setSelectedAudience] = useState('')
  const [policy, setPolicy] = useState<CampaignLoopResponse['policy'] | null>(null)
  const [agencyClients, setAgencyClients] = useState<{ id: string; name: string; queuedJobs: number; activeCampaigns: number }[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<{ id: string; attempt: number; status: string; error: string | null; startedAt: string; finishedAt: string | null }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.campaignLoop(companyId)
      setData(result)
      setPolicy(result.policy)
      setAudienceId((current) => current || result.audiences[0]?.id || '')
      setSelectedAudience((current) => current || result.audiences[0]?.id || '')
    } catch (caught) {
      setError(translateError(caught))
    } finally {
      setLoading(false)
    }
  }, [companyId, translateError])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    let cancelled = false
    void api.agencies().then(async ({ agencies }) => {
      const first = agencies[0]
      if (!first) return
      const portfolio = await api.agency(first.id)
      if (!cancelled) setAgencyClients(portfolio.clients.map((client) => ({ id: client.id, name: client.name, queuedJobs: client.queuedJobs, activeCampaigns: client.activeCampaigns })))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [companyId])

  const campaigns = data?.campaigns ?? []
  const audiences = data?.audiences ?? []
  const jobs = data?.jobs ?? []
  const metrics = data?.metrics ?? []

  async function savePolicy(): Promise<void> {
    if (!policy || saving) return
    setSaving(true)
    setError(null)
    try {
      const result = await api.updateAutomationPolicy(companyId, {
        enabled: policy.enabled,
        timezone: policy.timezone,
        channels: policy.channels,
        maxPostsPerDay: policy.maxPostsPerDay,
        maxEmailsPerDay: policy.maxEmailsPerDay,
        quietStart: policy.quietStart,
        quietEnd: policy.quietEnd,
        killSwitch: policy.killSwitch,
      })
      setPolicy(result.policy)
      setNotice(t('common.saved'))
    } catch (caught) {
      setError(translateError(caught))
    } finally {
      setSaving(false)
    }
  }

  async function createCampaign(): Promise<void> {
    if (!campaignName.trim() || !content.trim() || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.createCampaign(companyId, {
        name: campaignName.trim(),
        timezone: campaignTimezone,
        items: [{ channel, title: channel === 'email' ? campaignName.trim() : campaignName.trim(), content: content.trim(), scheduledAt: schedule.trim() || null, audienceId: channel === 'email' ? (audienceId || null) : null }],
      })
      setCampaignName('')
      setContent('')
      setSchedule('')
      setNotice(t('common.saved'))
      await load()
    } catch (caught) {
      setError(translateError(caught))
    } finally {
      setSaving(false)
    }
  }

  async function campaignAction(campaign: CampaignView, action: 'activate' | 'pause' | 'resume'): Promise<void> {
    if (saving) return
    setSaving(true)
    try {
      await api.campaignAction(companyId, campaign.id, action)
      await load()
    } catch (caught) {
      setError(translateError(caught))
    } finally {
      setSaving(false)
    }
  }

  async function createAudience(): Promise<void> {
    if (!audienceName.trim() || saving) return
    setSaving(true)
    try {
      await api.createAudience(companyId, audienceName.trim())
      setAudienceName('')
      await load()
    } catch (caught) {
      setError(translateError(caught))
    } finally {
      setSaving(false)
    }
  }

  async function importCsv(): Promise<void> {
    if (!selectedAudience || !csv.trim() || saving) return
    setSaving(true)
    try {
      const result = await api.importAudienceCsv(companyId, selectedAudience, { csv, source: 'campaign-loop-csv', consentVersion: 'v1', consentAt: new Date().toISOString() })
      setNotice(t('campaign.importResult', result.result))
      setCsv('')
      await load()
    } catch (caught) {
      setError(translateError(caught))
    } finally {
      setSaving(false)
    }
  }

  async function showAttempts(jobId: string): Promise<void> {
    setSelectedJobId(jobId)
    try {
      setAttempts((await api.jobAttempts(companyId, jobId)).attempts)
    } catch (caught) {
      setError(translateError(caught))
    }
  }

  const policyChannels = useMemo(() => new Set(policy?.channels ?? []), [policy?.channels])

  if (loading && !data) return <Trang rong><DangTai nhan={t('common.loadingData')} /></Trang>

  return (
    <Trang rong>
      <div className="dashboard">
        <header className="dashboard__header">
          <div><TieuDeTrang moTa={t('campaign.subtitle')}>{t('campaign.title')}</TieuDeTrang></div>
          <Nut bien="phu" onClick={() => void load()} dangTai={loading}>{t('campaign.refresh')}</Nut>
        </header>
        {error ? <ThongBao loai="loi">{error}</ThongBao> : null}
        {notice ? <ThongBao loai="thanh-cong">{notice}</ThongBao> : null}

        <div className="dashboard__overview">
          <Card tieuDe={t('campaign.policy')} phu={t('campaign.policyHint')}>
            {policy ? <div className="cot">
              <label><input type="checkbox" checked={policy.enabled} onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })} /> {policy.enabled ? t('campaign.enabled') : t('campaign.disabled')}</label>
              <label><input type="checkbox" checked={policy.killSwitch} onChange={(event) => setPolicy({ ...policy, killSwitch: event.target.checked })} /> {t('campaign.killSwitch')} {policy.killSwitch ? `— ${t('campaign.killSwitchOn')}` : ''}</label>
              <OChon value={policy.timezone} onChange={(value) => setPolicy({ ...policy, timezone: value })} options={TIMEZONES.map((value) => ({ value, label: value }))} />
              <div className="hang">
                <TruongSo label={t('campaign.postsPerDay')} value={policy.maxPostsPerDay} onChange={(value) => setPolicy({ ...policy, maxPostsPerDay: value })} />
                <TruongSo label={t('campaign.emailsPerDay')} value={policy.maxEmailsPerDay} onChange={(value) => setPolicy({ ...policy, maxEmailsPerDay: value })} />
              </div>
              <div className="hang">
                <ONhap value={policy.quietStart ?? ''} onChange={(value) => setPolicy({ ...policy, quietStart: value || null })} placeholder={t('campaign.quietStart')} />
                <ONhap value={policy.quietEnd ?? ''} onChange={(value) => setPolicy({ ...policy, quietEnd: value || null })} placeholder={t('campaign.quietEnd')} />
              </div>
              <ONhap value={policy.allowedHosts.join(', ')} onChange={(value) => setPolicy({ ...policy, allowedHosts: value.split(',').map((host) => host.trim()).filter(Boolean) })} placeholder={t('campaign.allowedHosts')} />
              <div className="hang" style={{ justifyContent: 'space-between' }}>
                <span>{t('campaign.channel')}: {[...policyChannels].join(', ')}</span>
                <Nut onClick={() => void savePolicy()} dangTai={saving}>{t('campaign.savePolicy')}</Nut>
              </div>
            </div> : null}
          </Card>

          <Card tieuDe={t('campaign.create')}>
            <div className="cot">
              <ONhap value={campaignName} onChange={setCampaignName} placeholder={t('campaign.name')} />
              <OChon value={campaignTimezone} onChange={setCampaignTimezone} options={TIMEZONES.map((value) => ({ value, label: value }))} />
              <OChon value={channel} onChange={(value) => setChannel(value as typeof channel)} options={[{ value: 'meta', label: 'Meta' }, { value: 'linkedin', label: 'LinkedIn' }, { value: 'email', label: 'Email' }]} />
              {channel === 'email' ? <OChon value={audienceId} onChange={setAudienceId} options={[{ value: '', label: t('common.none') }, ...audiences.map((audience) => ({ value: audience.id, label: `${audience.name} (${audience.optedInCount})` }))]} /> : null}
              <ONhap value={schedule} onChange={setSchedule} placeholder={t('campaign.schedule')} />
              <OVanBan value={content} onChange={setContent} rows={5} placeholder={t('campaign.content')} />
              <Nut onClick={() => void createCampaign()} dangTai={saving}>{t('campaign.create')}</Nut>
            </div>
          </Card>
        </div>

        <div className="dashboard__overview">
          {agencyClients.length > 0 ? <Card tieuDe={t('campaign.agencyClients')}>
            {agencyClients.map((client) => <div className="hang" key={client.id} style={{ justifyContent: 'space-between' }}><span>{client.name}</span><span><Nhan loai={client.id === companyId ? 'thanh-cong' : 'mo'}>{client.activeCampaigns} active · {client.queuedJobs} queued</Nhan> <Nut nho bien="phu" onClick={() => selectCompany(client.id)}>{client.id === companyId ? t('common.yes') : t('campaign.openClient')}</Nut></span></div>)}
          </Card> : null}
          <Card tieuDe={t('campaign.audiences')} phu={t('campaign.emailHint')}>
            <div className="hang"><ONhap value={audienceName} onChange={setAudienceName} placeholder={t('campaign.audienceName')} /><Nut onClick={() => void createAudience()}>{t('campaign.createAudience')}</Nut></div>
            {audiences.map((audience) => <div className="hang" key={audience.id} style={{ justifyContent: 'space-between' }}><span>{audience.name}</span><Nhan loai="mo">{formatNumber(audience.optedInCount)} opt-in / {formatNumber(audience.contactCount)}</Nhan></div>)}
            {audiences.length > 0 ? <><OChon value={selectedAudience} onChange={setSelectedAudience} options={audiences.map((audience) => ({ value: audience.id, label: audience.name }))} /><OVanBan value={csv} onChange={setCsv} rows={4} placeholder="email,name,source,consent_at,consent_version" /><Nut bien="phu" onClick={() => void importCsv()}>{t('campaign.importCsv')}</Nut></> : null}
          </Card>
          <Card tieuDe={t('campaign.jobs')}>
            {jobs.length === 0 ? <p>{t('common.emptySection')}</p> : jobs.slice(0, 12).map((job) => <div className="hang" key={job.id} style={{ justifyContent: 'space-between' }}><span>{job.campaignItemId.slice(0, 12)}</span><span><Nhan loai={job.status === 'accepted' ? 'thanh-cong' : job.status === 'failed' ? 'loi' : 'mo'}>{job.status} · {formatDateTime(job.runAt)}</Nhan> <Nut nho bien="phu" onClick={() => void showAttempts(job.id)}>{t('campaign.attempts')}</Nut></span></div>)}
            {selectedJobId ? <div style={{ marginTop: 10 }}><strong>{t('campaign.attempts')}</strong>{attempts.map((attempt) => <div className="hang" key={attempt.id}><Nhan loai={attempt.status === 'accepted' ? 'thanh-cong' : attempt.status === 'failed' ? 'loi' : 'mo'}>{attempt.attempt}</Nhan><span>{attempt.status} · {attempt.error ?? ''}</span></div>)}</div> : null}
          </Card>
        </div>

        <Card tieuDe={t('campaign.title')}>
          {campaigns.length === 0 ? <p>{t('campaign.empty')}</p> : campaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} onAction={campaignAction} saving={saving} />)}
        </Card>
        <Card tieuDe={t('campaign.metrics')}>
          {metrics.length === 0 ? <p>{t('common.emptySection')}</p> : metrics.slice(0, 12).map((metric) => <div className="hang" key={metric.id} style={{ justifyContent: 'space-between' }}><span>{metric.channel} · {metric.metricDate}</span><code>{JSON.stringify(metric.metrics)}</code></div>)}
        </Card>
      </div>
    </Trang>
  )
}

function CampaignCard({ campaign, onAction, saving }: { campaign: CampaignView; onAction: (campaign: CampaignView, action: 'activate' | 'pause' | 'resume') => void; saving: boolean }): ReactNode {
  const { t, formatDateTime } = useI18n()
  const action = campaign.status === 'draft' ? 'activate' : campaign.status === 'paused' ? 'resume' : 'pause'
  return <article className="card" data-campaign-id={campaign.id}>
    <div className="hang" style={{ justifyContent: 'space-between' }}><div><h3 className="card__tieu-de">{campaign.name}</h3><p className="card__phu">{campaign.timezone} · {campaign.status}</p></div><Nut bien={action === 'pause' ? 'nguy-hiem' : 'chinh'} nho disabled={campaign.status === 'completed'} dangTai={saving} onClick={() => onAction(campaign, action)}>{t(`campaign.${action}` as never)}</Nut></div>
    {campaign.items.map((item) => <div key={item.id} style={{ borderTop: '1px solid var(--mau-vien)', paddingTop: 8, marginTop: 8 }}><div className="hang" style={{ justifyContent: 'space-between' }}><Nhan>{item.channel}</Nhan><span>{item.scheduledAt ? formatDateTime(item.scheduledAt) : t('common.none')}</span></div><p style={{ whiteSpace: 'pre-wrap' }}>{item.content}</p></div>)}
  </article>
}

function TruongSo({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }): ReactNode {
  return <label className="truong" style={{ flex: 1 }}><span className="nhan">{label}</span><input className="o-nhap" type="number" min={0} value={value} onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} /></label>
}

