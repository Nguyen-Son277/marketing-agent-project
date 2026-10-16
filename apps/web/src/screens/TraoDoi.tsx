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
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { MessageKey, Translate } from '@marketing-agent/i18n'
import type {
  ClarificationAnswer,
  ClarificationRequest,
  ConversationDetailResponse,
  ConversationPhase,
  ConversationView,
  MessageView,
  TaskView,
} from '@marketing-agent/shared'
import { api, ApiError, openConversationStream, type StreamEvent } from '../lib/api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { ChatComposer } from '../components/ChatComposer.tsx'
import { acquireChatSend } from '../lib/chat-composer.ts'
import { Markdown } from '../components/Markdown.tsx'
import { HopThoai } from '../components/HopThoai.tsx'
import { TheChonPhuongAn } from '../components/TheChonPhuongAn.tsx'
import {
  Card,
  DangTai,
  Nhan,
  Nut,
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
 * Khoảng cách tới đáy còn được coi là "đang ở dưới cùng".
 *
 * Vì sao cần ngưỡng: nếu hễ có tin mới là cuộn xuống đáy thì người dùng vừa cuộn lên đọc
 * tin cũ sẽ bị giật xuống giữa lúc agent đang chạy — đúng lúc họ cần đọc nhất.
 */
const NGUONG_GAN_DAY = 80

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

/** Trạng thái hiển thị của một thẻ chọn phương án trong dòng tin nhắn. */
interface TrangThaiThe {
  /** Câu trả lời đã gửi, nếu thẻ đã được trả lời. */
  readonly daTraLoi?: ClarificationAnswer[]
  /** Thẻ đã cũ (người dùng đã trả lời ở chỗ khác) nên không cho gửi nữa. */
  readonly disabled: boolean
}

export function TraoDoi({ companyId }: { companyId: string }): ReactNode {
  const { t, formatDateTime, formatCurrencyUsd } = useI18n()
  const [danhSach, setDanhSach] = useState<ConversationView[]>([])
  const [dangChon, setDangChon] = useState<string | null>(null)
  /**
   * Danh sách cuộc trao đổi mở ra theo yêu cầu, không chiếm chỗ thường trực.
   *
   * Trước đây nó là cột trái cố định 250px luôn hiện, làm khung chat hẹp đi suốt trong khi
   * phần lớn thời gian người dùng chỉ đọc một cuộc.
   */
  const [moDanhSach, setMoDanhSach] = useState(false)
  const [keHoachDangMo, setKeHoachDangMo] = useState<{ companyId: string; conversationId: string } | null>(null)
  const [chiTiet, setChiTiet] = useState<ConversationDetailResponse | null>(null)
  const [suKien, setSuKien] = useState<DongSuKien[]>([])
  const [noiDung, setNoiDung] = useState('')
  const [cheDoGiaoViec,setCheDoGiaoViec]=useState<'campaign'|'workforce'>('campaign')
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTai, setDangTai] = useState(true)
  const [dangGui, setDangGui] = useState(false)
  const [dangChay, setDangChay] = useState<'plan' | 'run' | 'report' | null>(null)
  const [baoKetQua, setBaoKetQua] = useState<string | null>(null)
  const [coTinMoi, setCoTinMoi] = useState(false)
  /**
   * Thẻ vừa được trả lời trong phiên này, theo id tin nhắn.
   *
   * Vì sao cần ngoài `meta.answers`: sau khi gửi, giao diện tải lại chi tiết, nhưng bản
   * tải lại chỉ có dấu vết câu trả lời nếu server kịp ghi vào `meta`. Giữ thêm ở đây để
   * thẻ chuyển ngay sang chỉ đọc và không cho gửi trùng trong lúc chờ server.
   */
  const [traLoiCucBo, setTraLoiCucBo] = useState<ReadonlyMap<string, ClarificationAnswer[]>>(new Map())

  const composerRef = useRef<HTMLTextAreaElement>(null)
  const sendLock = useRef(false)
  const chatScope = useRef({ companyId, conversationId: dangChon })
  chatScope.current = { companyId, conversationId: dangChon }
  const cuonRef = useRef<HTMLDivElement>(null)
  const demSuKien = useRef(0)
  const oGanDayRef = useRef(true)
  /** Vùng bảng danh sách và nút mở nó, để biết cú bấm nào là "bấm ra ngoài". */
  const bangRef = useRef<HTMLDivElement>(null)
  const nutDanhSachRef = useRef<HTMLButtonElement>(null)

  /**
   * Đóng bảng danh sách bằng `Esc` và bằng bấm ra ngoài.
   *
   * Vì sao nghe `pointerdown` chứ không phải `click`: nút mở cũng nằm ngoài bảng, nên với
   * `click` thì chính cú bấm mở bảng sẽ bị hiểu là "bấm ra ngoài" và đóng lại ngay. Nghe ở
   * pha nhấn xuống và bỏ qua cú bấm trên nút mở khử được vòng luẩn quẩn đó.
   *
   * Chỉ gắn listener khi bảng đang mở, và gỡ khi đóng hoặc khi component unmount.
   */
  useEffect(() => {
    if (!moDanhSach) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMoDanhSach(false)
    }
    const onPointerDown = (event: PointerEvent): void => {
      const mucTieu = event.target as Node | null
      if (!mucTieu) return
      if (bangRef.current?.contains(mucTieu)) return
      if (nutDanhSachRef.current?.contains(mucTieu)) return
      setMoDanhSach(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [moDanhSach])

  /** Tải danh sách cuộc trao đổi; chọn cuộc mới nhất nếu chưa chọn gì. */
  useEffect(() => {
    let cancelled = false
    setDangTai(true)
    setDangChon(null)
    setChiTiet(null)
    setKeHoachDangMo(null)
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

  /** Đổi cuộc thì bỏ dấu vết câu trả lời của cuộc trước để không hiện nhầm trạng thái. */
  useEffect(() => {
    setTraLoiCucBo(new Map())
    setKeHoachDangMo(null)
  }, [companyId, dangChon])

  useEffect(() => {
    if (!chiTiet || chiTiet.conversation.id !== dangChon || chiTiet.tasks.length === 0) {
      setKeHoachDangMo(null)
    }
  }, [chiTiet, dangChon])

  /** Tải chi tiết cuộc đang chọn. */
  const taiChiTiet = useCallback(async (conversationId: string) => {
    const company = chatScope.current.companyId
    const ketQua = await api.conversation(conversationId)
    if (chatScope.current.companyId !== company || chatScope.current.conversationId !== conversationId) return
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

  const idDangMo = chiTiet?.conversation.id ?? null

  /**
   * Cuộn xuống đáy ngay khi mở một cuộc khác.
   *
   * Vì sao `useLayoutEffect` chứ không `useEffect`: cuộn phải xong TRƯỚC khi trình duyệt
   * vẽ khung hình đầu, nếu không người dùng thấy tin nhắn nhảy từ trên xuống. Chỉ phụ
   * thuộc id cuộc đang mở để bản tải lại giữa lượt chạy (cùng cuộc) không kéo khung nhìn
   * xuống khi người dùng đang đọc tin cũ.
   */
  useLayoutEffect(() => {
    const khung = cuonRef.current
    if (!khung) return
    khung.scrollTop = khung.scrollHeight
    oGanDayRef.current = true
    setCoTinMoi(false)
  }, [idDangMo])

  /** Có nội dung mới: chỉ tự cuộn khi người dùng đang ở gần đáy, nếu không thì báo có tin. */
  useEffect(() => {
    const khung = cuonRef.current
    if (!khung) return
    if (oGanDayRef.current) {
      khung.scrollTop = khung.scrollHeight
    } else {
      setCoTinMoi(true)
    }
  }, [chiTiet?.messages.length, suKien.length])

  /** Ghi nhớ người dùng đang ở đâu để quyết định có tự cuộn hay không. */
  function khiCuon(): void {
    const khung = cuonRef.current
    if (!khung) return
    const cachDay = khung.scrollHeight - khung.scrollTop - khung.clientHeight
    const ganDay = cachDay <= NGUONG_GAN_DAY
    oGanDayRef.current = ganDay
    if (ganDay) setCoTinMoi(false)
  }

  function xuongDay(hanhVi: ScrollBehavior = 'smooth'): void {
    const khung = cuonRef.current
    if (!khung) return
    khung.scrollTo({ top: khung.scrollHeight, behavior: hanhVi })
    oGanDayRef.current = true
    setCoTinMoi(false)
  }

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

  /** Gửi một lượt tin; trả về `true` khi server nhận. `answers` chỉ có khi gửi từ thẻ chọn. */
  async function guiNoiDung(content: string, answers?: ClarificationAnswer[]): Promise<boolean> {
    if (!dangChon || content.trim().length === 0 || !acquireChatSend(sendLock)) return false
    const scope = chatScope.current
    const currentScope = () => chatScope.current.companyId === scope.companyId && chatScope.current.conversationId === scope.conversationId
    setLoi(null)
    setBaoKetQua(null)
    setDangGui(true)
    let accepted = false
    try {
      const ketQua = await api.sendMessage(dangChon, answers ? { content, answers, mode:cheDoGiaoViec } : { content, mode:cheDoGiaoViec })
      accepted = true
      if (!currentScope()) return false
      setBaoKetQua(
        ketQua.briefComplete
          ? t('chat.briefCompleteHint')
          : t('chat.leaderNeedsMore', {
              fields: ketQua.missingFields.map((field) => nhanTruongBrief(field, t)).join(', '),
            }),
      )
      await taiChiTiet(dangChon)
      return currentScope()
    } catch (error) {
      if (currentScope()) setLoi(error instanceof ApiError ? error.message : t('chat.errorSendMessage'))
      return accepted && currentScope()
    } finally {
      sendLock.current = false
      setDangGui(false)
      requestAnimationFrame(() => { if (currentScope()) composerRef.current?.focus() })
    }
  }

  async function gui(): Promise<void> {
    const original = noiDung
    if (!original.trim() || sendLock.current) return
    const scope = chatScope.current
    // Keep the original multiline draft verbatim for recovery, including whitespace.
    setNoiDung('')
    const thanhCong = await guiNoiDung(original)
    if (!thanhCong && chatScope.current.companyId === scope.companyId && chatScope.current.conversationId === scope.conversationId) setNoiDung(original)
  }

  /** Gửi câu trả lời của thẻ chọn: kèm bản chữ để đọc lại, và `answers` để server điền brief. */
  async function guiCauTraLoi(
    messageId: string,
    clarify: ClarificationRequest,
    answers: ClarificationAnswer[],
  ): Promise<void> {
    const content = dungNoiDungTraLoi(clarify, answers, t)
    if (content.trim().length === 0) return
    const thanhCong = await guiNoiDung(content, answers)
    if (thanhCong) {
      setTraLoiCucBo((truoc) => {
        const sau = new Map(truoc)
        sau.set(messageId, answers)
        return sau
      })
    }
  }

  /** Bỏ qua thẻ chọn: gửi nội dung đã gõ ở ô nhập, hoặc một câu báo sẽ trả lời tự do. */
  async function boQuaThe(): Promise<void> {
    if (sendLock.current) return
    const original = noiDung
    const scope = chatScope.current
    const hasDraft = original.trim().length > 0
    if (hasDraft) setNoiDung('')
    const thanhCong = await guiNoiDung(hasDraft ? original : t('chat.skipAnswersMessage'))
    if (!thanhCong && hasDraft && chatScope.current.companyId === scope.companyId && chatScope.current.conversationId === scope.conversationId) setNoiDung(original)
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

  /**
   * Với mỗi thẻ chọn: đã được trả lời chưa, và còn dùng được không.
   *
   * Duyệt lịch sử theo thứ tự vì thẻ thuộc về tin nhắn HỎI, còn câu trả lời nằm ở tin nhắn
   * người dùng kế tiếp. Thẻ bị bỏ qua bằng chữ tự do cũng tính là đã dùng: cho gửi lại nữa
   * sẽ tạo hai câu trả lời cho cùng một câu hỏi.
   */
  const theTraLoi = useMemo(() => {
    const ketQua = new Map<string, TrangThaiThe>()
    let dangCho: string[] = []
    for (const message of chiTiet?.messages ?? []) {
      if (message.clarify) {
        dangCho.push(message.id)
        ketQua.set(message.id, { disabled: false })
        continue
      }
      if (message.authorKind !== 'user') continue
      const traLoi = docCauTraLoi(message.meta)
      const cuoi = dangCho.pop()
      if (cuoi !== undefined) {
        ketQua.set(cuoi, traLoi ? { daTraLoi: traLoi, disabled: true } : { disabled: true })
      }
      // Thẻ nào còn treo phía trước cũng đã cũ: người dùng đã trả lời ở chỗ khác.
      for (const id of dangCho) ketQua.set(id, { disabled: true })
      dangCho = []
    }
    for (const [id, traLoi] of traLoiCucBo) ketQua.set(id, { daTraLoi: [...traLoi], disabled: true })
    return ketQua
  }, [chiTiet, traLoiCucBo])

  if (dangTai) {
    return (
      <Trang>
        <DangTai nhan={t('chat.loadingList')} />
      </Trang>
    )
  }

  return (
    <Trang rong caoDay>
      {/*
        Bố cục cao-đầy-đủ: `.the--cao-day` là flex column và CHỈ thẻ chat được là `.card`
        con trực tiếp để nhận `flex: 1`. Phần đầu được bọc thêm một `div` để nó không khớp
        `.the--cao-day > .card` — nếu khớp, nó cũng giãn hết chiều cao và đẩy khung nhập ra
        ngoài màn hình, đúng lỗi đang sửa.
      */}
      <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loi ? <ThongBao loai="loi">{loi}</ThongBao> : null}
        {baoKetQua ? <ThongBao loai="thong-tin">{baoKetQua}</ThongBao> : null}

        {chiTiet ? (
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
                  disabled={cheDoGiaoViec === 'workforce'}
                  onClick={() => void chayBuoc('plan')}
                  title={t('chat.planHint')}
                >
                  {t('chat.plan')}
                </Nut>
                <Nut
                  nho
                  bien="phu"
                  dangTai={dangChay === 'run'}
                  disabled={chiTiet.tasks.length === 0 || cheDoGiaoViec === 'workforce'}
                  onClick={() => void chayBuoc('run')}
                  title={chiTiet.tasks.length === 0 ? t('chat.runNeedsPlan') : t('chat.runHint')}
                >
                  {t('chat.run')}
                </Nut>
                <Nut
                  nho
                  dangTai={dangChay === 'report'}
                  disabled={chiTiet.tasks.length === 0 || cheDoGiaoViec === 'workforce'}
                  onClick={() => void chayBuoc('report')}
                  title={t('chat.reportHint')}
                >
                  {t('chat.report')}
                </Nut>
              </div>
            </div>

            {chiTiet.conversation.briefComplete || cheDoGiaoViec === 'workforce' ? null : (
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
        ) : null}
      </div>

      {chiTiet && chiTiet.conversation.id === dangChon && chiTiet.tasks.length > 0 ? (
        <HopThoai
          mo={keHoachDangMo?.companyId === companyId && keHoachDangMo.conversationId === dangChon}
          tieuDe={t('chat.planTitle')}
          onDong={() => setKeHoachDangMo(null)}
          rong
        >
          <p className="card__phu">{t('chat.planSubtitle')}</p>
          <div className="chat__ke-hoach">
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
          </div>
        </HopThoai>
      ) : null}

      {/*
        Thẻ chat là `.card` con trực tiếp DUY NHẤT của `.the--cao-day`, nhờ đó nhận
        `flex: 1` rồi truyền chiều cao xuống `.chat` → `.chat__khung` (vùng cuộn duy nhất)
        → `.chat__nhap` luôn nằm trong tầm nhìn.
      */}
      <div className="card">
        {/*
          Thanh công cụ nằm TRONG luồng flex (không nổi) nên chiều cao khung tin nhắn tự giảm
          đúng mức, và bất biến "chỉ một vùng cuộn" vẫn giữ.
        */}
        <div className="chat__thanh">
          <Nut
            nho
            bien="phu"
            className="chat__nut-menu"
            diVa={nutDanhSachRef}
            ariaLabel={t('chat.listConversations')}
            ariaExpanded={moDanhSach}
            ariaHasPopup
            ariaControls="ds-phien"
            onClick={() => setMoDanhSach((truoc) => !truoc)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </Nut>
          <select className="o-chon" style={{width:'auto',maxWidth:'100%'}} aria-label={t('wf.chatMode')} value={cheDoGiaoViec} disabled={dangGui} onChange={e=>setCheDoGiaoViec(e.target.value as 'campaign'|'workforce')}>
            <option value="campaign">{t('wf.campaign')}</option><option value="workforce">{t('wf.designerChat')}</option>
          </select>
          {chiTiet && chiTiet.conversation.id === dangChon && chiTiet.tasks.length > 0 ? (
            <Nut
              nho
              bien="phu"
              onClick={() => setKeHoachDangMo({ companyId, conversationId: chiTiet.conversation.id })}
              title={t('chat.viewPlanHint')}
            >
              {t('chat.viewPlan', { count: chiTiet.tasks.length })}
            </Nut>
          ) : null}
          <Nut nho onClick={() => void taoCuocMoi()}>
            {t('chat.newConversation')}
          </Nut>
        </div>

        <div className="chat__than">
          {/*
            Bảng danh sách là lớp phủ neo vào vùng chat, chỉ render khi đang mở. Đặt trong
            `.chat__than` (đã `position: relative`) nên nó không tràn ra ngoài khung chat.
          */}
          {moDanhSach ? (
            <div className="ds-phien" id="ds-phien" ref={bangRef} role="group" aria-label={t('chat.listConversations')}>
              <div className="ds-phien__dau">
                <div style={{ fontWeight: 650 }}>{t('chat.conversations')}</div>
                <Nut nho bien="phu" onClick={() => setMoDanhSach(false)} title={t('chat.closeList')}>
                  {t('common.close')}
                </Nut>
              </div>
              <div className="ds-phien__danh-sach">
                {danhSach.length === 0 ? (
                  <p style={{ color: 'var(--mau-chu-mo)', fontSize: 14, margin: 0 }}>{t('chat.emptyList')}</p>
                ) : (
                  danhSach.map((cuoc) => (
                    <button
                      key={cuoc.id}
                      type="button"
                      className={cuoc.id === dangChon ? 'app__nav-item app__nav-item--active' : 'app__nav-item'}
                      // Chọn xong thì đóng bảng: mục đích đã đạt, để mở tiếp chỉ che khung chat.
                      onClick={() => {
                        setDangChon(cuoc.id)
                        setMoDanhSach(false)
                      }}
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
                  ))
                )}
              </div>
            </div>
          ) : null}

        {chiTiet ? (
          <div className="chat" style={{ minWidth: 0 }}>
            <div className="chat__khung" ref={cuonRef} onScroll={khiCuon}>
              {chiTiet.messages.length === 0 && suKien.length === 0 ? (
                <div className="trong">{t('chat.emptyChat')}</div>
              ) : null}

              {chiTiet.messages.map((message: MessageView) => {
                const clarify = message.clarify
                const trangThai = theTraLoi.get(message.id)
                return (
                  <Fragment key={message.id}>
                    <TinNhan message={message} />
                    {clarify ? (
                      <TheChonPhuongAn
                        clarify={clarify}
                        disabled={(trangThai?.disabled ?? false) || dangGui}
                        daTraLoi={trangThai?.daTraLoi}
                        onTraLoi={(answers) => void guiCauTraLoi(message.id, clarify, answers)}
                        onBoQua={() => void boQuaThe()}
                      />
                    ) : null}
                  </Fragment>
                )
              })}

              {suKien.map((dong) => (
                <div key={dong.id} className="su-kien">
                  {dong.text}
                </div>
              ))}

              {/*
                Nút nằm trong chính vùng cuộn và dùng `position: sticky; bottom` để luôn
                nổi ở đáy tầm nhìn khi người dùng đã cuộn lên — không cần thêm CSS, và chỉ
                hiện khi thật sự có tin mới.
              */}
              {coTinMoi ? (
                <button
                  type="button"
                  className="btn btn--phu btn--nho"
                  style={{ position: 'sticky', bottom: 8, alignSelf: 'center' }}
                  onClick={() => xuongDay()}
                >
                  {t('chat.scrollToLatest')}
                </button>
              ) : null}
            </div>

            <ChatComposer value={noiDung} onChange={setNoiDung} busy={dangGui} onSend={() => void gui()} inputRef={composerRef} />
          </div>
        ) : (
          <div className="trong" style={{ flex: 1 }}>
            {t('chat.chooseConversation')}
          </div>
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
        {message.workforceDraftIds?.map(id=><div key={id} className="card" style={{marginTop:10}}><p>{t('wf.draftNotice')}</p><a href={`#/giao-viec?taskId=${encodeURIComponent(id)}`}>{t('wf.openDraft')}</a></div>)}
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
    case 'tool.finished': {
      const thamSo = { role: String(data['agentRole'] ?? ''), tool: String(data['toolName'] ?? '') }
      return data['outcome'] === 'succeeded' ? t('chat.event.toolCalled', thamSo) : t('chat.event.toolCalledFailed', thamSo)
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

/**
 * Đọc câu trả lời có cấu trúc từ `meta` của tin nhắn người dùng.
 *
 * Vì sao phải kiểm tra hình dạng: `meta` là `unknown` và còn được dùng cho việc khác, nên
 * đọc thẳng `meta.answers` rồi tin đó là mảng đúng kiểu sẽ vỡ im lặng mỗi khi hình dạng đổi.
 */
function docCauTraLoi(meta: unknown): ClarificationAnswer[] | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const answers = (meta as { answers?: unknown }).answers
  if (!Array.isArray(answers) || answers.length === 0) return undefined
  const ketQua: ClarificationAnswer[] = []
  for (const item of answers) {
    if (typeof item !== 'object' || item === null) continue
    const ban = item as { field?: unknown; optionIds?: unknown; custom?: unknown }
    if (typeof ban.field !== 'string' || ban.field.length === 0) continue
    const optionIds = Array.isArray(ban.optionIds)
      ? ban.optionIds.filter((id): id is string => typeof id === 'string')
      : []
    const custom = typeof ban.custom === 'string' && ban.custom.length > 0 ? ban.custom : undefined
    ketQua.push(custom === undefined ? { field: ban.field, optionIds } : { field: ban.field, optionIds, custom })
  }
  return ketQua.length > 0 ? ketQua : undefined
}

/**
 * Dựng bản chữ người đọc được cho lượt gửi câu trả lời.
 *
 * Vì sao vẫn cần bản chữ khi đã có `answers`: `answers` là dữ liệu để server điền brief tất
 * định, còn lịch sử chat là thứ người dùng đọc lại. Nhãn câu hỏi và phương án lấy từ chính
 * thẻ (đã ở ngôn ngữ của cuộc trao đổi lúc hỏi), không hard-code ở đây.
 */
function dungNoiDungTraLoi(
  clarify: ClarificationRequest,
  answers: readonly ClarificationAnswer[],
  t: Translate,
): string {
  // Chú thích kiểu tuple tường minh: nếu để TypeScript suy từ mảng literal, `new Map` sẽ
  // nhận `(string | ClarificationQuestion)[][]` và báo lỗi kiểu.
  const cauHoiTheoField = new Map<string, ClarificationRequest['questions'][number]>(
    clarify.questions.map((cauHoi): [string, ClarificationRequest['questions'][number]] => [cauHoi.field, cauHoi]),
  )
  return answers
    .map((traLoi) => {
      const cauHoi = cauHoiTheoField.get(traLoi.field)
      const nhan = traLoi.optionIds
        .map((id) => cauHoi?.options.find((option) => option.id === id)?.label)
        .filter((value): value is string => value !== undefined)
      const dong = [cauHoi?.question ?? traLoi.field, nhan.join(', ')]
        .filter((phan) => phan.length > 0)
        .join(': ')
      return traLoi.custom ? `${dong}\n${t('clarify.customLabel')}: ${traLoi.custom}` : dong
    })
    .join('\n')
}
