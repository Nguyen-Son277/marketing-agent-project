import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { BrowserOverview, WordpressSiteView } from '@marketing-agent/shared'
import { api, ApiError, request } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { useSession } from '../lib/session.tsx'
import { useSettingsTabActive } from './SettingsTabs.tsx'
import { HopThoai, HopThoaiXacNhan } from './HopThoai.tsx'
import {
  Card,
  DangTai,
  Nhan,
  Nut,
  OChon,
  ONhap,
  ThongBao,
  Trong,
  Truong,
} from './ui.tsx'

interface BridgeCapability {
  available?: boolean
  seo?: { yoast?: boolean; rankmath?: boolean }
  updraftplus?: boolean
  elementor?: boolean
}

export function WordpressSettings({ companyId }: { companyId: string }): ReactNode {
  const { company } = useSession()
  const { t, formatDateTime } = useI18n()
  const tabActive = useSettingsTabActive()
  const manage = company?.role === 'owner' || company?.role === 'admin'

  const [sites, setSites] = useState<readonly WordpressSiteView[] | null>(null)
  const [channels, setChannels] = useState<BrowserOverview['channels']>([])
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<string | null>(null)
  const [thongBao, setThongBao] = useState<string | null>(null)

  // Dialog state
  const [hopThoaiMo, setHopThoaiMo] = useState(false)
  const [siteDangSua, setSiteDangSua] = useState<WordpressSiteView | null>(null)
  const [siteChoXoa, setSiteChoXoa] = useState<WordpressSiteView | null>(null)
  const [dangXoa, setDangXoa] = useState(false)
  const [dangLuu, setDangLuu] = useState(false)
  const [loiLuu, setLoiLuu] = useState<string | null>(null)
  const [dangTestId, setDangTestId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [environment, setEnvironment] = useState<'production' | 'staging'>('production')
  const [browserChannelId, setBrowserChannelId] = useState('')
  const [seoPlugin, setSeoPlugin] = useState<'' | 'yoast' | 'rankmath'>('')

  const taiLai = useCallback(async () => {
    try {
      const [sRes, bRes] = await Promise.all([
        api.wordpressSites(companyId),
        request<BrowserOverview>(`/api/companies/${encodeURIComponent(companyId)}/social-browser`).catch(() => ({ channels: [] })),
      ])
      setSites(sRes.sites)
      setChannels(bRes.channels || [])
    } catch (e) {
      setLoi(e instanceof ApiError ? e.message : t('common.cannotConnectServer'))
    } finally {
      setDangTai(false)
    }
  }, [companyId, t])

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    setThongBao(null)
    void taiLai()
    return () => {
      cancelled = true
    }
  }, [taiLai])

  // Reload when tab becomes active again
  useEffect(() => {
    if (tabActive) {
      void taiLai()
    }
  }, [tabActive, taiLai])

  function resetForm(): void {
    setName('')
    setUrl('')
    setUsername('')
    setPassword('')
    setEnvironment('production')
    setBrowserChannelId('')
    setSeoPlugin('')
    setLoiLuu(null)
  }

  function moThemMoi(): void {
    setSiteDangSua(null)
    resetForm()
    setHopThoaiMo(true)
  }

  function moSua(site: WordpressSiteView): void {
    setSiteDangSua(site)
    setName(site.name)
    setUrl(site.url)
    setUsername(site.username)
    setPassword('')
    setEnvironment(site.environment === 'staging' ? 'staging' : 'production')
    setBrowserChannelId(site.browserChannelId ?? '')
    setSeoPlugin((site.seoPlugin as '' | 'yoast' | 'rankmath') ?? '')
    setLoiLuu(null)
    setHopThoaiMo(true)
  }

  function dongHopThoai(): void {
    setHopThoaiMo(false)
    setSiteDangSua(null)
    resetForm()
  }

  async function luu(): Promise<void> {
    setLoiLuu(null)
    if (!name.trim()) {
      setLoiLuu(t('settings.wordpress.form.siteName') + ' không được để trống')
      return
    }
    if (!siteDangSua && !url.trim()) {
      setLoiLuu(t('settings.wordpress.form.siteUrl') + ' không được để trống')
      return
    }
    if (!username.trim()) {
      setLoiLuu(t('settings.wordpress.form.username') + ' không được để trống')
      return
    }
    if (!siteDangSua && !password.trim()) {
      setLoiLuu(t('settings.wordpress.form.password') + ' không được để trống')
      return
    }

    setDangLuu(true)
    try {
      if (siteDangSua) {
        await api.updateWordpressSite(companyId, siteDangSua.id, {
          name: name.trim(),
          username: username.trim(),
          browserChannelId: browserChannelId || null,
          seoPlugin: seoPlugin || null,
          environment,
          ...(password ? { applicationPassword: password } : {}),
        })
        setThongBao('Đã cập nhật kết nối website')
      } else {
        await api.createWordpressSite(companyId, {
          name: name.trim(),
          url: url.trim(),
          username: username.trim(),
          applicationPassword: password,
          environment,
          browserChannelId: browserChannelId || null,
          seoPlugin: seoPlugin || null,
        })
        setThongBao('Đã thêm kết nối website mới')
      }
      dongHopThoai()
      await taiLai()
    } catch (e) {
      setLoiLuu(e instanceof Error ? e.message : String(e))
    } finally {
      setDangLuu(false)
    }
  }

  async function kiemTra(site: WordpressSiteView): Promise<void> {
    setDangTestId(site.id)
    setLoi(null)
    setThongBao(null)
    try {
      await api.testWordpressSite(companyId, site.id)
      setThongBao(t('settings.wordpress.testSuccess'))
      await taiLai()
    } catch (e) {
      setLoi(t('settings.wordpress.testFailed', { error: e instanceof Error ? e.message : String(e) }))
    } finally {
      setDangTestId(null)
    }
  }

  async function xacNhanXoa(): Promise<void> {
    if (!siteChoXoa) return
    setDangXoa(true)
    setLoi(null)
    try {
      await api.deleteWordpressSite(companyId, siteChoXoa.id)
      setThongBao('Đã thu hồi kết nối website')
      setSiteChoXoa(null)
      await taiLai()
    } catch (e) {
      setLoi(e instanceof Error ? e.message : String(e))
    } finally {
      setDangXoa(false)
    }
  }

  const envOptions = [
    { value: 'production', label: t('settings.wordpress.form.envProduction') },
    { value: 'staging', label: t('settings.wordpress.form.envStaging') },
  ] as const

  const seoOptions = [
    { value: '', label: t('settings.wordpress.form.seoAuto') },
    { value: 'yoast', label: t('settings.wordpress.form.seoYoast') },
    { value: 'rankmath', label: t('settings.wordpress.form.seoRankMath') },
  ] as const

  const browserOptions = [
    { value: '', label: t('settings.wordpress.form.noBrowser') },
    ...channels.map((c) => ({ value: c.id, label: c.name })),
  ]

  return (
    <Card
      tieuDe={t('settings.wordpress.title')}
      phu={t('settings.wordpress.subtitle')}
      hanhDong={
        manage ? (
          <Nut nho onClick={moThemMoi}>
            {t('settings.wordpress.add')}
          </Nut>
        ) : null
      }
    >
      {loi ? <ThongBao loai="loi">{loi}</ThongBao> : null}
      {thongBao ? <ThongBao loai="thanh-cong">{thongBao}</ThongBao> : null}

      {dangTai ? <DangTai nhan={t('common.loading')} /> : null}

      {!dangTai && sites?.length === 0 ? (
        <Trong>
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <p style={{ fontWeight: 600, fontSize: 16, margin: '0 0 6px' }}>
              {t('settings.wordpress.empty.title')}
            </p>
            <p style={{ color: 'var(--mau-chu-mo)', margin: '0 0 16px' }}>
              {t('settings.wordpress.empty.desc')}
            </p>
            {manage && (
              <Nut nho onClick={moThemMoi}>
                {t('settings.wordpress.add')}
              </Nut>
            )}
          </div>
        </Trong>
      ) : null}

      {!dangTai && sites && sites.length > 0 ? (
        <div className="cot" style={{ gap: 14 }}>
          {sites.map((site) => {
            const bridge = site.capabilities?.bridge as BridgeCapability | undefined
            const channelName = channels.find((c) => c.id === site.browserChannelId)?.name

            return (
              <div
                key={site.id}
                style={{
                  padding: '14px 16px',
                  borderRadius: 'var(--ban-kinh)',
                  border: '1px solid var(--mau-vien)',
                  background: 'var(--mau-be-mat)',
                }}
              >
                <div className="hang" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                  <div className="hang" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 16 }}>{site.name}</strong>
                    <a
                      href={site.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 13, color: 'var(--mau-chinh)' }}
                    >
                      {site.url} ↗
                    </a>
                    <Nhan loai={site.environment === 'production' ? 'chinh' : 'canh-bao'}>
                      {site.environment === 'production'
                        ? t('settings.wordpress.form.envProduction')
                        : t('settings.wordpress.form.envStaging')}
                    </Nhan>
                    <Nhan loai={site.enabled ? 'thanh-cong' : 'mo'}>
                      {site.enabled
                        ? t('settings.wordpress.status.enabled')
                        : t('settings.wordpress.status.revoked')}
                    </Nhan>
                  </div>

                  <div className="hang" style={{ gap: 6 }}>
                    {manage && site.enabled && (
                      <>
                        <Nut
                          nho
                          onClick={() => void kiemTra(site)}
                          dangTai={dangTestId === site.id}
                          disabled={Boolean(dangTestId)}
                        >
                          {t('settings.wordpress.test')}
                        </Nut>
                        <Nut nho bien="phu" onClick={() => moSua(site)}>
                          {t('settings.wordpress.edit')}
                        </Nut>
                        <Nut nho bien="nguy-hiem" onClick={() => setSiteChoXoa(site)}>
                          {t('settings.wordpress.revoke')}
                        </Nut>
                      </>
                    )}
                    <Nut
                      nho
                      bien="phu"
                      onClick={() => {
                        window.location.hash = `#/wordpress?siteId=${encodeURIComponent(site.id)}`
                      }}
                    >
                      {t('settings.wordpress.openWorkspace')}
                    </Nut>
                  </div>
                </div>

                <div className="hang" style={{ gap: 16, fontSize: 13, color: 'var(--mau-chu-mo)', marginBottom: 10 }}>
                  <span>
                    <strong>Username:</strong> {site.username}
                  </span>
                  {channelName && (
                    <span>
                      <strong>Browser:</strong> {channelName}
                    </span>
                  )}
                  {site.checkedAt && (
                    <span>
                      {t('settings.wordpress.capabilities.lastChecked', {
                        time: formatDateTime(site.checkedAt),
                      })}
                    </span>
                  )}
                </div>

                {/* Capabilities pills */}
                <div className="hang" style={{ gap: 6, marginBottom: 8 }}>
                  <Nhan loai={bridge?.available ? 'chinh' : 'mo'}>
                    {t('settings.wordpress.capabilities.bridge')}:{' '}
                    {bridge?.available
                      ? t('settings.wordpress.capabilities.ready')
                      : t('settings.wordpress.capabilities.notDetected')}
                  </Nhan>
                  {bridge?.available && (
                    <>
                      <Nhan loai={bridge.seo?.yoast || bridge.seo?.rankmath ? 'thanh-cong' : 'mo'}>
                        {t('settings.wordpress.capabilities.seo')}:{' '}
                        {site.seoPlugin === 'yoast'
                          ? 'Yoast SEO'
                          : site.seoPlugin === 'rankmath'
                            ? 'Rank Math'
                            : bridge.seo?.yoast
                              ? 'Yoast SEO'
                              : bridge.seo?.rankmath
                                ? 'Rank Math'
                                : t('settings.wordpress.capabilities.notDetected')}
                      </Nhan>
                      <Nhan loai={bridge.updraftplus ? 'thanh-cong' : 'mo'}>
                        {t('settings.wordpress.capabilities.backup')}:{' '}
                        {bridge.updraftplus
                          ? t('settings.wordpress.capabilities.ready')
                          : t('settings.wordpress.capabilities.notDetected')}
                      </Nhan>
                      <Nhan loai={bridge.elementor ? 'thanh-cong' : 'mo'}>
                        {t('settings.wordpress.capabilities.elementor')}:{' '}
                        {bridge.elementor
                          ? t('settings.wordpress.capabilities.ready')
                          : t('settings.wordpress.capabilities.notDetected')}
                      </Nhan>
                    </>
                  )}
                </div>

                {/* Advanced details collapsible */}
                {site.checkedAt && (
                  <details style={{ marginTop: 6, fontSize: 12 }}>
                    <summary style={{ cursor: 'pointer', color: 'var(--mau-chu-mo)' }}>
                      {t('settings.wordpress.capabilities.raw')}
                    </summary>
                    <pre
                      style={{
                        margin: '6px 0 0',
                        padding: 10,
                        borderRadius: 'var(--ban-kinh-nho)',
                        background: 'var(--mau-nen)',
                        fontSize: 12,
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {JSON.stringify(site.capabilities, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      ) : null}

      {/* Add / Edit HopThoai */}
      <HopThoai
        mo={hopThoaiMo}
        tieuDe={
          siteDangSua
            ? t('settings.wordpress.form.editTitle')
            : t('settings.wordpress.form.createTitle')
        }
        onDong={dongHopThoai}
        chanDung={
          <>
            <Nut bien="phu" nho onClick={dongHopThoai} disabled={dangLuu}>
              {t('common.cancel')}
            </Nut>
            <Nut bien="chinh" nho onClick={() => void luu()} dangTai={dangLuu}>
              {dangLuu ? t('settings.wordpress.form.saving') : t('settings.wordpress.form.save')}
            </Nut>
          </>
        }
      >
        <div className="cot" style={{ gap: 12 }}>
          {loiLuu && <ThongBao loai="loi">{loiLuu}</ThongBao>}

          <Truong nhan={t('settings.wordpress.form.siteName')}>
            <ONhap
              value={name}
              onChange={setName}
              placeholder="VD: Blog Doanh Nghiệp"
              disabled={dangLuu}
            />
          </Truong>

          <Truong nhan={t('settings.wordpress.form.siteUrl')}>
            <ONhap
              type="url"
              value={url}
              onChange={setUrl}
              placeholder="https://example.com"
              disabled={dangLuu || Boolean(siteDangSua)}
            />
          </Truong>

          <Truong nhan={t('settings.wordpress.form.username')}>
            <ONhap
              value={username}
              onChange={setUsername}
              placeholder="admin_agent"
              disabled={dangLuu}
            />
          </Truong>

          <Truong
            nhan={
              siteDangSua
                ? t('settings.wordpress.form.newPassword')
                : t('settings.wordpress.form.password')
            }
            goiY={t('settings.wordpress.form.passwordHint')}
          >
            <ONhap
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="xxxx xxxx xxxx xxxx"
              disabled={dangLuu}
            />
          </Truong>

          <div className="luoi luoi--2">
            <Truong nhan={t('settings.wordpress.form.env')}>
              <OChon
                value={environment}
                onChange={(val) => setEnvironment(val as 'production' | 'staging')}
                options={envOptions}
                disabled={dangLuu}
              >
              </OChon>
            </Truong>

            <Truong nhan={t('settings.wordpress.form.seoPlugin')}>
              <OChon
                value={seoPlugin}
                onChange={(val) => setSeoPlugin(val as '' | 'yoast' | 'rankmath')}
                options={seoOptions}
                disabled={dangLuu}
              >
              </OChon>
            </Truong>
          </div>

          <Truong nhan={t('settings.wordpress.form.browserChannel')}>
            <OChon
              value={browserChannelId}
              onChange={setBrowserChannelId}
              options={browserOptions}
              disabled={dangLuu}
            >
            </OChon>
          </Truong>
        </div>
      </HopThoai>

      {/* Revoke confirmation HopThoaiXacNhan */}
      <HopThoaiXacNhan
        mo={Boolean(siteChoXoa)}
        tieuDe={t('settings.wordpress.revoke.title')}
        moTa={
          siteChoXoa
            ? t('settings.wordpress.revoke.message', { name: siteChoXoa.name })
            : ''
        }
        nhanXacNhan={t('settings.wordpress.revoke.confirm')}
        nguyHiem
        dangXuLy={dangXoa}
        onXacNhan={() => void xacNhanXoa()}
        onHuy={() => setSiteChoXoa(null)}
      />
    </Card>
  )
}
