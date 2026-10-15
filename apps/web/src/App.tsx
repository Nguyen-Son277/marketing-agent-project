/**
 * Khung ứng dụng: quyết định hiển thị màn hình đăng nhập hay shell chính.
 *
 * Vì sao tách khỏi từng màn hình: chỉ một chỗ quyết định "đã đăng nhập chưa" và
 * "đã có công ty chưa", nên không màn hình nào phải tự xử lý hai trạng thái đó.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { NhapBaoCaoHangNgay } from './screens/NhapBaoCaoHangNgay.tsx'
import { useSession } from './lib/session.tsx'
import { useI18n } from './lib/i18n.tsx'
import { DangTai } from './components/ui.tsx'
import { DangNhapScreen } from './screens/DangNhap.tsx'
import { ChonCongTyScreen } from './screens/ChonCongTy.tsx'
import { Shell } from './Shell.tsx'
import { ChoDuyet } from './screens/ChoDuyet.tsx'
import { AdminDuyetTaiKhoan } from './screens/AdminDuyetTaiKhoan.tsx'
import { DoiMatKhau } from './screens/DoiMatKhau.tsx'
import { GiaoViecNhanVien } from './screens/GiaoViecNhanVien.tsx'

export function App(): ReactNode {
  const { user, company, ready, loading } = useSession()
  const { t } = useI18n()
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => { const update = () => setHash(window.location.hash); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update) }, [])
  const publicReport = /^#\/daily-report\/([A-Za-z0-9_-]{43})$/.exec(hash)
  if (publicReport) return <NhapBaoCaoHangNgay token={publicReport[1]!} />

  if (!ready || (loading && !user)) {
    return (
      <div className="dang-nhap">
        <div className="dang-nhap__hop">
          <h1 className="dang-nhap__tieude">{t('auth.title')}</h1>
          <DangTai nhan={t('common.sessionChecking')} />
        </div>
      </div>
    )
  }

  if (!user) return <DangNhapScreen />
  if (user.approvalStatus !== 'approved') return <ChoDuyet />
  if (user.isAdmin) return <AdminDuyetTaiKhoan />
  if (user.mustChangePassword) return <DoiMatKhau />
  if (user.accountType === 'employee') return <GiaoViecNhanVien employee />
  if (!company) return <ChonCongTyScreen />

  return <Shell />
}
