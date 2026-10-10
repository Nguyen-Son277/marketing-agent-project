/** Màn hình đăng nhập và đăng ký. */
import { useState, type ReactNode } from 'react'
import { api, ApiError } from '../lib/api.ts'
import { useSession } from '../lib/session.tsx'
import { useI18n } from '../lib/i18n.tsx'
import { LocaleSwitcher } from '../components/LocaleSwitcher.tsx'
import { Nut, ONhap, ThongBao, Truong } from '../components/ui.tsx'

export function DangNhapScreen(): ReactNode {
  const { signIn } = useSession()
  const { t } = useI18n()
  const [cheDo, setCheDo] = useState<'dang-nhap' | 'dang-ky'>('dang-nhap')
  const [email, setEmail] = useState('')
  const [matKhau, setMatKhau] = useState('')
  const [ten, setTen] = useState('')
  const [loi, setLoi] = useState<string | null>(null)
  const [dangGui, setDangGui] = useState(false)

  async function gui(): Promise<void> {
    setLoi(null)
    if (email.trim().length === 0 || matKhau.length === 0) {
      setLoi(t('auth.needCredentials'))
      return
    }
    if (cheDo === 'dang-ky' && matKhau.length < 10) {
      setLoi(t('auth.passwordTooShort'))
      return
    }
    setDangGui(true)
    try {
      const ketQua =
        cheDo === 'dang-ky'
          ? await api.register({
              email: email.trim(),
              password: matKhau,
              name: ten.trim() || email.split('@')[0] || t('auth.defaultUserName'),
            })
          : await api.login({ email: email.trim(), password: matKhau })
      signIn(ketQua.user, ketQua.companies)
    } catch (error) {
      // `ApiError.message` đã được backend dịch theo ngôn ngữ gửi lên; nếu chưa dịch
      // được thì đây là lỗi mạng, và câu đó cũng nằm trong catalog.
      setLoi(error instanceof ApiError ? error.message : t('common.cannotConnectServer'))
    } finally {
      setDangGui(false)
    }
  }

  return (
    <div className="dang-nhap">
      {/* Nút chuyển ngôn ngữ đặt ở đây chứ không chỉ trong Shell: người chưa đăng nhập
          vẫn phải đọc được màn hình này bằng ngôn ngữ mình chọn. */}
      <div className="dang-nhap__ngon-ngu">
        <LocaleSwitcher />
      </div>
      <div className="dang-nhap__hop">
        <h1 className="dang-nhap__tieude">{t('auth.title')}</h1>
        <p className="dang-nhap__phu">{t('auth.subtitle')}</p>

        {loi ? (
          <div style={{ marginBottom: 16 }}>
            <ThongBao loai="loi">{loi}</ThongBao>
          </div>
        ) : null}

        {cheDo === 'dang-ky' ? (
          <Truong nhan={t('auth.displayName')}>
            <ONhap value={ten} onChange={setTen} placeholder={t('auth.namePlaceholder')} />
          </Truong>
        ) : null}

        <Truong nhan={t('auth.email')}>
          <ONhap
            value={email}
            onChange={setEmail}
            type="email"
            placeholder={t('auth.emailPlaceholder')}
            autoFocus
          />
        </Truong>

        <Truong nhan={t('auth.password')} goiY={cheDo === 'dang-ky' ? t('auth.passwordHint') : undefined}>
          <ONhap value={matKhau} onChange={setMatKhau} type="password" placeholder="••••••••" />
        </Truong>

        <div style={{ marginTop: 20 }}>
          <Nut onClick={() => void gui()} dangTai={dangGui} rong>
            {cheDo === 'dang-ky' ? t('auth.register') : t('auth.login')}
          </Nut>
        </div>

        <div style={{ marginTop: 14, textAlign: 'center', fontSize: 14 }}>
          {cheDo === 'dang-nhap' ? (
            <>
              {t('auth.toRegister')}{' '}
              <button
                type="button"
                onClick={() => {
                  setCheDo('dang-ky')
                  setLoi(null)
                }}
                style={{ border: 0, background: 'none', color: 'var(--mau-chinh)', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}
              >
                {t('auth.register')}
              </button>
            </>
          ) : (
            <>
              {t('auth.toLogin')}{' '}
              <button
                type="button"
                onClick={() => {
                  setCheDo('dang-nhap')
                  setLoi(null)
                }}
                style={{ border: 0, background: 'none', color: 'var(--mau-chinh)', cursor: 'pointer', font: 'inherit', fontWeight: 600 }}
              >
                {t('auth.login')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
