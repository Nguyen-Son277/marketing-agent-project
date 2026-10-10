/**
 * Công việc — bảng kanban và nơi con người phê duyệt kết quả của agent.
 *
 * Vì sao màn hình này tồn tại: agent tự chia việc và tự chạy, nhưng quyền quyết
 * định cuối cùng vẫn thuộc về con người. Màn hình gom việc theo trạng thái để
 * nhìn ra ngay chỗ tắc, và mở chi tiết ngay trong trang (không đổi route) để
 * người duyệt đọc brief, kết quả, artifact, trao đổi giữa các agent rồi quyết
 * định approve / yêu cầu sửa / huỷ mà không mất ngữ cảnh.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { TaskDetailResponse, TaskListResponse, TaskStatus, TaskView } from '@marketing-agent/shared'
import { TASK_STATUSES, TERMINAL_TASK_STATUSES } from '@marketing-agent/shared'
import { api, ApiError } from '../lib/api.ts'
import { Markdown } from '../components/Markdown.tsx'
import {
  Card,
  DangTai,
  Nhan,
  Nut,
  OVanBan,
  ThongBao,
  TieuDeTrang,
  Trang,
  Trong,
  soNguyen,
  thoiDiem,
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

type LoaiNhan = 'mo' | 'thanh-cong' | 'canh-bao' | 'loi' | 'chinh'

function loaiNhanTrangThai(trangThai: TaskStatus): LoaiNhan {
  if (trangThai === 'done') return 'thanh-cong'
  if (trangThai === 'failed' || trangThai === 'blocked') return 'loi'
  if (trangThai === 'review') return 'canh-bao'
  if (trangThai === 'in_progress') return 'chinh'
  return 'mo'
}

/** Ưu tiên càng nhỏ càng gấp (hàng đợi sắp xếp tăng dần theo priority). */
function nhanUuTien(priority: number): { nhan: string; loai: LoaiNhan } {
  if (priority <= 1) return { nhan: `Ưu tiên ${priority} · cao nhất`, loai: 'loi' }
  if (priority === 2) return { nhan: `Ưu tiên ${priority} · cao`, loai: 'canh-bao' }
  if (priority === 3) return { nhan: `Ưu tiên ${priority} · trung bình`, loai: 'mo' }
  return { nhan: `Ưu tiên ${priority} · thấp`, loai: 'mo' }
}

function LoiManHinh({ loi }: { loi: ApiError }): ReactNode {
  return (
    <ThongBao loai="loi">
      {loi.message}
      {loi.needsConfiguration ? ' Vào mục “Cài đặt” để hoàn tất cấu hình trước khi dùng màn hình này.' : null}
    </ThongBao>
  )
}

