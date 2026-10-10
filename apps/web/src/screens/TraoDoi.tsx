/**
 * Màn hình trao đổi với Leader.
 *
 * Vì sao đây là màn hình quan trọng nhất: nó là điểm chạm duy nhất giữa người dùng
 * và đội agent. Người dùng không chat với chuyên môn — họ chốt brief với Leader, xem
 * kế hoạch, phê duyệt, rồi đọc báo cáo. Màn hình phải làm ba việc đó rõ ràng:
 *
 * 1. Cho thấy Leader đang cần thêm thông tin gì (BriefGate) thay vì để người dùng
 *    đoán tại sao chưa có kế hoạch.
 * 2. Hiện tiến độ chạy thật qua SSE — agent nào đang chạy, tool nào vừa gọi — vì
 *    một lượt chạy có thể mất vài phút và im lặng là trải nghiệm tệ nhất.
 * 3. Tách rõ ba hành động không thể hoàn tác: lập kế hoạch, chạy kế hoạch, viết báo
 *    cáo. Mỗi hành động là một nút riêng để người dùng biết mình đang cho phép gì.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  ConversationDetailResponse,
  ConversationView,
  MessageView,
  TaskView,
} from '@marketing-agent/shared'
import { api, ApiError, openConversationStream, type StreamEvent } from '../lib/api.ts'
import { Markdown } from '../components/Markdown.tsx'
import {
  Card,
  DangTai,
  Nhan,
  Nut,
  OVanBan,
  ThongBao,
  Trang,
  thoiDiem,
  tienUsd,
} from '../components/ui.tsx'

/** Nhãn tiếng Việt cho trường còn thiếu của brief, khớp BRIEF_FIELD_LABELS. */
const NHAN_TRUONG: Record<string, string> = {
  objective: 'Mục tiêu',
  kpi: 'KPI',
  scope: 'Phạm vi',
  deadline: 'Thời hạn',
  budget: 'Ngân sách',
  constraints: 'Ràng buộc',
}

/** Một dòng nhật ký sự kiện hiện giữa các tin nhắn. */
interface DongSuKien {
  readonly id: number
  readonly text: string
  readonly at: number
}

