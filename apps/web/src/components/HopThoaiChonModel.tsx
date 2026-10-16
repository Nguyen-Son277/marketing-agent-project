/**
 * Hộp thoại lấy danh sách model từ nhà cung cấp và chọn model để thêm vào hệ thống.
 *
 * Vì sao tách thành hộp thoại riêng thay vì để trong bảng khoá của nhà cung cấp: gateway
 * nội bộ trả về hàng trăm model, và khối này cần một vùng rộng, có tìm kiếm và lọc riêng.
 * Chỗ cũ chỉ hiện khi mở đúng một dòng nhà cung cấp nên gần như không ai tìm thấy — đó là
 * lý do người dùng phải tự gõ model bằng tay.
 *
 * Vì sao mọi trạng thái bên trong bị xoá khi đóng: giữ lại thì lần mở sau người dùng thấy
 * danh sách và những dòng đã tích của lần trước, và rất dễ bấm "Thêm" rồi nhập nhầm model.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  FetchedModelView,
  FetchModelsResponse,
  ProviderView,
} from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { useSettingsNotifications } from '../lib/settings-notifications.ts'
import {
  BO_LOC_MODEL_MAC_DINH,
  chonTatCaDangHien,
  daoChon,
  demDaChon,
  locModel,
} from '../lib/model-filter.ts'
import { HopThoai } from './HopThoai.tsx'
import { DangTai, Nhan, Nut, OChon, ONhap, ThongBao, Truong } from './ui.tsx'

/**
 * Mảng rỗng dùng chung.
 *
 * Vì sao không viết `?? []` ngay trong thân component: mảng mới mỗi lần render làm
 * `useMemo` của danh sách đã lọc mất tác dụng và tính lại trên cả trăm model mỗi lần gõ.
 */
const KHONG_CO_MODEL: readonly FetchedModelView[] = []

