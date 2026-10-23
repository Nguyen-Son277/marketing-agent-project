/** Chỉ sau đổi mật khẩu ban đầu mới mở API việc; server cưỡng chế cùng quy tắc. */
import { useState } from 'react'
import { useSession } from '../lib/session.tsx'
import { useI18n } from '../lib/i18n.tsx'
import { workforceApi } from '../lib/workforce-api.ts'
import { Nut, ONhap, Truong, ThongBao } from '../components/ui.tsx'
import { LocaleSwitcher } from '../components/LocaleSwitcher.tsx'
import { ThemeSwitcher } from '../components/ThemeSwitcher.tsx'
import { Logo } from '../components/Logo.tsx'
export function DoiMatKhau() {
 const { signIn, signOut }=useSession(),{t,translateError}=useI18n()
 const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null)
 async function save(){setBusy(true);setError(null);try{const me=await workforceApi.changePassword(current,next);setCurrent('');setNext('');signIn(me.user,me.companies)}catch(e){setError(translateError(e))}finally{setBusy(false)}}
 return <div className="dang-nhap"><div className="dang-nhap__cong-cu"><LocaleSwitcher/><ThemeSwitcher/></div><div className="dang-nhap__hop">
  <div className="dang-nhap__logo"><Logo size={56}/></div>
  <h1>{t('wf.changePassword')}</h1><p>{t('wf.passwordNote')}</p>
  <Truong nhan={t('wf.currentPassword')}><ONhap type="password" value={current} onChange={setCurrent} disabled={busy}/></Truong>
  <Truong nhan={t('wf.newPassword')}><ONhap type="password" value={next} onChange={setNext} disabled={busy}/></Truong>
  {error?<ThongBao loai="loi">{error}</ThongBao>:null}
  <div className="hang"><Nut onClick={()=>void save()} dangTai={busy}>{t('common.save')}</Nut><Nut bien="phu" onClick={()=>void signOut()}>{t('nav.signOut')}</Nut></div>
 </div></div>
}
