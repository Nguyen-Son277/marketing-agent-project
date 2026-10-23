/**
 * Cài đặt — nơi khai báo hạ tầng mà cả đội agent chạy trên đó.
 *
 * Vì sao màn hình này tồn tại: agent chỉ chạy được khi biết gọi model nào qua nhà
 * cung cấp nào, tốn bao nhiêu tiền, và được phép chạm vào kênh ngoài nào. Màn
 * hình này chia sáu nhóm cấu hình thành các tab, mỗi nhóm tự tải dữ liệu để một
 * phần hỏng không kéo sập cả trang. Nguyên tắc bảo mật được nói thẳng trên giao
 * diện: API key là chỉ-ghi, gửi lên rồi thì không bao giờ hiển thị lại.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  IntegrationKind,
  IntegrationView,
  ModelOptionView,
  ModelRouteView,
  ModelTier,
  ProviderKeyView,
  ProviderKind,
  ProviderView,
} from '@marketing-agent/shared'
import { INTEGRATION_KINDS, MODEL_TIERS, PROVIDER_KINDS } from '@marketing-agent/shared'
import type { MessageKey } from '@marketing-agent/i18n'
import { api, ApiError } from '../lib/api.ts'
import { buildFirecrawlConfig, firecrawlConnectionName } from '../lib/firecrawl-form.ts'
import { useI18n } from '../lib/i18n.tsx'
import { useSession } from '../lib/session.tsx'
import { useSettingsNotifications } from '../lib/settings-notifications.ts'
import { HopThoai, HopThoaiXacNhan } from '../components/HopThoai.tsx'
import { HopThoaiChonModel } from '../components/HopThoaiChonModel.tsx'
import { KnowledgeModelSettings } from '../components/KnowledgeModelSettings.tsx'
import { ModelPricingDialog } from '../components/ModelPricingDialog.tsx'
import { SettingsTabs, useSettingsTabActive } from '../components/SettingsTabs.tsx'
import {
  Card,
  DangTai,
  Nhan,
  Nut,
  OChon,
  ONhap,
  ThongBao,
  TieuDeTrang,
  Trang,
  Trong,
  Truong,
} from '../components/ui.tsx'

// Tên giao thức là danh từ riêng của nhà cung cấp nên không dịch, vì thế giữ thẳng
// ở đây thay vì đưa vào catalog.
const NHAN_PROVIDER: Readonly<Record<ProviderKind, string>> = {
  openai_compatible: 'OpenAI-compatible',
  anthropic: 'Anthropic',
}

const NHAN_KEY_USAGE_MODE: Readonly<Record<ProviderView['keyUsageMode'], MessageKey>> = {
  failover: 'settings.providers.keyUsageMode.failover',
  round_robin: 'settings.providers.keyUsageMode.roundRobin',
}

/**
 * Nhãn kênh là KHOÁ DỊCH (trừ tên riêng giữ nguyên ở cả hai ngôn ngữ).
 *
 * Vì sao gom cả tên riêng vào catalog: bảng ánh xạ chỉ giữ một kiểu duy nhất, nên
 * không có nhánh nào vô tình hiển thị mã kênh thô khi thiếu bản dịch.
 */
const NHAN_INTEGRATION: Readonly<Record<IntegrationKind, MessageKey>> = {
  firecrawl: 'settings.integrationKind.firecrawl',
  'google-search-console': 'settings.integrationKind.googleSearchConsole',
  'google-analytics': 'settings.integrationKind.googleAnalytics',
  'google-sheets': 'settings.integrationKind.googleSheets',
  meta: 'settings.integrationKind.meta',
  linkedin: 'settings.integrationKind.linkedin',
  'google-ads': 'settings.integrationKind.googleAds',
  'email-smtp': 'settings.integrationKind.emailSmtp',
}

// Mức năng lực đã có sẵn khoá `modelTier.*` dùng chung với màn Đội agent; tạo khoá
// riêng ở đây sẽ khiến hai màn gọi cùng một mức bằng hai câu chữ khác nhau.
const NHAN_TIER: Readonly<Record<ModelTier, MessageKey>> = {
  light: 'modelTier.light',
  standard: 'modelTier.standard',
  deep: 'modelTier.deep',
}

function laProviderKind(giaTri: string): giaTri is ProviderKind {
  return (PROVIDER_KINDS as readonly string[]).includes(giaTri)
}

function laIntegrationKind(giaTri: string): giaTri is IntegrationKind {
  return (INTEGRATION_KINDS as readonly string[]).includes(giaTri)
}

function laTier(giaTri: string): giaTri is ModelTier {
  return (MODEL_TIERS as readonly string[]).includes(giaTri)
}

/** Chấp nhận cả dấu phẩy thập phân kiểu Việt Nam; giá trị không hợp lệ quy về 0. */
function soTuChuoi(giaTri: string): number {
  const so = Number(giaTri.trim().replace(',', '.'))
  return Number.isFinite(so) ? so : 0
}

function LoiManHinh({ loi }: { loi: ApiError }): ReactNode {
  const { t } = useI18n()
  return (
    <ThongBao loai="loi">
      {loi.message}
      {loi.needsConfiguration ? ` ${t('settings.needsConfigurationHint')}` : null}
    </ThongBao>
  )
}

/** Khối trạng thái tải/lỗi dùng chung cho từng nhóm cấu hình. */
function TrangThai({ dangTai, loi, taiLai }: { dangTai: boolean; loi: ApiError | null; taiLai: () => void }): ReactNode {
  const { t } = useI18n()
  if (dangTai) return <DangTai nhan={t('common.loading')} />
  if (loi) {
    return (
      <div>
        <LoiManHinh loi={loi} />
        <div style={{ marginTop: 10 }}>
          <Nut bien="phu" nho onClick={taiLai}>
            {t('common.retry')}
          </Nut>
        </div>
      </div>
    )
  }
  return null
}

/* ------------------------------------------------------------ nhà cung cấp */

