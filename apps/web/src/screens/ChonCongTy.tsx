/** Màn hình chọn hoặc tạo công ty khi người dùng chưa thuộc công ty nào. */
import { useState, type ReactNode } from 'react'
import { useSession } from '../lib/session.tsx'
import { useI18n } from '../lib/i18n.tsx'
import { LocaleSwitcher } from '../components/LocaleSwitcher.tsx'
import { Card, Nut, ONhap, ThongBao, Trang, Truong } from '../components/ui.tsx'

export function ChonCongTyScreen(): ReactNode {
  const { companies, createCompany, systemProblem, signOut } = useSession()
  const { t, translateError } = useI18n()
  const [ten, setTen] = useState('')
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTao, setDangTao] = useState(false)

  async function tao(): Promise<void> {
    if (ten.trim().length === 0) {
      setLoi(t('company.needName'))
      return
    }
    setLoi(null)
    setDangTao(true)
    try {
      await createCompany(ten.trim())
    } catch (error) {
      setLoi(translateError(error))
    } finally {
      setDangTao(false)
    }
  }

  return (
    <div className="dang-nhap">
      {/* Người dùng chưa có công ty vẫn phải đổi được ngôn ngữ: không có Shell ở màn này. */}
      <div className="dang-nhap__ngon-ngu">
        <LocaleSwitcher />
      </div>
      <div style={{ width: '100%', maxWidth: 560 }}>
        <Trang>
          <h1 className="the__tieude">{t('company.chooseTitle')}</h1>
          <p className="the__mo-ta">{t('company.chooseSubtitle')}</p>

          {systemProblem ? (
            <div style={{ marginBottom: 16 }}>
              <ThongBao loai="canh-bao">{t('company.systemNotReady', { problem: systemProblem })}</ThongBao>
            </div>
          ) : null}

          {loi ? (
            <div style={{ marginBottom: 16 }}>
              <ThongBao loai="loi">{loi}</ThongBao>
            </div>
          ) : null}

          {companies.length > 0 ? (
            <Card tieuDe={t('company.yours')}>
              <div className="cot">
                {companies.map((company) => (
                  <div key={company.id} className="hang" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{company.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                        {company.slug} · {t('company.role', { role: company.role })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <Card tieuDe={t('company.createTitle')} phu={t('company.createHint')}>
            <Truong nhan={t('company.name')}>
              <ONhap value={ten} onChange={setTen} placeholder={t('company.namePlaceholder')} autoFocus />
            </Truong>
            <div style={{ marginTop: 16 }}>
              <Nut onClick={() => void tao()} dangTai={dangTao} rong>
                {t('company.createAndStart')}
              </Nut>
            </div>
          </Card>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <Nut bien="phu" nho onClick={() => void signOut()}>
              {t('nav.signOut')}
            </Nut>
          </div>
        </Trang>
      </div>
    </div>
  )
}