export function TraoDoi({ companyId }: { companyId: string }): ReactNode {
  const [danhSach, setDanhSach] = useState<ConversationView[]>([])
  const [dangChon, setDangChon] = useState<string | null>(null)
  const [chiTiet, setChiTiet] = useState<ConversationDetailResponse | null>(null)
  const [suKien, setSuKien] = useState<DongSuKien[]>([])
  const [noiDung, setNoiDung] = useState('')
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [dangGui, setDangGui] = useState(false)
  const [dangChay, setDangChay] = useState<'plan' | 'run' | 'report' | null>(null)
  const [baoKetQua, setBaoKetQua] = useState<string | null>(null)

  const cuonRef = useRef<HTMLDivElement>(null)
  const demSuKien = useRef(0)

  /** Tải danh sách cuộc trao đổi; chọn cuộc mới nhất nếu chưa chọn gì. */
  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    void (async () => {
      try {
        const ketQua = await api.conversations(companyId)
        if (cancelled) return
        setDanhSach(ketQua.conversations)
        setDangChon((hienTai) => hienTai ?? ketQua.conversations[0]?.id ?? null)
      } catch (error) {
        if (!cancelled) setLoi(error instanceof ApiError ? error.message : 'Không tải được danh sách trao đổi.')
      } finally {
        if (!cancelled) setDangTai(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [companyId])

  /** Tải chi tiết cuộc đang chọn. */
  const taiChiTiet = useCallback(async (conversationId: string) => {
    const ketQua = await api.conversation(conversationId)
    setChiTiet(ketQua)
    setSuKien([])
    demSuKien.current = 0
  }, [])

  useEffect(() => {
    if (!dangChon) {
      setChiTiet(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const ketQua = await api.conversation(dangChon)
        if (!cancelled) {
          setChiTiet(ketQua)
          setSuKien([])
          demSuKien.current = 0
        }
      } catch (error) {
        if (!cancelled) setLoi(error instanceof ApiError ? error.message : 'Không tải được cuộc trao đổi.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dangChon])

  /** Nghe sự kiện của cuộc đang mở; đóng luồng khi đổi cuộc hoặc unmount. */
  useEffect(() => {
    if (!dangChon) return
    const dong = openConversationStream(dangChon, {
      onEvent: (event: StreamEvent) => {
        const text = moTaSuKien(event)
        if (!text) return
        demSuKien.current += 1
        setSuKien((truoc) => [...truoc.slice(-40), { id: demSuKien.current, text, at: Date.now() }])
        // Sự kiện đánh dấu thay đổi dữ liệu thì tải lại để thấy nội dung thật.
        if (['leader.replied', 'plan.created', 'task.updated', 'report.created', 'artifact.created'].includes(event.type)) {
          void taiChiTiet(dangChon).catch(() => undefined)
        }
      },
    })
    return dong
  }, [dangChon, taiChiTiet])

  /** Tự cuộn xuống cuối khi có nội dung mới. */
  useEffect(() => {
    const khung = cuonRef.current
    if (khung) khung.scrollTop = khung.scrollHeight
  }, [chiTiet?.messages.length, suKien.length])

  async function taoCuocMoi(): Promise<void> {
    setLoi(null)
    try {
      const ketQua = await api.createConversation(companyId, 'Cuộc trao đổi mới')
      setDanhSach((truoc) => [ketQua.conversation, ...truoc])
      setDangChon(ketQua.conversation.id)
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'Không tạo được cuộc trao đổi.')
    }
  }

  async function gui(): Promise<void> {
    const content = noiDung.trim()
    if (content.length === 0 || !dangChon) return
    setLoi(null)
    setBaoKetQua(null)
    setDangGui(true)
    setNoiDung('')
    try {
      const ketQua = await api.sendMessage(dangChon, { content })
      setBaoKetQua(
        ketQua.briefComplete
          ? 'Đã đủ thông tin để lập kế hoạch. Bấm "Lập kế hoạch" ở trên.'
          : `Leader cần thêm: ${ketQua.missingFields.map((field) => NHAN_TRUONG[field] ?? field).join(', ')}`,
      )
      await taiChiTiet(dangChon)
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'Không gửi được tin nhắn.')
      setNoiDung(content)
    } finally {
      setDangGui(false)
    }
  }

  async function chayBuoc(buoc: 'plan' | 'run' | 'report'): Promise<void> {
    if (!dangChon) return
    setLoi(null)
    setBaoKetQua(null)
    setDangChay(buoc)
    try {
      if (buoc === 'plan') {
        const ketQua = await api.planConversation(dangChon)
        setBaoKetQua(`Đã lập kế hoạch ${ketQua.tasks.length} công việc. Bấm "Chạy kế hoạch" để đội bắt đầu làm.`)
      } else if (buoc === 'run') {
        await api.runConversation(dangChon)
        setBaoKetQua('Đội đã chạy xong kế hoạch. Xem tab Công việc để biết chi tiết từng việc.')
      } else {
        const ketQua = await api.reportConversation(dangChon)
        setBaoKetQua(`Đã tạo báo cáo (tài sản ${ketQua.artifactId}).`)
      }
      await taiChiTiet(dangChon)
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : 'Không thực hiện được bước này.')
    } finally {
      setDangChay(null)
    }
  }

  if (dangTai) {
    return (
      <Trang>
        <DangTai nhan="Đang tải cuộc trao đổi…" />
      </Trang>
    )
  }

  return (
    <Trang rong>
      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Danh sách cuộc trao đổi */}
        <Card
          tieuDe="Cuộc trao đổi"
          hanhDong={
            <Nut nho bien="phu" onClick={() => void taoCuocMoi()} title="Tạo cuộc trao đổi mới">
              +
            </Nut>
          }
        >
          {danhSach.length === 0 ? (
            <p style={{ color: 'var(--mau-chu-mo)', fontSize: 14, margin: 0 }}>
              Chưa có cuộc trao đổi nào. Bấm + để bắt đầu.
            </p>
          ) : (
            <div className="cot" style={{ gap: 4 }}>
              {danhSach.map((cuoc) => (
                <button
                  key={cuoc.id}
                  type="button"
                  className={cuoc.id === dangChon ? 'app__nav-item app__nav-item--active' : 'app__nav-item'}
                  onClick={() => setDangChon(cuoc.id)}
                  style={{ display: 'block' }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{cuoc.title}</div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>
                    {cuoc.phase} · {thoiDiem(cuoc.updatedAt)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Khung chat */}
        <div className="cot">
          {loi ? <ThongBao loai="loi">{loi}</ThongBao> : null}
          {baoKetQua ? <ThongBao loai="thong-tin">{baoKetQua}</ThongBao> : null}

          {chiTiet ? (
            <>
              <Card>
                <div className="hang" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 650 }}>{chiTiet.conversation.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>
                      Giai đoạn {chiTiet.conversation.phase} · chi phí {tienUsd(chiTiet.costUsd)} ·{' '}
                      {chiTiet.usage.runs} lượt chạy
                    </div>
                  </div>
                  <div className="hang">
                    <Nut
                      nho
                      bien="phu"
                      dangTai={dangChay === 'plan'}
                      onClick={() => void chayBuoc('plan')}
                      title="Leader chia công việc từ brief đã chốt"
                    >
                      Lập kế hoạch
                    </Nut>
                    <Nut
                      nho
                      bien="phu"
                      dangTai={dangChay === 'run'}
                      disabled={chiTiet.tasks.length === 0}
                      onClick={() => void chayBuoc('run')}
                      title={
                        chiTiet.tasks.length === 0
                          ? 'Cần lập kế hoạch trước'
                          : 'Các agent chuyên môn bắt đầu làm việc'
                      }
                    >
                      Chạy kế hoạch
                    </Nut>
                    <Nut
                      nho
                      dangTai={dangChay === 'report'}
                      disabled={chiTiet.tasks.length === 0}
                      onClick={() => void chayBuoc('report')}
                      title="Tổng hợp báo cáo cuối cùng"
                    >
                      Viết báo cáo
                    </Nut>
                  </div>
                </div>

                {chiTiet.conversation.briefComplete ? null : (
                  <div style={{ marginTop: 12 }}>
                    <ThongBao loai="canh-bao">
                      Leader chưa đủ thông tin để lập kế hoạch. Còn thiếu:{' '}
                      <strong>
                        {chiTiet.conversation.missingFields
                          .map((field) => NHAN_TRUONG[field] ?? field)
                          .join(', ') || 'chưa xác định'}
                      </strong>
                      . Hãy trả lời các câu hỏi của Leader ở khung bên dưới.
                    </ThongBao>
                  </div>
                )}
              </Card>

              {chiTiet.tasks.length > 0 ? (
                <Card tieuDe="Kế hoạch" phu="Bấm tab Công việc để xem chi tiết từng việc.">
                  <table className="bang">
                    <thead>
                      <tr>
                        <th>Công việc</th>
                        <th>Chuyên môn</th>
                        <th>Phụ thuộc</th>
                        <th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chiTiet.tasks.map((task: TaskView) => (
                        <tr key={task.id}>
                          <td>{task.title}</td>
                          <td>{task.assigneeName ?? task.assigneeRole ?? '—'}</td>
                          <td>{task.dependsOn.length > 0 ? task.dependsOn.length : '—'}</td>
                          <td>
                            <Nhan loai={nhanTrangThai(task.status).loai}>{nhanTrangThai(task.status).nhan}</Nhan>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              ) : null}

              <div className="card">
                <div className="chat">
                  <div className="chat__khung" ref={cuonRef}>
                    {chiTiet.messages.length === 0 && suKien.length === 0 ? (
                      <div className="trong">
                        Hãy mô tả mục tiêu marketing của bạn. Leader sẽ hỏi thêm cho tới khi đủ thông tin để
                        lập kế hoạch.
                      </div>
                    ) : null}

                    {chiTiet.messages.map((message: MessageView) => (
                      <TinNhan key={message.id} message={message} />
                    ))}

                    {suKien.map((dong) => (
                      <div key={dong.id} className="su-kien">
                        {dong.text}
                      </div>
                    ))}
                  </div>

                  <div className="chat__nhap">
                    <OVanBan
                      value={noiDung}
                      onChange={setNoiDung}
                      rows={2}
                      disabled={dangGui}
                      placeholder="Ví dụ: Lập kế hoạch content tháng 11 cho sản phẩm Sapa POS, mục tiêu 50 lead"
                    />
                    <Nut dangTai={dangGui} onClick={() => void gui()} disabled={noiDung.trim().length === 0}>
                      Gửi
                    </Nut>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <Card>
              <div className="trong">Chọn hoặc tạo một cuộc trao đổi để bắt đầu.</div>
            </Card>
          )}
        </div>
      </div>
    </Trang>
  )
}

/** Một tin nhắn trong khung chat, phân biệt người dùng với Leader. */
function TinNhan({ message }: { message: MessageView }): ReactNode {
  const laNguoiDung = message.authorKind === 'user'
  const laHeThong = message.authorKind === 'system'
  const tenTacGia = laNguoiDung
    ? 'Bạn'
    : laHeThong
      ? 'Hệ thống'
      : (message.authorAgent ?? 'Leader')

  return (
    <div className={laNguoiDung ? 'tin tin--nguoi-dung' : 'tin'}>
      <div className="tin__avatar" aria-hidden>
        {laNguoiDung ? '🧑' : laHeThong ? '⚙️' : '🎯'}
      </div>
      <div className="tin__than">
        <div className="tin__dau">
          <span style={{ fontWeight: 600 }}>{tenTacGia}</span>
          <span>{thoiDiem(message.createdAt)}</span>
          {message.costUsd > 0 ? <span>{tienUsd(message.costUsd)}</span> : null}
        </div>
        {laNguoiDung ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.contentMd}</div>
        ) : (
          <Markdown>{message.contentMd}</Markdown>
        )}
      </div>
    </div>
  )
}

/** Nhãn và màu hiển thị cho trạng thái công việc. */
export function nhanTrangThai(status: string): { nhan: string; loai: 'mo' | 'thanh-cong' | 'canh-bao' | 'loi' } {
  switch (status) {
    case 'done':
      return { nhan: 'Xong', loai: 'thanh-cong' }
    case 'in_progress':
      return { nhan: 'Đang làm', loai: 'canh-bao' }
    case 'blocked':
      return { nhan: 'Bị chặn', loai: 'loi' }
    case 'failed':
      return { nhan: 'Thất bại', loai: 'loi' }
    case 'review':
      return { nhan: 'Chờ duyệt', loai: 'canh-bao' }
    case 'assigned':
      return { nhan: 'Đã giao', loai: 'mo' }
    case 'cancelled':
      return { nhan: 'Đã huỷ', loai: 'mo' }
    default:
      return { nhan: status, loai: 'mo' }
  }
}

/**
 * Chuyển một sự kiện SSE thành một dòng người đọc được.
 *
 * Chỉ những sự kiện mang thông tin mới cho người dùng mới được hiện; sự kiện thuần
 * kỹ thuật bị bỏ qua để nhật ký không bị nhiễu.
 */
export function moTaSuKien(event: StreamEvent): string | null {
  const data = (event.data ?? {}) as Record<string, unknown>
  switch (event.type) {
    case 'leader.thinking':
      return '🎯 Leader đang phân tích yêu cầu…'
    case 'leader.replied':
      return '🎯 Leader đã trả lời.'
    case 'plan.created': {
      const tasks = Array.isArray(data['tasks']) ? data['tasks'].length : 0
      return `🗂️ Đã tạo kế hoạch gồm ${tasks} công việc.`
    }
    case 'agent.started':
      return `▶️ ${String(data['assigneeRole'] ?? 'Agent')} bắt đầu: ${String(data['title'] ?? '')}`
    case 'tool.called':
      return `🔧 ${String(data['agentRole'] ?? '')} gọi ${String(data['tool'] ?? '')}${data['ok'] === false ? ' (lỗi)' : ''}`
    case 'task.updated':
      return `📌 ${String(data['title'] ?? '')} → ${String(data['status'] ?? '')}${data['reason'] ? `: ${String(data['reason'])}` : ''}`
    case 'artifact.created':
      return '📄 Có tài sản đầu ra mới.'
    case 'agent.message':
      return `💬 ${String(data['from'] ?? '')} → ${String(data['to'] ?? '')} (${String(data['kind'] ?? '')})`
    case 'review.completed':
      return `🔍 Kiểm tra chất lượng: ${data['verdict'] === 'pass' ? 'đạt' : 'cần sửa'}`
    case 'report.created':
      return '📊 Báo cáo cuối cùng đã sẵn sàng.'
    case 'brief.updated':
      return data['complete'] === true ? '✅ Đã chốt đủ thông tin brief.' : '❓ Cần bổ sung thông tin cho brief.'
    case 'warning':
      return `⚠️ ${String(data['message'] ?? 'Có cảnh báo từ hệ thống.')}`
    default:
      return null
  }
}
