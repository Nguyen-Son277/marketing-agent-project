/**
 * Giao diện admin hệ thống chỉ duyệt user. Không cần công ty và không có menu marketing.
 * Giữ danh tính tài khoản ở hộp xác nhận để không duyệt nhầm sau một lần tải lại danh sách.
 */
import { useEffect, useState } from 'react'
import type { AdminUsersResponse, AdminUserView } from '@marketing-agent/shared'
import { api } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { useSession } from '../lib/session.tsx'
import { LocaleSwitcher } from '../components/LocaleSwitcher.tsx'
import { ThemeSwitcher } from '../components/ThemeSwitcher.tsx'
import { Logo } from '../components/Logo.tsx'
import { HopThoaiXacNhan } from '../components/HopThoai.tsx'
import { Card, DangTai, Nut, OChon, ONhap, ThongBao, Trong } from '../components/ui.tsx'

export function AdminDuyetTaiKhoan() {
  const { user, signOut } = useSession()
  const { t, translateError, formatDateTime, formatNumber } = useI18n()
  const [status, setStatus] = useState<'pending' | 'approved'>('pending')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<AdminUsersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<AdminUserView | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    // Debounce để gõ tìm kiếm không tạo một yêu cầu ở mỗi phím; huỷ nhận kết quả cũ.
    const timer = window.setTimeout(() => {
      void api.adminUsers({ status, q: search.trim(), page })
        .then((result) => { if (!cancelled) setData(result) })
        .catch((error) => { if (!cancelled) setError(translateError(error)) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [status, search, page, revision, translateError])

  async function approve() {
    if (!selected || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.approveUser(selected.id)
      setNotice(t('admin.success', { email: selected.email }))
      setSelected(null)
      setPage(1)
      setRevision((r) => r + 1)
    } catch (error) {
      setError(translateError(error))
      setSelected(null)
    } finally { setSaving(false) }
  }

  return (
    <div className="admin-app">
      <header className="admin-app__header">
        <strong className="app__brand"><Logo />{t('admin.title')}</strong>
        <span className="app__user" title={user?.email}>{user?.email}</span>
        <LocaleSwitcher compact />
        <ThemeSwitcher compact />
        <Nut bien="phu" nho onClick={() => void signOut()}>{t('nav.signOut')}</Nut>
      </header>
      <main className="admin-app__main">
        <h1 className="the__tieu-de">{t('admin.title')}</h1>
        <p className="the__mo-ta">{t('admin.subtitle')}</p>
        <Card>
          <div className="admin-app__filters">
            <OChon value={status} onChange={(value) => { if (value === 'pending' || value === 'approved') { setStatus(value); setPage(1) } }}
              options={[{ value: 'pending', label: t('admin.pending') }, { value: 'approved', label: t('admin.approved') }]} />
            <ONhap value={search} onChange={(value) => { setSearch(value); setPage(1) }} placeholder={t('admin.search')} />
            <Nut bien="phu" nho onClick={() => setRevision((r) => r + 1)} disabled={loading}>{t('common.refresh')}</Nut>
          </div>
          {notice ? <ThongBao loai="thanh-cong">{notice}</ThongBao> : null}
          {error ? <ThongBao loai="loi">{error}</ThongBao> : null}
          {loading ? <DangTai /> : null}
          {!loading && data?.users.length === 0 ? <Trong>{t('admin.empty')}</Trong> : null}
          {data ? <>
            <div className="admin-app__users">
              {data.users.map((account) => (
                <article key={account.id} className="admin-app__user">
                  <div className="admin-app__identity">
                    <strong>{account.name}</strong>
                    <span>{account.email}</span>
                    <small>{t('admin.registered')}: {formatDateTime(account.createdAt)}</small>
                    {account.approvedAt ? <small>{t('admin.approvedAt')}: {formatDateTime(account.approvedAt)}</small> : null}
                  </div>
                  {account.approvalStatus === 'pending'
                    ? <Nut nho disabled={saving} onClick={() => setSelected(account)}>{t('admin.approve')}</Nut>
                    : <span className="badge badge--thanh-cong">{t('admin.approved')}</span>}
                </article>
              ))}
            </div>
            <div className="admin-app__pagination">
              <span>{t('admin.total', { n: formatNumber(data.total) })} · {t('admin.page', { n: formatNumber(page) })}</span>
              <Nut bien="phu" nho disabled={page === 1 || loading} onClick={() => setPage((p) => p - 1)}>{t('admin.previous')}</Nut>
              <Nut bien="phu" nho disabled={page * data.pageSize >= data.total || loading} onClick={() => setPage((p) => p + 1)}>{t('admin.next')}</Nut>
            </div>
          </> : null}
        </Card>
      </main>
      <HopThoaiXacNhan mo={selected !== null} tieuDe={t('admin.approve')}
        moTa={selected ? t('admin.confirm', { email: selected.email }) : ''}
        nhanXacNhan={t('admin.approve')} nguyHiem={false} dangXuLy={saving}
        onXacNhan={() => void approve()} onHuy={() => { if (!saving) setSelected(null) }} />
    </div>
  )
}
