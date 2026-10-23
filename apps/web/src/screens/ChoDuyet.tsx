/** User đã xác thực chỉ xem trạng thái; không gắn Shell hay tải API công ty trước khi duyệt. */
import { useState } from 'react'
import { api } from '../lib/api.ts'
import { useSession } from '../lib/session.tsx'
import { useI18n } from '../lib/i18n.tsx'
import { LocaleSwitcher } from '../components/LocaleSwitcher.tsx'
import { ThemeSwitcher } from '../components/ThemeSwitcher.tsx'
import { Logo } from '../components/Logo.tsx'
import { Nut, ThongBao } from '../components/ui.tsx'

export function ChoDuyet() {
  const { user, signIn, signOut } = useSession()
  const { t, translateError } = useI18n()
  const [checking, setChecking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function check() {
    setChecking(true)
    setError(null)
    setNotice(null)
    try {
      const me = await api.me()
      if (me.user.approvalStatus === 'approved') signIn(me.user, me.companies)
      else setNotice(t('approval.stillPending'))
    } catch (error) { setError(translateError(error)) }
    finally { setChecking(false) }
  }
  return (
    <div className="dang-nhap">
      <div className="dang-nhap__cong-cu"><LocaleSwitcher /><ThemeSwitcher /></div>
      <div className="dang-nhap__hop">
        <div className="dang-nhap__logo"><Logo size={56} /></div>
        <h1 className="dang-nhap__tieude">{t('approval.title')}</h1>
        <p>{t('approval.subtitle', { email: user?.email ?? '' })}</p>
        {error ? <ThongBao loai="loi">{error}</ThongBao> : null}
        {notice ? <ThongBao loai="thong-tin">{notice}</ThongBao> : null}
        <div className="hang" style={{ marginTop: 16 }}>
          <Nut onClick={() => void check()} dangTai={checking}>{t('approval.check')}</Nut>
          <Nut bien="phu" onClick={() => void signOut()}>{t('nav.signOut')}</Nut>
        </div>
      </div>
    </div>
  )
}
