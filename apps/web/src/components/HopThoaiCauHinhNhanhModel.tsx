/**
 * Hộp thoại "Cấu hình nhanh model": gán model chính cho nhiều agent trong một lần.
 *
 * Vì sao cần: mỗi agent có một thẻ cấu hình riêng, nên chọn model cho cả đội 10 agent phải
 * mở 10 thẻ và bấm Lưu 10 lần — chậm tới mức người dùng bỏ qua việc gán model. Hộp thoại này
 * gộp lại thành bảng: gán một model cho tất cả, hoặc gán theo tier, hoặc chỉnh lẻ từng dòng,
 * rồi lưu một lần.
 *
 * Vì sao CHỈ gửi trường model: kỹ năng, tool và quyền kiến thức là cấu hình riêng của từng
 * agent. Nếu hộp thoại nhanh gửi kèm các trường đó thì một lần bấm "lưu tất cả" sẽ ghi đè
 * công sức người dùng đã chỉnh trong từng thẻ. Xem `thanhCapNhat`.
 *
 * Vì sao mọi trạng thái xoá khi đóng: mở lại mà còn thấy lựa chọn của lần trước thì rất dễ
 * bấm Lưu và ghi nhầm model vào cả đội.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MessageKey } from '@marketing-agent/i18n'
import type { ModelOptionView, ModelTier, TeamMemberView } from '@marketing-agent/shared'
import { MODEL_TIERS } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import {
  TOI_DA_DU_PHONG,
  dsVaiTroThayDoi,
  ganModelChinhTatCa,
  ganModelChinhTheoTier,
  taoBanNhapNhanh,
  thanhCapNhat,
  themDuPhongTatCa,
  type BanNhapNhanhTheoVaiTro,
} from '../lib/team-quick-model.ts'
import { HopThoai } from './HopThoai.tsx'
import { Nhan, Nut, OChon, ThongBao } from './ui.tsx'

/**
 * Tier giữ khoá dịch chứ không giữ câu chữ, cùng lý do như màn Đội agent: đổi ngôn ngữ
 * không phải dựng lại bảng chọn.
 */
const KHOA_TIER: Readonly<Record<ModelTier, MessageKey>> = {
  light: 'modelTier.light',
  standard: 'modelTier.standard',
  deep: 'modelTier.deep',
}

const TIER_RONG: Readonly<Record<ModelTier, string>> = { light: '', standard: '', deep: '' }

export interface KetQuaCauHinhNhanh {
  /** Số agent đã lưu thành công. */
  readonly daCapNhat: number
  /** Vai trò lưu thất bại — cha sẽ hiện cảnh báo và tải lại. */
  readonly roleLoi: readonly string[]
}

