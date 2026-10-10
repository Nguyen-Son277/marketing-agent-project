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
  soNguyen,
  thoiDiem,
  tienUsd,
} from '../components/ui.tsx'

const NHAN_TRANG_THAI: Readonly<Record<TaskStatus, string>> = {
  draft: 'Nháp',
  assigned: 'Đã giao',
  in_progress: 'Đang chạy',
  blocked: 'Bị chặn',
  review: 'Chờ duyệt',
  done: 'Hoàn tất',
  failed: 'Thất bại',
  cancelled: 'Đã huỷ',
}

/** Trạng thái được coi là "còn việc phải theo". */
const DANG_MO: readonly TaskStatus[] = ['draft', 'assigned', 'in_progress', 'blocked', 'review']

/** Hiện lỗi tải dữ liệu kèm gợi ý khi lỗi là do thiếu cấu hình. */
function LoiManHinh({ loi }: { loi: ApiError }): ReactNode {
  return (
    <ThongBao loai="loi">
      {loi.message}
      {loi.needsConfiguration ? ' Vào mục “Cài đặt” để hoàn tất cấu hình trước khi dùng màn hình này.' : null}
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
        setLoi(error instanceof ApiError ? error : new ApiError(0, 'network', 'Không kết nối được máy chủ.'))
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
        <TieuDeTrang>Bảng điều khiển</TieuDeTrang>
        <DangTai nhan="Đang tải số liệu…" />
      </Trang>
    )
  }

  if (loi && !duLieu) {
    return (
      <Trang>
        <TieuDeTrang>Bảng điều khiển</TieuDeTrang>
        <LoiManHinh loi={loi} />
        <div style={{ marginTop: 12 }}>
          <Nut bien="phu" onClick={taiLai}>
            Thử lại
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
      <TieuDeTrang
        moTa={`Tổng quan hoạt động của ${duLieu.company.name}. Số liệu lấy trực tiếp từ kho dữ liệu của công ty này.`}
      >
        Bảng điều khiển
      </TieuDeTrang>

      {systemProblem ? (
        <div style={{ marginBottom: 16 }}>
          <ThongBao loai="canh-bao">
            <strong>Hệ thống chưa sẵn sàng:</strong> {systemProblem}. Kiểm tra lại danh mục agent/model ở màn “Cài
            đặt” trước khi chạy công việc mới.
          </ThongBao>
        </div>
      ) : null}

      <div className="luoi luoi--4">
        <OSo nhan="Việc đang mở" giaTri={soNguyen(soViecDangMo)} moTa="Nháp, đã giao, đang chạy, bị chặn, chờ duyệt" />
        <OSo nhan="Việc hoàn tất" giaTri={soNguyen(counts.tasks.done)} loai="thanh-cong" moTa="Đã qua bước duyệt" />
        <OSo nhan="Cuộc trao đổi" giaTri={soNguyen(counts.conversations)} moTa="Với Leader" />
        <OSo nhan="Tài liệu" giaTri={soNguyen(counts.documents)} moTa="Trong kho kiến thức" />
        <OSo
          nhan="Agent đang bật"
          giaTri={`${soNguyen(counts.agentsEnabled)}/${soNguyen(counts.agentsTotal)}`}
          loai={counts.agentsEnabled === 0 ? 'loi' : counts.agentsEnabled < counts.agentsTotal ? 'canh-bao' : 'thanh-cong'}
          moTa={counts.agentsEnabled === 0 ? 'Không agent nào chạy được' : 'Sẵn sàng nhận việc'}
        />
      </div>

      <Card
        tieuDe="Chi phí hôm nay"
        phu={`Trần chi phí mỗi ngày: ${tienUsd(cost.limitPerDay)} · 30 ngày qua: ${tienUsd(cost.last30Days)}`}
      >
        <div className="hang" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="so" style={{ fontWeight: 700, fontSize: 20 }}>
            {tienUsd(cost.today)}
          </span>
          <span style={{ color: 'var(--mau-chu-mo)', fontSize: 13 }}>
            {cost.limitPerDay > 0
              ? `Đã dùng ${Math.round(tyLeChiPhi)}% trần ngày`
              : 'Chưa đặt trần chi phí ngày'}
          </span>
        </div>
        <ThanhTienDo tyLe={tyLeChiPhi} />
        {cost.limitPerDay > 0 && conLai <= 0 ? (
          <div style={{ marginTop: 10 }}>
            <ThongBao loai="loi">
              Đã chạm trần chi phí ngày. Các lượt chạy mới sẽ bị dừng cho tới khi trần được nâng ở mục “Cài đặt”.
            </ThongBao>
          </div>
        ) : null}
      </Card>

      <Card tieuDe="Công việc theo trạng thái" phu="Bấm “Xem công việc” để mở bảng kanban đầy đủ.">
        <div className="hang">
          {TASK_STATUSES.map((trangThai) => (
            <span key={trangThai} className="badge badge--mo" title={NHAN_TRANG_THAI[trangThai]}>
              {NHAN_TRANG_THAI[trangThai]}: <span className="so">{soNguyen(counts.tasks[trangThai])}</span>
            </span>
          ))}
        </div>
      </Card>

      <Card tieuDe="Hoạt động gần đây" phu="Sự kiện mới nhất trong công ty, mới nhất ở trên.">
        {duLieu.recentActivity.length === 0 ? (
          <Trong>Chưa có hoạt động nào. Hãy bắt đầu bằng một cuộc trao đổi với Leader.</Trong>
        ) : (
          <div className="cot">
            {duLieu.recentActivity.map((hoatDong, chiSo) => (
              <div key={`${hoatDong.at}-${chiSo}`} className="hang" style={{ alignItems: 'flex-start' }}>
                <span style={{ flex: '0 0 118px', color: 'var(--mau-chu-mo)', fontSize: 13 }} className="so">
                  {thoiDiem(hoatDong.at)}
                </span>
                <span className="badge badge--mo">{hoatDong.kind}</span>
                <span style={{ flex: 1, minWidth: 200 }}>{hoatDong.summary}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card tieuDe="Hành động nhanh" phu="Đường tắt tới hai việc hay làm nhất.">
        <div className="hang">
          <Nut onClick={() => onNavigate('trao-doi')}>Trao đổi với Leader</Nut>
          <Nut bien="phu" onClick={() => onNavigate('cong-viec')}>
            Xem công việc
          </Nut>
          <Nut bien="phu" onClick={taiLai} dangTai={dangTai && duLieu !== null}>
            Làm mới số liệu
          </Nut>
        </div>
      </Card>
    </Trang>
  )
}
