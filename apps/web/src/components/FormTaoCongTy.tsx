/**
 * Form tạo công ty, dùng chung cho màn "Chọn công ty" (lần đầu) và màn "Công ty của tôi".
 *
 * Vì sao tách thành component riêng: hai màn cần đúng cùng một hành vi — kiểm tra tên
 * không rỗng, gọi `createCompany`, hiện lỗi, khoá nút khi đang gửi. Chép lại ở hai nơi
 * thì mọi sửa đổi về sau (ví dụ thêm gợi ý tên) sẽ chỉ được áp cho một màn.
 */
import { useState, type ReactNode } from 'react'
import { useSession } from '../lib/session.tsx'
import { useI18n } from '../lib/i18n.tsx'
import { Nut, ONhap, Truong } from './ui.tsx'

export function FormTaoCongTy({
  tieuDe,
  phu,
  nhanNut,
  autoFocus = false,
  onLoi,
  onThanhCong,
}: {
  tieuDe?: string
  phu?: string
  nhanNut?: string
  autoFocus?: boolean
  onLoi?: (message: string) => void
  onThanhCong?: () => void
}): ReactNode {
  const { createCompany } = useSession()
  const { t, translateError } = useI18n()
  const [ten, setTen] = useState('')
  const [loi, setLoi] = useState<string | null>(null)
  const [dangTao, setDangTao] = useState(false)

  async function tao(): Promise<void> {
    if (ten.trim().length === 0) {
      setLoi(t('companies.needName'))
      onLoi?.(t('companies.needName'))
      return
    }
    setLoi(null)
    setDangTao(true)
    try {
      await createCompany(ten.trim())
      setTen('')
      onThanhCong?.()
    } catch (error) {
      const message = translateError(error)
      setLoi(message)
      onLoi?.(message)
    } finally {
      setDangTao(false)
    }
  }

  return (
    <div className="cot" style={{ gap: 10 }}>
      {tieuDe ? <div style={{ fontWeight: 650 }}>{tieuDe}</div> : null}
      {phu ? <p className="the__mo-ta" style={{ margin: 0 }}>{phu}</p> : null}
      <Truong nhan={t('companies.name')}>
        <ONhap
          value={ten}
          onChange={setTen}
          placeholder={t('companies.namePlaceholder')}
          autoFocus={autoFocus}
        />
      </Truong>
      {loi ? (
        <div role="alert" style={{ color: 'var(--mau-loi)', fontSize: 13 }}>
          {loi}
        </div>
      ) : null}
      <div>
        <Nut onClick={() => void tao()} dangTai={dangTao} rong disabled={ten.trim().length === 0}>
          {dangTao ? t('companies.creating') : (nhanNut ?? t('companies.create'))}
        </Nut>
      </div>
    </div>
  )
}