function PhanNhaCungCap({ companyId }: { companyId: string }): ReactNode {
  const tabActive = useSettingsTabActive()
  const { t, formatNumber } = useI18n()
  const { begin } = useSettingsNotifications(companyId)
  const [danhSach, setDanhSach] = useState<readonly ProviderView[] | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [suaId, setSuaId] = useState<string | null>(null)
  const [ten, setTen] = useState('')
  const [kind, setKind] = useState<ProviderKind>('openai_compatible')
  const [keyUsageMode, setKeyUsageMode] = useState<ProviderView['keyUsageMode']>('failover')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyLabel, setApiKeyLabel] = useState('')
  const [bat, setBat] = useState(true)
  /** Provider đang mở bảng quản lý khoá/model. Một lúc chỉ mở một cái cho dễ đọc. */
  const [moProvider, setMoProvider] = useState<string | null>(null)

  /**
   * Hộp thoại thêm/sửa provider. Một hộp thoại phục vụ cả hai chế độ vì biểu mẫu gần như
   * giống hệt nhau; tách làm hai thì mỗi lần thêm một trường phải sửa hai chỗ và chắc chắn
   * sẽ có lúc lệch.
   */
  const [hopMo, setHopMo] = useState(false)
  /** Provider đang chờ xác nhận xoá; `null` nghĩa là không có hộp thoại xác nhận nào. */
  const [choXoa, setChoXoa] = useState<ProviderView | null>(null)
  const [dangXoa, setDangXoa] = useState(false)

  const [dangLuu, setDangLuu] = useState(false)
  /** Chỉ giữ lỗi kiểm tra trường nhập ngay trong biểu mẫu. */
  const [loiLuu, setLoiLuu] = useState<string | null>(null)

  const [dangTest, setDangTest] = useState<string | null>(null)

  useEffect(() => {
    if (!tabActive) return
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    api
      .providers(companyId)
      .then((ketQua) => {
        if (!cancelled) setDanhSach(ketQua.providers)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', t('common.cannotConnectServer')))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, lanThu, tabActive])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  function napVaoBieuMau(provider: ProviderView): void {
    setSuaId(provider.id)
    setTen(provider.name)
    setKind(provider.kind)
    setKeyUsageMode(provider.keyUsageMode)
    setBaseUrl(provider.baseUrl)
    setApiKey('')
    setApiKeyLabel('')
    setBat(provider.enabled)
    setLoiLuu(null)
    setHopMo(true)
  }

  /** Mở hộp thoại ở chế độ tạo mới, luôn bắt đầu từ biểu mẫu trắng. */
  function moTaoMoi(): void {
    xoaBieuMau()

    setHopMo(true)
  }

  /** Xoá trắng biểu mẫu nhưng không đóng hộp thoại và không đụng tới thông báo. */
  function xoaBieuMau(): void {
    setSuaId(null)
    setTen('')
    setKind('openai_compatible')
    setKeyUsageMode('failover')
    setBaseUrl('')
    setApiKey('')
    setApiKeyLabel('')
    setBat(true)
    setLoiLuu(null)
  }

  /**
   * Đóng hộp thoại và xoá sạch biểu mẫu.
   *
   * Vì sao phải xoá: trạng thái biểu mẫu sống ngoài hộp thoại, nên nếu chỉ ẩn hộp thoại thì
   * lần sau bấm "Thêm nhà cung cấp" người dùng thấy nguyên dữ liệu của lần trước và rất dễ
   * gửi nhầm. Hàm này cũng là `onDong`, nên nó chạy cho cả `Esc` lẫn bấm ra ngoài.
   */
  function dongHopThoai(): void {
    setHopMo(false)
    xoaBieuMau()
  }

  /** Xoá provider đang chờ xác nhận; kéo theo toàn bộ khoá/model và route trỏ tới model của nó. */
  async function xacNhanXoa(): Promise<void> {
    const provider = choXoa
    if (!provider) return

    setDangXoa(true)
    const finish = begin('provider.delete')
    try {
      await api.deleteProvider(companyId, provider.id)
      if (moProvider === provider.id) setMoProvider(null)
      finish('success')
      taiLai()
    } catch (error) {
      finish('error')
    } finally {
      setDangXoa(false)
      // Kết quả thao tác xuất hiện trong toast dùng chung.
      setChoXoa(null)
    }
  }

  async function luu(): Promise<void> {
    setLoiLuu(null)

    if (ten.trim().length === 0 || baseUrl.trim().length === 0) {
      setLoiLuu(t('settings.providers.needNameAndBaseUrl'))
      return
    }
    setDangLuu(true)
    const finish = begin('provider.save')
    try {
      if (suaId) {
        // Sửa provider không đổi khoá: khoá quản lý riêng từng cái ở bảng bên dưới.
        await api.updateProvider(companyId, suaId, {
          name: ten.trim(),
          kind,
          keyUsageMode,
          baseUrl: baseUrl.trim(),
          enabled: bat,
        })
        finish('success')
      } else {
        await api.createProvider(companyId, {
          name: ten.trim(),
          kind,
          keyUsageMode,
          baseUrl: baseUrl.trim(),
          enabled: bat,
          ...(apiKey.length > 0
            ? {
                apiKey,
                ...(apiKeyLabel.trim().length > 0 ? { apiKeyLabel: apiKeyLabel.trim() } : {}),
              }
            : {}),
        })
        finish('success')
      }
      // Đóng hộp thoại sau khi lưu xong: giữ nó mở sẽ khiến người dùng bấm Lưu lần nữa và
      // tạo bản ghi trùng.
      dongHopThoai()
      taiLai()
    } catch (error) {
      finish('error')
    } finally {
      setDangLuu(false)
    }
  }

  async function test(provider: ProviderView): Promise<void> {
    setDangTest(provider.id)
    const finish = begin('provider.test')
    try {
      const ketQua = await api.testProvider(companyId, provider.id)
      finish(ketQua.ok ? 'success' : 'error')
    } catch (error) {
      finish('error')
    } finally {
      setDangTest(null)
    }
  }

  return (
    <Card tieuDe={t('settings.providers.title')} phu={t('settings.providers.subtitle')}>
      <TrangThai dangTai={dangTai} loi={loi} taiLai={taiLai} />



      {/* Nút mở hộp thoại đặt ngay trên bảng: mắt đi từ "danh sách" sang "thêm" theo một
          chiều, thay vì phải cuộn xuống cuối mục như khi biểu mẫu luôn hiện. */}
      <div className="hang" style={{ marginBottom: 10 }}>
        <Nut nho onClick={moTaoMoi}>
          {t('settings.providers.add')}
        </Nut>
      </div>

      {danhSach && danhSach.length === 0 ? <Trong>{t('settings.providers.empty')}</Trong> : null}

      {danhSach && danhSach.length > 0 ? (
        <div className="settings-table" role="region" aria-label={t('settings.providers.title')} tabIndex={0}>
        <table className="bang">
          <thead>
            <tr>
              <th>{t('settings.providers.table.name')}</th>
              <th>{t('settings.providers.table.kind')}</th>
              <th>{t('settings.providers.table.baseUrl')}</th>
              <th>{t('settings.providers.table.apiKey')}</th>
              <th>{t('settings.providers.table.models')}</th>
              <th>{t('settings.providers.table.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {danhSach.map((provider) => (
              <tr key={provider.id}>
                <td>
                  <strong>{provider.name}</strong>
                  {provider.isGlobal ? (
                    <div>
                      <Nhan loai="mo">{t('settings.providers.global')}</Nhan>
                    </div>
                  ) : null}
                </td>
                <td>{NHAN_PROVIDER[provider.kind]}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{provider.baseUrl}</td>
                <td>
                  {provider.apiKeyConfigured ? (
                    <>
                      <Nhan loai="thanh-cong">
                        {t('settings.providers.keys.title', { count: formatNumber(provider.keys.length) })}
                      </Nhan>
                      {provider.apiKeyHint ? (
                        <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                          {t('settings.providers.keyHint', { hint: provider.apiKeyHint })}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <Nhan loai="canh-bao">{t('settings.providers.keyMissing')}</Nhan>
                  )}
                </td>
                <td className="so">{formatNumber(provider.models.length)}</td>
                <td>
                  {provider.enabled ? (
                    <Nhan loai="thanh-cong">{t('settings.providers.enabled')}</Nhan>
                  ) : (
                    <Nhan loai="mo">{t('settings.providers.disabled')}</Nhan>
                  )}
                </td>
                <td>
                  <div className="hang" style={{ gap: 6 }}>
                    <Nut bien="phu" nho onClick={() => napVaoBieuMau(provider)}>
                      {t('common.edit')}
                    </Nut>
                    <Nut
                      bien="phu"
                      nho
                      onClick={() => setMoProvider((hienTai) => (hienTai === provider.id ? null : provider.id))}
                    >
                      {t('settings.providers.keys.title', { count: formatNumber(provider.keys.length) })}
                    </Nut>
                    <Nut bien="phu" nho onClick={() => void test(provider)} dangTai={dangTest === provider.id}>
                      {t('settings.providers.test')}
                    </Nut>
                    <Nut
                      bien="nguy-hiem"
                      nho
                      onClick={() => setChoXoa(provider)}
                    >
                      {t('settings.providers.delete')}
                    </Nut>
                  </div>


                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : null}

      {(danhSach ?? []).map((provider) =>
        moProvider === provider.id ? (
          <PhanKhoaProvider key={provider.id} companyId={companyId} provider={provider} onChanged={taiLai} />
        ) : null,
      )}

      {/*
        Một hộp thoại cho cả tạo mới và sửa: `suaId` quyết định tiêu đề và việc có hiện ô
        khoá API hay không.
      */}
      <HopThoai
        mo={hopMo}
        tieuDe={suaId ? t('settings.providers.form.editTitle') : t('settings.providers.form.createTitle')}
        onDong={dongHopThoai}
        chanDung={
          <>
            <Nut bien="phu" nho onClick={dongHopThoai} disabled={dangLuu}>
              {t('common.cancel')}
            </Nut>
            <Nut nho onClick={() => void luu()} dangTai={dangLuu}>
              {suaId ? t('settings.providers.form.submitEdit') : t('settings.providers.form.submitCreate')}
            </Nut>
          </>
        }
      >
        <div className="cot" style={{ gap: 10 }}>
          <div className="luoi luoi--2">
            <ONhap value={ten} onChange={setTen} placeholder={t('settings.providers.form.namePlaceholder')} />
            <OChon
              value={kind}
              onChange={(giaTri) => {
                if (laProviderKind(giaTri)) setKind(giaTri)
              }}
              options={PROVIDER_KINDS.map((item) => ({ value: item, label: NHAN_PROVIDER[item] }))}
            />
            <ONhap value={baseUrl} onChange={setBaseUrl} placeholder={t('settings.providers.form.baseUrlPlaceholder')} />
            {/* Chỉ nhập khoá khi TẠO MỚI: provider đã có khoá riêng từng cái ở bảng bên dưới,
                nhập ở đây nữa sẽ thành hai đường sửa cùng một thứ. */}
            {suaId === null ? (
              <>
                <ONhap
                  value={apiKeyLabel}
                  onChange={setApiKeyLabel}
                  placeholder={t('settings.providers.keys.labelPlaceholder')}
                />
                <ONhap
                  value={apiKey}
                  onChange={setApiKey}
                  type="password"
                  visibilityResetKey={hopMo}
                  placeholder={t('settings.providers.keys.keyPlaceholder')}
                />
              </>
            ) : null}
          </div>
          <label className="truong">
            <span className="nhan">{t('settings.providers.keyUsageMode.label')}</span>
            <OChon
              value={keyUsageMode}
              onChange={(giaTri) => {
                if (giaTri === 'failover' || giaTri === 'round_robin') setKeyUsageMode(giaTri)
              }}
              options={[
                { value: 'failover', label: t(NHAN_KEY_USAGE_MODE.failover) },
                { value: 'round_robin', label: t(NHAN_KEY_USAGE_MODE.round_robin) },
              ]}
              disabled={dangLuu}
            />
          </label>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--mau-chu-mo)' }}>
            {t('settings.providers.keyUsageMode.hint')}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--mau-chu-mo)' }}>
            {t('settings.providers.keyUsageMode.rateLimitNote')}
          </p>
          <label className="hang" style={{ gap: 6, fontSize: 14 }}>
            <input type="checkbox" checked={bat} onChange={(event) => setBat(event.target.checked)} />
            {t('settings.providers.form.enable')}
          </label>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--mau-chu-mo)' }}>
            {t('settings.providers.form.keyNote')}
          </p>
          {/* Lỗi lưu phải nằm TRONG hộp thoại: hiện ở đầu mục thì bị lớp phủ che, người dùng
              chỉ thấy nút Lưu không phản hồi. */}
          {loiLuu ? <ThongBao loai="loi">{loiLuu}</ThongBao> : null}
        </div>
      </HopThoai>

      <HopThoaiXacNhan
        mo={choXoa !== null}
        tieuDe={t('settings.providers.delete')}
        moTa={choXoa ? t('settings.providers.deleteConfirm', { name: choXoa.name }) : ''}
        nhanXacNhan={t('settings.providers.delete')}
        dangXuLy={dangXoa}
        onXacNhan={() => void xacNhanXoa()}
        onHuy={() => {
          if (!dangXoa) setChoXoa(null)
        }}
      />
    </Card>
  )
}

/* ------------------------------------------- khoá API và fetch model */

function PhanKhoaProvider({
  companyId,
  provider,
  onChanged,
}: {
  companyId: string
  provider: ProviderView
  onChanged: () => void
}): ReactNode {
  const { t, formatNumber } = useI18n()
  const { begin } = useSettingsNotifications(companyId)
  const [keyForm, setKeyForm] = useState<{
    keyId: string | null
    label: string
    apiKey: string
    priority: string
    enabled: boolean
  } | null>(null)
  const [dangLuu, setDangLuu] = useState(false)
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTest, setDangTest] = useState<string | null>(null)
  /** Đang mở hộp thoại chọn model dùng chung, khoá sẵn vào provider này. */
  const [chonModelMo, setChonModelMo] = useState(false)
  const [dangPurge, setDangPurge] = useState(false)
  /** Đang mở hộp thoại xác nhận xoá model không dùng của provider này. */
  const [xacNhanPurge, setXacNhanPurge] = useState(false)

  function moThemKhoa(): void {
    setKeyForm({
      keyId: null,
      label: '',
      apiKey: '',
      priority: String((provider.keys.length + 1) * 100),
      enabled: true,
    })
    setLoi(null)

  }

  function moSuaKhoa(key: ProviderKeyView): void {
    setKeyForm({ keyId: key.id, label: key.label, apiKey: '', priority: String(key.priority), enabled: key.enabled })
    setLoi(null)

  }

  async function luuKhoa(): Promise<void> {
    if (!keyForm) return
    if (keyForm.label.trim().length === 0 || (keyForm.keyId === null && keyForm.apiKey.trim().length === 0)) {
      setLoi(t('settings.providers.keys.needLabelAndKey'))
      return
    }
    setDangLuu(true)
    setLoi(null)
    const finish = begin('key.save')
    try {
      if (keyForm.keyId === null) {
        await api.createProviderKey(companyId, provider.id, {
          label: keyForm.label.trim(),
          apiKey: keyForm.apiKey.trim(),
          priority: Math.round(soTuChuoi(keyForm.priority)),
          enabled: keyForm.enabled,
        })
        finish('success')
      } else {
        await api.updateProviderKey(companyId, provider.id, keyForm.keyId, {
          label: keyForm.label.trim(),
          priority: Math.round(soTuChuoi(keyForm.priority)),
          enabled: keyForm.enabled,
          ...(keyForm.apiKey.trim().length > 0 ? { apiKey: keyForm.apiKey.trim() } : {}),
        })
        finish('success')
      }
      setKeyForm(null)
      onChanged()
    } catch (error) {
      finish('error')
    } finally {
      setDangLuu(false)
    }
  }

  async function xoaKhoa(key: ProviderKeyView): Promise<void> {
    setLoi(null)
    const finish = begin('key.delete')
    try {
      await api.deleteProviderKey(companyId, provider.id, key.id)
      finish('success')
      onChanged()
    } catch (error) {
      finish('error')
    }
  }

  async function testKhoa(key: ProviderKeyView): Promise<void> {
    setDangTest(key.id)
    const finish = begin('key.test')
    try {
      const ketQua = await api.testProviderKey(companyId, provider.id, key.id)
      finish(ketQua.ok ? 'success' : 'error')
    } catch (error) {
      finish('error')
    } finally {
      setDangTest(null)
    }
  }

  /** Chạy sau khi người dùng xác nhận trong hộp thoại; hộp thoại thay `window.confirm`. */
  async function purgeModels(): Promise<void> {
    setDangPurge(true)
    setLoi(null)
    const finish = begin('model.purge')
    try {
      await api.purgeProviderModels(companyId, provider.id)
      finish('success')
      onChanged()
    } catch (error) {
      finish('error')
    } finally {
      setDangPurge(false)
      // Kết quả thao tác xuất hiện trong toast dùng chung.
      setXacNhanPurge(false)
    }
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3 className="card__tieu-de">{t('settings.providers.keys.title', { count: formatNumber(provider.keys.length) })}</h3>
      <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{t('settings.providers.keys.hint')}</p>
      <p style={{ fontSize: 12 }}>
        <strong>{t('settings.providers.keyUsageMode.label')}: </strong>
        {t(NHAN_KEY_USAGE_MODE[provider.keyUsageMode])}
      </p>
      <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{t('settings.providers.keyUsageMode.hint')}</p>
      <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{t('settings.providers.keyUsageMode.rateLimitNote')}</p>

      {loi ? (
        <div style={{ marginBottom: 8 }}>
          <ThongBao loai="loi">{loi}</ThongBao>
        </div>
      ) : null}

      {provider.keys.length === 0 ? <Trong>{t('settings.providers.keys.empty')}</Trong> : null}

      {provider.keys.length > 0 ? (
        <div className="settings-table" role="region" aria-label={t('settings.providers.keys.title', { count: provider.keys.length })} tabIndex={0}>
        <table className="bang">
          <thead>
            <tr>
              <th>{t('settings.providers.keys.label')}</th>
              <th>{t('settings.providers.table.apiKey')}</th>
              <th>{t('settings.providers.keys.priority')}</th>
              <th>{t('settings.providers.keys.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {provider.keys.map((key) => (
              <tr key={key.id}>
                <td>
                  <strong>{key.label}</strong>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{key.hint ?? ''}</td>
                <td className="so">{formatNumber(key.priority)}</td>
                <td>
                  {key.enabled ? (
                    <Nhan loai="thanh-cong">{t('settings.providers.keys.enabled')}</Nhan>
                  ) : (
                    <Nhan loai="mo">{t('settings.providers.keys.disabled')}</Nhan>
                  )}
                </td>
                <td>
                  <div className="hang" style={{ gap: 6 }}>
                    <Nut bien="phu" nho onClick={() => void testKhoa(key)} dangTai={dangTest === key.id}>
                      {t('settings.providers.keys.test')}
                    </Nut>
                    <Nut bien="phu" nho onClick={() => moSuaKhoa(key)}>
                      {t('common.edit')}
                    </Nut>
                    <Nut bien="nguy-hiem" nho onClick={() => void xoaKhoa(key)}>
                      {t('common.delete')}
                    </Nut>
                  </div>

                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : null}

      {keyForm ? (
        <div style={{ marginTop: 12 }}>
          <h4 className="card__tieu-de">{t('settings.providers.keys.addTitle')}</h4>
          <div className="luoi luoi--2">
            <ONhap
              value={keyForm.label}
              onChange={(value) => setKeyForm({ ...keyForm, label: value })}
              placeholder={t('settings.providers.keys.labelPlaceholder')}
            />
            <ONhap
              value={keyForm.apiKey}
              onChange={(value) => setKeyForm({ ...keyForm, apiKey: value })}
              type="password"
              visibilityResetKey={keyForm.keyId}
              placeholder={
                keyForm.keyId === null
                  ? t('settings.providers.keys.keyPlaceholder')
                  : t('settings.providers.keys.editPlaceholder')
              }
            />
            <ONhap
              value={keyForm.priority}
              onChange={(value) => setKeyForm({ ...keyForm, priority: value })}
              placeholder={t('settings.providers.keys.priorityPlaceholder')}
            />
          </div>
          <label className="hang" style={{ gap: 6, marginTop: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={keyForm.enabled}
              onChange={(event) => setKeyForm({ ...keyForm, enabled: event.target.checked })}
            />
            {t('settings.providers.keys.enabled')}
          </label>
          <div className="hang" style={{ marginTop: 8 }}>
            <Nut onClick={() => void luuKhoa()} dangTai={dangLuu}>
              {keyForm.keyId === null ? t('settings.providers.keys.submit') : t('common.save')}
            </Nut>
            <Nut bien="phu" onClick={() => setKeyForm(null)}>
              {t('settings.providers.keys.cancelEdit')}
            </Nut>
          </div>
        </div>
      ) : (
        <div className="hang" style={{ marginTop: 10 }}>
          <Nut bien="phu" nho onClick={moThemKhoa}>
            {t('settings.providers.keys.addTitle')}
          </Nut>
        </div>
      )}

      {/*
        Khối lấy/import model cũ (chọn khoá, gọi /models, tích từng dòng) đã chuyển vào
        `HopThoaiChonModel`. Ở đây chỉ còn một nút mở hộp thoại đó với `providerId` đã
        khoá sẵn, nên người dùng không phải chọn lại nhà cung cấp; nhờ vậy chỉ còn MỘT nơi
        làm việc này thay vì hai bản dễ lệch nhau.
      */}
      <div style={{ marginTop: 16, borderTop: '1px solid var(--mau-vien)', paddingTop: 12 }}>
        <div className="hang" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Nut bien="phu" nho onClick={() => setChonModelMo(true)}>
            {t('settings.models.fetch.open')}
          </Nut>
          <Nut bien="phu" nho onClick={() => setXacNhanPurge(true)} dangTai={dangPurge}>
            {t('settings.models.purge')}
          </Nut>
        </div>
      </div>

      <HopThoaiChonModel
        mo={chonModelMo}
        companyId={companyId}
        providerId={provider.id}
        // `onDaNhap` tải lại danh sách provider để bảng model bên ngoài thấy model vừa thêm.
        onDaNhap={onChanged}
        onDong={() => setChonModelMo(false)}
      />

      <HopThoaiXacNhan
        mo={xacNhanPurge}
        tieuDe={t('settings.models.purge')}
        moTa={t('settings.models.purgeConfirm', { name: provider.name })}
        nhanXacNhan={t('settings.models.purge')}
        dangXuLy={dangPurge}
        onXacNhan={() => void purgeModels()}
        onHuy={() => {
          if (!dangPurge) setXacNhanPurge(false)
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ model */

function PhanModel({ companyId }: { companyId: string }): ReactNode {
  const tabActive = useSettingsTabActive()
  const { t, formatNumber, formatCurrencyUsd } = useI18n()
  const { begin } = useSettingsNotifications(companyId)
  const [providers, setProviders] = useState<readonly ProviderView[] | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [label, setLabel] = useState('')
  const [contextWindow, setContextWindow] = useState('128000')
  const [costIn, setCostIn] = useState('0')
  const [costOut, setCostOut] = useState('0')
  const [hoTroTool, setHoTroTool] = useState(true)
  const [hoTroAnh, setHoTroAnh] = useState(false)
  const [dangDoiVision, setDangDoiVision] = useState<string | null>(null)

  const [dangLuu, setDangLuu] = useState(false)
  /** Lỗi của biểu mẫu thêm model — hiện BÊN TRONG hộp thoại, xem chú thích ở chỗ render. */
  const [loiLuu, setLoiLuu] = useState<string | null>(null)
  const [dangPurge, setDangPurge] = useState<string | null>(null)

  // Hộp thoại lấy model đặt ngay trong mục Model: đây mới là chỗ người dùng tìm khi cần
  // thêm model, còn khối fetch cũ nằm trong bảng khoá của nhà cung cấp thì không ai thấy.
  const [moChonModel, setMoChonModel] = useState(false)

  /**
   * Hộp thoại nhập model bằng tay.
   *
   * Tách khỏi `moChonModel` vì đây là hai đường khác nhau: lấy danh sách từ nhà cung cấp,
   * và tự khai một model mà nhà cung cấp không trả về. Gộp làm một hộp thoại sẽ khiến nó
   * phải chứa cả hai luồng và khó hiểu hơn cả hai.
   */
  const [moThemModel, setMoThemModel] = useState(false)

  // Hộp thoại xác nhận giữ ĐỐI TƯỢNG cần xoá thay vì một cờ boolean: nhờ vậy câu xác nhận
  // luôn nhắc đúng tên model/nhà cung cấp, kể cả khi danh sách đã được tải lại sau đó.
  const [suaGia, setSuaGia] = useState<{ companyId: string; model: ModelOptionView } | null>(null)
  useEffect(() => { setSuaGia(null) }, [companyId])
  const [choXoaModel, setChoXoaModel] = useState<ModelOptionView | null>(null)
  const [dangXoaModel, setDangXoaModel] = useState(false)
  const [choPurge, setChoPurge] = useState<ProviderView | null>(null)

  useEffect(() => {
    if (!tabActive) return
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    api
      .providers(companyId)
      .then((ketQua) => {
        if (cancelled) return
        setProviders(ketQua.providers)
        setProviderId((hienTai) => (hienTai.length > 0 ? hienTai : (ketQua.providers[0]?.id ?? '')))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', t('common.cannotConnectServer')))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, lanThu, tabActive])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  const tatCaModel: readonly ModelOptionView[] = useMemo(
    () => (providers ?? []).flatMap((provider) => provider.models),
    [providers],
  )

  /** Xoá trắng biểu mẫu nhập model. */
  function xoaBieuMauModel(): void {
    setProviderId('')
    setModelId('')
    setLabel('')
    setContextWindow('128000')
    setCostIn('0')
    setCostOut('0')
    setHoTroTool(true)
    setHoTroAnh(false)
    setLoiLuu(null)
  }

  /**
   * Đóng hộp thoại và xoá sạch biểu mẫu.
   *
   * Vì sao phải xoá: trạng thái biểu mẫu sống ngoài hộp thoại, nên nếu chỉ ẩn hộp thoại thì
   * lần sau bấm "Thêm model" người dùng thấy nguyên dữ liệu của lần trước và rất dễ gửi
   * nhầm. Hàm này cũng là `onDong`, nên nó chạy cho cả `Esc` lẫn bấm ra ngoài.
   */
  function dongHopThoaiModel(): void {
    setMoThemModel(false)
    xoaBieuMauModel()
  }

  /** Mở hộp thoại nhập model, luôn bắt đầu từ biểu mẫu trắng. */
  function moThemModelMoi(): void {
    xoaBieuMauModel()

    setMoThemModel(true)
  }

  async function luu(): Promise<void> {
    setLoiLuu(null)

    if (providerId.length === 0 || modelId.trim().length === 0 || label.trim().length === 0) {
      setLoiLuu(t('settings.models.needFields'))
      return
    }
    setDangLuu(true)
    const finish = begin('model.save')
    try {
      await api.createModel(companyId, {
        providerId,
        modelId: modelId.trim(),
        label: label.trim(),
        contextWindow: Math.round(soTuChuoi(contextWindow)),
        supportsTools: hoTroTool,
        supportsVision: hoTroAnh,
        costInPerMtok: soTuChuoi(costIn),
        costOutPerMtok: soTuChuoi(costOut),
      })
      // Đóng hộp thoại và xoá biểu mẫu qua MỘT đường duy nhất (`dongHopThoaiModel`), thay vì
      // tự đặt lại từng trường ở đây: hai nơi cùng xoá biểu mẫu thì sớm muộn sẽ lệch nhau.
      // Hộp thoại mở lại lần sau vì thế luôn là biểu mẫu trắng.
      finish('success')
      dongHopThoaiModel()
      taiLai()
    } catch (error) {
      // Giữ nguyên nháp sau lỗi để người dùng sửa và thử lại.
      finish('error')
    } finally {
      setDangLuu(false)
    }
  }

  async function xoaModel(): Promise<void> {
    const model = choXoaModel
    if (!model) return
    setDangXoaModel(true)

    const finish = begin('model.delete')
    try {
      await api.deleteModel(companyId, model.id)
      finish('success')
      setChoXoaModel(null)
      taiLai()
    } catch (error) {
      finish('error')
      // Hộp thoại xác nhận không chứa biểu mẫu cần giữ lại.
      setChoXoaModel(null)
    } finally {
      setDangXoaModel(false)
    }
  }

  async function doiVision(model: ModelOptionView): Promise<void> {
    setDangDoiVision(model.id)
    const finish = begin('model.save')
    try {
      await api.updateModelVision(companyId, model.id, !model.supportsVision)
      finish('success')
      taiLai()
    } catch (error) {
      finish('error')
      setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', t('common.cannotConnectServer')))
    } finally { setDangDoiVision(null) }
  }

  async function xoaModelKhongDung(): Promise<void> {
    const provider = choPurge
    if (!provider) return
    setDangPurge(provider.id)

    const finish = begin('model.purge')
    try {
      await api.purgeProviderModels(companyId, provider.id)
      finish('success')
      setChoPurge(null)
      taiLai()
    } catch (error) {
      finish('error')
      setChoPurge(null)
    } finally {
      setDangPurge(null)
    }
  }

  return (
    <Card
      tieuDe={t('settings.models.title')}
      phu={t('settings.models.subtitle')}
      // Hai nút đặt cạnh tiêu đề mục Model — đúng chỗ người dùng đi tìm khi muốn thêm model,
      // thay vì phải mở một dòng nhà cung cấp rồi cuộn xuống bảng khoá. Nút lấy danh sách là
      // đường đi phổ biến nên để kiểu chính; nhập tay là đường dự phòng cho model mà nhà cung
      // cấp không trả về, nên để kiểu phụ.
      hanhDong={
        <div className="hang" style={{ gap: 8 }}>
          <Nut bien="phu" nho onClick={moThemModelMoi}>
            {t('settings.models.add')}
          </Nut>
          <Nut nho onClick={() => setMoChonModel(true)}>
            {t('settings.models.fetch.open')}
          </Nut>
        </div>
      }
    >
      <TrangThai dangTai={dangTai} loi={loi} taiLai={taiLai} />


      {providers && providers.length === 0 ? <Trong>{t('settings.models.emptyNoProvider')}</Trong> : null}

      {providers && providers.length > 0 && tatCaModel.length === 0 ? (
        <Trong>{t('settings.models.empty')}</Trong>
      ) : null}

      {providers && providers.length > 0 ? (
        <div className="hang" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          {providers
            .filter((provider) => provider.models.length > 0)
            .map((provider) => (
              <Nut
                key={provider.id}
                bien="phu"
                nho
                onClick={() => setChoPurge(provider)}
                dangTai={dangPurge === provider.id}
              >
                {t('settings.models.purge')} · {provider.name}
              </Nut>
            ))}
        </div>
      ) : null}

      {tatCaModel.length > 0 ? (
        <div className="settings-table" role="region" aria-label={t('settings.models.title')} tabIndex={0}>
        <table className="bang">
          <thead>
            <tr>
              <th>{t('settings.models.table.label')}</th>
              <th>{t('settings.models.table.modelId')}</th>
              <th>{t('settings.models.table.provider')}</th>
              <th>{t('settings.models.table.context')}</th>
              <th>{t('settings.models.table.tools')}</th>
              <th>{t('settings.models.vision')}</th>
              <th>{t('settings.models.table.usage')}</th>
              <th>{t('settings.models.table.costIn')}</th>
              <th>{t('settings.models.table.costOut')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tatCaModel.map((model) => (
              <tr key={model.id}>
                <td>
                  <strong>{model.label}</strong>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{model.modelId}</td>
                <td>{model.providerName}</td>
                <td className="so">{formatNumber(model.contextWindow)}</td>
                <td>
                  {model.supportsTools ? (
                    <Nhan loai="thanh-cong">{t('common.yes')}</Nhan>
                  ) : (
                    <Nhan loai="canh-bao">{t('common.no')}</Nhan>
                  )}
                </td>
                <td>
                  <input type="checkbox" checked={model.supportsVision ?? false}
                    disabled={dangDoiVision !== null} aria-label={t('settings.models.visionLabel', { model: model.label })}
                    title={t('settings.models.visionNote')} onChange={() => void doiVision(model)} />
                </td>
                <td className="so">
                  {model.usedByAgentCount > 0
                    ? t('settings.models.usageCount', { count: formatNumber(model.usedByAgentCount) })
                    : t('common.none')}
                </td>
                <td className="so">{formatNumber(model.costInPerMtok, { maximumFractionDigits: 12 })}</td>
                <td className="so">{formatNumber(model.costOutPerMtok, { maximumFractionDigits: 12 })}</td>
                <td>
                  <Nut bien="phu" nho onClick={() => setSuaGia({ companyId, model })}>
                    {t('settings.models.pricing.title')}
                  </Nut>
                  <Nut
                    bien="nguy-hiem"
                    nho
                    disabled={model.usedByAgentCount > 0}
                    title={model.usedByAgentCount > 0 ? t('settings.models.deleteFailed') : undefined}
                    onClick={() => setChoXoaModel(model)}
                  >
                    {t('settings.models.delete')}
                  </Nut>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : null}

      {suaGia?.companyId === companyId ? (
        <ModelPricingDialog key={`${companyId}:${suaGia.model.id}`} companyId={companyId} model={suaGia.model}
          onClose={() => setSuaGia(null)} onSaved={taiLai} />
      ) : null}

      {/*
        Biểu mẫu nhập model nằm trong hộp thoại, chỉ mở khi bấm nút "Thêm model" ở đầu mục.
        Trước đây nó là một khối tĩnh luôn hiện ở cuối mục, làm mục này nặng và đẩy bảng
        model lên trên — trong khi phần lớn người dùng đi đường "Lấy danh sách model".
      */}
      <HopThoai
        mo={moThemModel}
        tieuDe={t('settings.models.form.title')}
        onDong={dongHopThoaiModel}
        chanDung={
          <>
            <Nut bien="phu" nho onClick={dongHopThoaiModel} disabled={dangLuu}>
              {t('common.cancel')}
            </Nut>
            <Nut nho onClick={() => void luu()} dangTai={dangLuu} disabled={providers !== null && providers.length === 0}>
              {t('settings.models.form.submit')}
            </Nut>
          </>
        }
      >
        <div className="cot" style={{ gap: 10 }}>
          <div className="luoi luoi--2">
            <OChon
              value={providerId}
              onChange={setProviderId}
              options={(providers ?? []).map((provider) => ({ value: provider.id, label: provider.name }))}
            />
            <ONhap value={modelId} onChange={setModelId} placeholder={t('settings.models.form.modelIdPlaceholder')} />
            <ONhap value={label} onChange={setLabel} placeholder={t('settings.models.form.labelPlaceholder')} />
            <ONhap
              value={contextWindow}
              onChange={setContextWindow}
              placeholder={t('settings.models.form.contextPlaceholder')}
            />
            <ONhap value={costIn} onChange={setCostIn} placeholder={t('settings.models.form.costInPlaceholder')} />
            <ONhap value={costOut} onChange={setCostOut} placeholder={t('settings.models.form.costOutPlaceholder')} />
          </div>
          <label className="hang" style={{ gap: 6, fontSize: 14 }}>
            <input type="checkbox" checked={hoTroTool} onChange={(event) => setHoTroTool(event.target.checked)} />
            {t('settings.models.form.supportsTools')}
          </label>
          <label className="hang" style={{ gap: 6, fontSize: 14 }}>
            <input type="checkbox" checked={hoTroAnh} onChange={(event) => setHoTroAnh(event.target.checked)} />
            {t('settings.models.vision')}
          </label>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--mau-chu-mo)' }}>{t('settings.models.visionNote')}</p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--mau-chu-mo)' }}>
            {t('settings.models.form.toolsNote')}
          </p>
          {/* Lỗi lưu phải nằm TRONG hộp thoại: hiện ở đầu mục thì bị lớp phủ che, người dùng
              chỉ thấy nút Lưu không phản hồi. Hộp thoại cũng Ở LẠI khi lỗi để sửa và thử lại. */}
          {loiLuu ? <ThongBao loai="loi">{loiLuu}</ThongBao> : null}
        </div>
      </HopThoai>

      {/* Không truyền `providerId`: người dùng chọn nhà cung cấp ngay trong hộp thoại, vì
          mục Model gom model của mọi nhà cung cấp. */}
      <HopThoaiChonModel
        mo={moChonModel}
        companyId={companyId}
        onDong={() => setMoChonModel(false)}
        // Bảng model bên ngoài phải tải lại, nếu không model vừa thêm không xuất hiện.
        onDaNhap={() => void taiLai()}
      />

      <HopThoaiXacNhan
        mo={choXoaModel !== null}
        tieuDe={t('settings.models.deleteTitle')}
        moTa={choXoaModel ? t('settings.models.deleteConfirm', { label: choXoaModel.label }) : ''}
        nhanXacNhan={t('common.delete')}
        dangXuLy={dangXoaModel}
        onXacNhan={() => void xoaModel()}
        onHuy={() => {
          if (!dangXoaModel) setChoXoaModel(null)
        }}
      />

      <HopThoaiXacNhan
        mo={choPurge !== null}
        tieuDe={t('settings.models.purgeTitle')}
        moTa={choPurge ? t('settings.models.purgeConfirm', { name: choPurge.name }) : ''}
        nhanXacNhan={t('settings.models.purge')}
        dangXuLy={dangPurge !== null}
        onXacNhan={() => void xoaModelKhongDung()}
        onHuy={() => {
          if (dangPurge === null) setChoPurge(null)
        }}
      />
    </Card>
  )
}

/* ------------------------------------------------------- route theo tier */

function PhanRoute({ companyId }: { companyId: string }): ReactNode {
  const tabActive = useSettingsTabActive()
  const { t, formatNumber } = useI18n()
  const { begin } = useSettingsNotifications(companyId)
  const [routes, setRoutes] = useState<readonly ModelRouteView[] | null>(null)
  const [models, setModels] = useState<readonly ModelOptionView[]>([])
  const [agents, setAgents] = useState<readonly { id: string; label: string }[]>([])
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [agentDefId, setAgentDefId] = useState('')
  const [tier, setTier] = useState<ModelTier>('standard')
  const [modelFk, setModelFk] = useState('')

  const [dangLuu, setDangLuu] = useState(false)
  const [loiLuu, setLoiLuu] = useState<string | null>(null)

  useEffect(() => {
    if (!tabActive) return
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    Promise.all([api.routes(companyId), api.providers(companyId), api.team(companyId)])
      .then(([ketQuaRoute, ketQuaProvider, ketQuaTeam]) => {
        if (cancelled) return
        setRoutes(ketQuaRoute.routes)
        const modelList = ketQuaProvider.providers.flatMap((provider) => provider.models)
        setModels(modelList)
        setAgents(ketQuaTeam.members.map((member) => ({ id: member.agentDefId, label: member.displayName })))
        setAgentDefId((hienTai) => (hienTai.length > 0 ? hienTai : (ketQuaTeam.members[0]?.agentDefId ?? '')))
        setModelFk((hienTai) => (hienTai.length > 0 ? hienTai : (modelList[0]?.id ?? '')))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', t('common.cannotConnectServer')))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, lanThu, tabActive])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  const nhanAgent = useMemo(() => {
    const map = new Map<string, string>()
    for (const agent of agents) map.set(agent.id, agent.label)
    return map
  }, [agents])

  async function luu(): Promise<void> {
    setLoiLuu(null)

    if (agentDefId.length === 0 || modelFk.length === 0) {
      setLoiLuu(t('settings.routes.needAgentAndModel'))
      return
    }
    setDangLuu(true)
    const finish = begin('route.save')
    try {
      await api.upsertRoute(companyId, { agentDefId, tier, modelFk })
      finish('success')
      taiLai()
    } catch (error) {
      finish('error')
    } finally {
      setDangLuu(false)
    }
  }

  return (
    <Card tieuDe={t('settings.routes.title')} phu={t('settings.routes.subtitle')}>
      <TrangThai dangTai={dangTai} loi={loi} taiLai={taiLai} />

      {loiLuu ? (
        <div style={{ marginBottom: 10 }}>
          <ThongBao loai="loi">{loiLuu}</ThongBao>
        </div>
      ) : null}

      {routes && routes.length === 0 ? <Trong>{t('settings.routes.empty')}</Trong> : null}

      {routes && routes.length > 0 ? (
        <div className="settings-table" role="region" aria-label={t('settings.routes.title')} tabIndex={0}>
        <table className="bang">
          <thead>
            <tr>
              <th>{t('settings.routes.table.agent')}</th>
              <th>{t('settings.routes.table.role')}</th>
              <th>{t('settings.routes.table.tier')}</th>
              <th>{t('settings.routes.table.model')}</th>
              <th>{t('settings.routes.table.priority')}</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => (
              <tr key={route.id}>
                <td>{nhanAgent.get(route.agentDefId) ?? route.agentDefId}</td>
                <td>{route.role}</td>
                <td>
                  <Nhan loai="mo">{t(NHAN_TIER[route.tier])}</Nhan>
                </td>
                <td>{route.modelLabel}</td>
                <td className="so">{formatNumber(route.priority)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : null}

      <h3 className="card__tieu-de" style={{ marginTop: 18 }}>
        {t('settings.routes.form.title')}
      </h3>
      <div className="luoi luoi--3">
        <OChon value={agentDefId} onChange={setAgentDefId} options={agents.map((agent) => ({ value: agent.id, label: agent.label }))} />
        <OChon
          value={tier}
          onChange={(giaTri) => {
            if (laTier(giaTri)) setTier(giaTri)
          }}
          options={MODEL_TIERS.map((item) => ({ value: item, label: t(NHAN_TIER[item]) }))}
        />
        <OChon
          value={modelFk}
          onChange={setModelFk}
          options={models.map((model) => ({
            value: model.id,
            label: t('settings.routes.modelOption', { label: model.label, provider: model.providerName }),
          }))}
        />
      </div>
      <div className="hang" style={{ marginTop: 10 }}>
        <Nut
          onClick={() => void luu()}
          dangTai={dangLuu}
          disabled={agents.length === 0 || models.length === 0}
        >
          {t('settings.routes.form.submit')}
        </Nut>
      </div>
    </Card>
  )
}

/* ----------------------------------------------------------- kết nối ngoài */

function PhanKetNoi({ companyId }: { companyId: string }): ReactNode {
  const { t, formatNumber, formatDateTime } = useI18n()
  const { begin } = useSettingsNotifications(companyId)
  const [danhSach, setDanhSach] = useState<readonly IntegrationView[] | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [kind, setKind] = useState<IntegrationKind>('firecrawl')
  const [ten, setTen] = useState('')
  const [configJson, setConfigJson] = useState('{}')
  const [firecrawlKey, setFirecrawlKey] = useState('')
  const [firecrawlUrl, setFirecrawlUrl] = useState('')
  const [moNangCao, setMoNangCao] = useState(false)
  const [moThemKetNoi, setMoThemKetNoi] = useState(false)
  const congTyKetNoiRef = useRef(companyId)
  congTyKetNoiRef.current = companyId
  const luotKetNoiRef = useRef(0)
  const dangLuuKetNoiRef = useRef(false)

  const [dangLuu, setDangLuu] = useState(false)
  const [loiLuu, setLoiLuu] = useState<string | null>(null)

  function xoaBieuMauKetNoi(): void {
    setKind('firecrawl')
    setTen('')
    setConfigJson('{}')
    setFirecrawlKey('')
    setFirecrawlUrl('')
    setMoNangCao(false)
    setLoiLuu(null)
  }

  function doiLoaiKetNoi(value: string): void {
    if (!laIntegrationKind(value)) return
    // Không giữ bí mật trong nháp khi chuyển sang dịch vụ khác.
    xoaBieuMauKetNoi()
    setKind(value)
  }

  function dongHopThoaiKetNoi(): void {
    setMoThemKetNoi(false)
    xoaBieuMauKetNoi()
  }

  function moKetNoiMoi(): void {
    if (dangLuuKetNoiRef.current) return
    xoaBieuMauKetNoi()

    setMoThemKetNoi(true)
  }

  useEffect(() => {
    // Đổi công ty phải bỏ nháp và vô hiệu phản hồi cũ; cấu hình có thể chứa bí mật nên
    // tuyệt đối không mang nó, hay thông báo của lượt lưu trước, sang công ty mới.
    dongHopThoaiKetNoi()

    setDangLuu(false)
    dangLuuKetNoiRef.current = false

    setDangTest(null)
    return () => {
      luotKetNoiRef.current += 1
    }
  }, [companyId])

  const [dangTest, setDangTest] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    api
      .integrations(companyId)
      .then((ketQua) => {
        if (!cancelled) setDanhSach(ketQua.integrations)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', t('common.cannotConnectServer')))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, lanThu])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  async function luu(): Promise<void> {
    setLoiLuu(null)

    const name = kind === 'firecrawl' ? firecrawlConnectionName(ten) : ten.trim()
    if (!name) {
      setLoiLuu(t('settings.integrations.needName'))
      return
    }
    let config: Record<string, unknown>
    if (kind === 'firecrawl') {
      const result = buildFirecrawlConfig(firecrawlKey, firecrawlUrl)
      if (!result.success) {
        setLoiLuu(t(firecrawlKey.trim() ? 'settings.integrations.firecrawl.invalidUrl' : 'settings.integrations.firecrawl.needKey'))
        return
      }
      config = result.data
    } else {
      try {
        const parsed: unknown = JSON.parse(configJson)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setLoiLuu(t('settings.integrations.configMustBeObject'))
          return
        }
        config = parsed as Record<string, unknown>
      } catch {
        setLoiLuu(t('settings.integrations.configInvalidJson'))
        return
      }
    }
    // Chặn gửi lặp ngay trong cùng một nhịp, trước khi trạng thái React kịp cập nhật.
    if (dangLuuKetNoiRef.current) return
    dangLuuKetNoiRef.current = true
    const luotLuu = ++luotKetNoiRef.current
    const vanDungNguCanh = (): boolean =>
      luotLuu === luotKetNoiRef.current && companyId === congTyKetNoiRef.current
    setDangLuu(true)

    const finish = begin('integration.save')
    try {
      await api.upsertIntegration(companyId, { kind, name, config })
      if (!vanDungNguCanh()) return
      finish('success')
      dongHopThoaiKetNoi()
      taiLai()
    } catch (error) {
      if (!vanDungNguCanh()) return
      finish('error')
    } finally {
      if (vanDungNguCanh()) {
        dangLuuKetNoiRef.current = false
        setDangLuu(false)
      }
    }
  }

  async function test(integration: IntegrationView): Promise<void> {
    setDangTest(integration.id)
    const finish = begin('integration.test')
    try {
      const ketQua = await api.testIntegration(companyId, integration.id)
      finish(ketQua.ok ? 'success' : 'error')
    } catch (error) {
      finish('error')
    } finally {
      setDangTest(null)
    }
  }

  return (
    <Card
      tieuDe={t('settings.integrations.title')}
      phu={t('settings.integrations.subtitle')}
      hanhDong={
        <Nut nho onClick={moKetNoiMoi} disabled={dangLuu}>
          {t('settings.integrations.add')}
        </Nut>
      }
    >
      <TrangThai dangTai={dangTai} loi={loi} taiLai={taiLai} />



      <p style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>{t('settings.integrations.testNote')}</p>
      {danhSach && danhSach.length === 0 ? <Trong>{t('settings.integrations.empty')}</Trong> : null}

      {danhSach && danhSach.length > 0 ? (
        <div className="settings-table" role="region" aria-label={t('settings.integrations.title')} tabIndex={0}>
        <table className="bang">
          <thead>
            <tr>
              <th>{t('settings.integrations.table.kind')}</th>
              <th>{t('settings.integrations.table.name')}</th>
              <th>{t('settings.integrations.table.status')}</th>
              <th>{t('settings.integrations.table.config')}</th>
              <th>{t('settings.integrations.table.lastCheck')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {danhSach.map((integration) => (
              <tr key={integration.id}>
                <td>{t(NHAN_INTEGRATION[integration.kind])}</td>
                <td>{integration.name}</td>
                <td>
                  <Nhan loai={integration.status === 'ok' || integration.status === 'connected' ? 'thanh-cong' : 'mo'}>
                    {integration.status}
                  </Nhan>
                </td>
                <td>
                  {integration.configured ? (
                    <Nhan loai="thanh-cong">{t('settings.integrations.configured')}</Nhan>
                  ) : (
                    <Nhan loai="canh-bao">{t('settings.integrations.missingConfig')}</Nhan>
                  )}
                </td>
                <td>{formatDateTime(integration.lastCheckAt ?? '')}</td>
                <td>
                  <Nut bien="phu" nho onClick={() => void test(integration)} dangTai={dangTest === integration.id}>
                    {t('settings.integrations.test')}
                  </Nut>


                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ) : null}

      {/* Form chỉ mở từ nút Thêm kết nối, không chiếm chỗ thường trực dưới bảng. */}
      <HopThoai
        mo={moThemKetNoi}
        tieuDe={t('settings.integrations.form.title')}
        onDong={dongHopThoaiKetNoi}
        chanDung={
          <>
            <Nut bien="phu" nho onClick={dongHopThoaiKetNoi} disabled={dangLuu}>
              {t('common.cancel')}
            </Nut>
            <Nut nho onClick={() => void luu()} dangTai={dangLuu}>
              {t('settings.integrations.form.submit')}
            </Nut>
          </>
        }
      >
        <div className="luoi luoi--2">
          <OChon
            value={kind}
            disabled={dangLuu}
            onChange={doiLoaiKetNoi}
            options={INTEGRATION_KINDS.map((item) => ({ value: item, label: t(NHAN_INTEGRATION[item]) }))}
          />
          <Truong nhan={t(kind === 'firecrawl' ? 'settings.integrations.firecrawl.nameOptional' : 'settings.integrations.table.name')}>
            <ONhap value={ten} onChange={setTen} disabled={dangLuu} placeholder={kind === 'firecrawl' ? 'Firecrawl' : t('settings.integrations.form.namePlaceholder')} />
          </Truong>
        </div>
        {kind === 'firecrawl' ? (
          <div className="cot" style={{ marginTop: 12 }}>
            <Truong nhan={t('settings.integrations.firecrawl.apiKey')} goiY={t('settings.integrations.firecrawl.keyNote')}>
              <ONhap type="password" visibilityResetKey={moThemKetNoi} value={firecrawlKey} onChange={setFirecrawlKey} disabled={dangLuu} placeholder="fc-…" />
            </Truong>
            <p style={{ margin: 0, color: 'var(--mau-chu-mo)', fontSize: 13 }}>{t('settings.integrations.firecrawl.updateNote')}</p>
            <details open={moNangCao} onToggle={(event) => setMoNangCao(event.currentTarget.open)}>
              <summary>{t('settings.integrations.firecrawl.advanced')}</summary>
              <Truong nhan={t('settings.integrations.firecrawl.baseUrl')} goiY={t('settings.integrations.firecrawl.urlNote')}>
                <ONhap value={firecrawlUrl} onChange={setFirecrawlUrl} disabled={dangLuu} placeholder="https://api.firecrawl.dev" />
              </Truong>
            </details>
          </div>
        ) : (
        <div style={{ marginTop: 12 }}>
          <label className="cot" style={{ gap: 6 }}>
            <span className="nhan">{t('settings.integrations.form.configLabel')}</span>
            <textarea
              className="o-van-ban"
              value={configJson}
              rows={5}
              disabled={dangLuu}
              onChange={(event) => setConfigJson(event.target.value)}
              placeholder={t('settings.integrations.form.configPlaceholder')}
            />
          </label>
          <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{t('settings.integrations.form.configNote')}</div>
        </div>
        )}
        {/* Lỗi nhập liệu phải ở trong cửa sổ, không bị lớp phủ che ở đầu mục. */}
        {loiLuu ? <ThongBao loai="loi">{loiLuu}</ThongBao> : null}
      </HopThoai>
    </Card>
  )
}

/* -------------------------------------------------------------- giới hạn */

function PhanGioiHan({ companyId }: { companyId: string }): ReactNode {
  const { t, formatCurrencyUsd } = useI18n()
  const { begin } = useSettingsNotifications(companyId)
  // Tên công ty đang mở: giới hạn lưu theo `companyId`, nên phải nói rõ đang sửa cho
  // công ty nào — người thuộc nhiều công ty rất dễ sửa nhầm.
  const { company: congTyDangMo } = useSession()
  const [duLieu, setDuLieu] = useState<{
    dailyCostUsd: string
    taskCostUsd: string
    maxStepsPerRun: string
    maxPeerRounds: string
    maxRevisionsPerTask: string
    maxParallelTasks: string
  } | null>(null)
  const [usedTodayUsd, setUsedTodayUsd] = useState(0)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [dangLuu, setDangLuu] = useState(false)

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    api
      .limits(companyId)
      .then((ketQua) => {
        if (cancelled) return
        setUsedTodayUsd(ketQua.usedTodayUsd)
        setDuLieu({
          dailyCostUsd: String(ketQua.dailyCostUsd),
          taskCostUsd: String(ketQua.taskCostUsd),
          maxStepsPerRun: String(ketQua.maxStepsPerRun),
          maxPeerRounds: String(ketQua.maxPeerRounds),
          maxRevisionsPerTask: String(ketQua.maxRevisionsPerTask),
          maxParallelTasks: String(ketQua.maxParallelTasks),
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', t('common.cannotConnectServer')))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, lanThu])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  async function luu(): Promise<void> {
    if (!duLieu) return

    setDangLuu(true)
    const finish = begin('limits.save')
    try {
      const ketQua = await api.updateLimits(companyId, {
        dailyCostUsd: soTuChuoi(duLieu.dailyCostUsd),
        taskCostUsd: soTuChuoi(duLieu.taskCostUsd),
        maxStepsPerRun: Math.round(soTuChuoi(duLieu.maxStepsPerRun)),
        maxPeerRounds: Math.round(soTuChuoi(duLieu.maxPeerRounds)),
        maxRevisionsPerTask: Math.round(soTuChuoi(duLieu.maxRevisionsPerTask)),
        maxParallelTasks: Math.round(soTuChuoi(duLieu.maxParallelTasks)),
      })
      setUsedTodayUsd(ketQua.usedTodayUsd)
      finish('success')
    } catch (error) {
      finish('error')
    } finally {
      setDangLuu(false)
    }
  }

  const tran = duLieu ? soTuChuoi(duLieu.dailyCostUsd) : 0
  const tyLe = tran > 0 ? (usedTodayUsd / tran) * 100 : 0
  const phanTram = Math.max(0, Math.min(100, tyLe))

  return (
    <Card tieuDe={t('settings.limits.title')} phu={t('settings.limits.subtitle')}>
      <TrangThai dangTai={dangTai} loi={loi} taiLai={taiLai} />

      {duLieu ? (
        <>
          <div className="hang" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span>
              {t('settings.limits.used24hPrefix')}{' '}
              <strong className="so">{formatCurrencyUsd(usedTodayUsd)}</strong> {t('settings.limits.limitPrefix')}{' '}
              <strong className="so">{formatCurrencyUsd(tran)}</strong>
            </span>
            <span style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>
              {tran > 0 ? `${Math.round(tyLe)}%` : t('settings.limits.noCap')}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--mau-vien)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${phanTram}%`,
                borderRadius: 999,
                background: phanTram >= 80 ? 'var(--mau-loi)' : 'var(--mau-chinh)',
                transition: 'width 0.2s ease',
              }}
            />
          </div>

          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--mau-chu-mo)' }}>
            {t('settings.limits.companyScope', { company: congTyDangMo?.name ?? companyId })}
          </div>



          <div className="luoi luoi--3" style={{ marginTop: 14 }}>
            <div>
              <div className="nhan">{t('settings.limits.dailyCost')}</div>
              <ONhap value={duLieu.dailyCostUsd} onChange={(v) => setDuLieu({ ...duLieu, dailyCostUsd: v })} />
            </div>
            <div>
              <div className="nhan">{t('settings.limits.taskCost')}</div>
              <ONhap value={duLieu.taskCostUsd} onChange={(v) => setDuLieu({ ...duLieu, taskCostUsd: v })} />
            </div>
            <div>
              <div className="nhan">{t('settings.limits.maxSteps')}</div>
              <ONhap value={duLieu.maxStepsPerRun} onChange={(v) => setDuLieu({ ...duLieu, maxStepsPerRun: v })} />
            </div>
            <div>
              <div className="nhan">{t('settings.limits.maxPeerRounds')}</div>
              <ONhap value={duLieu.maxPeerRounds} onChange={(v) => setDuLieu({ ...duLieu, maxPeerRounds: v })} />
            </div>
            <div>
              <div className="nhan">{t('settings.limits.maxRevisions')}</div>
              <ONhap
                value={duLieu.maxRevisionsPerTask}
                onChange={(v) => setDuLieu({ ...duLieu, maxRevisionsPerTask: v })}
              />
            </div>
            <div>
              <div className="nhan">{t('settings.limits.maxParallel')}</div>
              <ONhap value={duLieu.maxParallelTasks} onChange={(v) => setDuLieu({ ...duLieu, maxParallelTasks: v })} />
            </div>
          </div>

          <div className="hang" style={{ marginTop: 12 }}>
            <Nut onClick={() => void luu()} dangTai={dangLuu}>
              {t('settings.limits.submit')}
            </Nut>
          </div>
        </>
      ) : null}
    </Card>
  )
}

export function CaiDat({ companyId }: { companyId: string }): ReactNode {
  const { t } = useI18n()
  return (
    <Trang rong>
      <TieuDeTrang moTa={t('settings.subtitle')}>{t('settings.title')}</TieuDeTrang>

      <SettingsTabs panels={{
        providers: <PhanNhaCungCap companyId={companyId} />,
        models: <PhanModel companyId={companyId} />,
        routes: <PhanRoute companyId={companyId} />,
        knowledge: <KnowledgeModelSettings companyId={companyId} />,
        integrations: <PhanKetNoi companyId={companyId} />,
        limits: <PhanGioiHan companyId={companyId} />,
      }} />
    </Trang>
  )
}
