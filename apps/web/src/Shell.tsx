/**
 * Shell: khung điều hướng của ứng dụng.
 *
 * Dùng hash routing thay vì router thư viện: URL dạng `#/cong-viec` không cần cấu
 * hình phía server (SPA fallback vẫn phải phục vụ index.html cho mọi đường dẫn),
 * hoạt động khi mở từ file tĩnh, và chỉ có một chỗ đọc/ghi route nên không cần
 * thêm phụ thuộc.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSession } from './lib/session.tsx'
import { Nhan, Nut } from './components/ui.tsx'
import { BangDieuKhien } from './screens/BangDieuKhien.tsx'
import { TraoDoi } from './screens/TraoDoi.tsx'
import { CongViec } from './screens/CongViec.tsx'
import { DoiAgent } from './screens/DoiAgent.tsx'
import { KhoKienThuc } from './screens/KhoKienThuc.tsx'
import { CaiDat } from './screens/CaiDat.tsx'
import { ChiPhi } from './screens/ChiPhi.tsx'
import { SoDoDoiAgent } from './screens/SoDoDoiAgent.tsx'

export const ROUTES = [
  { id: 'bang-dieu-khien', nhan: 'Bảng điều khiển', nhom: 'Làm việc', bieuTuong: '📊' },
  { id: 'trao-doi', nhan: 'Trao đổi với Leader', nhom: 'Làm việc', bieuTuong: '💬' },
  { id: 'cong-viec', nhan: 'Công việc', nhom: 'Làm việc', bieuTuong: '🗂️' },
  { id: 'doi-agent', nhan: 'Đội agent', nhom: 'Cấu hình', bieuTuong: '🎯' },
  { id: 'kho-kien-thuc', nhan: 'Kho kiến thức', nhom: 'Cấu hình', bieuTuong: '📚' },
  { id: 'cai-dat', nhan: 'Cài đặt', nhom: 'Cấu hình', bieuTuong: '⚙️' },
  { id: 'chi-phi', nhan: 'Chi phí', nhom: 'Theo dõi', bieuTuong: '💰' },
  { id: 'so-do', nhan: 'Sơ đồ đội agent', nhom: 'Theo dõi', bieuTuong: '🗺️' },
] as const

export type RouteId = (typeof ROUTES)[number]['id']

function docRoute(): RouteId {
  const raw = window.location.hash.replace(/^#\/?/, '')
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
  const [route, navigate] = useRoute()

  const nhom = useMemo(() => {
    const map = new Map<string, (typeof ROUTES)[number][]>()
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
      case 'doi-agent':
        return <DoiAgent companyId={companyId} />
      case 'kho-kien-thuc':
        return <KhoKienThuc companyId={companyId} />
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
        <span className="app__brand">Đội Agent Marketing</span>

        {companies.length > 0 ? (
          <select
            className="o-chon"
            style={{ width: 'auto', minWidth: 190 }}
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

        <span style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>{user?.name}</span>
        <Nut bien="phu" nho onClick={() => void signOut()}>
          Đăng xuất
        </Nut>
      </header>

      <nav className="app__nav">
        {nhom.map(([tenNhom, items]) => (
          <div key={tenNhom}>
            <div className="app__nav-group">{tenNhom}</div>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={route === item.id ? 'app__nav-item app__nav-item--active' : 'app__nav-item'}
                onClick={() => navigate(item.id)}
              >
                <span aria-hidden>{item.bieuTuong}</span>
                {item.nhan}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <main className="app__main">{manHinh}</main>
    </div>
  )
}
