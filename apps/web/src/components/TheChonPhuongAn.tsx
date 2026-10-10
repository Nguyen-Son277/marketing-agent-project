/**
 * Thẻ chọn phương án cho câu hỏi làm rõ của Leader.
 *
 * Vì sao tách thành component riêng thay vì viết thẳng trong TraoDoi: thẻ có trạng thái
 * cục bộ (lựa chọn từng câu, ô ý kiến riêng) và xuất hiện lặp lại trong dòng tin nhắn.
 * Viết thẳng thì mỗi tin nhắn phải mang theo state của mình ở component cha; tách ra thì
 * React tự quản state theo `key` của tin nhắn.
 *
 * Vì sao câu hỏi và nhãn phương án lấy từ server chứ không tra catalog ở đây: chúng đã
 * được dịch theo ngôn ngữ của cuộc trao đổi ngay lúc Leader hỏi, nên hiển thị lại đúng
 * câu người dùng từng đọc kể cả sau khi họ đổi ngôn ngữ giao diện. Catalog `clarify.*` là
 * bản dự phòng phía server, không phải để tra ở đây.
 */
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import type {
  ClarificationAnswer,
  ClarificationQuestion,
  ClarificationRequest,
} from '@marketing-agent/shared'
import { useI18n } from '../lib/i18n.tsx'
import { Nut } from './ui.tsx'

/** Lựa chọn của người dùng cho một câu hỏi; khoá theo `field` vì đó là khoá server dùng. */
interface LuaChonCau {
  optionIds: string[]
  custom: string
}

type BangLuaChon = Record<string, LuaChonCau>

/** Giá trị rỗng dùng chung; chỉ đọc và luôn được spread ra bản mới nên chia sẻ an toàn. */
const RONG: LuaChonCau = { optionIds: [], custom: '' }

