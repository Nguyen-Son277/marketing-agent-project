import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  SOCIAL_PLATFORMS,
  type BrowserChannelView,
  type BrowserContentView,
  type BrowserDesktopView,
  type BrowserHumanInput,
  type BrowserJobEvent,
  type BrowserJobView,
  type BrowserOverview,
} from '@marketing-agent/shared'
import { request } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { Card, Nut, Trang, TieuDeTrang } from '../components/ui.tsx'

const TABS = ['desktops', 'channels', 'contents', 'jobs'] as const
const URLS: Record<string, { url: string; hosts: string }> = {
  facebook: { url: 'https://www.facebook.com/', hosts: 'facebook.com' },
  tiktok: { url: 'https://www.tiktok.com/tiktokstudio/upload', hosts: 'tiktok.com' },
  linkedin: { url: 'https://www.linkedin.com/feed/', hosts: 'linkedin.com' },
  youtube: { url: 'https://studio.youtube.com/', hosts: 'youtube.com' },
  x: { url: 'https://x.com/compose/post', hosts: 'x.com' },
  reddit: { url: 'https://www.reddit.com/submit', hosts: 'reddit.com' },
  threads: { url: 'https://www.threads.com/', hosts: 'threads.com, threads.net' },
  other: { url: '', hosts: '' },
}
type Perform = (work: () => Promise<void>) => Promise<void>
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }): ReactNode {
  return (
    <label className="truong">
      <span className="nhan">{label}</span>
      {children}
      {hint ? <small className="chu-mo">{hint}</small> : null}
    </label>
  )
}
function Input({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
  hint?: string
}): ReactNode {
  const id = useId()
  return (
    <div className="truong">
      <label className="nhan" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        aria-label={label}
        className="o-nhap"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
      {hint ? <small className="chu-mo">{hint}</small> : null}
    </div>
  )
}
function TextArea({
  label,
  value,
  onChange,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
}): ReactNode {
  const id = useId()
  return (
    <div className="truong">
      <label className="nhan" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="o-nhap"
        rows={5}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <small className="chu-mo">{hint}</small> : null}
    </div>
  )
}

function normalizeRemoteUrl(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(candidate)
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      /[\s%]/.test(parsed.hostname) ||
      parsed.username ||
      parsed.password ||
      parsed.href.length > 2000
    ) return undefined
    return parsed.href
  } catch {
    return undefined
  }
}

