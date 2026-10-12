/**
 * Đội agent — nơi cấu hình từng agent của công ty.
 *
 * Vì sao màn hình này tồn tại: một đội 10 agent chỉ hoạt động đúng khi mỗi agent
 * biết mình chạy model nào, được dùng kỹ năng và tool gì, và được đọc/ghi danh mục
 * kiến thức nào. Đây cũng là nơi phát hiện cấu hình chết — agent không có kỹ năng
 * hoặc không đọc được danh mục nào thì gần như chắc chắn trả lời sai — nên các
 * cảnh báo đó được đặt ngay cạnh nút lưu.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MessageKey } from '@marketing-agent/i18n'
import type { ModelTier, TeamMemberView, TeamResponse } from '@marketing-agent/shared'
import { KB_CATEGORIES, MODEL_TIERS } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import {
  HopThoaiCauHinhNhanhModel,
  type KetQuaCauHinhNhanh,
} from '../components/HopThoaiCauHinhNhanhModel.tsx'
import {
  Card,
  DangTai,
  Nhan,
  Nut,
  OChon,
  OSo,
  ThongBao,
  TieuDeTrang,
  Trang,
  Trong,
} from '../components/ui.tsx'

/**
 * Tier giữ KHOÁ DỊCH chứ không giữ câu chữ: nếu giữ câu chữ thì bảng chọn tier không
 * đổi được khi chuyển ngôn ngữ, và bảng tra phải dựng lại mỗi lần ngôn ngữ thay đổi.
 */
const KHOA_TIER: Readonly<Record<ModelTier, MessageKey>> = {
  light: 'modelTier.light',
  standard: 'modelTier.standard',
  deep: 'modelTier.deep',
}

/**
 * Bảng tường minh mã danh mục → khoá dịch, thay vì ghép `kbCategory.${code}`: kiểu khoá
 * là union literal nên ghép chuỗi sẽ mất kiểm tra của TypeScript và lọt khoá sai tới
 * runtime, đúng lúc chỉ hiện ra mã thô cho người dùng.
 */
const KHOA_DANH_MUC: Readonly<Record<string, MessageKey>> = {
  '00-cong-ty': 'kbCategory.00-cong-ty',
  '10-brand': 'kbCategory.10-brand',
  '20-thi-truong': 'kbCategory.20-thi-truong',
  '30-kenh': 'kbCategory.30-kenh',
  '40-du-lieu': 'kbCategory.40-du-lieu',
  '90-ket-qua': 'kbCategory.90-ket-qua',
}

/** Dấu tích trên nút kỹ năng/tool đã chọn, viết dạng mã thoát để mã nguồn thuần ASCII. */
const DAU_TICH = '\u2713 '

interface QuyenKienThuc {
  readonly category: string
  readonly canRead: boolean
  readonly canWrite: boolean
}

/** Bản nháp cấu hình của một agent, tách khỏi dữ liệu server để sửa rồi mới lưu. */
interface BanNhap {
  readonly enabled: boolean
  readonly modelFk: string
  /** Model dự phòng theo thứ tự dùng khi model chính lỗi. */
  readonly fallbackModelFks: readonly string[]
  readonly tier: ModelTier
  readonly skills: readonly string[]
  readonly tools: readonly string[]
  readonly knowledge: readonly QuyenKienThuc[]
}

function LoiManHinh({ loi }: { loi: ApiError }): ReactNode {
  const { t } = useI18n()
  return (
    <ThongBao loai="loi">
      {loi.message}
      {loi.needsConfiguration ? ` ${t('team.finishSetup')}` : null}
    </ThongBao>
  )
}

/**
 * Nhãn của một danh mục kiến thức.
 *
 * Vì sao mã lạ giữ nguyên: danh mục ngoài danh mục chuẩn do backend trả về là DỮ LIỆU
 * của công ty, dịch ở client sẽ khiến cùng một tài liệu mang hai cái tên.
 */
function nhanDanhMuc(code: string, t: (key: MessageKey) => string): string {
  const khoa = KHOA_DANH_MUC[code]
  return khoa ? t(khoa) : code
}

