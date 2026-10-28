/**
 * Bảng điều khiển — màn hình đầu tiên người dùng mở sau khi đăng nhập.
 *
 * Vì sao màn hình này tồn tại: một hệ thống nhiều agent chỉ đáng tin khi người
 * vận hành trả lời được ba câu hỏi trong vài giây — "đang có bao nhiêu việc, ai
 * đang làm, hôm nay đã tiêu bao nhiêu so với trần". Gộp ba câu đó vào một màn
 * hình cũng là cách phát hiện sớm cấu hình sai (hệ thống chưa sẵn sàng) trước
 * khi người dùng đi sâu vào các màn khác.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { DashboardResponse, TaskStatus } from '@marketing-agent/shared'
import { TASK_STATUSES } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import { useSession } from '../lib/session.tsx'
import { useI18n } from '../lib/i18n.tsx'
import type { RouteId } from '../Shell.tsx'
import {
  Card,
  DangTai,
  Nut,
  OSo,
  ThongBao,
  TieuDeTrang,
  Trang,
  Trong,
} from '../components/ui.tsx'

/**
 * Vì sao bỏ bảng nhãn trạng thái cứng: nhãn đó là câu chữ tiếng Việt nằm trong mã, nên
 * đổi ngôn ngữ không đổi được. Từ nay nhãn lấy từ catalog qua `taskStatus.<mã>`, cùng
 * nguồn với màn Công việc, nên hai màn không thể lệch nhau.
 */

/** Trạng thái được coi là "còn việc phải theo". */
const DANG_MO: readonly TaskStatus[] = ['draft', 'assigned', 'in_progress', 'blocked', 'review']

/** Hiện lỗi tải dữ liệu kèm gợi ý khi lỗi là do thiếu cấu hình. */
function LoiManHinh({ loi }: { loi: ApiError }): ReactNode {
  const { t } = useI18n()
  return (
    <ThongBao loai="loi">
      {loi.message}
      {loi.needsConfiguration ? ` ${t('dashboard.finishSetup')}` : null}
    </ThongBao>
  )
}

