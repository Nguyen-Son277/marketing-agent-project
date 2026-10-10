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
import type { MessageKey, Translate } from '@marketing-agent/i18n'
import type {
  ConversationDetailResponse,
  ConversationPhase,
  ConversationView,
  MessageView,
  TaskView,
} from '@marketing-agent/shared'
import { api, ApiError, openConversationStream, type StreamEvent } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { Markdown } from '../components/Markdown.tsx'
import {
  Card,
  DangTai,
  Nhan,
  Nut,
  OVanBan,
  ThongBao,
  Trang,
} from '../components/ui.tsx'

/**
 * Dấu gạch cho ô trống trong bảng.
 *
 * Viết dạng escape để mã nguồn thuần ASCII ngoài comment tiếng Việt, đúng điều kiện
 * của bài kiểm tra "không còn chuỗi tiếng Việt trong JSX".
 */
const KHONG_CO = '\u2014'

/**
 * Biểu tượng vai trò tác giả trong khung chat.
 *
 * Viết dạng escape vì cùng lý do như `KHONG_CO`: đây là ký tự trang trí, không phải câu
 * chữ cần dịch, nên để nguyên trong mã chỉ làm bài kiểm tra "không còn ký tự ngoài ASCII
 * ngoài comment" báo động giả.
 */
const BIEU_TUONG_NGUOI_DUNG = '\u{1F9D1}'
const BIEU_TUONG_HE_THONG = '\u2699\uFE0F'
const BIEU_TUONG_LEADER = '\u{1F3AF}'

/**
 * Khoá dịch cho từng trường brief.
 *
 * Vì sao dùng bảng ánh xạ tường minh thay vì `t(\`chat.briefField.${field}\`)`: `field`
 * đến từ API dưới dạng `string`, nên template string sẽ nới khoá thành `string` và mất
 * kiểm tra khoá lúc biên dịch — đúng thứ mà hook `t` sinh ra để chặn.
 */
const KHOA_TRUONG_BRIEF: Readonly<Record<string, MessageKey>> = {
  objective: 'chat.briefField.objective',
  kpi: 'chat.briefField.kpi',
  scope: 'chat.briefField.scope',
  deadline: 'chat.briefField.deadline',
  budget: 'chat.briefField.budget',
  constraints: 'chat.briefField.constraints',
}

/** Khoá dịch cho giai đoạn phiên; `phase` từ API là union literal nên bảng phủ đủ 9 giá trị. */
const KHOA_GIAI_DOAN: Readonly<Record<ConversationPhase, MessageKey>> = {
  intake: 'phase.intake',
  clarify: 'phase.clarify',
  brief: 'phase.brief',
  plan: 'phase.plan',
  assign: 'phase.assign',
  execute: 'phase.execute',
  review: 'phase.review',
  report: 'phase.report',
  closed: 'phase.closed',
}

/** Một dòng nhật ký sự kiện hiện giữa các tin nhắn. */
interface DongSuKien {
  readonly id: number
  readonly text: string
  readonly at: number
}