export function TheChonPhuongAn({
  clarify,
  disabled = false,
  daTraLoi,
  onTraLoi,
  onBoQua,
}: {
  clarify: ClarificationRequest
  disabled?: boolean
  daTraLoi?: ClarificationAnswer[]
  onTraLoi: (answers: ClarificationAnswer[]) => void
  onBoQua: () => void
}): ReactNode {
  const { t } = useI18n()
  // `useId` thay vì ghép id từ `field`: hai thẻ hỏi cùng một trường brief có thể cùng tồn
  // tại trong lịch sử, và trùng `name` sẽ khiến hai nhóm radio điều khiển lẫn nhau.
  const idThe = useId()
  const [luaChon, setLuaChon] = useState<BangLuaChon>({})

  const daXong = daTraLoi !== undefined && daTraLoi.length > 0

  const traLoiTheoField = useMemo(() => {
    const map = new Map<string, ClarificationAnswer>()
    for (const traLoi of daTraLoi ?? []) map.set(traLoi.field, traLoi)
    return map
  }, [daTraLoi])

  function chonPhuongAn(cauHoi: ClarificationQuestion, optionId: string): void {
    setLuaChon((truoc) => {
      const hienTai = truoc[cauHoi.field] ?? RONG
      const daChon = hienTai.optionIds.includes(optionId)
      const optionIds =
        cauHoi.inputMode === 'multi'
          ? daChon
            ? hienTai.optionIds.filter((id) => id !== optionId)
            : [...hienTai.optionIds, optionId]
          : [optionId]
      return { ...truoc, [cauHoi.field]: { ...hienTai, optionIds } }
    })
  }

  function doiYkien(field: string, giaTri: string): void {
    setLuaChon((truoc) => ({ ...truoc, [field]: { ...(truoc[field] ?? RONG), custom: giaTri } }))
  }

  // Chỉ cần MỘT câu có lựa chọn hoặc ý kiến riêng là gửi được: bắt trả lời đủ mọi câu sẽ
  // chặn người dùng ở đúng câu họ không có ý kiến, trong khi ô ý kiến luôn có sẵn.
  const coTheGui = useMemo(
    () =>
      clarify.questions.some((cauHoi) => {
        const chon = luaChon[cauHoi.field]
        return chon !== undefined && (chon.optionIds.length > 0 || chon.custom.trim().length > 0)
      }),
    [clarify.questions, luaChon],
  )

  function gui(): void {
    if (!coTheGui || disabled) return
    const answers: ClarificationAnswer[] = []
    for (const cauHoi of clarify.questions) {
      const chon = luaChon[cauHoi.field]
      if (chon === undefined) continue
      const custom = chon.custom.trim()
      // Câu không được trả lời thì bỏ hẳn khỏi payload: gửi mảng rỗng chỉ làm server phải
      // đoán xem người dùng "chọn không gì" hay "không trả lời".
      if (chon.optionIds.length === 0 && custom.length === 0) continue
      answers.push(
        custom.length > 0
          ? { field: cauHoi.field, optionIds: [...chon.optionIds], custom }
          : { field: cauHoi.field, optionIds: [...chon.optionIds] },
      )
    }
    onTraLoi(answers)
  }

  function khiNhanPhim(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Chỉ Ctrl/Cmd+Enter mới gửi: `Enter` thường phải xuống dòng vì đây là chỗ ghi ý dài.
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      gui()
    }
  }

  // Sau khi đã trả lời, thẻ chuyển sang chỉ đọc: hiện lại đúng lựa chọn để lịch sử chat
  // đọc được như một cuộc trao đổi bình thường, và để không gửi trùng câu trả lời.
  if (daXong) {
    return (
      <section className="hoi hoi--xong">
        <div className="hoi__dau">
          <div className="hoi__tieu-de">{t('chat.answersSent')}</div>
        </div>
        {clarify.questions.map((cauHoi) => {
          const traLoi = traLoiTheoField.get(cauHoi.field)
          const nhan = (traLoi?.optionIds ?? [])
            .map((id) => cauHoi.options.find((option) => option.id === id)?.label)
            .filter((value): value is string => value !== undefined)
          return (
            <div key={cauHoi.field} className="hoi__chon-lai">
              <strong>{cauHoi.question}</strong>
              {nhan.length > 0 ? <div>{nhan.join(', ')}</div> : null}
              {traLoi?.custom ? <div>{traLoi.custom}</div> : null}
            </div>
          )
        })}
      </section>
    )
  }

  return (
    <section className="hoi" style={disabled ? { opacity: 0.65 } : undefined}>
      <div className="hoi__dau">
        <div className="hoi__tieu-de">{clarify.intro}</div>
        <div className="hoi__dem">{t('chat.questionCount', { count: clarify.questions.length })}</div>
      </div>

      {clarify.questions.map((cauHoi) => (
        <fieldset className="hoi__cau" key={cauHoi.field} disabled={disabled}>
          {/* `fieldset` + `legend` để trình đọc màn hình đọc được quan hệ câu hỏi–phương án;
              gắn nhãn bằng `aria-label` trên từng input sẽ mất quan hệ nhóm. */}
          <legend className="hoi__cau-tieu-de">{cauHoi.question}</legend>
          {cauHoi.helper ? <div className="hoi__cau-goi-y">{cauHoi.helper}</div> : null}

          {cauHoi.options.map((option) => {
            const daChon = (luaChon[cauHoi.field]?.optionIds ?? []).includes(option.id)
            return (
              <label key={option.id} className={daChon ? 'hoi__pa is-chon' : 'hoi__pa'}>
                <input
                  type={cauHoi.inputMode === 'multi' ? 'checkbox' : 'radio'}
                  name={`${idThe}-${cauHoi.field}`}
                  checked={daChon}
                  onChange={() => chonPhuongAn(cauHoi, option.id)}
                />
                <span className="hoi__pa-than">
                  <span className="hoi__pa-nhan" style={{ display: 'block' }}>
                    {option.label}
                    {option.exclusive ? <span className="hoi__pa-nhan-phu">{t('chat.exclusiveTag')}</span> : null}
                  </span>
                  {option.hint ? (
                    <span className="hoi__pa-goi-y" style={{ display: 'block' }}>
                      {option.hint}
                    </span>
                  ) : null}
                </span>
              </label>
            )
          })}

          {cauHoi.allowCustom ? (
            <div className="hoi__khac">
              <label className="hoi__khac-nhan" htmlFor={`${idThe}-${cauHoi.field}-khac`}>
                {t('clarify.customLabel')}
              </label>
              <textarea
                id={`${idThe}-${cauHoi.field}-khac`}
                value={luaChon[cauHoi.field]?.custom ?? ''}
                placeholder={t('clarify.customPlaceholder')}
                aria-describedby={`${idThe}-${cauHoi.field}-goiy`}
                onChange={(event) => doiYkien(cauHoi.field, event.target.value)}
                onKeyDown={khiNhanPhim}
              />
              <div className="hoi__khac-nhan" id={`${idThe}-${cauHoi.field}-goiy`}>
                {t('clarify.customHint')}
              </div>
            </div>
          ) : null}
        </fieldset>
      ))}

      <div className="hoi__nut">
        <Nut onClick={gui} disabled={!coTheGui || disabled}>
          {t('chat.sendAnswers')}
        </Nut>
        <Nut bien="phu" onClick={onBoQua} disabled={disabled}>
          {t('chat.skipAnswers')}
        </Nut>
        {!coTheGui ? <span className="hoi__xong">{t('chat.answersRequired')}</span> : null}
      </div>
    </section>
  )
}
