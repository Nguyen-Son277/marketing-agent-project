/**
 * Shell: khung điều hướng của ứng dụng.
 *
 * Dùng hash routing thay vì router thư viện: URL dạng `#/cong-viec` không cần cấu
 * hình phía server (SPA fallback vẫn phải phục vụ index.html cho mọi đường dẫn),
 * hoạt động khi mở từ file tĩnh, và chỉ có một chỗ đọc/ghi route nên không cần
 * thêm phụ thuộc.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MessageKey } from '@marketing-agent/i18n'
import { useSession } from './lib/session.tsx'
import { useI18n } from './lib/i18n.tsx'
import { Nhan, Nut } from './components/ui.tsx'
import { LocaleSwitcher } from './components/LocaleSwitcher.tsx'
import { ThemeSwitcher } from './components/ThemeSwitcher.tsx'
import { NotificationBell } from './components/NotificationBell.tsx'
import { Logo } from './components/Logo.tsx'
import { BangDieuKhien } from './screens/BangDieuKhien.tsx'
import { TraoDoi } from './screens/TraoDoi.tsx'
import { CongViec } from './screens/CongViec.tsx'
import { BaoCaoHangNgay } from './screens/BaoCaoHangNgay.tsx'
import { GiaoViecNhanVien } from './screens/GiaoViecNhanVien.tsx'
import { DoiAgent } from './screens/DoiAgent.tsx'
import { KhoKienThuc } from './screens/KhoKienThuc.tsx'
import { CaiDat } from './screens/CaiDat.tsx'
import { CongTyCuaToi } from './screens/CongTyCuaToi.tsx'
import { ChiPhi } from './screens/ChiPhi.tsx'
import { SoDoDoiAgent } from './screens/SoDoDoiAgent.tsx'
import { TrinhDuyetXaHoi } from './screens/TrinhDuyetXaHoi.tsx'
import { Wordpress } from './screens/Wordpress.tsx'
import { CampaignLoop } from './screens/CampaignLoop.tsx'
import { VanPhongAI } from './screens/VanPhongAI.tsx'


/**
 * Bảng định tuyến.
 *
 * `nhan` và `nhom` là KHOÁ DỊCH chứ không phải câu chữ: giữ câu chữ ở đây sẽ khiến
 * nhãn menu không đổi được khi chuyển ngôn ngữ, và buộc phải dựng lại mảng mỗi lần
 * đổi ngôn ngữ.
 */
export const ROUTES = [
  { id: 'bang-dieu-khien', nhan: 'nav.dashboard', nhom: 'nav.group.work', bieuTuong: '📊' },
  { id: 'van-phong', nhan: 'nav.office', nhom: 'nav.group.work', bieuTuong: '🏢' },
  { id: 'trao-doi', nhan: 'nav.chat', nhom: 'nav.group.work', bieuTuong: '💬' },
  { id: 'cong-viec', nhan: 'nav.tasks', nhom: 'nav.group.work', bieuTuong: '🗂️' },
  { id: 'campaign-loop', nhan: 'campaign.nav', nhom: 'nav.group.work', bieuTuong: '🚀' },
  { id: 'giao-viec', nhan: 'nav.workforce', nhom: 'nav.group.work', bieuTuong: '🎨' },
  { id: 'bao-cao-hang-ngay', nhan: 'nav.dailyReports', nhom: 'nav.group.work', bieuTuong: '📝' },
  { id: 'wordpress', nhan: 'nav.wordpress', nhom: 'nav.group.work', bieuTuong: '🌍' },
  { id: 'trinh-duyet-xa-hoi', nhan: 'nav.socialBrowser', nhom: 'nav.group.work', bieuTuong: '🌐' },
  { id: 'doi-agent', nhan: 'nav.team', nhom: 'nav.group.config', bieuTuong: '🎯' },
  { id: 'kho-kien-thuc', nhan: 'nav.knowledge', nhom: 'nav.group.config', bieuTuong: '📚' },
  { id: 'cong-ty', nhan: 'nav.companies', nhom: 'nav.group.config', bieuTuong: '🏢' },
  { id: 'cai-dat', nhan: 'nav.settings', nhom: 'nav.group.config', bieuTuong: '⚙️' },
  { id: 'chi-phi', nhan: 'nav.costs', nhom: 'nav.group.monitor', bieuTuong: '💰' },
  { id: 'so-do', nhan: 'nav.diagram', nhom: 'nav.group.monitor', bieuTuong: '🗺️' },
] as const satisfies readonly { id: string; nhan: MessageKey; nhom: MessageKey; bieuTuong: string }[]

