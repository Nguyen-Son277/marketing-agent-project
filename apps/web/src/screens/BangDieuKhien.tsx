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
function ThanhTienDo({ tyLe }: { tyLe: number }): ReactNode {
  const phanTram = Math.max(0, Math.min(100, tyLe))
  const quaNguong = phanTram >= 80
  return (
    <div
      style={{ height: 8, borderRadius: 999, background: 'var(--mau-vien)', overflow: 'hidden' }}
      role="progressbar"
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
  const [duLieu, setDuLieu] = useState<DashboardResponse | null>(null)
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
      <Trang>
        <TieuDeTrang>{t('dashboard.title')}</TieuDeTrang>
        <DangTai nhan={t('common.loadingData')} />
      </Trang>
    )
  }

  if (loi && !duLieu) {
    return (
      <Trang>
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

  if (!duLieu) return null

  const { counts, cost } = duLieu
  const soViecDangMo = DANG_MO.reduce((tong, trangThai) => tong + counts.tasks[trangThai], 0)
  const tyLeChiPhi = cost.limitPerDay > 0 ? (cost.today / cost.limitPerDay) * 100 : 0
  const conLai = cost.limitPerDay - cost.today

  return (
    <Trang>
      <TieuDeTrang moTa={t('dashboard.subtitle', { company: duLieu.company.name })}>
        {t('dashboard.title')}
      </TieuDeTrang>

      {systemProblem ? (
        <div style={{ marginBottom: 16 }}>
          <ThongBao loai="canh-bao">
            <strong>{t('dashboard.systemNotReadyTitle')}</strong> {systemProblem}.{' '}
            {t('dashboard.finishSetup')}
          </ThongBao>
        </div>
      ) : null}

      <div className="luoi luoi--4">
        <OSo
          nhan={t('dashboard.openTasks')}
          giaTri={formatNumber(soViecDangMo)}
          moTa={t('dashboard.tasksHint')}
        />
        <OSo
          nhan={t('dashboard.doneTasks')}
          giaTri={formatNumber(counts.tasks.done)}
          loai="thanh-cong"
          moTa={t('dashboard.throughReview')}
        />
        <OSo nhan={t('dashboard.conversations')} giaTri={formatNumber(counts.conversations)} moTa={t('dashboard.withLeader')} />
        <OSo nhan={t('dashboard.documents')} giaTri={formatNumber(counts.documents)} moTa={t('dashboard.inKnowledgeBase')} />
        <OSo
          nhan={t('dashboard.agentsEnabled')}
          giaTri={`${formatNumber(counts.agentsEnabled)}/${formatNumber(counts.agentsTotal)}`}
          loai={counts.agentsEnabled === 0 ? 'loi' : counts.agentsEnabled < counts.agentsTotal ? 'canh-bao' : 'thanh-cong'}
          moTa={counts.agentsEnabled === 0 ? t('dashboard.noAgents') : t('dashboard.agentsReady')}
        />
      </div>

      <Card
        tieuDe={t('dashboard.costToday')}
        phu={t('dashboard.costLimits', {
          limit: formatCurrencyUsd(cost.limitPerDay),
          last30: formatCurrencyUsd(cost.last30Days),
        })}
      >
        <div className="hang" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="so" style={{ fontWeight: 700, fontSize: 20 }}>
            {formatCurrencyUsd(cost.today)}
          </span>
          <span style={{ color: 'var(--mau-chu-mo)', fontSize: 13 }}>
            {cost.limitPerDay > 0
              ? t('dashboard.costUsedPercent', { percent: Math.round(tyLeChiPhi) })
              : t('dashboard.noDailyLimit')}
          </span>
        </div>
        <ThanhTienDo tyLe={tyLeChiPhi} />
        {cost.limitPerDay > 0 && conLai <= 0 ? (
          <div style={{ marginTop: 10 }}>
            <ThongBao loai="loi">{t('dashboard.costCapReached')}</ThongBao>
          </div>
        ) : null}
      </Card>

      <Card tieuDe={t('dashboard.tasksByStatus')} phu={t('dashboard.viewTasksHint')}>
        <div className="hang">
          {TASK_STATUSES.map((trangThai) => {
            // Nhãn suy từ mã trạng thái; viết tường minh từng khoá sẽ lặp lại tám lần
            // cùng một quy tắc và dễ lệch khi hợp đồng thêm trạng thái mới.
            const nhan = t(`taskStatus.${trangThai}`)
            return (
              <span key={trangThai} className="badge badge--mo" title={nhan}>
                {nhan}: <span className="so">{formatNumber(counts.tasks[trangThai])}</span>
              </span>
            )
          })}
        </div>
      </Card>

      <Card tieuDe={t('dashboard.recentActivity')} phu={t('dashboard.recentHint')}>
        {duLieu.recentActivity.length === 0 ? (
          <Trong>{t('dashboard.noActivity')}</Trong>
        ) : (
          <div className="cot">
            {duLieu.recentActivity.map((hoatDong, chiSo) => (
              <div key={`${hoatDong.at}-${chiSo}`} className="hang" style={{ alignItems: 'flex-start' }}>
                <span style={{ flex: '0 0 118px', color: 'var(--mau-chu-mo)', fontSize: 13 }} className="so">
                  {formatDateTime(hoatDong.at)}
                </span>
                <span className="badge badge--mo">{hoatDong.kind}</span>
                <span style={{ flex: 1, minWidth: 200 }}>{hoatDong.summary}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card tieuDe={t('dashboard.quickActions')} phu={t('dashboard.quickHint')}>
        <div className="hang">
          <Nut onClick={() => onNavigate('trao-doi')}>{t('dashboard.openChat')}</Nut>
          <Nut bien="phu" onClick={() => onNavigate('cong-viec')}>
            {t('dashboard.viewTasks')}
          </Nut>
          <Nut bien="phu" onClick={taiLai} dangTai={dangTai && duLieu !== null}>
            {t('common.refresh')}
          </Nut>
        </div>
      </Card>
    </Trang>
  )
}
