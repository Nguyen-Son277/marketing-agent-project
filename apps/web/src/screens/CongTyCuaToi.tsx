/**
 * Màn "Công ty của tôi": liệt kê, tạo, đổi tên và chuyển đổi giữa các công ty.
 *
 * Vì sao cần màn riêng: trước đây cơ sở dữ liệu và API đã cho một tài khoản thuộc nhiều
 * công ty, nhưng giao diện chỉ hiện màn tạo công ty khi tài khoản CHƯA có công ty nào —
 * nên sau công ty đầu tiên, không còn đường nào tạo thêm. Màn này là chỗ đứng cho việc đó.
 */
import { useState, type ReactNode } from 'react'
import type { CompanySummary } from '@marketing-agent/shared'
import { useSession } from '../lib/session.tsx'
import { useI18n } from '../lib/i18n.tsx'
import { FormTaoCongTy } from '../components/FormTaoCongTy.tsx'
import { Card, DangTai, Nhan, Nut, ONhap, ThongBao, TieuDeTrang, Trang, Trong, Truong } from '../components/ui.tsx'

/**
 * Vai trò được phép đổi tên, khớp `requireManage` phía server.
 *
 * Vì sao kiểm tra ở giao diện dù server đã chặn: hiện nút cho người chắc chắn bị từ chối
 * là mời họ bấm rồi nhận lỗi. Ẩn nút là nói trước rằng việc này không thuộc quyền của họ.
 */
function coTheDoiTen(role: CompanySummary['role']): boolean {
  return role === 'owner' || role === 'admin'
}