/** Danh sách quyền kiến thức đầy đủ: mọi danh mục chuẩn, cộng danh mục lạ nếu server có. */
function danhMucDayDu(member: TeamMemberView): QuyenKienThuc[] {
  const hienCo = new Map(member.knowledge.map((quyen) => [quyen.category, quyen]))
  const codes = new Set<string>(KB_CATEGORIES.map((danhMuc) => danhMuc.code))
  for (const quyen of member.knowledge) codes.add(quyen.category)
  return [...codes].sort().map((code) => {
    const quyen = hienCo.get(code)
    return { category: code, canRead: quyen?.canRead ?? false, canWrite: quyen?.canWrite ?? false }
  })
}

function taoBanNhap(team: TeamResponse): Record<string, BanNhap> {
  const map: Record<string, BanNhap> = {}
  for (const member of team.members) {
    map[member.role] = {
      enabled: member.enabled,
      // `modelFk` là khoá nội bộ server trả về sẵn để đọc-rồi-ghi lại chính xác.
      modelFk: member.modelFk ?? '',
      fallbackModelFks: [...member.fallbackModelFks],
      tier: member.tier,
      skills: member.skills.map((kyNang) => kyNang.name),
      tools: [...member.tools],
      knowledge: danhMucDayDu(member),
    }
  }
  return map
}

