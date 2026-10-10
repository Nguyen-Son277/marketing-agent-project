/**
 * Cài đặt — nơi khai báo hạ tầng mà cả đội agent chạy trên đó.
 *
 * Vì sao màn hình này tồn tại: agent chỉ chạy được khi biết gọi model nào qua nhà
 * cung cấp nào, tốn bao nhiêu tiền, và được phép chạm vào kênh ngoài nào. Màn
 * hình này gom năm nhóm cấu hình đó lại, mỗi nhóm tự tải dữ liệu riêng để một
 * phần hỏng không kéo sập cả trang. Nguyên tắc bảo mật được nói thẳng trên giao
 * diện: API key là chỉ-ghi, gửi lên rồi thì không bao giờ hiển thị lại.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  IntegrationKind,
  IntegrationTestResponse,
  IntegrationView,
  ModelOptionView,
  ModelRouteView,
  ModelTier,
  ProviderKind,
  ProviderTestResponse,
  ProviderView,
} from '@marketing-agent/shared'
import { INTEGRATION_KINDS, MODEL_TIERS, PROVIDER_KINDS } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
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
  soNguyen,
  thoiDiem,
  tienUsd,
} from '../components/ui.tsx'

const NHAN_PROVIDER: Readonly<Record<ProviderKind, string>> = {
  openai_compatible: 'OpenAI-compatible',
  anthropic: 'Anthropic',
}

const NHAN_INTEGRATION: Readonly<Record<IntegrationKind, string>> = {
  firecrawl: 'Firecrawl (cào nội dung web)',
  'google-search-console': 'Google Search Console',
  'google-analytics': 'Google Analytics',
  'google-sheets': 'Google Sheets',
  meta: 'Meta (Facebook / Instagram)',
  linkedin: 'LinkedIn',
  'google-ads': 'Google Ads',
  'email-smtp': 'Email SMTP',
}

const NHAN_TIER: Readonly<Record<ModelTier, string>> = {
  light: 'Nhẹ (light)',
  standard: 'Chuẩn (standard)',
  deep: 'Sâu (deep)',
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
  return (
    <ThongBao loai="loi">
      {loi.message}
      {loi.needsConfiguration ? ' Kiểm tra lại nhà cung cấp và API key ngay tại màn hình này.' : null}
    </ThongBao>
  )
}

/** Khối trạng thái tải/lỗi dùng chung cho từng nhóm cấu hình. */
function TrangThai({ dangTai, loi, taiLai }: { dangTai: boolean; loi: ApiError | null; taiLai: () => void }): ReactNode {
  if (dangTai) return <DangTai />
  if (loi) {
    return (
      <div>
        <LoiManHinh loi={loi} />
        <div style={{ marginTop: 10 }}>
          <Nut bien="phu" nho onClick={taiLai}>
            Thử lại
          </Nut>
        </div>
      </div>
    )
  }
  return null
}

/* ------------------------------------------------------------ nhà cung cấp */