export function CongTyCuaToi(): ReactNode {
  const { companies, companyId, company, selectCompany, renameCompany, loading, refresh } = useSession()
  const { t, translateError } = useI18n()

  /** `suaId` khác null nghĩa là đang mở ô sửa tại chỗ của đúng công ty đó. */
  const [suaId, setSuaId] = useState<string | null>(null)
  const [tenMoi, setTenMoi] = useState('')
  const [dangLuu, setDangLuu] = useState(false)
  const [loiSua, setLoiSua] = useState<string | null>(null)
  const [thongBao, setThongBao] = useState<string | null>(null)

  function moSua(id: string, tenHienTai: string): void {
    setSuaId(id)
    setTenMoi(tenHienTai)
    setLoiSua(null)
    setThongBao(null)
  }

  function dongSua(): void {
    setSuaId(null)
    setTenMoi('')
    setLoiSua(null)
  }

  async function luuTen(id: string): Promise<void> {
    const ten = tenMoi.trim()
    // Chặn ở đây thay vì để server trả 400: người dùng nhận phản hồi ngay, và tránh một
    // vòng mạng cho thao tác chắc chắn thất bại.
    if (ten.length === 0) {
      setLoiSua(t('companies.needName'))
      return
    }
    setDangLuu(true)
    setLoiSua(null)
    try {
      await renameCompany(id, ten)
      setThongBao(t('companies.renamed'))
      dongSua()
    } catch (error) {
      // Lỗi từ server đã có khoá dịch; `translateError` lo cả trường hợp lỗi mạng.
      setLoiSua(translateError(error))
    } finally {
      setDangLuu(false)
    }
  }

  if (loading) {
    return (
      <Trang>
        <TieuDeTrang>{t('companies.title')}</TieuDeTrang>
        <DangTai nhan={t('companies.loading')} />
      </Trang>
    )
  }

  // Khối tạo công ty dùng ở cả trạng thái rỗng lẫn trạng thái bình thường, nên dựng một
  // lần: chép hai bản thì lần sau sửa props sẽ quên một bên.
  const khoiTaoCongTy = (
    <Card tieuDe={t('companies.createTitle')} phu={t('companies.createHint')}>
      <FormTaoCongTy onThanhCong={() => setThongBao(t('companies.created'))} />
    </Card>
  )

  if (companies.length === 0) {
    return (
      <Trang rong>
        <TieuDeTrang moTa={t('companies.subtitle')}>{t('companies.title')}</TieuDeTrang>
        <Trong>{t('companies.empty')}</Trong>
        {khoiTaoCongTy}
      </Trang>
    )
  }

  // Nhánh dự phòng: Shell chỉ gắn màn này khi đã có công ty đang dùng, nhưng nếu danh
  // sách không xác định được công ty hiện tại thì phải có nút thử lại thay vì màn trắng
  // mà người dùng không có cách nào tự khôi phục.
  if (!company) {
    return (
      <Trang>
        <TieuDeTrang>{t('companies.title')}</TieuDeTrang>
        <ThongBao loai="loi">{t('companies.errorLoad')}</ThongBao>
        <div style={{ marginTop: 12 }}>
          <Nut bien="phu" onClick={() => void refresh()}>
            {t('common.retry')}
          </Nut>
        </div>
      </Trang>
    )
  }

  return (
    <Trang rong>
      <TieuDeTrang moTa={t('companies.subtitle')}>{t('companies.title')}</TieuDeTrang>

      {thongBao ? (
        <div style={{ marginBottom: 16 }}>
          <ThongBao loai="thanh-cong">{thongBao}</ThongBao>
        </div>
      ) : null}

      <Card tieuDe={t('companies.yours')}>
        <div className="cot" style={{ gap: 0 }}>
          {companies.map((congTy) => {
            const dangDung = congTy.id === companyId
            const duocDoiTen = coTheDoiTen(congTy.role)
            const dangSua = suaId === congTy.id
            return (
              <div key={congTy.id} className={dangDung ? 'cty-the cty-the--dang-dung' : 'cty-the'}>
                <div className="hang" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="hang" style={{ gap: 8 }}>
                      <strong>{congTy.name}</strong>
                      {dangDung ? <Nhan loai="chinh">{t('companies.current')}</Nhan> : null}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)', marginTop: 4 }}>
                      {t('companies.pathLabel')}: <span className="so">{congTy.slug}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                      {t('companies.roleLabel', { role: congTy.role })}
                    </div>
                  </div>
                  {dangSua ? null : (
                    <div className="hang" style={{ gap: 6 }}>
                      <Nut bien="phu" nho disabled={dangDung} onClick={() => selectCompany(congTy.id)}>
                        {t('companies.switch')}
                      </Nut>
                      {duocDoiTen ? (
                        <Nut bien="phu" nho onClick={() => moSua(congTy.id, congTy.name)}>
                          {t('companies.rename')}
                        </Nut>
                      ) : null}
                    </div>
                  )}
                </div>

                {dangSua ? (
                  <div className="cot cty-dong-sua" style={{ gap: 8 }}>
                    <div style={{ fontWeight: 600 }}>{t('companies.renameTitle')}</div>
                    <Truong nhan={t('companies.name')}>
                      <ONhap value={tenMoi} onChange={setTenMoi} autoFocus />
                    </Truong>
                    {/* Nói trước rằng slug giữ nguyên: người dùng rất dễ tưởng đổi tên là
                        đổi luôn đường dẫn kho kiến thức. */}
                    <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                      {t('companies.renameSlugNote', { slug: congTy.slug })}
                    </div>
                    {loiSua ? (
                      <div role="alert" style={{ color: 'var(--mau-loi)', fontSize: 13 }}>
                        {loiSua}
                      </div>
                    ) : null}
                    <div className="hang">
                      <Nut
                        nho
                        dangTai={dangLuu}
                        disabled={tenMoi.trim().length === 0}
                        onClick={() => void luuTen(congTy.id)}
                      >
                        {dangLuu ? t('companies.renaming') : t('companies.renameSave')}
                      </Nut>
                      <Nut bien="phu" nho onClick={dongSua}>
                        {t('companies.renameCancel')}
                      </Nut>
                    </div>
                  </div>
                ) : null}

                {/* Chỉ hiện một lần, ở công ty đang dùng: lặp lại lời giải thích quyền trên
                    mọi thẻ sẽ thành tiếng ồn, còn im lặng hoàn toàn thì người dùng tưởng
                    giao diện thiếu nút. */}
                {!duocDoiTen && dangDung ? (
                  <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)', marginTop: 8 }}>
                    {t('companies.renameNotAllowed')}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </Card>

      {khoiTaoCongTy}
    </Trang>
  )
}