export function DoiAgent({ companyId }: { companyId: string }): ReactNode {
  // `formatNumber` thay cho hàm định dạng cứng `vi-VN`: số phải đổi dấu phân cách theo
  // ngôn ngữ đang chọn, không phải theo ngôn ngữ gốc của dự án.
  const { t, formatNumber } = useI18n()
  const [duLieu, setDuLieu] = useState<TeamResponse | null>(null)
  const [banNhap, setBanNhap] = useState<Record<string, BanNhap>>({})
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)
  const [moRong, setMoRong] = useState<Record<string, boolean>>({})
  const [dangLuu, setDangLuu] = useState<string | null>(null)
  const [thongBao, setThongBao] = useState<Record<string, string>>({})
  const [loiLuu, setLoiLuu] = useState<Record<string, string>>({})
  /** Model đang chọn trong ô "thêm model dự phòng" của từng agent. */
  const [chonFallback, setChonFallback] = useState<Record<string, string>>({})
  /** Hộp thoại "Cấu hình nhanh model" — gán model cho nhiều agent trong một lần. */
  const [moNhanh, setMoNhanh] = useState(false)
  /** Kết quả lần lưu nhanh gần nhất, hiện ở đầu trang. */
  const [ketQuaNhanh, setKetQuaNhanh] = useState<KetQuaCauHinhNhanh | null>(null)

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    api
      .team(companyId)
      .then((ketQua) => {
        if (cancelled) return
        setDuLieu(ketQua)
        setBanNhap(taoBanNhap(ketQua))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // Câu lỗi mạng do giao diện tự viết nên phải nằm trong catalog; lỗi từ backend
        // thì `ApiError.message` đã được backend dịch theo ngôn ngữ gửi lên.
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', t('common.cannotConnectServer')))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, lanThu, t])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  const tongQuan = useMemo(() => {
    if (!duLieu) return null
    const bat = duLieu.members.filter((member) => member.enabled).length
    const thieuKyNang = duLieu.members.filter((member) => member.skills.length === 0).map((member) => member.displayName)
    const khongDocDuoc = duLieu.members
      .filter((member) => !member.knowledge.some((quyen) => quyen.canRead))
      .map((member) => member.displayName)
    return { bat, tong: duLieu.members.length, thieuKyNang, khongDocDuoc }
  }, [duLieu])

  function capNhat(role: string, thayDoi: Partial<BanNhap>): void {
    setBanNhap((truoc) => {
      const hienTai = truoc[role]
      if (!hienTai) return truoc
      return { ...truoc, [role]: { ...hienTai, ...thayDoi } }
    })
  }

  function doiKyNang(role: string, ten: string): void {
    setBanNhap((truoc) => {
      const hienTai = truoc[role]
      if (!hienTai) return truoc
      const co = hienTai.skills.includes(ten)
      const skills = co ? hienTai.skills.filter((item) => item !== ten) : [...hienTai.skills, ten]
      return { ...truoc, [role]: { ...hienTai, skills } }
    })
  }

  function doiTool(role: string, ten: string): void {
    setBanNhap((truoc) => {
      const hienTai = truoc[role]
      if (!hienTai) return truoc
      const co = hienTai.tools.includes(ten)
      const tools = co ? hienTai.tools.filter((item) => item !== ten) : [...hienTai.tools, ten]
      return { ...truoc, [role]: { ...hienTai, tools } }
    })
  }

  function doiQuyen(role: string, category: string, truong: 'canRead' | 'canWrite', giaTri: boolean): void {
    setBanNhap((truoc) => {
      const hienTai = truoc[role]
      if (!hienTai) return truoc
      const knowledge = hienTai.knowledge.map((quyen) =>
        quyen.category === category ? { ...quyen, [truong]: giaTri } : quyen,
      )
      return { ...truoc, [role]: { ...hienTai, knowledge } }
    })
  }

  /** Thêm model đang chọn vào cuối danh sách dự phòng (tối đa 5). */
  function themFallback(role: string): void {
    const modelId = chonFallback[role] ?? ''
    const hienTai = banNhap[role]
    if (modelId.length === 0 || !hienTai) return
    if (hienTai.fallbackModelFks.includes(modelId) || hienTai.fallbackModelFks.length >= 5) return
    capNhat(role, { fallbackModelFks: [...hienTai.fallbackModelFks, modelId] })
    setChonFallback((truoc) => ({ ...truoc, [role]: '' }))
  }

  function xoaFallback(role: string, modelId: string): void {
    const hienTai = banNhap[role]
    if (!hienTai) return
    capNhat(role, { fallbackModelFks: hienTai.fallbackModelFks.filter((id) => id !== modelId) })
  }

  function doiThuTuFallback(role: string, index: number, delta: number): void {
    const hienTai = banNhap[role]
    if (!hienTai) return
    const target = index + delta
    if (target < 0 || target >= hienTai.fallbackModelFks.length) return
    const next = [...hienTai.fallbackModelFks]
    const current = next[index]
    const swap = next[target]
    if (current === undefined || swap === undefined) return
    next[index] = swap
    next[target] = current
    capNhat(role, { fallbackModelFks: next })
  }

  async function luu(member: TeamMemberView): Promise<void> {
    const nhap = banNhap[member.role]
    if (!nhap) return
    setDangLuu(member.role)
    setThongBao((truoc) => ({ ...truoc, [member.role]: '' }))
    setLoiLuu((truoc) => ({ ...truoc, [member.role]: '' }))
    try {
      const ketQua = await api.updateTeamMember(companyId, member.role, {
        enabled: nhap.enabled,
        tier: nhap.tier,
        modelFk: nhap.modelFk.length > 0 ? nhap.modelFk : null,
        fallbackModelFks: [...nhap.fallbackModelFks],
        skills: nhap.skills,
        tools: nhap.tools,
        knowledge: nhap.knowledge,
      })
      // Đồng bộ nhãn do server suy ra (modelLabel, providerName) mà bản nháp không có.
      setDuLieu((truoc) =>
        truoc
          ? { ...truoc, members: truoc.members.map((item) => (item.role === member.role ? ketQua.member : item)) }
          : truoc,
      )
      setThongBao((truoc) => ({ ...truoc, [member.role]: t('team.saveSuccess', { name: member.displayName }) }))
    } catch (error) {
      setLoiLuu((truoc) => ({
        ...truoc,
        [member.role]: error instanceof ApiError ? error.message : t('team.saveError'),
      }))
    } finally {
      setDangLuu(null)
    }
  }

  if (dangTai && !duLieu) {
    return (
      <Trang>
        <TieuDeTrang>{t('nav.team')}</TieuDeTrang>
        <DangTai nhan={t('team.loading')} />
      </Trang>
    )
  }

  if (loi && !duLieu) {
    return (
      <Trang>
        <TieuDeTrang>{t('nav.team')}</TieuDeTrang>
        <LoiManHinh loi={loi} />
        <div style={{ marginTop: 12 }}>
          <Nut bien="phu" onClick={taiLai}>
            {t('common.retry')}
          </Nut>
        </div>
      </Trang>
    )
  }

  if (!duLieu || !tongQuan) return null

  return (
    <Trang rong>
      <TieuDeTrang moTa={t('team.subtitle')}>{t('nav.team')}</TieuDeTrang>

      <div className="hang" style={{ marginBottom: 12 }}>
        <Nut
          onClick={() => {
            setKetQuaNhanh(null)
            setMoNhanh(true)
          }}
          disabled={duLieu.models.length === 0}
          title={duLieu.models.length === 0 ? t('team.quickNoModels') : undefined}
        >
          {t('team.quickOpen')}
        </Nut>
      </div>

      {ketQuaNhanh && ketQuaNhanh.roleLoi.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <ThongBao loai="loi">
            {t('team.quickSaveFailed', {
              roles: ketQuaNhanh.roleLoi
                .map((role) => duLieu.members.find((member) => member.role === role)?.displayName ?? role)
                .join(', '),
            })}
          </ThongBao>
        </div>
      ) : null}
      {ketQuaNhanh && ketQuaNhanh.roleLoi.length === 0 && ketQuaNhanh.daCapNhat > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <ThongBao loai="thanh-cong">
            {t('team.quickSaved', { n: formatNumber(ketQuaNhanh.daCapNhat) })}
          </ThongBao>
        </div>
      ) : null}

      <div className="luoi luoi--3" style={{ marginBottom: 16 }}>
        <OSo
          nhan={t('team.enabledAgents')}
          giaTri={`${formatNumber(tongQuan.bat)}/${formatNumber(tongQuan.tong)}`}
        />
        <OSo
          nhan={t('team.availableSkills')}
          giaTri={formatNumber(duLieu.availableSkills.length)}
          moTa={t('team.availableSkillsHint')}
        />
        <OSo
          nhan={t('team.availableTools')}
          giaTri={formatNumber(duLieu.availableTools.length)}
          moTa={t('team.availableToolsHint')}
        />
        <OSo
          nhan={t('team.needsApproval')}
          giaTri={formatNumber(duLieu.availableTools.filter((tool) => tool.requiresApproval).length)}
          loai="canh-bao"
          moTa={t('team.needsApprovalHint')}
        />
      </div>

      {tongQuan.thieuKyNang.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <ThongBao loai="canh-bao">
            <strong>{t('team.noSkillsTitle')}</strong>{' '}
            {t('team.noSkillsBody', { members: tongQuan.thieuKyNang.join(', ') })}
          </ThongBao>
        </div>
      ) : null}

      {tongQuan.khongDocDuoc.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <ThongBao loai="canh-bao">
            <strong>{t('team.noCategoriesTitle')}</strong>{' '}
            {t('team.noCategoriesBody', { members: tongQuan.khongDocDuoc.join(', ') })}
          </ThongBao>
        </div>
      ) : null}

      {duLieu.members.length === 0 ? <Trong>{t('team.empty')}</Trong> : null}

      {duLieu.members.map((member) => {
        const nhap = banNhap[member.role]
        if (!nhap) return null
        const mo = moRong[member.role] === true
        const soKyNang = nhap.skills.length
        const soDocDuoc = nhap.knowledge.filter((quyen) => quyen.canRead).length
        return (
          <Card
            key={member.agentDefId}
            tieuDe={
              <span className="hang">
                {member.displayName}
                {member.isLeader ? <Nhan loai="chinh">Leader</Nhan> : null}
                <Nhan loai="mo">{member.role}</Nhan>
                {member.requireApproval ? <Nhan loai="canh-bao">{t('team.needsApproval')}</Nhan> : null}
              </span>
            }
            phu={member.description}
            hanhDong={
              <span className="hang">
                <label className="hang" style={{ gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={nhap.enabled}
                    onChange={(event) => capNhat(member.role, { enabled: event.target.checked })}
                  />
                  {t('team.enabled')}
                </label>
                <Nut bien="phu" nho onClick={() => setMoRong((truoc) => ({ ...truoc, [member.role]: !mo }))}>
                  {mo ? t('team.collapse') : t('team.configure')}
                </Nut>
                <Nut nho onClick={() => void luu(member)} dangTai={dangLuu === member.role}>
                  {t('common.save')}
                </Nut>
              </span>
            }
          >
            <div className="hang" style={{ marginBottom: 8 }}>
              <Nhan loai="mo">{t('team.currentTier', { tier: t(KHOA_TIER[member.tier]) })}</Nhan>
              <Nhan loai="mo">
                {t('team.modelLabel', { model: member.modelLabel ?? t('team.defaultByTier') })}
              </Nhan>
              <Nhan loai="mo">
                {t('team.providerLabel', { provider: member.providerName ?? t('team.noValue') })}
              </Nhan>
              <Nhan loai={soKyNang === 0 ? 'canh-bao' : 'mo'}>
                {t('team.skillCount', { n: formatNumber(soKyNang) })}
              </Nhan>
              <Nhan loai={nhap.tools.length === 0 ? 'canh-bao' : 'mo'}>
                {t('team.toolCount', { n: formatNumber(nhap.tools.length) })}
              </Nhan>
              <Nhan loai={soDocDuoc === 0 ? 'canh-bao' : 'mo'}>
                {t('team.readableCategories', { n: formatNumber(soDocDuoc) })}
              </Nhan>
              <Nhan loai="mo">{t('team.contextBudget', { n: formatNumber(member.contextBudgetTokens) })}</Nhan>
            </div>

            {thongBao[member.role] ? (
              <div style={{ marginBottom: 8 }}>
                <ThongBao loai="thanh-cong">{thongBao[member.role]}</ThongBao>
              </div>
            ) : null}
            {loiLuu[member.role] ? (
              <div style={{ marginBottom: 8 }}>
                <ThongBao loai="loi">{loiLuu[member.role]}</ThongBao>
              </div>
            ) : null}

            {soKyNang === 0 ? (
              <div style={{ marginBottom: 8 }}>
                <ThongBao loai="canh-bao">{t('team.memberNoSkills')}</ThongBao>
              </div>
            ) : null}
            {soDocDuoc === 0 ? (
              <div style={{ marginBottom: 8 }}>
                <ThongBao loai="canh-bao">{t('team.memberNoCategories')}</ThongBao>
              </div>
            ) : null}
            {member.enabled && member.modelId === null ? (
              <div style={{ marginBottom: 8 }}>
                <ThongBao loai="canh-bao">{t('team.noPrimaryModel')}</ThongBao>
              </div>
            ) : null}

            {mo ? (
              <div className="cot" style={{ gap: 16, marginTop: 12 }}>
                <div className="luoi luoi--2">
                  <div>
                    <h3 className="card__tieu-de">Model</h3>
                    <OChon
                      value={nhap.modelFk}
                      onChange={(giaTri) => capNhat(member.role, { modelFk: giaTri })}
                      options={[
                        { value: '', label: t('team.useTierDefault') },
                        ...duLieu.models.map((model) => ({
                          // `label`/`providerName` là tên model và nhà cung cấp do backend
                          // trả về — dữ liệu, không dịch ở client; chỉ dấu phân cách là
                          // chuỗi giao diện nên nằm trong catalog.
                          value: model.id,
                          label: t('team.modelOption', { model: model.label, provider: model.providerName }),
                        })),
                      ]}
                    />
                    <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)', marginBottom: 0 }}>
                      {t('team.modelHint')}
                    </p>
                  </div>
                  <div>
                    <h3 className="card__tieu-de">Tier</h3>
                    <OChon
                      value={nhap.tier}
                      onChange={(giaTri) => {
                        const tier = MODEL_TIERS.find((item) => item === giaTri)
                        if (tier) capNhat(member.role, { tier })
                      }}
                      options={MODEL_TIERS.map((tier) => ({ value: tier, label: t(KHOA_TIER[tier]) }))}
                    />
                    <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)', marginBottom: 0 }}>
                      {t('team.tierHint')}
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="card__tieu-de">
                    {t('team.fallbackHeading', { n: formatNumber(nhap.fallbackModelFks.length) })}
                  </h3>
                  {nhap.fallbackModelFks.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)', marginBottom: 6 }}>
                      {t('team.fallbackEmpty')}
                    </p>
                  ) : null}
                  <div className="cot" style={{ gap: 6 }}>
                    {nhap.fallbackModelFks.map((modelFk, index) => {
                      const model = duLieu.models.find((item) => item.id === modelFk)
                      return (
                        <div key={modelFk} className="hang" style={{ gap: 8 }}>
                          <span style={{ fontSize: 13 }}>
                            {model
                              ? t('team.modelOption', { model: model.label, provider: model.providerName })
                              : modelFk}
                          </span>
                          <Nut
                            bien="phu"
                            nho
                            disabled={index === 0}
                            onClick={() => doiThuTuFallback(member.role, index, -1)}
                          >
                            {t('team.fallbackUp')}
                          </Nut>
                          <Nut
                            bien="phu"
                            nho
                            disabled={index === nhap.fallbackModelFks.length - 1}
                            onClick={() => doiThuTuFallback(member.role, index, 1)}
                          >
                            {t('team.fallbackDown')}
                          </Nut>
                          <Nut bien="nguy-hiem" nho onClick={() => xoaFallback(member.role, modelFk)}>
                            {t('team.fallbackRemoveTitle')}
                          </Nut>
                        </div>
                      )
                    })}
                  </div>
                  <div className="hang" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <OChon
                      value={chonFallback[member.role] ?? ''}
                      onChange={(giaTri) => setChonFallback((truoc) => ({ ...truoc, [member.role]: giaTri }))}
                      options={[
                        { value: '', label: t('team.fallbackAddPlaceholder') },
                        ...duLieu.models
                          .filter(
                            (model) => !nhap.fallbackModelFks.includes(model.id) && model.id !== nhap.modelFk,
                          )
                          .map((model) => ({
                            value: model.id,
                            label: t('team.modelOption', { model: model.label, provider: model.providerName }),
                          })),
                      ]}
                    />
                    <Nut
                      bien="phu"
                      nho
                      onClick={() => themFallback(member.role)}
                      disabled={
                        (chonFallback[member.role] ?? '').length === 0 || nhap.fallbackModelFks.length >= 5
                      }
                    >
                      {t('team.fallbackAdd')}
                    </Nut>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                    {t('team.fallbackHint')} {t('team.fallbackMax')}
                  </p>
                </div>

                <div>
                  <h3 className="card__tieu-de">{t('team.skillsHeading', { n: formatNumber(soKyNang) })}</h3>
                  <div className="hang">
                    {duLieu.availableSkills.map((kyNang) => {
                      const chon = nhap.skills.includes(kyNang.name)
                      return (
                        <Nut
                          key={kyNang.name}
                          nho
                          bien={chon ? 'chinh' : 'phu'}
                          onClick={() => doiKyNang(member.role, kyNang.name)}
                          title={kyNang.description}
                        >
                          {chon ? DAU_TICH : '+ '}
                          {kyNang.name}
                        </Nut>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="card__tieu-de">{t('team.toolsHeading', { n: formatNumber(nhap.tools.length) })}</h3>
                  <div className="hang">
                    {duLieu.availableTools.map((tool) => {
                      const chon = nhap.tools.includes(tool.name)
                      return (
                        <Nut
                          key={tool.name}
                          nho
                          bien={chon ? 'chinh' : 'phu'}
                          onClick={() => doiTool(member.role, tool.name)}
                          title={tool.description}
                        >
                          {chon ? DAU_TICH : '+ '}
                          {tool.name}
                          {tool.requiresApproval ? t('team.toolApprovalMark') : ''}
                        </Nut>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{t('team.toolNote')}</p>
                </div>

                <div>
                  <h3 className="card__tieu-de">{t('team.permissionMatrix')}</h3>
                  <table className="bang">
                    <thead>
                      <tr>
                        <th>{t('team.category')}</th>
                        <th style={{ width: 90 }}>{t('team.read')}</th>
                        <th style={{ width: 90 }}>{t('team.write')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nhap.knowledge.map((quyen) => (
                        <tr key={quyen.category}>
                          <td>
                            {nhanDanhMuc(quyen.category, t)}{' '}
                            <span style={{ color: 'var(--mau-chu-mo)' }}>({quyen.category})</span>
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={quyen.canRead}
                              onChange={(event) =>
                                doiQuyen(member.role, quyen.category, 'canRead', event.target.checked)
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              checked={quyen.canWrite}
                              onChange={(event) =>
                                doiQuyen(member.role, quyen.category, 'canWrite', event.target.checked)
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{t('team.matrixHint')}</p>
                </div>
              </div>
            ) : null}
          </Card>
        )
      })}

      <HopThoaiCauHinhNhanhModel
        mo={moNhanh}
        companyId={companyId}
        members={duLieu.members}
        models={duLieu.models}
        onDong={() => setMoNhanh(false)}
        onKetThuc={(ketQua) => {
          setMoNhanh(false)
          setKetQuaNhanh(ketQua)
          // Tải lại để bảng phản ánh đúng trạng thái server, kể cả khi một phần lưu lỗi.
          taiLai()
        }}
      />
    </Trang>
  )
}
