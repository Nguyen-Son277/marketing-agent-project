/**
 * Chi phí — nơi trả lời "tiền đã đi đâu".
 *
 * Vì sao màn hình này tồn tại: chi phí model là khoản tăng âm thầm theo từng lượt
 * chạy, và một agent cấu hình sai model có thể đốt ngân sách nhanh hơn mọi thứ
 * khác. Bảng theo ngày để thấy xu hướng, bảng theo agent để thấy thủ phạm, và
 * bảng lượt chạy để soi từng lần lỗi — tất cả đều là bảng chữ, không cần biểu đồ
 * phức tạp.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CostAgentRow, CostsResponse, RunStatus, RunView } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import {
  Card,
  DangTai,
  Nhan,
  Nut,
  ONhap,
  OSo,
  ThongBao,
  TieuDeTrang,
  Trang,
  Trong,
  soNguyen,
  thoiDiem,
  tienUsd,
} from '../components/ui.tsx'

const NHAN_RUN: Readonly<Record<RunStatus, string>> = {
  running: 'Đang chạy',
  succeeded: 'Thành công',
  failed: 'Thất bại',
  cancelled: 'Đã huỷ',
  budget_exceeded: 'Vượt ngân sách',
}

function loaiNhanRun(status: RunStatus): 'mo' | 'thanh-cong' | 'canh-bao' | 'loi' | 'chinh' {
  if (status === 'succeeded') return 'thanh-cong'
  if (status === 'failed') return 'loi'
  if (status === 'budget_exceeded') return 'canh-bao'
  if (status === 'running') return 'chinh'
  return 'mo'
}

function LoiManHinh({ loi }: { loi: ApiError }): ReactNode {
  return (
    <ThongBao loai="loi">
      {loi.message}
      {loi.needsConfiguration ? ' Vào mục “Cài đặt” để khai báo nhà cung cấp và model trước.' : null}
    </ThongBao>
  )
}

/** Độ trễ hiển thị theo ms khi ngắn, theo giây khi dài — tránh con số 5 chữ số khó đọc. */
function doTre(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${soNguyen(Math.round(ms))} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

interface DongNgay {
  readonly day: string
  readonly tokensIn: number
  readonly tokensOut: number
  readonly costUsd: number
  readonly runs: number
}

export function ChiPhi({ companyId }: { companyId: string }): ReactNode {
  const [duLieu, setDuLieu] = useState<CostsResponse | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [boLoc, setBoLoc] = useState<{ from: string; to: string }>({ from: '', to: '' })

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    api
      .costs(companyId, {
        ...(boLoc.from.length > 0 ? { from: boLoc.from } : {}),
        ...(boLoc.to.length > 0 ? { to: boLoc.to } : {}),
      })
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
  }, [companyId, boLoc.from, boLoc.to, lanThu])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  const theoNgay = useMemo<readonly DongNgay[]>(() => {
    const nhom = new Map<string, DongNgay>()
    for (const dong of duLieu?.daily ?? []) {
      const hienCo: DongNgay = nhom.get(dong.day) ?? { day: dong.day, tokensIn: 0, tokensOut: 0, costUsd: 0, runs: 0 }
      nhom.set(dong.day, {
        day: dong.day,
        tokensIn: hienCo.tokensIn + dong.tokensIn,
        tokensOut: hienCo.tokensOut + dong.tokensOut,
        costUsd: hienCo.costUsd + dong.costUsd,
        runs: hienCo.runs + dong.runs,
      })
    }
    return [...nhom.values()].sort((a, b) => b.day.localeCompare(a.day))
  }, [duLieu])

  const theoAgent = useMemo<readonly CostAgentRow[]>(
    () => [...(duLieu?.byAgent ?? [])].sort((a, b) => b.costUsd - a.costUsd),
    [duLieu],
  )

  const chiPhiLonNhatNgay = theoNgay.reduce((lon, dong) => Math.max(lon, dong.costUsd), 0)
  const chiPhiLonNhatAgent = theoAgent.reduce((lon, dong) => Math.max(lon, dong.costUsd), 0)

  const tongToken = (duLieu?.totals.tokensIn ?? 0) + (duLieu?.totals.tokensOut ?? 0)

  return (
    <Trang rong>
      <TieuDeTrang moTa="Tổng hợp chi phí theo ngày, theo agent và từng lượt chạy. Chọn khoảng ngày để thu hẹp.">
        Chi phí
      </TieuDeTrang>

      <Card tieuDe="Khoảng thời gian" phu="Để trống nghĩa là lấy toàn bộ dữ liệu còn lưu.">
        <div className="hang" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 180 }}>
            <div className="nhan">Từ ngày</div>
            <ONhap value={from} onChange={setFrom} type="date" />
          </div>
          <div style={{ minWidth: 180 }}>
            <div className="nhan">Đến ngày</div>
            <ONhap value={to} onChange={setTo} type="date" />
          </div>
          <Nut onClick={() => setBoLoc({ from, to })}>Xem</Nut>
          <Nut
            bien="phu"
            onClick={() => {
              setFrom('')
              setTo('')
              setBoLoc({ from: '', to: '' })
            }}
          >
            Xoá lọc
          </Nut>
          <Nut bien="phu" onClick={taiLai} dangTai={dangTai && duLieu !== null}>
            Làm mới
          </Nut>
        </div>
        {boLoc.from.length > 0 || boLoc.to.length > 0 ? (
          <p style={{ marginBottom: 0, fontSize: 13, color: 'var(--mau-chu-mo)' }}>
            Đang lọc: {boLoc.from || 'đầu kỳ'} → {boLoc.to || 'nay'}
          </p>
        ) : null}
      </Card>

      {loi ? (
        <div style={{ marginTop: 16 }}>
          <LoiManHinh loi={loi} />
        </div>
      ) : null}

      {dangTai && !duLieu ? <DangTai nhan="Đang tổng hợp chi phí…" /> : null}

      {duLieu ? (
        <>
          <div className="luoi luoi--4" style={{ marginTop: 16 }}>
            <OSo nhan="Tổng chi phí" giaTri={tienUsd(duLieu.totals.costUsd)} />
            <OSo nhan="Lượt chạy" giaTri={soNguyen(duLieu.totals.runs)} moTa="Số lần agent thực sự gọi model" />
            <OSo nhan="Token vào" giaTri={soNguyen(duLieu.totals.tokensIn)} />
            <OSo nhan="Token ra" giaTri={soNguyen(duLieu.totals.tokensOut)} moTa={`Tổng ${soNguyen(tongToken)} token`} />
          </div>

          <Card tieuDe="Theo ngày" phu="Cộng dồn mọi agent và model trong cùng một ngày. Thanh dài nhất là ngày tốn nhất.">
            {theoNgay.length === 0 ? (
              <Trong>Chưa có dữ liệu chi phí trong khoảng đã chọn.</Trong>
            ) : (
              <table className="bang">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th>Chi phí</th>
                    <th style={{ width: '35%' }}>Tỷ lệ</th>
                    <th>Token vào</th>
                    <th>Token ra</th>
                    <th>Lượt chạy</th>
                  </tr>
                </thead>
                <tbody>
                  {theoNgay.map((dong) => (
                    <tr key={dong.day}>
                      <td className="so">{dong.day}</td>
                      <td className="so">{tienUsd(dong.costUsd)}</td>
                      <td>
                        <div style={{ height: 8, borderRadius: 999, background: 'var(--mau-vien)', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${chiPhiLonNhatNgay > 0 ? (dong.costUsd / chiPhiLonNhatNgay) * 100 : 0}%`,
                              background: 'var(--mau-chinh)',
                              borderRadius: 999,
                            }}
                          />
                        </div>
                      </td>
                      <td className="so">{soNguyen(dong.tokensIn)}</td>
                      <td className="so">{soNguyen(dong.tokensOut)}</td>
                      <td className="so">{soNguyen(dong.runs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card tieuDe="Theo agent" phu="Sắp xếp giảm dần theo chi phí — agent đứng đầu là chỗ nên xem lại model trước.">
            {theoAgent.length === 0 ? (
              <Trong>Chưa có agent nào tiêu tốn trong khoảng đã chọn.</Trong>
            ) : (
              <table className="bang">
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Chi phí</th>
                    <th style={{ width: '35%' }}>Tỷ lệ</th>
                    <th>Token</th>
                    <th>Lượt chạy</th>
                  </tr>
                </thead>
                <tbody>
                  {theoAgent.map((dong) => (
                    <tr key={dong.agentDefId}>
                      <td>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{dong.agentDefId}</span>
                      </td>
                      <td className="so">{tienUsd(dong.costUsd)}</td>
                      <td>
                        <div style={{ height: 8, borderRadius: 999, background: 'var(--mau-vien)', overflow: 'hidden' }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${chiPhiLonNhatAgent > 0 ? (dong.costUsd / chiPhiLonNhatAgent) * 100 : 0}%`,
                              background: 'var(--mau-phu)',
                              borderRadius: 999,
                            }}
                          />
                        </div>
                      </td>
                      <td className="so">{soNguyen(dong.tokens)}</td>
                      <td className="so">{soNguyen(dong.runs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card tieuDe="Lượt chạy" phu="Chi tiết từng lần gọi model, mới nhất ở trên.">
            {duLieu.runs.length === 0 ? (
              <Trong>Chưa có lượt chạy nào trong khoảng đã chọn.</Trong>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="bang">
                  <thead>
                    <tr>
                      <th>Thời điểm</th>
                      <th>Trạng thái</th>
                      <th>Agent</th>
                      <th>Model</th>
                      <th>Token vào</th>
                      <th>Token ra</th>
                      <th>Chi phí</th>
                      <th>Độ trễ</th>
                      <th>Bước</th>
                      <th>Lỗi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...duLieu.runs]
                      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                      .map((run: RunView) => (
                        <tr key={run.id}>
                          <td className="so">{thoiDiem(run.createdAt)}</td>
                          <td>
                            <Nhan loai={loaiNhanRun(run.status)}>{NHAN_RUN[run.status]}</Nhan>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{run.agentDefId}</td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{run.modelId ?? '—'}</td>
                          <td className="so">{soNguyen(run.tokensIn)}</td>
                          <td className="so">{soNguyen(run.tokensOut)}</td>
                          <td className="so">{tienUsd(run.costUsd)}</td>
                          <td className="so">{doTre(run.latencyMs)}</td>
                          <td className="so">{soNguyen(run.steps)}</td>
                          <td style={{ color: run.error ? 'var(--mau-loi)' : undefined, maxWidth: 260 }}>
                            {run.error ?? '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}

      {!dangTai && !duLieu && !loi ? <Trong>Chưa có dữ liệu chi phí.</Trong> : null}
    </Trang>
  )
}