function PhanNhaCungCap({ companyId }: { companyId: string }): ReactNode {
  const [danhSach, setDanhSach] = useState<readonly ProviderView[] | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [suaId, setSuaId] = useState<string | null>(null)
  const [ten, setTen] = useState('')
  const [kind, setKind] = useState<ProviderKind>('openai_compatible')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [bat, setBat] = useState(true)

  const [dangLuu, setDangLuu] = useState(false)
  const [loiLuu, setLoiLuu] = useState<string | null>(null)
  const [thongBao, setThongBao] = useState<string | null>(null)

  const [dangTest, setDangTest] = useState<string | null>(null)
  const [ketQuaTest, setKetQuaTest] = useState<Record<string, ProviderTestResponse>>({})
  const [loiTest, setLoiTest] = useState<Record<string, string>>({})

  useEffect(() => {
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
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', 'Không kết nối được máy chủ.'))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, lanThu])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  function napVaoBieuMau(provider: ProviderView): void {
    setSuaId(provider.id)
    setTen(provider.name)
    setKind(provider.kind)
    setBaseUrl(provider.baseUrl)
    setApiKey('')
    setBat(provider.enabled)
    setLoiLuu(null)
    setThongBao(null)
  }

  function xoaBieuMau(): void {
    setSuaId(null)
    setTen('')
    setKind('openai_compatible')
    setBaseUrl('')
    setApiKey('')
    setBat(true)
    setLoiLuu(null)
    setThongBao(null)
  }

  async function luu(): Promise<void> {
    setLoiLuu(null)
    setThongBao(null)
    if (ten.trim().length === 0 || baseUrl.trim().length === 0) {
      setLoiLuu('Cần nhập tên nhà cung cấp và base URL.')
      return
    }
    setDangLuu(true)
    try {
      if (suaId) {
        await api.updateProvider(companyId, suaId, {
          name: ten.trim(),
          kind,
          baseUrl: baseUrl.trim(),
          enabled: bat,
          ...(apiKey.length > 0 ? { apiKey } : {}),
        })
        setThongBao('Đã cập nhật nhà cung cấp.')
      } else {
        await api.createProvider(companyId, {
          name: ten.trim(),
          kind,
          baseUrl: baseUrl.trim(),
          enabled: bat,
          ...(apiKey.length > 0 ? { apiKey } : {}),
        })
        setThongBao('Đã thêm nhà cung cấp.')
      }
      xoaBieuMau()
      taiLai()
    } catch (error) {
      setLoiLuu(error instanceof ApiError ? error.message : 'Không lưu được nhà cung cấp.')
    } finally {
      setDangLuu(false)
    }
  }

  async function test(provider: ProviderView): Promise<void> {
    setDangTest(provider.id)
    setLoiTest((truoc) => ({ ...truoc, [provider.id]: '' }))
    try {
      const ketQua = await api.testProvider(companyId, provider.id)
      setKetQuaTest((truoc) => ({ ...truoc, [provider.id]: ketQua }))
    } catch (error) {
      setLoiTest((truoc) => ({
        ...truoc,
        [provider.id]: error instanceof ApiError ? error.message : 'Không kiểm tra được kết nối.',
      }))
    } finally {
      setDangTest(null)
    }
  }

  return (
    <Card
      tieuDe="Nhà cung cấp model"
      phu="Nơi agent gửi yêu cầu tới. API key là chỉ-ghi: gửi lên một lần, server mã hoá, và không bao giờ trả lại giá trị gốc."
    >
      <TrangThai dangTai={dangTai} loi={loi} taiLai={taiLai} />

      {thongBao ? (
        <div style={{ marginBottom: 10 }}>
          <ThongBao loai="thanh-cong">{thongBao}</ThongBao>
        </div>
      ) : null}
      {loiLuu ? (
        <div style={{ marginBottom: 10 }}>
          <ThongBao loai="loi">{loiLuu}</ThongBao>
        </div>
      ) : null}

      {danhSach && danhSach.length === 0 ? (
        <Trong>Chưa có nhà cung cấp nào. Thêm một nhà cung cấp OpenAI-compatible để agent gọi được model.</Trong>
      ) : null}

      {danhSach && danhSach.length > 0 ? (
        <table className="bang">
          <thead>
            <tr>
              <th>Tên</th>
              <th>Loại</th>
              <th>Base URL</th>
              <th>API key</th>
              <th>Model</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {danhSach.map((provider) => (
              <tr key={provider.id}>
                <td>
                  <strong>{provider.name}</strong>
                  {provider.isGlobal ? <div><Nhan loai="mo">Dùng chung toàn hệ thống</Nhan></div> : null}
                </td>
                <td>{NHAN_PROVIDER[provider.kind]}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{provider.baseUrl}</td>
                <td>
                  {provider.apiKeyConfigured ? (
                    <>
                      <Nhan loai="thanh-cong">Đã cấu hình</Nhan>
                      {provider.apiKeyHint ? (
                        <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>Gợi ý: {provider.apiKeyHint}</div>
                      ) : null}
                    </>
                  ) : (
                    <Nhan loai="canh-bao">Chưa có khoá</Nhan>
                  )}
                </td>
                <td className="so">{soNguyen(provider.models.length)}</td>
                <td>{provider.enabled ? <Nhan loai="thanh-cong">Đang bật</Nhan> : <Nhan loai="mo">Đã tắt</Nhan>}</td>
                <td>
                  <div className="hang" style={{ gap: 6 }}>
                    <Nut bien="phu" nho onClick={() => napVaoBieuMau(provider)}>
                      Sửa
                    </Nut>
                    <Nut bien="phu" nho onClick={() => void test(provider)} dangTai={dangTest === provider.id}>
                      Kiểm tra
                    </Nut>
                  </div>
                  {ketQuaTest[provider.id] ? (
                    <div style={{ marginTop: 6 }}>
                      <ThongBao loai={ketQuaTest[provider.id]?.ok ? 'thanh-cong' : 'loi'}>
                        {ketQuaTest[provider.id]?.message} · {soNguyen(ketQuaTest[provider.id]?.latencyMs ?? 0)} ms
                        {ketQuaTest[provider.id]?.modelsSeen !== undefined
                          ? ` · thấy ${soNguyen(ketQuaTest[provider.id]?.modelsSeen ?? 0)} model`
                          : ''}
                      </ThongBao>
                    </div>
                  ) : null}
                  {loiTest[provider.id] ? (
                    <div style={{ marginTop: 6 }}>
                      <ThongBao loai="loi">{loiTest[provider.id]}</ThongBao>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h3 className="card__tieu-de" style={{ marginTop: 18 }}>
        {suaId ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'}
      </h3>
      <div className="luoi luoi--2">
        <ONhap value={ten} onChange={setTen} placeholder="Tên, ví dụ: Gateway nội bộ" />
        <OChon
          value={kind}
          onChange={(giaTri) => {
            if (laProviderKind(giaTri)) setKind(giaTri)
          }}
          options={PROVIDER_KINDS.map((item) => ({ value: item, label: NHAN_PROVIDER[item] }))}
        />
        <ONhap value={baseUrl} onChange={setBaseUrl} placeholder="http://localhost:20128/v1" />
        <ONhap
          value={apiKey}
          onChange={setApiKey}
          type="password"
          placeholder={suaId ? 'Để trống nếu giữ khoá cũ' : 'Dán API key'}
        />
      </div>
      <label className="hang" style={{ gap: 6, marginTop: 10, fontSize: 14 }}>
        <input type="checkbox" checked={bat} onChange={(event) => setBat(event.target.checked)} />
        Bật nhà cung cấp này
      </label>
      <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
        Khoá đã lưu không hiển thị lại dưới bất kỳ hình thức nào. Muốn đổi khoá thì dán khoá mới; để trống nghĩa là giữ
        nguyên khoá cũ.
      </p>
      <div className="hang">
        <Nut onClick={() => void luu()} dangTai={dangLuu}>
          {suaId ? 'Lưu thay đổi' : 'Thêm nhà cung cấp'}
        </Nut>
        {suaId ? (
          <Nut bien="phu" onClick={xoaBieuMau}>
            Huỷ sửa
          </Nut>
        ) : null}
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ model */

function PhanModel({ companyId }: { companyId: string }): ReactNode {
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

  const [dangLuu, setDangLuu] = useState(false)
  const [loiLuu, setLoiLuu] = useState<string | null>(null)
  const [thongBao, setThongBao] = useState<string | null>(null)

  useEffect(() => {
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
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', 'Không kết nối được máy chủ.'))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, lanThu])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  const tatCaModel: readonly ModelOptionView[] = useMemo(
    () => (providers ?? []).flatMap((provider) => provider.models),
    [providers],
  )

  async function luu(): Promise<void> {
    setLoiLuu(null)
    setThongBao(null)
    if (providerId.length === 0 || modelId.trim().length === 0 || label.trim().length === 0) {
      setLoiLuu('Cần chọn nhà cung cấp và nhập mã model cùng nhãn hiển thị.')
      return
    }
    setDangLuu(true)
    try {
      await api.createModel(companyId, {
        providerId,
        modelId: modelId.trim(),
        label: label.trim(),
        contextWindow: Math.round(soTuChuoi(contextWindow)),
        supportsTools: hoTroTool,
        costInPerMtok: soTuChuoi(costIn),
        costOutPerMtok: soTuChuoi(costOut),
      })
      setModelId('')
      setLabel('')
      setThongBao('Đã thêm model.')
      taiLai()
    } catch (error) {
      setLoiLuu(error instanceof ApiError ? error.message : 'Không lưu được model.')
    } finally {
      setDangLuu(false)
    }
  }

  return (
    <Card
      tieuDe="Model"
      phu="Khai báo model kèm giá vào/ra mỗi triệu token. Giá này là cơ sở để tính chi phí và so với trần ngày."
    >
      <TrangThai dangTai={dangTai} loi={loi} taiLai={taiLai} />

      {thongBao ? (
        <div style={{ marginBottom: 10 }}>
          <ThongBao loai="thanh-cong">{thongBao}</ThongBao>
        </div>
      ) : null}
      {loiLuu ? (
        <div style={{ marginBottom: 10 }}>
          <ThongBao loai="loi">{loiLuu}</ThongBao>
        </div>
      ) : null}

      {providers && providers.length === 0 ? (
        <Trong>Chưa có nhà cung cấp nào. Thêm nhà cung cấp ở mục trên trước khi khai báo model.</Trong>
      ) : null}

      {providers && providers.length > 0 && tatCaModel.length === 0 ? (
        <Trong>Chưa có model nào. Khai báo model đầu tiên bằng biểu mẫu bên dưới.</Trong>
      ) : null}

      {tatCaModel.length > 0 ? (
        <table className="bang">
          <thead>
            <tr>
              <th>Nhãn</th>
              <th>Mã model</th>
              <th>Nhà cung cấp</th>
              <th>Ngữ cảnh</th>
              <th>Tool</th>
              <th>Giá vào / 1M</th>
              <th>Giá ra / 1M</th>
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
                <td className="so">{soNguyen(model.contextWindow)}</td>
                <td>{model.supportsTools ? <Nhan loai="thanh-cong">Có</Nhan> : <Nhan loai="canh-bao">Không</Nhan>}</td>
                <td className="so">{model.costInPerMtok.toFixed(4)} USD</td>
                <td className="so">{model.costOutPerMtok.toFixed(4)} USD</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h3 className="card__tieu-de" style={{ marginTop: 18 }}>
        Thêm model
      </h3>
      <div className="luoi luoi--2">
        <OChon
          value={providerId}
          onChange={setProviderId}
          options={(providers ?? []).map((provider) => ({ value: provider.id, label: provider.name }))}
        />
        <ONhap value={modelId} onChange={setModelId} placeholder="Mã model, ví dụ: deepseek-v4-flash" />
        <ONhap value={label} onChange={setLabel} placeholder="Nhãn hiển thị" />
        <ONhap value={contextWindow} onChange={setContextWindow} placeholder="Cửa sổ ngữ cảnh (token)" />
        <ONhap value={costIn} onChange={setCostIn} placeholder="Giá vào mỗi triệu token (USD)" />
        <ONhap value={costOut} onChange={setCostOut} placeholder="Giá ra mỗi triệu token (USD)" />
      </div>
      <label className="hang" style={{ gap: 6, marginTop: 10, fontSize: 14 }}>
        <input type="checkbox" checked={hoTroTool} onChange={(event) => setHoTroTool(event.target.checked)} />
        Model hỗ trợ gọi tool
      </label>
      <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
        Model không hỗ trợ tool sẽ bị router đổi sang model khác cùng mức năng lực, nên hãy đánh dấu chính xác.
      </p>
      <div className="hang">
        <Nut onClick={() => void luu()} dangTai={dangLuu} disabled={providers !== null && providers.length === 0}>
          Thêm model
        </Nut>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------- route theo tier */

function PhanRoute({ companyId }: { companyId: string }): ReactNode {
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
  const [thongBao, setThongBao] = useState<string | null>(null)

  useEffect(() => {
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
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', 'Không kết nối được máy chủ.'))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, lanThu])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  const nhanAgent = useMemo(() => {
    const map = new Map<string, string>()
    for (const agent of agents) map.set(agent.id, agent.label)
    return map
  }, [agents])

  async function luu(): Promise<void> {
    setLoiLuu(null)
    setThongBao(null)
    if (agentDefId.length === 0 || modelFk.length === 0) {
      setLoiLuu('Cần chọn agent và model.')
      return
    }
    setDangLuu(true)
    try {
      await api.upsertRoute(companyId, { agentDefId, tier, modelFk })
      setThongBao(`Đã gán model cho mức ${NHAN_TIER[tier]}.`)
      taiLai()
    } catch (error) {
      setLoiLuu(error instanceof ApiError ? error.message : 'Không lưu được route.')
    } finally {
      setDangLuu(false)
    }
  }

  return (
    <Card
      tieuDe="Route theo mức năng lực"
      phu="Khi agent không gán model cứng, router chọn model theo cặp (agent, tier). Đây là cơ chế dự phòng khi model đã chọn thiếu năng lực."
    >
      <TrangThai dangTai={dangTai} loi={loi} taiLai={taiLai} />

      {thongBao ? (
        <div style={{ marginBottom: 10 }}>
          <ThongBao loai="thanh-cong">{thongBao}</ThongBao>
        </div>
      ) : null}
      {loiLuu ? (
        <div style={{ marginBottom: 10 }}>
          <ThongBao loai="loi">{loiLuu}</ThongBao>
        </div>
      ) : null}

      {routes && routes.length === 0 ? (
        <Trong>Chưa có route nào. Agent sẽ dùng model rẻ nhất còn bật nếu không có route lẫn model gán cứng.</Trong>
      ) : null}

      {routes && routes.length > 0 ? (
        <table className="bang">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Vai trò</th>
              <th>Mức</th>
              <th>Model</th>
              <th>Ưu tiên</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => (
              <tr key={route.id}>
                <td>{nhanAgent.get(route.agentDefId) ?? route.agentDefId}</td>
                <td>{route.role}</td>
                <td>
                  <Nhan loai="mo">{NHAN_TIER[route.tier]}</Nhan>
                </td>
                <td>{route.modelLabel}</td>
                <td className="so">{soNguyen(route.priority)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h3 className="card__tieu-de" style={{ marginTop: 18 }}>
        Gán route
      </h3>
      <div className="luoi luoi--3">
        <OChon value={agentDefId} onChange={setAgentDefId} options={agents.map((agent) => ({ value: agent.id, label: agent.label }))} />
        <OChon
          value={tier}
          onChange={(giaTri) => {
            if (laTier(giaTri)) setTier(giaTri)
          }}
          options={MODEL_TIERS.map((item) => ({ value: item, label: NHAN_TIER[item] }))}
        />
        <OChon
          value={modelFk}
          onChange={setModelFk}
          options={models.map((model) => ({ value: model.id, label: `${model.label} · ${model.providerName}` }))}
        />
      </div>
      <div className="hang" style={{ marginTop: 10 }}>
        <Nut
          onClick={() => void luu()}
          dangTai={dangLuu}
          disabled={agents.length === 0 || models.length === 0}
        >
          Lưu route
        </Nut>
      </div>
    </Card>
  )
}

/* ----------------------------------------------------------- kết nối ngoài */

function PhanKetNoi({ companyId }: { companyId: string }): ReactNode {
  const [danhSach, setDanhSach] = useState<readonly IntegrationView[] | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [kind, setKind] = useState<IntegrationKind>('firecrawl')
  const [ten, setTen] = useState('')
  const [configJson, setConfigJson] = useState('{}')

  const [dangLuu, setDangLuu] = useState(false)
  const [loiLuu, setLoiLuu] = useState<string | null>(null)
  const [thongBao, setThongBao] = useState<string | null>(null)

  const [dangTest, setDangTest] = useState<string | null>(null)
  const [ketQuaTest, setKetQuaTest] = useState<Record<string, IntegrationTestResponse>>({})
  const [loiTest, setLoiTest] = useState<Record<string, string>>({})

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
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', 'Không kết nối được máy chủ.'))
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
    setThongBao(null)
    if (ten.trim().length === 0) {
      setLoiLuu('Cần nhập tên kết nối.')
      return
    }
    let config: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(configJson)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setLoiLuu('Phần cấu hình phải là một đối tượng JSON, ví dụ {"apiKey": "..."}.')
        return
      }
      config = parsed as Record<string, unknown>
    } catch {
      setLoiLuu('Cấu hình không phải JSON hợp lệ.')
      return
    }
    setDangLuu(true)
    try {
      await api.upsertIntegration(companyId, { kind, name: ten.trim(), config })
      setThongBao('Đã lưu kết nối. Bí mật trong cấu hình được mã hoá và không hiển thị lại.')
      taiLai()
    } catch (error) {
      setLoiLuu(error instanceof ApiError ? error.message : 'Không lưu được kết nối.')
    } finally {
      setDangLuu(false)
    }
  }

  async function test(integration: IntegrationView): Promise<void> {
    setDangTest(integration.id)
    setLoiTest((truoc) => ({ ...truoc, [integration.id]: '' }))
    try {
      const ketQua = await api.testIntegration(companyId, integration.id)
      setKetQuaTest((truoc) => ({ ...truoc, [integration.id]: ketQua }))
    } catch (error) {
      setLoiTest((truoc) => ({
        ...truoc,
        [integration.id]: error instanceof ApiError ? error.message : 'Không kiểm tra được kết nối.',
      }))
    } finally {
      setDangTest(null)
    }
  }

  return (
    <Card
      tieuDe="Kết nối ngoài"
      phu="Cấu hình để agent đọc dữ liệu kênh và tạo bản nháp. Cấu hình là chỉ-ghi, không hiển thị lại sau khi lưu."
    >
      <TrangThai dangTai={dangTai} loi={loi} taiLai={taiLai} />

      {thongBao ? (
        <div style={{ marginBottom: 10 }}>
          <ThongBao loai="thanh-cong">{thongBao}</ThongBao>
        </div>
      ) : null}
      {loiLuu ? (
        <div style={{ marginBottom: 10 }}>
          <ThongBao loai="loi">{loiLuu}</ThongBao>
        </div>
      ) : null}

      {danhSach && danhSach.length === 0 ? (
        <Trong>Chưa có kết nối nào. Thêm kết nối bằng biểu mẫu bên dưới khi cần agent chạm ra bên ngoài.</Trong>
      ) : null}

      {danhSach && danhSach.length > 0 ? (
        <table className="bang">
          <thead>
            <tr>
              <th>Loại</th>
              <th>Tên</th>
              <th>Trạng thái</th>
              <th>Cấu hình</th>
              <th>Kiểm tra gần nhất</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {danhSach.map((integration) => (
              <tr key={integration.id}>
                <td>{NHAN_INTEGRATION[integration.kind]}</td>
                <td>{integration.name}</td>
                <td>
                  <Nhan loai={integration.status === 'ok' || integration.status === 'connected' ? 'thanh-cong' : 'mo'}>
                    {integration.status}
                  </Nhan>
                </td>
                <td>{integration.configured ? <Nhan loai="thanh-cong">Đã cấu hình</Nhan> : <Nhan loai="canh-bao">Thiếu cấu hình</Nhan>}</td>
                <td>{thoiDiem(integration.lastCheckAt)}</td>
                <td>
                  <Nut bien="phu" nho onClick={() => void test(integration)} dangTai={dangTest === integration.id}>
                    Kiểm tra
                  </Nut>
                  {ketQuaTest[integration.id] ? (
                    <div style={{ marginTop: 6 }}>
                      <ThongBao loai={ketQuaTest[integration.id]?.ok ? 'thanh-cong' : 'loi'}>
                        {ketQuaTest[integration.id]?.message} · {ketQuaTest[integration.id]?.status} ·{' '}
                        {soNguyen(ketQuaTest[integration.id]?.latencyMs ?? 0)} ms
                      </ThongBao>
                    </div>
                  ) : null}
                  {loiTest[integration.id] ? (
                    <div style={{ marginTop: 6 }}>
                      <ThongBao loai="loi">{loiTest[integration.id]}</ThongBao>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <h3 className="card__tieu-de" style={{ marginTop: 18 }}>
        Thêm / cập nhật kết nối
      </h3>
      <div className="luoi luoi--2">
        <OChon
          value={kind}
          onChange={(giaTri) => {
            if (laIntegrationKind(giaTri)) setKind(giaTri)
          }}
          options={INTEGRATION_KINDS.map((item) => ({ value: item, label: NHAN_INTEGRATION[item] }))}
        />
        <ONhap value={ten} onChange={setTen} placeholder="Tên gợi nhớ, ví dụ: Firecrawl chính" />
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="nhan">Cấu hình (JSON)</div>
        <textarea
          className="o-van-ban"
          value={configJson}
          rows={5}
          onChange={(event) => setConfigJson(event.target.value)}
          placeholder={'{\n  "apiKey": "…"\n}'}
        />
        <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
          Giá trị bí mật nằm trong JSON này sẽ được mã hoá trước khi lưu và không bao giờ trả về giao diện.
        </div>
      </div>
      <div className="hang" style={{ marginTop: 10 }}>
        <Nut onClick={() => void luu()} dangTai={dangLuu}>
          Lưu kết nối
        </Nut>
      </div>
    </Card>
  )
}

/* -------------------------------------------------------------- giới hạn */

function PhanGioiHan({ companyId }: { companyId: string }): ReactNode {
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
  const [loiLuu, setLoiLuu] = useState<string | null>(null)
  const [thongBao, setThongBao] = useState<string | null>(null)

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
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', 'Không kết nối được máy chủ.'))
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
    setLoiLuu(null)
    setThongBao(null)
    setDangLuu(true)
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
      setThongBao('Đã lưu giới hạn.')
    } catch (error) {
      setLoiLuu(error instanceof ApiError ? error.message : 'Không lưu được giới hạn.')
    } finally {
      setDangLuu(false)
    }
  }

  const tran = duLieu ? soTuChuoi(duLieu.dailyCostUsd) : 0
  const tyLe = tran > 0 ? (usedTodayUsd / tran) * 100 : 0
  const phanTram = Math.max(0, Math.min(100, tyLe))

  return (
    <Card
      tieuDe="Giới hạn"
      phu="Trần chi phí và số vòng lặp. Vượt trần thì lượt chạy bị dừng thay vì chạy tiếp và tiêu thêm tiền."
    >
      <TrangThai dangTai={dangTai} loi={loi} taiLai={taiLai} />

      {duLieu ? (
        <>
          <div className="hang" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span>
              Đã dùng 24 giờ qua: <strong className="so">{tienUsd(usedTodayUsd)}</strong> / trần{' '}
              <strong className="so">{tienUsd(tran)}</strong>
            </span>
            <span style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>{tran > 0 ? `${Math.round(tyLe)}%` : 'Chưa đặt trần'}</span>
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

          {thongBao ? (
            <div style={{ marginTop: 12 }}>
              <ThongBao loai="thanh-cong">{thongBao}</ThongBao>
            </div>
          ) : null}
          {loiLuu ? (
            <div style={{ marginTop: 12 }}>
              <ThongBao loai="loi">{loiLuu}</ThongBao>
            </div>
          ) : null}

          <div className="luoi luoi--3" style={{ marginTop: 14 }}>
            <div>
              <div className="nhan">Trần chi phí ngày (USD)</div>
              <ONhap value={duLieu.dailyCostUsd} onChange={(v) => setDuLieu({ ...duLieu, dailyCostUsd: v })} />
            </div>
            <div>
              <div className="nhan">Trần chi phí mỗi việc (USD)</div>
              <ONhap value={duLieu.taskCostUsd} onChange={(v) => setDuLieu({ ...duLieu, taskCostUsd: v })} />
            </div>
            <div>
              <div className="nhan">Số bước tối đa mỗi lượt chạy</div>
              <ONhap value={duLieu.maxStepsPerRun} onChange={(v) => setDuLieu({ ...duLieu, maxStepsPerRun: v })} />
            </div>
            <div>
              <div className="nhan">Số vòng trao đổi giữa agent</div>
              <ONhap value={duLieu.maxPeerRounds} onChange={(v) => setDuLieu({ ...duLieu, maxPeerRounds: v })} />
            </div>
            <div>
              <div className="nhan">Số lần sửa tối đa mỗi việc</div>
              <ONhap
                value={duLieu.maxRevisionsPerTask}
                onChange={(v) => setDuLieu({ ...duLieu, maxRevisionsPerTask: v })}
              />
            </div>
            <div>
              <div className="nhan">Số việc chạy song song</div>
              <ONhap value={duLieu.maxParallelTasks} onChange={(v) => setDuLieu({ ...duLieu, maxParallelTasks: v })} />
            </div>
          </div>

          <div className="hang" style={{ marginTop: 12 }}>
            <Nut onClick={() => void luu()} dangTai={dangLuu}>
              Lưu giới hạn
            </Nut>
          </div>
        </>
      ) : null}
    </Card>
  )
}

export function CaiDat({ companyId }: { companyId: string }): ReactNode {
  return (
    <Trang rong>
      <TieuDeTrang moTa="Khai báo nhà cung cấp, model, route theo mức năng lực, kết nối ngoài và giới hạn chi phí.">
        Cài đặt
      </TieuDeTrang>

      <PhanNhaCungCap companyId={companyId} />
      <PhanModel companyId={companyId} />
      <PhanRoute companyId={companyId} />
      <PhanKetNoi companyId={companyId} />
      <PhanGioiHan companyId={companyId} />
    </Trang>
  )
}
