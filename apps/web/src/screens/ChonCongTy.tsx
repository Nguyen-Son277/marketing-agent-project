/** Màn hình chọn hoặc tạo công ty khi người dùng chưa thuộc công ty nào. */
import type { ReactNode } from 'react'
import { useSession } from '../lib/session.tsx'
import { useI18n } from '../lib/i18n.tsx'
import { LocaleSwitcher } from '../components/LocaleSwitcher.tsx'
import { ThemeSwitcher } from '../components/ThemeSwitcher.tsx'
import { FormTaoCongTy } from '../components/FormTaoCongTy.tsx'
import { Card, Nut, ThongBao, Trang } from '../components/ui.tsx'

export function ChonCongTyScreen(): ReactNode {
  const { companies, systemProblem, signOut } = useSession()
  const { t } = useI18n()

  return (
    <div className="dang-nhap">
      {/* Người dùng chưa có công ty vẫn phải đổi được ngôn ngữ: không có Shell ở màn này. */}
      <div className="dang-nhap__cong-cu">
        <LocaleSwitcher />
        <ThemeSwitcher />
      </div>
      <div style={{ width: '100%', maxWidth: 560 }}>
        <Trang>
          {/* `the__tieu-de` chứ không phải `the__tieude`: CSS chỉ định nghĩa tên có gạch
              nối, nên bản cũ không hề được style. */}
          <h1 className="the__tieu-de">{t('company.chooseTitle')}</h1>
          <p className="the__mo-ta">{t('company.chooseSubtitle')}</p>

          {systemProblem ? (
            <div style={{ marginBottom: 16 }}>
              <ThongBao loai="canh-bao">{t('company.systemNotReady', { problem: systemProblem })}</ThongBao>
            </div>
          ) : null}

          {companies.length > 0 ? (
            <Card tieuDe={t('company.yours')}>
              <div className="cot">
                {companies.map((company) => (
                  <div key={company.id} className="hang" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{company.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{company.slug}</div>
                      <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                        {t('company.role', { role: company.role })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          {/* Tiêu đề và mô tả do chính form vẽ (không đặt thêm trên `Card`): cùng một câu
              hiện hai lần ở hai chỗ là lỗi dễ thấy, mà form đã nhận đúng hai prop đó. */}
          <Card>
            <FormTaoCongTy
              autoFocus
              tieuDe={t('company.createTitle')}
              phu={t('company.createHint')}
              nhanNut={t('company.createAndStart')}
            />
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