export type RouteId = (typeof ROUTES)[number]['id']

/** Trạng thái sidebar là sở thích riêng của trình duyệt, độc lập với công ty/tài khoản. */
const NAV_COLLAPSED_KEY = 'ma.navCollapsed'
function docNavCollapsed(): boolean {
  try {
    return window.localStorage.getItem(NAV_COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}
function storeNavCollapsed(value: boolean): void {
  try {
    window.localStorage.setItem(NAV_COLLAPSED_KEY, String(value))
  } catch {
    // Sidebar vẫn dùng được trong bộ nhớ nếu trình duyệt chặn localStorage.
  }
}

export { NAV_COLLAPSED_KEY }

function docRoute(): RouteId {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0]
  const found = ROUTES.find((route) => route.id === raw)
  return found ? found.id : 'bang-dieu-khien'
}

export function useRoute(): [RouteId, (route: RouteId) => void] {
  const [route, setRoute] = useState<RouteId>(docRoute)

  useEffect(() => {
    const onChange = (): void => setRoute(docRoute())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((next: RouteId) => {
    window.location.hash = `#/${next}`
    setRoute(next)
  }, [])

  return [route, navigate]
}

export function Shell(): ReactNode {
  const { user, companies, company, companyId, selectCompany, signOut } = useSession()
  const { t } = useI18n()
  const [route, navigate] = useRoute()
  const [navCollapsed, setNavCollapsed] = useState<boolean>(docNavCollapsed)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  const chuyenTrangThaiNav = useCallback(() => {
    setNavCollapsed((truoc) => {
      const tiep = !truoc
      storeNavCollapsed(tiep)
      return tiep
    })
  }, [])

  // Kiểu của map ghi rõ `MessageKey` cho tên nhóm: nếu để TypeScript suy từ mảng,
  // khoá sẽ bị nới thành `string` và `t(tenNhom)` mất kiểm tra khoá.
  const nhom = useMemo(() => {
    type Route = (typeof ROUTES)[number]
    const map = new Map<MessageKey, Route[]>()
    for (const item of ROUTES) {
      const bucket = map.get(item.nhom) ?? []
      bucket.push(item)
      map.set(item.nhom, bucket)
    }
    return [...map.entries()]
  }, [])

  const manHinh = useMemo<ReactNode>(() => {
    if (!companyId) return null
    switch (route) {
      case 'bang-dieu-khien':
        return <BangDieuKhien companyId={companyId} onNavigate={navigate} />
      case 'van-phong':
        return <VanPhongAI key={companyId} companyId={companyId} onNavigate={navigate} />
      case 'trao-doi':
        return <TraoDoi companyId={companyId} />
      case 'wordpress':
        return <Wordpress key={companyId} companyId={companyId} />
      case 'campaign-loop':
        return <CampaignLoop companyId={companyId} />
      case 'cong-viec':
        return <CongViec companyId={companyId} />
      case 'giao-viec':
        return <GiaoViecNhanVien />
      case 'bao-cao-hang-ngay':
        return <BaoCaoHangNgay companyId={companyId} />
      case 'trinh-duyet-xa-hoi':
        return <TrinhDuyetXaHoi key={`${user?.id}:${companyId}`} companyId={companyId} />
      case 'doi-agent':
        return <DoiAgent companyId={companyId} />
      case 'kho-kien-thuc':
        return <KhoKienThuc companyId={companyId} />
      case 'cong-ty':
        return <CongTyCuaToi />
      case 'cai-dat':
        return <CaiDat key={`${user?.id}:${companyId}`} companyId={companyId} />
      case 'chi-phi':
        return <ChiPhi companyId={companyId} />
      case 'so-do':
        return <SoDoDoiAgent companyId={companyId} />
    }
  }, [route, companyId, user?.id, navigate])

  return (
    <div className={navCollapsed ? 'app app--nav-thu-gon' : 'app'}>
      <header className="app__header">
        <span className="app__brand"><Logo />{t('nav.brand')}</span>

        {companies.length > 0 ? (
          <select
            className="o-chon app__company-picker"
            aria-label={t('nav.switchCompany')}
            value={companyId ?? ''}
            onChange={(event) => selectCompany(event.target.value)}
          >
            {companies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        ) : null}

        {company ? <Nhan loai="mo">{company.role}</Nhan> : null}

        <span className="app__spacer" />

        {companyId && user ? <NotificationBell key={`${user.id}:${companyId}`} companyId={companyId} userId={user.id} /> : null}
        <LocaleSwitcher compact />
        <ThemeSwitcher compact />
      </header>

      <nav className="app__nav" id="main-navigation" aria-label={t('nav.label')}>
        {/* Danh sách route nằm trong khối cuộn riêng để nút co/mở neo được ở đáy sidebar,
            không trôi theo nội dung khi menu dài. */}
        <div className="app__nav-links">
          {nhom.map(([tenNhom, items]) => (
            <div key={tenNhom} className="app__nav-group-wrap">
              <div className="app__nav-group">{t(tenNhom)}</div>
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={route === item.id ? 'app__nav-item app__nav-item--active' : 'app__nav-item'}
                  aria-label={t(item.nhan)}
                  title={navCollapsed ? t(item.nhan) : undefined}
                  onClick={() => navigate(item.id)}
                >
                  <span className="app__nav-icon" aria-hidden>{item.bieuTuong}</span>
                  <span className="app__nav-label">{t(item.nhan)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="app__nav-toggle"
          aria-expanded={!navCollapsed}
          aria-controls="main-navigation"
          aria-label={t(navCollapsed ? 'nav.expand' : 'nav.collapse')}
          title={t(navCollapsed ? 'nav.expand' : 'nav.collapse')}
          onClick={chuyenTrangThaiNav}
        >
          <svg className="app__nav-toggle-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
            <path d={navCollapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} />
          </svg>
        </button>
        <div className="app__sidebar-user" data-menu-open={userMenuOpen}>
          <button
            type="button"
            className="app__sidebar-user-trigger"
            aria-label={user?.name ?? t('nav.userMenu')}
            aria-expanded={userMenuOpen}
            aria-haspopup="true"
            onClick={() => setUserMenuOpen((open) => !open)}
          >
            <span className="app__sidebar-user-avatar" aria-hidden="true">{user?.name?.trim().charAt(0).toLocaleUpperCase() || 'U'}</span>
            <span className="app__sidebar-user-name" title={user?.name}>{user?.name}</span>
          </button>
          <button
            type="button"
            className="app__sidebar-signout"
            aria-label={t('nav.signOut')}
            title={t('nav.signOut')}
            onClick={() => void signOut()}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M10 17l5-5-5-5" />
              <path d="M15 12H3" />
              <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
            </svg>
          </button>
        </div>
      </nav>

      {/* Màn Trao đổi cần khoá cuộn trang để khung nhập tin luôn nằm trong tầm nhìn;
          các màn khác giữ nguyên cuộn trang như trước. */}
      <main className={route === 'trao-doi' ? 'app__main app__main--cao-day' : 'app__main'}>{manHinh}</main>
    </div>
  )
}