/** Chuyển payload sự kiện (unknown) thành chuỗi đọc được, không bao giờ ném lỗi. */
function chuoiJson(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function CongViec({ companyId }: { companyId: string }): ReactNode {
  const [duLieu, setDuLieu] = useState<TaskListResponse | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<ApiError | null>(null)
  const [lanThu, setLanThu] = useState(0)

  const [chonId, setChonId] = useState<string | null>(null)
  const [chiTiet, setChiTiet] = useState<TaskDetailResponse | null>(null)
  const [dangTaiChiTiet, setDangTaiChiTiet] = useState(false)
  const [loiChiTiet, setLoiChiTiet] = useState<ApiError | null>(null)

  const [ghiChu, setGhiChu] = useState('')
  const [dangDuyet, setDangDuyet] = useState(false)
  const [thongBaoDuyet, setThongBaoDuyet] = useState<string | null>(null)
  const [loiDuyet, setLoiDuyet] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setLoi(null)
    api
      .tasks(companyId)
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

  useEffect(() => {
    if (!chonId) {
      setChiTiet(null)
      return
    }
    let cancelled = false
    setDangTaiChiTiet(true)
    setLoiChiTiet(null)
    setChiTiet(null)
    setThongBaoDuyet(null)
    setLoiDuyet(null)
    setGhiChu('')
    api
      .task(chonId)
      .then((ketQua) => {
        if (!cancelled) setChiTiet(ketQua)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoiChiTiet(error instanceof ApiError ? error : new ApiError(0, 'network', 'Không kết nối được máy chủ.'))
      })
      .finally(() => {
        if (!cancelled) setDangTaiChiTiet(false)
      })
    return () => {
      cancelled = true
    }
  }, [chonId])

  const taiLai = useCallback(() => setLanThu((lan) => lan + 1), [])

  const tenTheoId = useMemo(() => {
    const map = new Map<string, string>()
    for (const task of duLieu?.tasks ?? []) map.set(task.id, task.title)
    return map
  }, [duLieu])

  const cotTheoTrangThai = useMemo(() => {
    const map = new Map<TaskStatus, TaskView[]>()
    for (const trangThai of TASK_STATUSES) map.set(trangThai, [])
    for (const task of duLieu?.tasks ?? []) {
      const bucket = map.get(task.status)
      if (bucket) bucket.push(task)
    }
    return map
  }, [duLieu])

  async function duyet(quyetDinh: 'approve' | 'request_changes' | 'cancel'): Promise<void> {
    if (!chonId) return
    setDangDuyet(true)
    setLoiDuyet(null)
    setThongBaoDuyet(null)
    try {
      const ketQua = await api.reviewTask(chonId, {
        decision: quyetDinh,
        ...(ghiChu.trim().length > 0 ? { note: ghiChu.trim() } : {}),
      })
      const nhanQuyetDinh =
        quyetDinh === 'approve' ? 'Đã duyệt' : quyetDinh === 'request_changes' ? 'Đã yêu cầu sửa' : 'Đã huỷ'
      setThongBaoDuyet(`${nhanQuyetDinh} công việc “${ketQua.task.title}”.`)
      setGhiChu('')
      setLanThu((lan) => lan + 1)
      // Nạp lại chi tiết để thấy ngay sự kiện review vừa sinh.
      const moi = await api.task(chonId)
      setChiTiet(moi)
    } catch (error) {
      setLoiDuyet(error instanceof ApiError ? error.message : 'Không gửi được quyết định duyệt.')
    } finally {
      setDangDuyet(false)
    }
  }

  const taskDangChon = chiTiet?.task ?? null
  const coTheDuyet = taskDangChon !== null && !TERMINAL_TASK_STATUSES.includes(taskDangChon.status)

  return (
    <Trang rong>
      <TieuDeTrang moTa="Mỗi cột là một trạng thái. Bấm một thẻ để xem chi tiết và phê duyệt ngay tại đây.">
        Công việc
      </TieuDeTrang>

      {loi ? (
        <div style={{ marginBottom: 16 }}>
          <LoiManHinh loi={loi} />
          <div style={{ marginTop: 12 }}>
            <Nut bien="phu" onClick={taiLai}>
              Thử lại
            </Nut>
          </div>
        </div>
      ) : null}

      {dangTai && !duLieu ? <DangTai nhan="Đang tải danh sách công việc…" /> : null}

      {duLieu && duLieu.tasks.length === 0 ? (
        <Trong>
          Chưa có công việc nào. Vào mục “Trao đổi với Leader”, mô tả mục tiêu rồi để Leader lập kế hoạch và giao việc.
        </Trong>
      ) : null}

      {duLieu && duLieu.tasks.length > 0 ? (
        <div className="kanban" style={{ marginBottom: 16 }}>
          {TASK_STATUSES.filter((trangThai) => (cotTheoTrangThai.get(trangThai)?.length ?? 0) > 0).map((trangThai) => {
            const the = cotTheoTrangThai.get(trangThai) ?? []
            return (
              <div key={trangThai} className="kanban__cot">
                <div className="kanban__dau">
                  <span>{NHAN_TRANG_THAI[trangThai]}</span>
                  <span className="so">{soNguyen(the.length)}</span>
                </div>
                {the.map((task) => {
                  const uuTien = nhanUuTien(task.priority)
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className="kanban__the"
                      style={{ display: 'block', width: '100%', textAlign: 'left' }}
                      onClick={() => setChonId(task.id)}
                    >
                      <div className="kanban__the-td">{task.title}</div>
                      <div className="hang" style={{ gap: 6, marginTop: 6 }}>
                        <Nhan loai="mo">{task.assigneeName ?? 'Chưa giao'}</Nhan>
                        <Nhan loai={uuTien.loai}>{uuTien.nhan}</Nhan>
                      </div>
                      {task.revisionCount > 0 ? (
                        <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)', marginTop: 6 }}>
                          Đã sửa {soNguyen(task.revisionCount)} lần
                        </div>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      ) : null}

      {chonId ? (
        <Card
          tieuDe={`Chi tiết công việc${taskDangChon ? `: ${taskDangChon.title}` : ''}`}
          hanhDong={
            <Nut bien="phu" nho onClick={() => setChonId(null)}>
              Đóng
            </Nut>
          }
        >
          {dangTaiChiTiet ? <DangTai nhan="Đang tải chi tiết…" /> : null}

          {loiChiTiet ? <LoiManHinh loi={loiChiTiet} /> : null}

          {chiTiet && taskDangChon ? (
            <div className="cot" style={{ gap: 16 }}>
              <div className="hang">
                <Nhan loai={loaiNhanTrangThai(taskDangChon.status)}>{NHAN_TRANG_THAI[taskDangChon.status]}</Nhan>
                <Nhan loai={nhanUuTien(taskDangChon.priority).loai}>{nhanUuTien(taskDangChon.priority).nhan}</Nhan>
                <Nhan loai="mo">{taskDangChon.assigneeName ?? 'Chưa giao'}</Nhan>
                <span style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>
                  Tạo {thoiDiem(taskDangChon.createdAt)} · Cập nhật {thoiDiem(taskDangChon.updatedAt)}
                  {taskDangChon.deadline ? ` · Hạn ${thoiDiem(taskDangChon.deadline)}` : ''}
                </span>
              </div>

              <div className="luoi luoi--2">
                <div>
                  <h3 className="card__tieu-de">Brief</h3>
                  {taskDangChon.briefMd.trim().length > 0 ? (
                    <Markdown>{taskDangChon.briefMd}</Markdown>
                  ) : (
                    <Trong>Chưa có brief.</Trong>
                  )}
                  {taskDangChon.deliverableSpec ? (
                    <p style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>
                      Sản phẩm cần giao: {taskDangChon.deliverableSpec}
                    </p>
                  ) : null}
                </div>
                <div>
                  <h3 className="card__tieu-de">Kết quả</h3>
                  {taskDangChon.resultMd && taskDangChon.resultMd.trim().length > 0 ? (
                    <Markdown>{taskDangChon.resultMd}</Markdown>
                  ) : (
                    <Trong>Agent chưa gửi kết quả cho công việc này.</Trong>
                  )}
                </div>
              </div>

              <div className="luoi luoi--2">
                <div>
                  <h3 className="card__tieu-de">Phụ thuộc</h3>
                  {taskDangChon.dependsOn.length === 0 ? (
                    <p style={{ color: 'var(--mau-chu-mo)' }}>Không phụ thuộc việc nào.</p>
                  ) : (
                    <ul>
                      {taskDangChon.dependsOn.map((id) => (
                        <li key={id}>{tenTheoId.get(id) ?? id}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <h3 className="card__tieu-de">Việc đang chờ công việc này</h3>
                  {taskDangChon.blocks.length === 0 ? (
                    <p style={{ color: 'var(--mau-chu-mo)' }}>Không chặn việc nào.</p>
                  ) : (
                    <ul>
                      {taskDangChon.blocks.map((id) => (
                        <li key={id}>{tenTheoId.get(id) ?? id}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div>
                <h3 className="card__tieu-de">Artifact ({soNguyen(chiTiet.artifacts.length)})</h3>
                {chiTiet.artifacts.length === 0 ? (
                  <Trong>Chưa có artifact nào được tạo.</Trong>
                ) : (
                  <div className="cot">
                    {chiTiet.artifacts.map((artifact) => (
                      <div key={artifact.id}>
                        <div className="hang">
                          <strong>{artifact.name}</strong>
                          <Nhan loai="mo">{artifact.kind}</Nhan>
                          <span style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{thoiDiem(artifact.createdAt)}</span>
                        </div>
                        {artifact.content ? (
                          artifact.kind === 'markdown' ? (
                            <Markdown>{artifact.content}</Markdown>
                          ) : (
                            <pre style={{ maxHeight: 260, overflow: 'auto' }}>{artifact.content}</pre>
                          )
                        ) : (
                          <div style={{ fontSize: 13, color: 'var(--mau-chu-mo)' }}>
                            {artifact.path ? `Tệp: ${artifact.path}` : 'Không có nội dung đính kèm.'}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="card__tieu-de">Trao đổi giữa các agent ({soNguyen(chiTiet.messages.length)})</h3>
                {chiTiet.messages.length === 0 ? (
                  <Trong>Hai agent chưa trao đổi gì về công việc này.</Trong>
                ) : (
                  <div className="cot">
                    {chiTiet.messages.map((tin) => (
                      <div key={tin.id} className="card" style={{ boxShadow: 'none' }}>
                        <div className="hang" style={{ justifyContent: 'space-between' }}>
                          <span>
                            <strong>{tin.fromAgent}</strong> → <strong>{tin.toAgent}</strong> <Nhan loai="mo">{tin.kind}</Nhan>
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{thoiDiem(tin.createdAt)}</span>
                        </div>
                        <Markdown>{tin.contentMd}</Markdown>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="card__tieu-de">Dòng thời gian sự kiện</h3>
                {chiTiet.events.length === 0 ? (
                  <Trong>Chưa ghi nhận sự kiện nào.</Trong>
                ) : (
                  <div className="cot">
                    {chiTiet.events.map((suKien) => (
                      <div key={suKien.id} className="hang" style={{ alignItems: 'flex-start' }}>
                        <span style={{ flex: '0 0 118px', fontSize: 13, color: 'var(--mau-chu-mo)' }} className="so">
                          {thoiDiem(suKien.createdAt)}
                        </span>
                        <Nhan loai="mo">{suKien.kind}</Nhan>
                        <span style={{ flex: 1, minWidth: 200, fontSize: 13, fontFamily: 'var(--font-mono)' }}>
                          {chuoiJson(suKien.payload)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card" style={{ boxShadow: 'none', background: 'var(--mau-nen)' }}>
                <h3 className="card__tieu-de">Phê duyệt</h3>
                {thongBaoDuyet ? (
                  <div style={{ marginBottom: 10 }}>
                    <ThongBao loai="thanh-cong">{thongBaoDuyet}</ThongBao>
                  </div>
                ) : null}
                {loiDuyet ? (
                  <div style={{ marginBottom: 10 }}>
                    <ThongBao loai="loi">{loiDuyet}</ThongBao>
                  </div>
                ) : null}
                {coTheDuyet ? (
                  <>
                    <p style={{ marginTop: 0, color: 'var(--mau-chu-mo)', fontSize: 13 }}>
                      Ghi chú là tuỳ chọn, nhưng bắt buộc nên có khi yêu cầu sửa để agent biết cần đổi gì.
                    </p>
                    <OVanBan value={ghiChu} onChange={setGhiChu} rows={3} placeholder="Ví dụ: phần ngân sách chưa khớp với KPI đã chốt." />
                    <div className="hang" style={{ marginTop: 10 }}>
                      <Nut onClick={() => void duyet('approve')} dangTai={dangDuyet}>
                        Duyệt
                      </Nut>
                      <Nut bien="phu" onClick={() => void duyet('request_changes')} dangTai={dangDuyet}>
                        Yêu cầu sửa
                      </Nut>
                      <Nut bien="nguy-hiem" onClick={() => void duyet('cancel')} dangTai={dangDuyet}>
                        Huỷ công việc
                      </Nut>
                    </div>
                  </>
                ) : (
                  <ThongBao loai="thong-tin">
                    Công việc ở trạng thái “{NHAN_TRANG_THAI[taskDangChon.status]}” nên không còn hành động duyệt.
                  </ThongBao>
                )}
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}
    </Trang>
  )
}
