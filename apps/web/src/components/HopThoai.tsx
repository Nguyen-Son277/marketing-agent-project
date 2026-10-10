/**
 * Hộp thoại dùng chung.
 *
 * Vì sao dùng `<dialog>` gốc của trình duyệt thay vì tự vẽ lớp phủ: `showModal()` cho sẵn
 * đúng những thứ mà bản tự viết phải làm lại và rất dễ làm sai — bẫy tiêu điểm bằng `Tab`
 * bên trong hộp thoại, đóng bằng `Esc`, lớp phủ chặn tương tác với phần còn lại của trang,
 * và việc đưa tiêu điểm vào hộp thoại khi mở. Đây là hành vi chuẩn, đã được kiểm thử ở mọi
 * trình duyệt mục tiêu, và cũng được trình đọc màn hình hiểu là hộp thoại.
 *
 * Một chi tiết dễ sai khi bọc `<dialog>` trong React: gọi `showModal()` khi hộp thoại đã
 * mở sẽ NÉM LỖI. Vì vậy luôn kiểm tra `dialog.open` trước khi gọi.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useI18n } from '../lib/i18n.tsx'
import { Nut } from './ui.tsx'

export function HopThoai({
  mo,
  tieuDe,
  onDong,
  children,
  chanDung,
  rong = false,
}: {
  mo: boolean
  tieuDe: string
  /** Gọi khi hộp thoại đóng vì bất kỳ lý do gì: nút, `Esc`, hay bấm ra ngoài. */
  onDong: () => void
  children: ReactNode
  /** Phần đáy dính, thường là các nút hành động. */
  chanDung?: ReactNode
  /** Hộp thoại rộng cho nội dung dạng danh sách dài. */
  rong?: boolean
}): ReactNode {
  const { t } = useI18n()
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    // Kiểm tra `open` trước: gọi `showModal()` trên hộp thoại đã mở là lỗi runtime.
    if (mo && !dialog.open) dialog.showModal()
    else if (!mo && dialog.open) dialog.close()
  }, [mo])

  /**
   * Khoá cuộn trang khi hộp thoại mở.
   *
   * Vì sao cần: `<dialog>` chặn tương tác nhưng KHÔNG chặn cuộn trang nền. Không khoá thì
   * người dùng cuộn chuột trong hộp thoại mà trang phía sau trôi đi, và khi đóng lại thì
   * họ đã ở chỗ khác.
   */
  useEffect(() => {
    if (!mo) return
    const truoc = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = truoc
    }
  }, [mo])

  return (
    <dialog
      ref={ref}
      className={rong ? 'ht ht--rong' : 'ht'}
      aria-labelledby={titleId}
      // Sự kiện `close` bắt được cả trường hợp `Esc` và `form method="dialog"`, nên đây là
      // nơi duy nhất cần báo ra ngoài; không phải tự đoán người dùng đóng bằng cách nào.
      onClose={onDong}
      // Bấm vào chính phần tử `<dialog>` (không phải nội dung con) nghĩa là bấm ra ngoài.
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close()
      }}
    >
      <div className="ht__hop">
        <header className="ht__dau">
          <h2 className="ht__tieu-de" id={titleId}>
            {tieuDe}
          </h2>
          <button
            type="button"
            className="ht__dong"
            onClick={() => ref.current?.close()}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            ×
          </button>
        </header>

        <div className="ht__than">{children}</div>

        {chanDung ? <footer className="ht__chan">{chanDung}</footer> : null}
      </div>
    </dialog>
  )
}

/**
 * Hộp thoại xác nhận cho hành động không hoàn tác được.
 *
 * Vì sao thay `window.confirm`: hộp thoại của trình duyệt khoá cả tab, không style được,
 * không dịch được theo ngôn ngữ giao diện một cách chắc chắn, và chặn mọi thứ khác đang
 * chạy. Bản này giữ đúng vai trò "dừng lại và xác nhận" nhưng nằm trong hệ giao diện.
 */
export function HopThoaiXacNhan({
  mo,
  tieuDe,
  moTa,
  nhanXacNhan,
  nguyHiem = true,
  dangXuLy = false,
  onXacNhan,
  onHuy,
}: {
  mo: boolean
  tieuDe: string
  moTa: string
  nhanXacNhan: string
  nguyHiem?: boolean
  dangXuLy?: boolean
  onXacNhan: () => void
  onHuy: () => void
}): ReactNode {
  const { t } = useI18n()
  return (
    <HopThoai
      mo={mo}
      tieuDe={tieuDe}
      onDong={onHuy}
      chanDung={
        <>
          <Nut bien="phu" nho onClick={onHuy} disabled={dangXuLy}>
            {t('common.cancel')}
          </Nut>
          <Nut bien={nguyHiem ? 'nguy-hiem' : 'chinh'} nho onClick={onXacNhan} dangTai={dangXuLy}>
            {nhanXacNhan}
          </Nut>
        </>
      }
    >
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>{moTa}</p>
    </HopThoai>
  )
}