export function TraoDoi({ companyId }: { companyId: string }): ReactNode {
  const { t, formatDateTime, formatCurrencyUsd } = useI18n()
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
        if (!cancelled) setLoi(error instanceof ApiError ? error.message : t('chat.errorLoadList'))
      } finally {
        if (!cancelled) setDangTai(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [companyId, t])

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
        if (!cancelled) setLoi(error instanceof ApiError ? error.message : t('chat.errorLoadConversation'))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [dangChon, t])

  /** Nghe sự kiện của cuộc đang mở; đóng luồng khi đổi cuộc hoặc unmount. */
  useEffect(() => {
    if (!dangChon) return
    const dong = openConversationStream(dangChon, {
      onEvent: (event: StreamEvent) => {
        const text = moTaSuKien(event, t)
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
  }, [dangChon, taiChiTiet, t])

  /** Tự cuộn xuống cuối khi có nội dung mới. */
  useEffect(() => {
    const khung = cuonRef.current
    if (khung) khung.scrollTop = khung.scrollHeight
  }, [chiTiet?.messages.length, suKien.length])

  async function taoCuocMoi(): Promise<void> {
    setLoi(null)
    try {
      const ketQua = await api.createConversation(companyId, t('chat.newConversationTitle'))
      setDanhSach((truoc) => [ketQua.conversation, ...truoc])
      setDangChon(ketQua.conversation.id)
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : t('chat.errorCreateConversation'))
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
          ? t('chat.briefCompleteHint')
          : t('chat.leaderNeedsMore', {
              fields: ketQua.missingFields.map((field) => nhanTruongBrief(field, t)).join(', '),
            }),
      )
      await taiChiTiet(dangChon)
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : t('chat.errorSendMessage'))
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
        setBaoKetQua(t('chat.planCreated', { count: ketQua.tasks.length }))
      } else if (buoc === 'run') {
        await api.runConversation(dangChon)
        setBaoKetQua(t('chat.runFinished'))
      } else {
        const ketQua = await api.reportConversation(dangChon)
        setBaoKetQua(t('chat.reportCreated', { artifactId: ketQua.artifactId }))
      }
      await taiChiTiet(dangChon)
    } catch (error) {
      setLoi(error instanceof ApiError ? error.message : t('chat.errorStep'))
    } finally {
      setDangChay(null)
    }
  }

  if (dangTai) {
    return (
      <Trang>
        <DangTai nhan={t('chat.loadingList')} />
      </Trang>
    )
  }

  return (
    <Trang rong>
      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 16, alignItems: 'start' }}>
        {/* Danh sách cuộc trao đổi */}
        <Card
          tieuDe={t('chat.conversations')}
          hanhDong={
            <Nut nho bien="phu" onClick={() => void taoCuocMoi()} title={t('chat.newConversation')}>
              +
            </Nut>
          }
        >
          {danhSach.length === 0 ? (
            <p style={{ color: 'var(--mau-chu-mo)', fontSize: 14, margin: 0 }}>{t('chat.emptyList')}</p>
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
                    {t('chat.listMeta', {
                      phase: t(KHOA_GIAI_DOAN[cuoc.phase]),
                      date: formatDateTime(cuoc.updatedAt),
                    })}
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
                      {t('chat.metaLine', {
                        phase: t(KHOA_GIAI_DOAN[chiTiet.conversation.phase]),
                        cost: formatCurrencyUsd(chiTiet.costUsd),
                        runs: chiTiet.usage.runs,
                      })}
                    </div>
                  </div>
                  <div className="hang">
                    <Nut
                      nho
                      bien="phu"
                      dangTai={dangChay === 'plan'}
                      onClick={() => void chayBuoc('plan')}
                      title={t('chat.planHint')}
                    >
                      {t('chat.plan')}
                    </Nut>
                    <Nut
                      nho
                      bien="phu"
                      dangTai={dangChay === 'run'}
                      disabled={chiTiet.tasks.length === 0}
                      onClick={() => void chayBuoc('run')}
                      title={chiTiet.tasks.length === 0 ? t('chat.runNeedsPlan') : t('chat.runHint')}
                    >
                      {t('chat.run')}
                    </Nut>
                    <Nut
                      nho
                      dangTai={dangChay === 'report'}
                      disabled={chiTiet.tasks.length === 0}
                      onClick={() => void chayBuoc('report')}
                      title={t('chat.reportHint')}
                    >
                      {t('chat.report')}
                    </Nut>
                  </div>
                </div>

                {chiTiet.conversation.briefComplete ? null : (
                  <div style={{ marginTop: 12 }}>
                    <ThongBao loai="canh-bao">
                      {t('chat.briefMissingPrefix')}{' '}
                      <strong>
                        {chiTiet.conversation.missingFields
                          .map((field) => nhanTruongBrief(field, t))
                          .join(', ') || t('chat.briefMissingUnknown')}
                      </strong>
                      {t('chat.briefMissingSuffix')}
                    </ThongBao>
                  </div>
                )}
              </Card>

              {chiTiet.tasks.length > 0 ? (
                <Card tieuDe={t('chat.planTitle')} phu={t('chat.planSubtitle')}>
                  <table className="bang">
                    <thead>
                      <tr>
                        <th>{t('chat.tableTask')}</th>
                        <th>{t('chat.tableSpecialist')}</th>
                        <th>{t('chat.tableDependsOn')}</th>
                        <th>{t('common.status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chiTiet.tasks.map((task: TaskView) => {
                        const nhan = nhanTrangThai(task.status, t)
                        return (
                          <tr key={task.id}>
                            <td>{task.title}</td>
                            <td>{task.assigneeName ?? task.assigneeRole ?? KHONG_CO}</td>
                            <td>{task.dependsOn.length > 0 ? task.dependsOn.length : KHONG_CO}</td>
                            <td>
                              <Nhan loai={nhan.loai}>{nhan.nhan}</Nhan>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </Card>
              ) : null}

              <div className="card">
                <div className="chat">
                  <div className="chat__khung" ref={cuonRef}>
                    {chiTiet.messages.length === 0 && suKien.length === 0 ? (
                      <div className="trong">{t('chat.emptyChat')}</div>
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
                      placeholder={t('chat.placeholder')}
                    />
                    <Nut dangTai={dangGui} onClick={() => void gui()} disabled={noiDung.trim().length === 0}>
                      {t('chat.send')}
                    </Nut>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <Card>
              <div className="trong">{t('chat.chooseConversation')}</div>
            </Card>
          )}
        </div>
      </div>
    </Trang>
  )
}

/** Một tin nhắn trong khung chat, phân biệt người dùng với Leader. */
function TinNhan({ message }: { message: MessageView }): ReactNode {
  const { t, formatDateTime, formatCurrencyUsd } = useI18n()
  const laNguoiDung = message.authorKind === 'user'
  const laHeThong = message.authorKind === 'system'
  // "Leader" giữ nguyên: đó là tên vai trò trong sản phẩm, không phải câu chữ để dịch.
  const tenTacGia = laNguoiDung
    ? t('chat.authorYou')
    : laHeThong
      ? t('chat.authorSystem')
      : (message.authorAgent ?? 'Leader')

  return (
    <div className={laNguoiDung ? 'tin tin--nguoi-dung' : 'tin'}>
      <div className="tin__avatar" aria-hidden>
        {laNguoiDung ? BIEU_TUONG_NGUOI_DUNG : laHeThong ? BIEU_TUONG_HE_THONG : BIEU_TUONG_LEADER}
      </div>
      <div className="tin__than">
        <div className="tin__dau">
          <span style={{ fontWeight: 600 }}>{tenTacGia}</span>
          <span>{formatDateTime(message.createdAt)}</span>
          {message.costUsd > 0 ? <span>{formatCurrencyUsd(message.costUsd)}</span> : null}
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

type LoaiNhanTrangThai = 'mo' | 'thanh-cong' | 'canh-bao' | 'loi'

/** Khoá dịch của trạng thái; `status` là `string` từ API nên phải tra bảng tường minh. */
const KHOA_TRANG_THAI: Readonly<Record<string, MessageKey>> = {
  draft: 'taskStatus.draft',
  assigned: 'taskStatus.assigned',
  in_progress: 'taskStatus.in_progress',
  blocked: 'taskStatus.blocked',
  review: 'taskStatus.review',
  done: 'taskStatus.done',
  failed: 'taskStatus.failed',
  cancelled: 'taskStatus.cancelled',
}

/** Màu nhãn theo trạng thái; tách khỏi khoá dịch vì màu là quyết định giao diện. */
const LOAI_TRANG_THAI: Readonly<Record<string, LoaiNhanTrangThai>> = {
  done: 'thanh-cong',
  in_progress: 'canh-bao',
  blocked: 'loi',
  failed: 'loi',
  review: 'canh-bao',
  assigned: 'mo',
  cancelled: 'mo',
}

/** Nhãn và màu hiển thị cho trạng thái công việc. */
export function nhanTrangThai(status: string, t: Translate): { nhan: string; loai: LoaiNhanTrangThai } {
  const khoa = KHOA_TRANG_THAI[status]
  // Trạng thái lạ (dữ liệu cũ, giá trị mới chưa cập nhật catalog) hiện nguyên văn: nhìn
  // thấy mã trạng thái còn hơn một nhãn rỗng.
  return { nhan: khoa ? t(khoa) : status, loai: LOAI_TRANG_THAI[status] ?? 'mo' }
}

/**
 * Chuyển một sự kiện SSE thành một dòng người đọc được.
 *
 * Chỉ những sự kiện mang thông tin mới cho người dùng mới được hiện; sự kiện thuần
 * kỹ thuật bị bỏ qua để nhật ký không bị nhiễu. Câu chữ đi qua `t` chứ không dựng chuỗi
 * tại chỗ, để nhật ký đổi ngôn ngữ ngay khi người dùng bấm chuyển.
 */
export function moTaSuKien(event: StreamEvent, t: Translate): string | null {
  const data = (event.data ?? {}) as Record<string, unknown>
  switch (event.type) {
    case 'leader.thinking':
      return t('chat.event.leaderThinking')
    case 'leader.replied':
      return t('chat.event.leaderReplied')
    case 'plan.created': {
      const tasks = Array.isArray(data['tasks']) ? data['tasks'].length : 0
      return t('chat.event.planCreated', { count: tasks })
    }
    case 'agent.started':
      return t('chat.event.agentStarted', {
        role: String(data['assigneeRole'] ?? 'Agent'),
        title: String(data['title'] ?? ''),
      })
    case 'tool.called': {
      const thamSo = { role: String(data['agentRole'] ?? ''), tool: String(data['tool'] ?? '') }
      return data['ok'] === false ? t('chat.event.toolCalledFailed', thamSo) : t('chat.event.toolCalled', thamSo)
    }
    case 'task.updated': {
      const title = String(data['title'] ?? '')
      // Trạng thái trong payload là mã máy; dịch qua cùng bảng với bảng kế hoạch để nhật
      // ký và nhãn không bao giờ lệch nhau.
      const status = nhanTrangThai(String(data['status'] ?? ''), t).nhan
      return data['reason']
        ? t('chat.event.taskUpdatedReason', { title, status, reason: String(data['reason']) })
        : t('chat.event.taskUpdated', { title, status })
    }
    case 'artifact.created':
      return t('chat.event.artifactCreated')
    case 'agent.message':
      return t('chat.event.agentMessage', {
        from: String(data['from'] ?? ''),
        to: String(data['to'] ?? ''),
        kind: String(data['kind'] ?? ''),
      })
    case 'review.completed':
      return data['verdict'] === 'pass' ? t('chat.event.reviewPassed') : t('chat.event.reviewNeedsFix')
    case 'report.created':
      return t('chat.event.reportCreated')
    case 'brief.updated':
      return data['complete'] === true ? t('chat.event.briefComplete') : t('chat.event.briefIncomplete')
    case 'warning':
      return t('chat.event.warning', {
        message: String(data['message'] ?? t('chat.event.systemWarning')),
      })
    default:
      return null
  }
}

/** Nhãn một trường brief còn thiếu; trường lạ hiện nguyên mã để không che mất dữ liệu. */
function nhanTruongBrief(field: string, t: Translate): string {
  const khoa = KHOA_TRUONG_BRIEF[field]
  return khoa ? t(khoa) : field
}