export function TrinhDuyetXaHoi({ companyId }: { companyId: string }): ReactNode {
  const { t } = useI18n(),
    base = `/api/companies/${encodeURIComponent(companyId)}/social-browser`
  const [tab, setTab] = useState<(typeof TABS)[number]>('desktops'),
    [data, setData] = useState<BrowserOverview | null>(null)
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [remote, setRemote] = useState<string | null>(null)
  const alive = useRef(true),
    inFlight = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const reload = useCallback(async () => {
    const next = await request<BrowserOverview>(base)
    if (alive.current) setData(next)
  }, [base])
  useEffect(() => {
    void reload().catch((e) => {
      if (alive.current) setError(e.message)
    })
  }, [reload])
  useEffect(() => {
    if (!data?.jobs.some((j) => j.status === 'running')) return
    let stopped = false
    const timer = window.setInterval(() => {
      void request<{ jobs: BrowserJobView[] }>(`${base}/jobs`)
        .then((next) => {
          if (!stopped) setData((old) => (old ? { ...old, jobs: next.jobs } : old))
        })
        .catch(() => {})
    }, 3000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [base, data?.jobs.some((j) => j.status === 'running')])
  const perform: Perform = async (work) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await work()
      await reload()
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e))
      // A create-and-run or multi-file upload may have succeeded partially.
      await reload().catch(() => {})
    } finally {
      inFlight.current = false
      if (alive.current) setBusy(false)
    }
  }
  return (
    <Trang rong>
      <TieuDeTrang moTa={t('browser.subtitle')}>{t('browser.title')}</TieuDeTrang>
      {error ? (
        <div className="thong-bao thong-bao--loi" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {data && !data.canManage ? <p>{t('browser.readOnly')}</p> : null}
      <div className="browser-tabs" role="tablist" aria-label={t('browser.title')}>
        {TABS.map((item, index) => (
          <button
            key={item}
            id={`browser-tab-${item}`}
            role="tab"
            className={tab === item ? 'btn' : 'btn btn--phu'}
            aria-selected={tab === item}
            tabIndex={tab === item ? 0 : -1}
            aria-controls={`browser-panel-${item}`}
            onClick={() => setTab(item)}
            onKeyDown={(e) => {
              const next =
                e.key === 'ArrowRight'
                  ? (index + 1) % TABS.length
                  : e.key === 'ArrowLeft'
                    ? (index + TABS.length - 1) % TABS.length
                    : e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? TABS.length - 1
                        : -1
              if (next < 0) return
              e.preventDefault()
              setTab(TABS[next]!)
              document.getElementById(`browser-tab-${TABS[next]}`)?.focus()
            }}
          >
            {t(`browser.${item}`)}
          </button>
        ))}
        <Nut
          bien="phu"
          disabled={busy}
          onClick={() => {
            void perform(reload)
          }}
        >
          {t('common.refresh')}
        </Nut>
      </div>
      {!data ? (
        <p>{t('common.loading')}</p>
      ) : (
        <section role="tabpanel" id={`browser-panel-${tab}`} aria-labelledby={`browser-tab-${tab}`}>
          {tab === 'desktops' ? (
            <Desktops
              data={data}
              base={base}
              busy={busy}
              perform={perform}
              notice={setNotice}
              remote={setRemote}
            />
          ) : null}
          {tab === 'channels' ? <Channels data={data} base={base} busy={busy} perform={perform} /> : null}
          {tab === 'contents' ? <Contents data={data} base={base} busy={busy} perform={perform} /> : null}
          {tab === 'jobs' ? <Jobs data={data} base={base} busy={busy} perform={perform} /> : null}
        </section>
      )}
      {remote && data ? (
        <RemoteDesktop
          key={remote}
          base={base}
          desktop={data.desktops.find((d) => d.id === remote)!}
          onClose={() => setRemote(null)}
        />
      ) : null}
    </Trang>
  )
}

function Desktops({
  data,
  base,
  busy,
  perform,
  notice,
  remote,
}: {
  data: BrowserOverview
  base: string
  busy: boolean
  perform: Perform
  notice: (s: string) => void
  remote: (s: string) => void
}): ReactNode {
  const { t } = useI18n()
  const [name, setName] = useState(''),
    [endpoint, setEndpoint] = useState('http://127.0.0.1:4090'),
    [token, setToken] = useState(''),
    [region, setRegion] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <>
      <p>{t('browser.desktopHelp')}</p>
      <div className="browser-grid">
        {data.desktops.map((d) => (
          <Card key={d.id} tieuDe={d.name} phu={`${d.region} · ${t(`browser.${d.mode}`)}`}>
            <p className="browser-url">{d.endpoint}</p>
            {data.canManage ? (
              <div className="hang browser-actions">
                <Nut
                  bien="phu"
                  disabled={busy}
                  onClick={() => {
                    setEditing(d.id)
                    setName(d.name)
                    setEndpoint(d.endpoint)
                    setRegion(d.region)
                    setToken('')
                  }}
                >
                  {t('common.edit')}
                </Nut>
                <Nut
                  bien="phu"
                  disabled={busy}
                  onClick={() => {
                    void perform(async () => {
                      await request(`${base}/desktops/${d.id}/test`, { method: 'POST' })
                      notice(t('browser.connected'))
                    })
                  }}
                >
                  {t('browser.test')}
                </Nut>
                <Nut
                  disabled={busy}
                  onClick={() => {
                    void perform(async () => {
                      await request(`${base}/desktops/${d.id}/mode`, {
                        method: 'POST',
                        body: { mode: 'human' },
                      })
                      remote(d.id)
                    })
                  }}
                >
                  {t('browser.takeover')}
                </Nut>
                <Nut
                  bien="phu"
                  disabled={busy || d.mode === 'agent'}
                  onClick={() => {
                    void perform(async () => {
                      await request(`${base}/desktops/${d.id}/mode`, {
                        method: 'POST',
                        body: { mode: 'agent' },
                      })
                    })
                  }}
                >
                  {t('browser.allowAgent')}
                </Nut>
                <Nut
                  bien="phu"
                  disabled={busy || d.mode === 'paused'}
                  onClick={() => {
                    void perform(async () => {
                      await request(`${base}/desktops/${d.id}/mode`, {
                        method: 'POST',
                        body: { mode: 'paused' },
                      })
                    })
                  }}
                >
                  {t('browser.pause')}
                </Nut>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      {data.canManage ? (
        <Card tieuDe={t(editing ? 'browser.editDesktop' : 'browser.addDesktop')}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void perform(async () => {
                await request(`${base}/desktops${editing ? `/${editing}` : ''}`, {
                  method: editing ? 'PATCH' : 'POST',
                  body: { name, endpoint, ...(token ? { token } : {}), region },
                })
                setEditing(null)
                setName('')
                setToken('')
                setRegion('')
              })
            }}
          >
            <div className="browser-grid">
              <Input label={t('browser.name')} value={name} onChange={setName} required />
              <Input label={t('browser.region')} value={region} onChange={setRegion} required />
            </div>
            <Input
              label={t('browser.endpoint')}
              value={endpoint}
              onChange={setEndpoint}
              type="url"
              required
            />
            <Input
              label={t('browser.token')}
              value={token}
              onChange={setToken}
              type="password"
              required={!editing}
              hint={t(editing ? 'browser.keepToken' : 'browser.tokenHelp')}
            />
            <div className="hang browser-actions">
              <Nut type="submit" disabled={busy}>
                {t(editing ? 'common.save' : 'browser.addDesktop')}
              </Nut>
              {editing ? (
                <Nut
                  bien="phu"
                  onClick={() => {
                    setEditing(null)
                    setName('')
                    setToken('')
                    setRegion('')
                  }}
                >
                  {t('common.cancel')}
                </Nut>
              ) : null}
            </div>
          </form>
        </Card>
      ) : null}
    </>
  )
}

function Channels({
  data,
  base,
  busy,
  perform,
}: {
  data: BrowserOverview
  base: string
  busy: boolean
  perform: Perform
}): ReactNode {
  const { t } = useI18n()
  const [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(''),
    [desktopId, setDesktop] = useState(data.desktops[0]?.id ?? '')
  const [platform, setPlatform] = useState('facebook'),
    [url, setUrl] = useState(URLS.facebook!.url),
    [hosts, setHosts] = useState(URLS.facebook!.hosts),
    [instructions, setInstructions] = useState(''),
    [canPost, setCanPost] = useState(true)
  function edit(c: BrowserChannelView) {
    setEditing(c.id)
    setName(c.name)
    setDesktop(c.desktopId)
    setPlatform(c.platform)
    setUrl(c.entryUrl)
    setHosts(c.allowedHosts.join(', '))
    setInstructions(c.instructions)
    setCanPost(c.canPost)
  }
  return (
    <>
      <div className="browser-grid">
        {data.channels.map((c) => (
          <Card
            key={c.id}
            tieuDe={c.name}
            phu={`${c.platform} · ${data.desktops.find((d) => d.id === c.desktopId)?.name ?? ''}`}
          >
            <a className="browser-url" href={c.entryUrl} target="_blank" rel="noreferrer">
              {c.entryUrl}
            </a>
            <p>{c.canPost ? t('browser.publish') : t('browser.read')}</p>
            <p className="browser-pre">{c.instructions}</p>
            {data.canManage ? (
              <Nut bien="phu" onClick={() => edit(c)}>
                {t('common.edit')}
              </Nut>
            ) : null}
          </Card>
        ))}
      </div>
      {data.canManage ? (
        <Card tieuDe={t(editing ? 'browser.editChannel' : 'browser.addChannel')}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void perform(async () => {
                await request(`${base}/channels${editing ? `/${editing}` : ''}`, {
                  method: editing ? 'PATCH' : 'POST',
                  body: {
                    desktopId,
                    name,
                    platform,
                    entryUrl: url,
                    allowedHosts: hosts
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                    instructions,
                    canPost,
                  },
                })
                setEditing(null)
                setName('')
                setInstructions('')
              })
            }}
          >
            <Input label={t('browser.name')} value={name} onChange={setName} required />
            <div className="browser-grid">
              <Field label={t('browser.desktop')}>
                <select
                  aria-label={t('browser.desktop')}
                  className="o-chon"
                  value={desktopId}
                  onChange={(e) => setDesktop(e.target.value)}
                  required
                >
                  <option value="">{t('browser.select')}</option>
                  {data.desktops.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('browser.platform')}>
                <select
                  aria-label={t('browser.platform')}
                  className="o-chon"
                  value={platform}
                  onChange={(e) => {
                    setPlatform(e.target.value)
                    setUrl(URLS[e.target.value]!.url)
                    setHosts(URLS[e.target.value]!.hosts)
                  }}
                >
                  {SOCIAL_PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p === 'other' ? t('browser.other') : p}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Input label={t('browser.entryUrl')} value={url} onChange={setUrl} type="url" required />
            <Input label={t('browser.hosts')} value={hosts} onChange={setHosts} required />
            <TextArea
              label={t('browser.playbook')}
              value={instructions}
              onChange={setInstructions}
              hint={t('browser.playbookHint')}
            />
            <label className="browser-check">
              <input type="checkbox" checked={canPost} onChange={(e) => setCanPost(e.target.checked)} />
              {t('browser.canPost')}
            </label>
            <div className="hang">
              <Nut type="submit" disabled={busy || !data.desktops.length}>
                {t('common.save')}
              </Nut>
              {editing ? (
                <Nut
                  bien="phu"
                  onClick={() => {
                    setEditing(null)
                    setName('')
                  }}
                >
                  {t('common.cancel')}
                </Nut>
              ) : null}
            </div>
          </form>
        </Card>
      ) : null}
    </>
  )
}

function Contents({
  data,
  base,
  busy,
  perform,
}: {
  data: BrowserOverview
  base: string
  busy: boolean
  perform: Perform
}): ReactNode {
  const { t } = useI18n()
  const [editing, setEditing] = useState<string | null>(null),
    [title, setTitle] = useState(''),
    [body, setBody] = useState('')
  const selected = data.contents.find((c) => c.id === editing),
    locked =
      !!editing &&
      data.jobs.some(
        (j) => j.contentId === editing && ['queued', 'running', 'waiting_human'].includes(j.status),
      )
  function edit(c: BrowserContentView) {
    setEditing(c.id)
    setTitle(c.title)
    setBody(c.body)
  }
  return (
    <div className="browser-grid browser-grid--content">
      <div className="browser-list">
        {data.contents.map((c) => (
          <Card key={c.id} tieuDe={c.title} phu={`${c.assets.length} ${t('browser.media').toLowerCase()}`}>
            <p className="browser-pre browser-excerpt">{c.body}</p>
            <Nut bien="phu" onClick={() => edit(c)}>
              {t('browser.open')}
            </Nut>
          </Card>
        ))}
      </div>
      <Card tieuDe={t(editing ? 'browser.editContent' : 'browser.newContent')}>
        {locked ? <p role="status">{t('browser.contentLocked')}</p> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void perform(async () => {
              const result = await request<{ content: BrowserContentView }>(
                `${base}/contents${editing ? `/${editing}` : ''}`,
                { method: editing ? 'PATCH' : 'POST', body: { title, body } },
              )
              setEditing(result.content.id)
            })
          }}
        >
          <Input label={t('browser.contentTitle')} value={title} onChange={setTitle} required />
          <TextArea label={t('browser.body')} value={body} onChange={setBody} />
          {data.canManage ? (
            <div className="hang">
              <Nut type="submit" disabled={busy || locked}>
                {t('browser.addContent')}
              </Nut>
              <Nut
                bien="phu"
                onClick={() => {
                  setEditing(null)
                  setTitle('')
                  setBody('')
                }}
              >
                {t('browser.newContent')}
              </Nut>
            </div>
          ) : null}
        </form>
        {selected ? (
          <div className="browser-media">
            <h3>{t('browser.media')}</h3>
            <p className="chu-mo">{t('browser.mediaHelp')}</p>
            {selected.assets.map((asset) => (
              <div className="browser-asset" key={asset.id}>
                <a href={`${base}/assets/${asset.id}`} download>
                  {asset.filename}
                </a>
                <small>{(asset.sizeBytes / 1048576).toFixed(1)} MiB</small>
                {data.canManage ? (
                  <Nut
                    bien="phu"
                    nho
                    disabled={busy || locked}
                    onClick={() => {
                      void perform(async () => {
                        await request(`${base}/assets/${asset.id}`, { method: 'DELETE' })
                      })
                    }}
                  >
                    {t('browser.removeAsset')}
                  </Nut>
                ) : null}
              </div>
            ))}
            {data.canManage ? (
              <label className="truong">
                <span className="nhan">{t('browser.upload')}</span>
                <input
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm"
                  multiple
                  disabled={busy || locked}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? [])
                    e.target.value = ''
                    void perform(async () => {
                      for (const file of files) {
                        const form = new FormData()
                        form.append('file', file)
                        await request(`${base}/contents/${selected.id}/assets`, {
                          method: 'POST',
                          body: form,
                        })
                      }
                    })
                  }}
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  )
}

function Jobs({
  data,
  base,
  busy,
  perform,
}: {
  data: BrowserOverview
  base: string
  busy: boolean
  perform: Perform
}): ReactNode {
  const { t } = useI18n()
  const [channelId, setChannel] = useState(data.channels[0]?.id ?? ''),
    [contentId, setContent] = useState(data.contents[0]?.id ?? '')
  const [kind, setKind] = useState<'publish' | 'read'>('publish'),
    [instructions, setInstructions] = useState(''),
    [key, setKey] = useState(() => crypto.randomUUID())
  const [detail, setDetail] = useState<{ job: BrowserJobView; events: BrowserJobEvent[] } | null>(null)
  async function create(run: boolean) {
    const result = await request<{ job: BrowserJobView }>(`${base}/jobs`, {
      method: 'POST',
      body: {
        channelId,
        ...(kind === 'publish' ? { contentId } : {}),
        kind,
        instructions,
        idempotencyKey: key,
      },
    })
    // Rotate only after creation is acknowledged; a lost response reuses the old key.
    setKey(crypto.randomUUID())
    setInstructions('')
    if (run) await request(`${base}/jobs/${result.job.id}/run`, { method: 'POST' })
  }
  return (
    <>
      {data.canManage ? (
        <Card tieuDe={t('browser.createJob')} phu={t('browser.jobHelp')}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void perform(() => create(false))
            }}
          >
            <div className="browser-grid">
              <Field label={t('browser.channels')}>
                <select
                  aria-label={t('browser.channels')}
                  className="o-chon"
                  value={channelId}
                  onChange={(e) => setChannel(e.target.value)}
                  required
                >
                  <option value="">{t('browser.select')}</option>
                  {data.channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {c.platform}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('browser.kind')}>
                <select
                  aria-label={t('browser.kind')}
                  className="o-chon"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as 'publish' | 'read')}
                >
                  <option value="publish">{t('browser.publish')}</option>
                  <option value="read">{t('browser.read')}</option>
                </select>
              </Field>
            </div>
            {kind === 'publish' ? (
              <Field label={t('browser.content')}>
                <select
                  aria-label={t('browser.content')}
                  className="o-chon"
                  value={contentId}
                  onChange={(e) => setContent(e.target.value)}
                  required
                >
                  <option value="">{t('browser.select')}</option>
                  {data.contents.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <TextArea label={t('browser.instructions')} value={instructions} onChange={setInstructions} />
            <div className="hang browser-actions">
              <Nut type="submit" disabled={busy || !channelId || (kind === 'publish' && !contentId)}>
                {t('browser.createJob')}
              </Nut>
              <Nut
                bien="phu"
                disabled={busy || !channelId || (kind === 'publish' && !contentId)}
                onClick={() => {
                  void perform(() => create(true))
                }}
              >
                {t('browser.createRun')}
              </Nut>
            </div>
          </form>
        </Card>
      ) : null}
      {!data.channels.length ? <p>{t('browser.setupFirst')}</p> : null}
      <p className="chu-mo">{t('browser.notRetried')}</p>
      <div className="browser-grid">
        {data.jobs.map((j) => (
          <Card
            key={j.id}
            tieuDe={data.channels.find((c) => c.id === j.channelId)?.name ?? j.channelId}
            phu={`${t(`browser.${j.kind}`)} · ${t(`browser.${j.status}`)}`}
          >
            {j.contentId ? <p>{data.contents.find((c) => c.id === j.contentId)?.title}</p> : null}
            <p className="browser-pre">{j.instructions}</p>
            {j.result ? <p className="browser-pre">{j.result}</p> : null}
            {j.resultUrl ? (
              <a className="browser-url" href={j.resultUrl} target="_blank" rel="noreferrer">
                {j.resultUrl}
              </a>
            ) : null}
            <div className="hang browser-actions">
              {data.canManage && j.status === 'queued' ? (
                <Nut
                  disabled={busy}
                  onClick={() => {
                    void perform(async () => {
                      await request(`${base}/jobs/${j.id}/run`, { method: 'POST' })
                    })
                  }}
                >
                  {t('browser.run')}
                </Nut>
              ) : null}
              {data.canManage && ['queued', 'running', 'waiting_human'].includes(j.status) ? (
                <Nut
                  bien="phu"
                  disabled={busy}
                  onClick={() => {
                    void perform(async () => {
                      await request(`${base}/jobs/${j.id}/cancel`, { method: 'POST' })
                    })
                  }}
                >
                  {t('browser.cancelJob')}
                </Nut>
              ) : null}
              <Nut
                bien="phu"
                onClick={() => {
                  void perform(async () => {
                    setDetail(await request(`${base}/jobs/${j.id}`))
                  })
                }}
              >
                {t('browser.events')}
              </Nut>
            </div>
          </Card>
        ))}
      </div>
      {detail ? (
        <Card
          tieuDe={t('browser.jobDetail')}
          hanhDong={
            <Nut bien="phu" onClick={() => setDetail(null)}>
              {t('common.close')}
            </Nut>
          }
        >
          <p>{detail.job.id}</p>
          {detail.events.length ? (
            <ol>
              {detail.events.map((e) => (
                <li key={e.id}>
                  {new Date(e.createdAt).toLocaleString()} · {e.operation} · {e.outcome}
                </li>
              ))}
            </ol>
          ) : (
            <p>{t('browser.noEvents')}</p>
          )}
        </Card>
      ) : null}
    </>
  )
}

function RemoteDesktop({
  base,
  desktop,
  onClose,
}: {
  base: string
  desktop: BrowserDesktopView
  onClose: () => void
}): ReactNode {
  const { t } = useI18n(),
    root = `${base}/desktops/${desktop.id}`
  const [screen, setScreen] = useState(''),
    [error, setError] = useState(''),
    [text, setText] = useState(''),
    [hidden, setHidden] = useState(true),
    [url, setUrl] = useState('https://www.google.com/'),
    [busy, setBusy] = useState(false)
  const image = useRef<HTMLImageElement>(null),
    alive = useRef(true),
    controlBusy = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])
  useEffect(() => {
    alive.current = true
    let current = '',
      timer: number | undefined
    async function load() {
      try {
        const response = await fetch(`${root}/screen`, { credentials: 'same-origin', cache: 'no-store' })
        if (!response.ok) throw new Error(t('browser.screenError'))
        const next = URL.createObjectURL(await response.blob())
        if (!alive.current) {
          URL.revokeObjectURL(next)
          return
        }
        const previous = current
        current = next
        setScreen(next)
        if (previous) URL.revokeObjectURL(previous)
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : t('browser.screenError'))
      } finally {
        if (alive.current)
          timer = window.setTimeout(() => {
            void load()
          }, 1500)
      }
    }
    void load()
    return () => {
      alive.current = false
      if (timer) window.clearTimeout(timer)
      if (current) URL.revokeObjectURL(current)
    }
  }, [root, t])
  async function input(action: BrowserHumanInput) {
    if (controlBusy.current) return
    controlBusy.current = true
    setBusy(true)
    setError('')
    try {
      await request(`${root}/input`, { method: 'POST', body: action })
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      controlBusy.current = false
      if (alive.current) setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="browser-remote"
      aria-label={t('browser.remoteTitle')}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="browser-remote__body">
        <div className="hang browser-actions">
          <h2>
            {desktop.name} · {t('browser.remoteTitle')}
          </h2>
          <Nut bien="phu" onClick={onClose}>
            {t('common.close')}
          </Nut>
        </div>
        <p>{t('browser.remoteHelp')}</p>
        {error ? <p role="alert">{error}</p> : null}
        <form
          className="hang browser-actions"
          onSubmit={(e) => {
            e.preventDefault()
            const normalized = normalizeRemoteUrl(url)
            if (!normalized) {
              setError(t('browser.remoteInvalidUrl'))
              return
            }
            setUrl(normalized)
            void input({ operation: 'navigate', url: normalized })
          }}
        >
          <label className="browser-url-input">
            {t('browser.remoteUrl')}
            <input
              className="o-nhap"
              type="text"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </label>
          <Nut type="submit" disabled={busy}>
            {t('browser.open')}
          </Nut>
        </form>
        {screen ? (
          <button
            type="button"
            className="browser-screen"
            aria-label={t('browser.remoteScreen')}
            disabled={busy}
            onClick={(e) => {
              const img = image.current
              if (!img) return
              const rect = img.getBoundingClientRect()
              void input({
                operation: 'click',
                x: Math.max(0, Math.round(((e.clientX - rect.left) * img.naturalWidth) / rect.width)),
                y: Math.max(0, Math.round(((e.clientY - rect.top) * img.naturalHeight) / rect.height)),
              })
            }}
          >
            <img ref={image} src={screen} alt={t('browser.remoteScreen')} draggable={false} />
          </button>
        ) : (
          <p>{t('common.loading')}</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const value = text
            setText('')
            void input({ operation: 'text', text: value })
          }}
        >
          <Input
            label={t('browser.remoteText')}
            value={text}
            onChange={setText}
            type={hidden ? 'password' : 'text'}
          />
          <div className="hang browser-actions">
            <label className="browser-check">
              <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
              {t('browser.hideText')}
            </label>
            <Nut type="submit" disabled={busy || !text}>
              {t('browser.sendText')}
            </Nut>
            {(['Return', 'Tab', 'BackSpace', 'Escape'] as const).map((key) => (
              <Nut
                key={key}
                bien="phu"
                disabled={busy}
                onClick={() => {
                  void input({ operation: 'key', key })
                }}
              >
                {key === 'Return' ? 'Enter' : key}
              </Nut>
            ))}
            <Nut
              bien="phu"
              disabled={busy}
              onClick={() => {
                void input({ operation: 'scroll', direction: 'up' })
              }}
            >
              {t('browser.up')}
            </Nut>
            <Nut
              bien="phu"
              disabled={busy}
              onClick={() => {
                void input({ operation: 'scroll', direction: 'down' })
              }}
            >
              {t('browser.down')}
            </Nut>
          </div>
        </form>
      </div>
    </dialog>
  )
}