/** Thanh tiến độ thuần CSS, không cần thư viện biểu đồ. */
function ThanhTienDo({ tyLe, nhan }: { tyLe: number; nhan: string }): ReactNode {
  const phanTram = Math.max(0, Math.min(100, tyLe))
  const quaNguong = phanTram >= 80
  return (
    <div
      style={{ height: 8, borderRadius: 999, background: 'var(--mau-vien)', overflow: 'hidden' }}
      role="progressbar"
      aria-label={nhan}
      aria-valuenow={Math.round(phanTram)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        style={{
          height: '100%',
          width: `${phanTram}%`,
          borderRadius: 999,
          background: quaNguong ? 'var(--mau-loi)' : 'var(--mau-chinh)',
          transition: 'width 0.2s ease',
        }}
      />
    </div>
  )
}

export function BangDieuKhien({
  companyId,
  onNavigate,
}: {
  companyId: string
  onNavigate: (route: RouteId) => void
}): ReactNode {
  const { systemProblem } = useSession()
  const { t, formatNumber, formatDateTime, formatCurrencyUsd } = useI18n()
  const [banChup, setDuLieu] = useState<DashboardResponse | null>(null)
  // Không hiển thị số liệu của công ty trước ngay cả trong nhịp render đầu khi đổi công ty.
  const duLieu = banChup?.company.id === companyId ? banChup : null
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    api
      .dashboard(companyId)
      .then((ketQua) => {
        if (!cancelled) setDuLieu(ketQua)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', t('common.cannotConnectServer')))
      })
      .finally(() => {
        if (!cancelled) setDangTai(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId, lanThu])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  if (dangTai && !duLieu) {
    return (
      <Trang rong>
        <TieuDeTrang>{t('dashboard.title')}</TieuDeTrang>
        <DangTai nhan={t('common.loadingData')} />
      </Trang>
    )
  }

  if (loi && !duLieu) {
    return (
      <Trang rong>
        <TieuDeTrang>{t('dashboard.title')}</TieuDeTrang>
        <LoiManHinh loi={loi} />
        <div style={{ marginTop: 12 }}>
          <Nut bien="phu" onClick={taiLai}>
            {t('common.retry')}
          </Nut>
        </div>
      </Trang>
    )
  }

  if (!duLieu) {
    return (
      <Trang rong>
        <TieuDeTrang>{t('dashboard.title')}</TieuDeTrang>
        <DangTai nhan={t('common.loadingData')} />
      </Trang>
    )
  }

  const { counts, cost } = duLieu
  const soViecDangMo = DANG_MO.reduce((tong, trangThai) => tong + counts.tasks[trangThai], 0)
  const tongTasks = TASK_STATUSES.reduce((tong, trangThai) => tong + counts.tasks[trangThai], 0)
  const tyLeChiPhi = cost.limitPerDay > 0 ? (cost.today / cost.limitPerDay) * 100 : 0
  const conLai = cost.limitPerDay - cost.today

  return (
    <Trang rong>
      <div className="dashboard">
        <header className="dashboard__header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
              <TieuDeTrang moTa={t('dashboard.subtitle', { company: duLieu.company.name })}>
                {t('dashboard.title')}
              </TieuDeTrang>
              <span className="dashboard__status-pill">
                <span className="dashboard__pulse-dot" aria-hidden="true" />
                <span>{systemProblem ? systemProblem : t('dashboard.agentsReady')}</span>
              </span>
            </div>
          </div>
          <Nut bien="phu" onClick={taiLai} dangTai={dangTai}>
            <svg
              className={dangTai ? 'dashboard__spin' : ''}
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ marginRight: 6, verticalAlign: 'middle' }}
              aria-hidden="true"
            >
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
            {t('common.refresh')}
          </Nut>
        </header>

        {loi ? <LoiManHinh loi={loi} /> : null}

        {systemProblem ? (
          <div style={{ marginBottom: 16 }}>
            <ThongBao loai="canh-bao">
              <strong>{t('dashboard.systemNotReadyTitle')}</strong> {systemProblem}.{' '}
              {t('dashboard.finishSetup')}
            </ThongBao>
          </div>
        ) : null}

        <div className="dashboard__stats">
          <div
            className="card dashboard__stat-card"
            role="button"
            tabIndex={0}
            title={t('dashboard.viewTasks')}
            onClick={() => onNavigate('cong-viec')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onNavigate('cong-viec')
              }
            }}
          >
            <div className="dashboard__stat-top">
              <span className="dashboard__stat-label">{t('dashboard.openTasks')}</span>
              <span className="dashboard__stat-icon" aria-hidden="true">📋</span>
            </div>
            <div className="so dashboard__stat-val" style={{ color: 'var(--mau-chinh-dam)' }}>
              {formatNumber(soViecDangMo)}
            </div>
            <div className="dashboard__stat-hint">{t('dashboard.tasksHint')}</div>
          </div>

          <div
            className="card dashboard__stat-card"
            role="button"
            tabIndex={0}
            title={t('dashboard.viewTasks')}
            onClick={() => onNavigate('cong-viec')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onNavigate('cong-viec')
              }
            }}
          >
            <div className="dashboard__stat-top">
              <span className="dashboard__stat-label">{t('dashboard.doneTasks')}</span>
              <span className="dashboard__stat-icon dashboard__stat-icon--success" aria-hidden="true">✅</span>
            </div>
            <div className="so dashboard__stat-val" style={{ color: 'var(--mau-thanh-cong)' }}>
              {formatNumber(counts.tasks.done)}
            </div>
            <div className="dashboard__stat-hint">{t('dashboard.throughReview')}</div>
          </div>

          <div
            className="card dashboard__stat-card"
            role="button"
            tabIndex={0}
            title={t('dashboard.openChat')}
            onClick={() => onNavigate('trao-doi')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onNavigate('trao-doi')
              }
            }}
          >
            <div className="dashboard__stat-top">
              <span className="dashboard__stat-label">{t('dashboard.conversations')}</span>
              <span className="dashboard__stat-icon dashboard__stat-icon--purple" aria-hidden="true">💬</span>
            </div>
            <div className="so dashboard__stat-val" style={{ color: 'var(--mau-chinh-dam)' }}>
              {formatNumber(counts.conversations)}
            </div>
            <div className="dashboard__stat-hint">{t('dashboard.withLeader')}</div>
          </div>

          <div
            className="card dashboard__stat-card"
            role="button"
            tabIndex={0}
            title={t('nav.knowledge')}
            onClick={() => onNavigate('kho-kien-thuc')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onNavigate('kho-kien-thuc')
              }
            }}
          >
            <div className="dashboard__stat-top">
              <span className="dashboard__stat-label">{t('dashboard.documents')}</span>
              <span className="dashboard__stat-icon dashboard__stat-icon--amber" aria-hidden="true">📚</span>
            </div>
            <div className="so dashboard__stat-val" style={{ color: 'var(--mau-chinh-dam)' }}>
              {formatNumber(counts.documents)}
            </div>
            <div className="dashboard__stat-hint">{t('dashboard.inKnowledgeBase')}</div>
          </div>

          <div
            className="card dashboard__stat-card"
            role="button"
            tabIndex={0}
            title={t('nav.team')}
            onClick={() => onNavigate('doi-agent')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onNavigate('doi-agent')
              }
            }}
          >
            <div className="dashboard__stat-top">
              <span className="dashboard__stat-label">{t('dashboard.agentsEnabled')}</span>
              <span
                className={`dashboard__stat-icon ${
                  counts.agentsEnabled === 0
                    ? 'dashboard__stat-icon--danger'
                    : counts.agentsEnabled < counts.agentsTotal
                      ? 'dashboard__stat-icon--warning'
                      : 'dashboard__stat-icon--success'
                }`}
                aria-hidden="true"
              >
                🤖
              </span>
            </div>
            <div
              className="so dashboard__stat-val"
              style={{
                color:
                  counts.agentsEnabled === 0
                    ? 'var(--mau-loi)'
                    : counts.agentsEnabled < counts.agentsTotal
                      ? 'var(--mau-canh-bao)'
                      : 'var(--mau-thanh-cong)',
              }}
            >
              {`${formatNumber(counts.agentsEnabled)}/${formatNumber(counts.agentsTotal)}`}
            </div>
            <div className="dashboard__stat-hint">
              {counts.agentsEnabled === 0 ? t('dashboard.noAgents') : t('dashboard.agentsReady')}
            </div>
          </div>
        </div>

        <div className="dashboard__overview">
          <Card
            tieuDe={t('dashboard.costToday')}
            phu={t('dashboard.costLimits', {
              limit: formatCurrencyUsd(cost.limitPerDay),
              last30: formatCurrencyUsd(cost.last30Days),
            })}
          >
            <div className="hang" style={{ justifyContent: 'space-between', marginBottom: 8, alignItems: 'baseline' }}>
              <span className="so" style={{ fontWeight: 800, fontSize: 26, color: 'var(--mau-chu)' }}>
                {formatCurrencyUsd(cost.today)}
              </span>
              <span
                className="badge"
                style={{
                  background:
                    tyLeChiPhi >= 90
                      ? 'var(--mau-loi-nen)'
                      : tyLeChiPhi >= 70
                        ? 'var(--mau-canh-bao-nen)'
                        : 'var(--mau-thanh-cong-nen)',
                  color:
                    tyLeChiPhi >= 90
                      ? 'var(--mau-loi)'
                      : tyLeChiPhi >= 70
                        ? 'var(--mau-canh-bao)'
                        : 'var(--mau-thanh-cong)',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {cost.limitPerDay > 0
                  ? t('dashboard.costUsedPercent', { percent: Math.round(tyLeChiPhi) })
                  : t('dashboard.noDailyLimit')}
              </span>
            </div>
            <ThanhTienDo tyLe={tyLeChiPhi} nhan={t('dashboard.costToday')} />
            {cost.limitPerDay > 0 && conLai <= 0 ? (
              <div style={{ marginTop: 10 }}>
                <ThongBao loai="loi">{t('dashboard.costCapReached')}</ThongBao>
              </div>
            ) : null}

            <div className="dashboard__cost-subgrid">
              <div className="dashboard__cost-box">
                <div className="dashboard__cost-box-label">{t('nav.costs')}</div>
                <div className="dashboard__cost-box-value">
                  {cost.limitPerDay > 0 ? formatCurrencyUsd(cost.limitPerDay) : '—'}
                </div>
              </div>
              <div className="dashboard__cost-box">
                <div className="dashboard__cost-box-label">
                  {conLai >= 0 ? 'Còn lại hôm nay' : 'Đã vượt trần'}
                </div>
                <div
                  className="dashboard__cost-box-value"
                  style={{
                    color: conLai <= 0 && cost.limitPerDay > 0 ? 'var(--mau-loi)' : 'inherit',
                  }}
                >
                  {cost.limitPerDay > 0 ? formatCurrencyUsd(Math.max(0, conLai)) : '—'}
                </div>
              </div>
              <div className="dashboard__cost-box">
                <div className="dashboard__cost-box-label">30 ngày qua</div>
                <div className="dashboard__cost-box-value">{formatCurrencyUsd(cost.last30Days)}</div>
              </div>
            </div>
          </Card>

          <Card
            tieuDe={t('dashboard.tasksByStatus')}
            phu={t('dashboard.viewTasksHint')}
            hanhDong={
              <Nut bien="phu" nho onClick={() => onNavigate('cong-viec')}>
                {t('dashboard.viewTasks')} →
              </Nut>
            }
          >
            {tongTasks > 0 ? (
              <div className="dashboard__distribution-bar" title={t('dashboard.tasksByStatus')}>
                {TASK_STATUSES.map((st) => {
                  const count = counts.tasks[st]
                  if (count === 0) return null
                  const pct = (count / tongTasks) * 100
                  const color =
                    st === 'in_progress'
                      ? 'var(--mau-chinh)'
                      : st === 'done'
                        ? 'var(--mau-thanh-cong)'
                        : st === 'blocked' || st === 'review'
                          ? 'var(--mau-canh-bao)'
                          : st === 'failed'
                            ? 'var(--mau-loi)'
                            : 'var(--mau-chu-mo)'
                  return (
                    <div
                      key={st}
                      className="dashboard__distribution-segment"
                      style={{ width: `${pct}%`, background: color }}
                      title={`${t(`taskStatus.${st}`)}: ${formatNumber(count)} (${Math.round(pct)}%)`}
                    />
                  )
                })}
              </div>
            ) : null}

            <div className="dashboard__statuses">
              {TASK_STATUSES.map((trangThai) => {
                // Nhãn suy từ mã trạng thái; viết tường minh từng khoá sẽ lặp lại tám lần
                // cùng một quy tắc và dễ lệch khi hợp đồng thêm trạng thái mới.
                const nhan = t(`taskStatus.${trangThai}`)
                return (
                  <div
                    key={trangThai}
                    className={`dashboard__status dashboard__status--${trangThai}`}
                    role="button"
                    tabIndex={0}
                    title={t('dashboard.viewTasks')}
                    onClick={() => onNavigate('cong-viec')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onNavigate('cong-viec')
                      }
                    }}
                  >
                    <div className="dashboard__status-left">
                      <span className="dashboard__status-dot" aria-hidden="true" />
                      <span>{nhan}</span>
                    </div>
                    <strong className="so">{formatNumber(counts.tasks[trangThai])}</strong>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>

        <div className="dashboard__bottom">
          <Card tieuDe={t('dashboard.recentActivity')} phu={t('dashboard.recentHint')}>
            {duLieu.recentActivity.length === 0 ? (
              <Trong>{t('dashboard.noActivity')}</Trong>
            ) : (
              <ol className="dashboard__activity">
                {duLieu.recentActivity.map((hoatDong, chiSo) => (
                  <li key={`${hoatDong.at}-${chiSo}`} className="dashboard__activity-item">
                    <div className="dashboard__activity-meta">
                      <time dateTime={hoatDong.at} className="so">{formatDateTime(hoatDong.at)}</time>
                      <span className="badge badge--mo">{hoatDong.kind}</span>
                    </div>
                    <div className="dashboard__activity-summary">{hoatDong.summary}</div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card tieuDe={t('dashboard.quickActions')} phu={t('dashboard.quickHint')}>
            <div className="dashboard__actions">
              <button
                type="button"
                className="dashboard__action-tile"
                onClick={() => onNavigate('trao-doi')}
              >
                <div className="dashboard__action-tile-icon" aria-hidden="true">💬</div>
                <div className="dashboard__action-tile-body">
                  <div className="dashboard__action-tile-title">{t('dashboard.openChat')}</div>
                  <div className="dashboard__action-tile-sub">Trao đổi chiến lược và giao việc cho AI Leader</div>
                </div>
                <div className="dashboard__action-tile-arrow" aria-hidden="true">→</div>
              </button>

              <button
                type="button"
                className="dashboard__action-tile"
                onClick={() => onNavigate('cong-viec')}
              >
                <div className="dashboard__action-tile-icon" aria-hidden="true">🗂️</div>
                <div className="dashboard__action-tile-body">
                  <div className="dashboard__action-tile-title">{t('dashboard.viewTasks')}</div>
                  <div className="dashboard__action-tile-sub">Kiểm tra tiến độ và bảng kanban nhiệm vụ</div>
                </div>
                <div className="dashboard__action-tile-arrow" aria-hidden="true">→</div>
              </button>
            </div>

            <div className="dashboard__shortcuts-grid">
              <button
                type="button"
                className="dashboard__shortcut-item"
                onClick={() => onNavigate('campaign-loop')}
              >
                <span aria-hidden="true">🚀</span>
                <span>{t('campaign.nav')}</span>
              </button>
              <button
                type="button"
                className="dashboard__shortcut-item"
                onClick={() => onNavigate('kho-kien-thuc')}
              >
                <span aria-hidden="true">📚</span>
                <span>{t('nav.knowledge')}</span>
              </button>
              <button
                type="button"
                className="dashboard__shortcut-item"
                onClick={() => onNavigate('wordpress')}
              >
                <span aria-hidden="true">🌍</span>
                <span>{t('nav.wordpress')}</span>
              </button>
              <button
                type="button"
                className="dashboard__shortcut-item"
                onClick={() => onNavigate('doi-agent')}
              >
                <span aria-hidden="true">🎯</span>
                <span>{t('nav.team')}</span>
              </button>
            </div>
          </Card>
        </div>
      </div>
    </Trang>
  )
}