export function HopThoaiChonModel({
  mo,
  companyId,
  onDong,
  onDaNhap,
  providerId,
}: {
  mo: boolean
  companyId: string
  onDong: () => void
  onDaNhap: () => void
  /** Khi đã biết nhà cung cấp (mở từ bảng khoá) thì bỏ bước chọn nhà cung cấp. */
  providerId?: string
}): ReactNode {
  const { t, formatNumber } = useI18n()
  const { begin } = useSettingsNotifications(companyId)
  const activeCompany = useRef(companyId)
  activeCompany.current = companyId
  const [loadAttempt, setLoadAttempt] = useState(0)

  const [providers, setProviders] = useState<readonly ProviderView[]>([])
  const [dangTaiProvider, setDangTaiProvider] = useState(false)
  const [loiProvider, setLoiProvider] = useState<string | null>(null)
  const [providerIdChon, setProviderIdChon] = useState('')
  const [keyId, setKeyId] = useState('')

  const [ketQuaFetch, setKetQuaFetch] = useState<FetchModelsResponse | null>(null)
  const [dangFetch, setDangFetch] = useState(false)

  const [tuKhoa, setTuKhoa] = useState<string>(BO_LOC_MODEL_MAC_DINH.tuKhoa)
  const [chiChuaThem, setChiChuaThem] = useState<boolean>(BO_LOC_MODEL_MAC_DINH.chiChuaThem)
  const [daChon, setDaChon] = useState<readonly string[]>([])

  const [dangNhap, setDangNhap] = useState(false)

  /**
   * Đưa hộp thoại về trạng thái trắng.
   *
   * Danh sách nhà cung cấp KHÔNG bị xoá ở đây: đó là dữ liệu chỉ đọc, giữ lại giúp lần mở
   * sau hiện ngay mà không phải chờ mạng. Mọi thứ người dùng đã nhập thì phải xoá.
   */
  const xoaTrangThai = useCallback((): void => {
    setProviderIdChon(providerId ?? '')
    setKeyId('')
    setKetQuaFetch(null)
    setTuKhoa(BO_LOC_MODEL_MAC_DINH.tuKhoa)
    setChiChuaThem(BO_LOC_MODEL_MAC_DINH.chiChuaThem)
    setDaChon([])
  }, [providerId])

  useEffect(() => {
    if (!mo) return
    // Mở hộp thoại là bắt đầu phiên mới. Xoá ở đây phòng trường hợp hộp thoại bị đóng bởi
    // đường khác (đổi trang, mất tiêu điểm) mà không đi qua nút Huỷ.
    xoaTrangThai()
    let cancelled = false
    setDangTaiProvider(true)
    setLoiProvider(null)
    api
      .providers(companyId)
      .then((ketQua) => {
        if (cancelled) return
        setProviders(ketQua.providers)
        // Chọn sẵn nhà cung cấp đầu tiên khi người dùng phải tự chọn, để bớt một bước.
        setProviderIdChon((hienTai) => hienTai || (ketQua.providers[0]?.id ?? ''))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoiProvider(error instanceof ApiError ? error.message : t('common.cannotConnectServer'))
      })
      .finally(() => {
        if (!cancelled) setDangTaiProvider(false)
      })
    return () => {
      cancelled = true
    }
  }, [mo, companyId, t, xoaTrangThai, loadAttempt])

  const nhaCungCap = useMemo(
    () => providers.find((item) => item.id === providerIdChon) ?? null,
    [providers, providerIdChon],
  )

  // Danh sách khoá ngắn (vài dòng) nên mảng mới mỗi lần render không đáng kể; không dùng
  // chung mảng rỗng với model vì hai kiểu phần tử khác nhau.
  const khoaApi = nhaCungCap?.keys ?? []

  const tatCaModel = ketQuaFetch?.models ?? KHONG_CO_MODEL

  const danhHien = useMemo(
    () => locModel(tatCaModel, { tuKhoa, chiChuaThem }),
    [tatCaModel, tuKhoa, chiChuaThem],
  )

  // Set để tra cứu theo từng dòng: `includes` trên mảng với hàng trăm model và hàng trăm
  // dòng là O(n²) mỗi lần gõ phím.
  const daChonSet = useMemo(() => new Set(daChon), [daChon])

  const soDaChon = demDaChon(tatCaModel, daChon)

  const conChonDuoc = danhHien.filter((model) => !model.alreadyAdded)
  const daChonHetDangHien =
    conChonDuoc.length > 0 && conChonDuoc.every((model) => daChonSet.has(model.modelId))

  const coTheLay = !dangTaiProvider && providerIdChon.length > 0 && nhaCungCap !== null

  function doiNhaCungCap(id: string): void {
    setProviderIdChon(id)
    setKeyId('')
    // Kết quả fetch gắn với nhà cung cấp cũ. Giữ lại sẽ khiến người dùng tưởng danh sách
    // đang nhìn thuộc nhà cung cấp vừa chọn.
    setKetQuaFetch(null)
    setDaChon([])
  }

  function doiKhoa(id: string): void {
    setKeyId(id)
    // Có gateway giới hạn danh sách model theo từng khoá, nên đổi khoá thì kết quả cũ
    // không còn đúng nữa.
    setKetQuaFetch(null)
    setDaChon([])
  }

  async function layDanhSach(): Promise<void> {
    if (providerIdChon.length === 0) return
    const finish = begin('model.fetch')
    const requestCompany = companyId
    setDangFetch(true)
    setDaChon([])
    try {
      const ketQua = await api.fetchProviderModels(
        companyId,
        providerIdChon,
        keyId.length > 0 ? keyId : undefined,
      )
      finish(ketQua.ok ? 'success' : 'error')
      if (activeCompany.current !== requestCompany) return
      setKetQuaFetch(ketQua)
    } catch {
      // Xoá kết quả cũ: để danh sách của lần lấy trước nằm cạnh thông báo lỗi sẽ khiến
      // người dùng tưởng đó là dữ liệu vừa lấy được.
      finish('error')
      if (activeCompany.current === requestCompany) setKetQuaFetch(null)
    } finally {
      if (activeCompany.current === requestCompany) setDangFetch(false)
    }
  }

  function chonHetDangHien(): void {
    // BẤT BIẾN: truyền DANH SÁCH ĐÃ LỌC (`danhHien`), không phải `tatCaModel`. Người dùng
    // đã thu hẹp bằng tìm kiếm nên chỉ mong chọn đúng những gì đang nhìn thấy; truyền danh
    // sách gốc thì một cú bấm sẽ nhập hàng trăm model ngoài ý muốn.
    setDaChon((truoc) => chonTatCaDangHien(danhHien, truoc))
  }

  async function nhapDaChon(): Promise<void> {
    if (providerIdChon.length === 0 || daChon.length === 0) return
    const finish = begin('model.save')
    const requestCompany = companyId
    setDangNhap(true)
    const daGui = [...daChon]
    try {
      const ketQua = await api.importProviderModels(companyId, providerIdChon, {
        models: daGui.map((modelId) => {
          const model = tatCaModel.find((item) => item.modelId === modelId)
          // `label` là dữ liệu nhà cung cấp trả về, không dịch ở client; thiếu thì để server tự đặt.
          return model ? { modelId, label: model.label } : { modelId }
        }),
      })
      if (activeCompany.current !== requestCompany) {
        finish(ketQua.skipped.length > 0 ? 'warning' : 'success')
        return
      }
      // Mọi model đã gửi giờ đều nằm trong hệ thống: hoặc được tạo, hoặc bị server bỏ qua
      // vì đã có. Đánh dấu theo đúng nhóm đã gửi nên danh sách phản ánh trạng thái thật.
      const daCo = new Set(daGui)
      setKetQuaFetch((truoc) =>
        truoc
          ? {
              ...truoc,
              models: truoc.models.map((item) =>
                daCo.has(item.modelId) ? { ...item, alreadyAdded: true } : item,
              ),
            }
          : truoc,
      )
      setDaChon([])
      // Mục Model bên ngoài cần tải lại để bảng hiện những model vừa thêm.
      onDaNhap()
      finish(ketQua.skipped.length > 0 ? 'warning' : 'success')
    } catch {
      finish('error')
    } finally {
      if (activeCompany.current === requestCompany) setDangNhap(false)
    }
  }

  function dong(): void {
    // Xoá TRƯỚC khi báo đóng để lần mở sau luôn là phiên trắng.
    xoaTrangThai()
    onDong()
  }

  return (
    <HopThoai
      mo={mo}
      rong
      tieuDe={t('settings.models.fetch.title')}
      onDong={dong}
      chanDung={
        <>
          <span style={{ marginRight: 'auto', fontSize: 13, color: 'var(--mau-chu-mo)' }}>
            {t('settings.models.fetch.selectedCount', { n: formatNumber(soDaChon) })}
          </span>
          <Nut bien="phu" nho onClick={dong}>
            {t('common.cancel')}
          </Nut>
          <Nut nho onClick={() => void nhapDaChon()} dangTai={dangNhap} disabled={soDaChon === 0}>
            {t('settings.models.fetch.import', { n: formatNumber(soDaChon) })}
          </Nut>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 13, color: 'var(--mau-chu-mo)' }}>
        {t('settings.models.fetch.hint')}
      </p>

      {loiProvider ? <><ThongBao loai="loi">{loiProvider}</ThongBao><Nut bien="phu" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t('common.retry')}</Nut></> : null}
      {dangTaiProvider ? <DangTai /> : null}

      {!providerId ? (
        <Truong nhan={t('settings.models.fetch.providerLabel')}>
          <OChon
            value={providerIdChon}
            onChange={doiNhaCungCap}
            options={providers.map((item) => ({ value: item.id, label: item.name }))}
            disabled={dangTaiProvider || providers.length === 0}
          />
        </Truong>
      ) : null}

      {!dangTaiProvider && !loiProvider && providers.length === 0 ? (
        <ThongBao loai="canh-bao">{t('settings.models.fetch.noProviders')}</ThongBao>
      ) : null}

      {nhaCungCap ? (
        <Truong nhan={t('settings.models.fetch.keyLabel')} goiY={t('settings.models.fetch.keyHint')}>
          <OChon
            value={keyId}
            onChange={doiKhoa}
            options={[
              { value: '', label: t('settings.models.fetch.keyAuto') },
              ...khoaApi.map((key) => ({ value: key.id, label: key.label })),
            ]}
          />
        </Truong>
      ) : null}

      <div className="hang" style={{ marginTop: 10 }}>
        <Nut onClick={() => void layDanhSach()} dangTai={dangFetch} disabled={!coTheLay}>
          {t('settings.models.fetch.action')}
        </Nut>
      </div>

      {/* Chỉ hiện danh sách khi lấy được: danh sách rỗng cạnh một lỗi kết nối rất dễ bị
          hiểu nhầm là "nhà cung cấp không có model nào". */}
      {ketQuaFetch?.ok ? (
        <>
          <div className="htm__loc">
            <ONhap
              value={tuKhoa}
              onChange={setTuKhoa}
              placeholder={t('settings.models.fetch.searchPlaceholder')}
            />
            <label className="hang" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={chiChuaThem}
                onChange={(event) => setChiChuaThem(event.target.checked)}
              />
              {t('settings.models.fetch.onlyNew')}
            </label>
            <Nut bien="phu" nho onClick={chonHetDangHien} disabled={danhHien.length === 0}>
              {daChonHetDangHien
                ? t('settings.models.fetch.clearVisible')
                : t('settings.models.fetch.selectVisible')}
            </Nut>
            <span style={{ color: 'var(--mau-chu-mo)' }}>
              {t('settings.models.fetch.showing', {
                hien: formatNumber(danhHien.length),
                tong: formatNumber(tatCaModel.length),
              })}
            </span>
          </div>

          <div className="htm__danh-sach">
            {danhHien.length === 0 ? (
              <div style={{ padding: 10, fontSize: 13, color: 'var(--mau-chu-mo)' }}>
                {t('settings.models.fetch.noMatch')}
              </div>
            ) : (
              danhHien.map((model) => (
                <label
                  key={model.modelId}
                  className={model.alreadyAdded ? 'htm__dong is-da-co' : 'htm__dong'}
                >
                  <input
                    type="checkbox"
                    checked={model.alreadyAdded || daChonSet.has(model.modelId)}
                    disabled={model.alreadyAdded}
                    onChange={() => setDaChon((truoc) => daoChon(truoc, model))}
                  />
                  {/* Mã và tên model là dữ liệu nhà cung cấp trả về: không dịch ở client. */}
                  <span className="htm__ma">{model.modelId}</span>
                  <span className="htm__nhan">{model.label}</span>
                  {model.alreadyAdded ? (
                    <Nhan loai="mo">{t('settings.models.fetch.alreadyAdded')}</Nhan>
                  ) : null}
                </label>
              ))
            )}
          </div>

        </>
      ) : null}
    </HopThoai>
  )
}
