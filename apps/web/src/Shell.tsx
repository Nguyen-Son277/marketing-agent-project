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
import { BangDieuKhien } from './screens/BangDieuKhien.tsx'
import { TraoDoi } from './screens/TraoDoi.tsx'
import { CongViec } from './screens/CongViec.tsx'
import { GiaoViecNhanVien } from './screens/GiaoViecNhanVien.tsx'
import { DoiAgent } from './screens/DoiAgent.tsx'
import { KhoKienThuc } from './screens/KhoKienThuc.tsx'
import { CaiDat } from './screens/CaiDat.tsx'
import { CongTyCuaToi } from './screens/CongTyCuaToi.tsx'
import { ChiPhi } from './screens/ChiPhi.tsx'
import { SoDoDoiAgent } from './screens/SoDoDoiAgent.tsx'

/**
 * Bảng định tuyến.
 *
 * `nhan` và `nhom` là KHOÁ DỊCH chứ không phải câu chữ: giữ câu chữ ở đây sẽ khiến
 * nhãn menu không đổi được khi chuyển ngôn ngữ, và buộc phải dựng lại mảng mỗi lần
 * đổi ngôn ngữ.
 */
export const ROUTES = [
  { id: 'bang-dieu-khien', nhan: 'nav.dashboard', nhom: 'nav.group.work', bieuTuong: '📊' },
  { id: 'trao-doi', nhan: 'nav.chat', nhom: 'nav.group.work', bieuTuong: '💬' },
  { id: 'cong-viec', nhan: 'nav.tasks', nhom: 'nav.group.work', bieuTuong: '🗂️' },
  { id: 'giao-viec', nhan: 'nav.workforce', nhom: 'nav.group.work', bieuTuong: '🎨' },
  { id: 'doi-agent', nhan: 'nav.team', nhom: 'nav.group.config', bieuTuong: '🎯' },
  { id: 'kho-kien-thuc', nhan: 'nav.knowledge', nhom: 'nav.group.config', bieuTuong: '📚' },
  { id: 'cong-ty', nhan: 'nav.companies', nhom: 'nav.group.config', bieuTuong: '🏢' },
  { id: 'cai-dat', nhan: 'nav.settings', nhom: 'nav.group.config', bieuTuong: '⚙️' },
  { id: 'chi-phi', nhan: 'nav.costs', nhom: 'nav.group.monitor', bieuTuong: '💰' },
  { id: 'so-do', nhan: 'nav.diagram', nhom: 'nav.group.monitor', bieuTuong: '🗺️' },
] as const satisfies readonly { id: string; nhan: MessageKey; nhom: MessageKey; bieuTuong: string }[]

export type RouteId = (typeof ROUTES)[number]['id']

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
      case 'trao-doi':
        return <TraoDoi companyId={companyId} />
      case 'cong-viec':
        return <CongViec companyId={companyId} />
      case 'giao-viec':
        return <GiaoViecNhanVien />
      case 'doi-agent':
        return <DoiAgent companyId={companyId} />
      case 'kho-kien-thuc':
        return <KhoKienThuc companyId={companyId} />
      case 'cong-ty':
        return <CongTyCuaToi />
      case 'cai-dat':
        return <CaiDat companyId={companyId} />
      case 'chi-phi':
        return <ChiPhi companyId={companyId} />
      case 'so-do':
        return <SoDoDoiAgent companyId={companyId} />
    }
  }, [route, companyId, navigate])

  return (
    <div className="app">
      <header className="app__header">
        <span className="app__brand">{t('nav.brand')}</span>

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

        <span className="app__user" title={user?.name}>{user?.name}</span>
        <LocaleSwitcher compact />
        <ThemeSwitcher compact />
        <Nut bien="phu" nho onClick={() => void signOut()}>
          {t('nav.signOut')}
        </Nut>
      </header>

      <nav className="app__nav">
        {nhom.map(([tenNhom, items]) => (
          <div key={tenNhom}>
            <div className="app__nav-group">{t(tenNhom)}</div>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={route === item.id ? 'app__nav-item app__nav-item--active' : 'app__nav-item'}
                onClick={() => navigate(item.id)}
              >
                <span aria-hidden>{item.bieuTuong}</span>
                {t(item.nhan)}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Màn Trao đổi cần khoá cuộn trang để khung nhập tin luôn nằm trong tầm nhìn;
          các màn khác giữ nguyên cuộn trang như trước. */}
      <main className={route === 'trao-doi' ? 'app__main app__main--cao-day' : 'app__main'}>{manHinh}</main>
    </div>
  )
}