export function HopThoaiCauHinhNhanhModel({
  mo,
  companyId,
  members,
  models,
  onDong,
  onKetThuc,
}: {
  mo: boolean
  companyId: string
  members: readonly TeamMemberView[]
  models: readonly ModelOptionView[]
  onDong: () => void
  onKetThuc: (ketQua: KetQuaCauHinhNhanh) => void
}): ReactNode {
  const { t, formatNumber } = useI18n()

  const [banNhap, setBanNhap] = useState<BanNhapNhanhTheoVaiTro>({})
  const [modelTatCa, setModelTatCa] = useState('')
  const [modelTheoTier, setModelTheoTier] = useState<Readonly<Record<ModelTier, string>>>(TIER_RONG)
  const [modelDuPhong, setModelDuPhong] = useState('')
  const [dangLuu, setDangLuu] = useState(false)
  const [loi, setLoi] = useState<string | null>(null)

  // Khởi tạo lại mỗi lần MỞ. Cố ý không phụ thuộc `members`: trong lúc hộp thoại mở, cha
  // không tải lại dữ liệu, nên thêm phụ thuộc chỉ làm draft bị dựng lại giữa lúc đang sửa.
  useEffect(() => {
    if (!mo) return
    setBanNhap(taoBanNhapNhanh(members))
    setModelTatCa('')
    setModelTheoTier(TIER_RONG)
    setModelDuPhong('')
    setLoi(null)
    setDangLuu(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mo])

  const tuyChonModel = useMemo(
    () =>
      models.map((model) => ({
        value: model.id,
        label: t('team.modelOption', { model: model.label, provider: model.providerName }),
      })),
    [models, t],
  )

  const soThayDoi = dsVaiTroThayDoi(members, banNhap).length
  const khongCoModel = models.length === 0

  function apDungTatCa(): void {
    setBanNhap((truoc) => ganModelChinhTatCa(truoc, modelTatCa))
  }

  function apDungTheoTier(): void {
    setBanNhap((truoc) => ganModelChinhTheoTier(members, truoc, modelTheoTier))
  }

  function apDungDuPhong(): void {
    setBanNhap((truoc) => themDuPhongTatCa(truoc, modelDuPhong, TOI_DA_DU_PHONG))
  }

  async function luu(): Promise<void> {
    const capNhat = thanhCapNhat(members, banNhap)
    if (capNhat.length === 0) return
    setDangLuu(true)
    setLoi(null)
    try {
      // Gửi song song: độc lập nhau nên chờ tuần tự chỉ làm chậm. `allSettled` để một agent
      // lỗi không chặn những agent còn lại.
      const ketQua = await Promise.allSettled(
        capNhat.map((muc) =>
          api.updateTeamMember(companyId, muc.role, {
            modelFk: muc.modelFk,
            ...(muc.fallbackModelFks ? { fallbackModelFks: muc.fallbackModelFks } : {}),
          }),
        ),
      )
      const roleLoi = capNhat
        .filter((_muc, index) => ketQua[index]?.status === 'rejected')
        .map((muc) => muc.role)
      onKetThuc({ daCapNhat: capNhat.length - roleLoi.length, roleLoi })
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : t('team.saveError'))
    } finally {
      setDangLuu(false)
    }
  }

  function dong(): void {
    setBanNhap({})
    setLoi(null)
    onDong()
  }

  return (
    <HopThoai
      mo={mo}
      rong
      tieuDe={t('team.quickTitle')}
      onDong={dong}
      chanDung={
        <>
          <span style={{ marginRight: 'auto', fontSize: 13, color: 'var(--mau-chu-mo)' }}>
            {soThayDoi > 0
              ? t('team.quickChanged', { n: formatNumber(soThayDoi) })
              : t('team.quickUnchanged')}
          </span>
          <Nut bien="phu" nho onClick={dong} disabled={dangLuu}>
            {t('common.cancel')}
          </Nut>
          <Nut nho onClick={() => void luu()} dangTai={dangLuu} disabled={soThayDoi === 0}>
            {t('team.quickSave')}
          </Nut>
        </>
      }
    >
      <p style={{ marginTop: 0, fontSize: 13, color: 'var(--mau-chu-mo)' }}>{t('team.quickHint')}</p>

      {khongCoModel ? <ThongBao loai="canh-bao">{t('team.quickNoModels')}</ThongBao> : null}
      {loi ? <ThongBao loai="loi">{loi}</ThongBao> : null}

      <div className="cot" style={{ gap: 8, marginTop: khongCoModel ? 12 : 0 }}>
        <div className="hang" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, minWidth: '12rem' }}>{t('team.quickAllLabel')}</span>
          <OChon
            value={modelTatCa}
            onChange={setModelTatCa}
            options={[{ value: '', label: t('team.quickPickPlaceholder') }, ...tuyChonModel]}
            disabled={khongCoModel || dangLuu}
          />
          <Nut
            bien="phu"
            nho
            onClick={apDungTatCa}
            disabled={khongCoModel || dangLuu || modelTatCa.length === 0}
          >
            {t('team.quickApplyAll')}
          </Nut>
        </div>

        <div className="hang" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, minWidth: '12rem' }}>{t('team.quickTierLabel')}</span>
          {MODEL_TIERS.map((tier) => (
            <OChon
              key={tier}
              value={modelTheoTier[tier]}
              onChange={(giaTri) => setModelTheoTier((truoc) => ({ ...truoc, [tier]: giaTri }))}
              options={[
                { value: '', label: t('team.quickTierKeep', { tier: t(KHOA_TIER[tier]) }) },
                ...tuyChonModel,
              ]}
              disabled={khongCoModel || dangLuu}
            />
          ))}
          <Nut
            bien="phu"
            nho
            onClick={apDungTheoTier}
            disabled={
              khongCoModel || dangLuu || MODEL_TIERS.every((tier) => modelTheoTier[tier].length === 0)
            }
          >
            {t('team.quickApplyTier')}
          </Nut>
        </div>
        <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{t('team.quickTierHint')}</div>

        <div className="hang" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, minWidth: '12rem' }}>{t('team.quickFallbackLabel')}</span>
          <OChon
            value={modelDuPhong}
            onChange={setModelDuPhong}
            options={[{ value: '', label: t('team.quickPickPlaceholder') }, ...tuyChonModel]}
            disabled={khongCoModel || dangLuu}
          />
          <Nut
            bien="phu"
            nho
            onClick={apDungDuPhong}
            disabled={khongCoModel || dangLuu || modelDuPhong.length === 0}
          >
            {t('team.quickApplyFallback')}
          </Nut>
        </div>
        <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{t('team.quickFallbackHint')}</div>
      </div>

      <table className="bang" style={{ marginTop: 14 }}>
        <thead>
          <tr>
            <th>{t('team.quickColAgent')}</th>
            <th>{t('team.quickColTier')}</th>
            <th>{t('team.quickColModel')}</th>
            <th>{t('team.quickColFallback')}</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const nhap = banNhap[member.role]
            return (
              <tr key={member.agentDefId}>
                <td>
                  <span className="hang" style={{ gap: 6 }}>
                    {member.displayName}
                    {member.isLeader ? <Nhan loai="chinh">Leader</Nhan> : null}
                    <Nhan loai="mo">{member.role}</Nhan>
                  </span>
                </td>
                <td>{t(KHOA_TIER[member.tier])}</td>
                <td>
                  <OChon
                    value={nhap?.modelFk ?? ''}
                    onChange={(giaTri) =>
                      setBanNhap((truoc) => {
                        const hienTai = truoc[member.role]
                        if (!hienTai) return truoc
                        return { ...truoc, [member.role]: { ...hienTai, modelFk: giaTri } }
                      })
                    }
                    options={[{ value: '', label: t('team.useTierDefault') }, ...tuyChonModel]}
                    disabled={khongCoModel || dangLuu}
                  />
                </td>
                <td className="so">
                  {t('team.quickFallbackCount', {
                    n: formatNumber(nhap?.fallbackModelFks.length ?? 0),
                    max: formatNumber(TOI_DA_DU_PHONG),
                  })}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </HopThoai>
  )
}
