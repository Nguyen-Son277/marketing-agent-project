/**
 * Thành phần giao diện dùng chung.
 *
 * Vì sao không dùng thư viện UI: số lượng thành phần cần thiết nhỏ (nút, ô nhập,
 * thẻ, nhãn, thông báo), và mỗi thư viện thêm vào là một phụ thuộc phải cập nhật
 * trong bản tự host. Các thành phần ở đây giữ đúng một trách nhiệm và không tự
 * quản lý trạng thái, nên màn hình nào cũng ghép được.
 */
import type { ChangeEvent, ReactNode, RefObject } from 'react'
import { useI18n } from '../lib/i18n.tsx'

/**
 * Khung bao một màn hình.
 *
 * `caoDay` dùng cho màn cần chiếm trọn chiều cao còn lại của cửa sổ (hiện là màn Trao
 * đổi): thêm lớp `the--cao-day` để vùng nội dung bên trong tự cuộn thay vì cả trang
 * cuộn, nhờ đó khung nhập tin luôn nằm trong tầm nhìn. Các màn còn lại giữ nguyên hành
 * vi cuộn trang như trước.
 */
export function Trang({
  children,
  rong = false,
  caoDay = false,
}: {
  children: ReactNode
  rong?: boolean
  caoDay?: boolean
}): ReactNode {
  const lop = ['the', rong ? 'the--rong' : '', caoDay ? 'the--cao-day' : ''].filter(Boolean).join(' ')
  return <div className={lop}>{children}</div>
}

export function TieuDeTrang({ children, moTa }: { children: ReactNode; moTa?: ReactNode }): ReactNode {
  return (
    <>
      <h1 className="the__tieu-de">{children}</h1>
      {moTa ? <p className="the__mo-ta">{moTa}</p> : null}
    </>
  )
}

export function Card({
  children,
  tieuDe,
  phu,
  hanhDong,
}: {
  children?: ReactNode
  tieuDe?: ReactNode
  phu?: ReactNode
  hanhDong?: ReactNode
}): ReactNode {
  return (
    <section className="card">
      {(tieuDe || hanhDong) && (
        <header className="hang" style={{ justifyContent: 'space-between', marginBottom: phu ? 0 : 12 }}>
          <div>
            {tieuDe ? <h2 className="card__tieu-de">{tieuDe}</h2> : null}
            {phu ? <p className="card__phu">{phu}</p> : null}
          </div>
          {hanhDong}
        </header>
      )}
      {children}
    </section>
  )
}

type NutBien = 'chinh' | 'phu' | 'nguy-hiem'

export function Nut({
  children,
  onClick,
  disabled,
  dangTai,
  bien = 'chinh',
  nho = false,
  rong = false,
  type = 'button',
  title,
  diVa,
  ariaExpanded,
  ariaHasPopup,
  ariaControls,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  dangTai?: boolean
  bien?: NutBien
  nho?: boolean
  rong?: boolean
  type?: 'button' | 'submit'
  title?: string
  /**
   * Ref tới chính phần tử `<button>`.
   *
   * Vì sao cần: nút mở một vùng nổi (bảng, danh sách) phải tự loại trừ chính nó khi xử lý
   * "bấm ra ngoài". Không có ref thì phải bọc nút trong một `div` chỉ để gắn ref, làm cây
   * phần tử rối thêm mà không giải quyết gì.
   */
  diVa?: RefObject<HTMLButtonElement | null>
  ariaExpanded?: boolean
  ariaHasPopup?: boolean
  ariaControls?: string
}): ReactNode {
  const lop = ['btn', bien === 'phu' ? 'btn--phu' : bien === 'nguy-hiem' ? 'btn--nguy-hiem' : '', nho ? 'btn--nho' : '', rong ? 'btn--rong' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <button
      ref={diVa}
      className={lop}
      onClick={onClick}
      disabled={disabled || dangTai}
      type={type}
      title={title}
      // Chỉ gắn thuộc tính aria khi nơi gọi thật sự truyền, để nút thường không mang thuộc
      // tính thừa gây nhiễu trình đọc màn hình.
      {...(ariaExpanded === undefined ? {} : { 'aria-expanded': ariaExpanded })}
      {...(ariaHasPopup ? { 'aria-haspopup': true as const } : {})}
      {...(ariaControls ? { 'aria-controls': ariaControls } : {})}
    >
      {dangTai ? <span className="dang-tai" aria-hidden /> : null}
      {children}
    </button>
  )
}

export function Truong({
  nhan,
  children,
  goiY,
}: {
  nhan: ReactNode
  children: ReactNode
  goiY?: ReactNode
}): ReactNode {
  return (
    <div className="truong">
      <label className="nhan">{nhan}</label>
      {children}
      {goiY ? <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)', marginTop: 4 }}>{goiY}</div> : null}
    </div>
  )
}

export function ONhap({
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled,
  autoFocus,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
  disabled?: boolean
  autoFocus?: boolean
}): ReactNode {
  return (
    <input
      className="o-nhap"
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
    />
  )
}

export function OChon({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  options: readonly { readonly value: string; readonly label: string }[]
  disabled?: boolean
}): ReactNode {
  return (
    <select
      className="o-chon"
      value={value}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLSelectElement>) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function OVanBan({
  value,
  onChange,
  rows,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  rows?: number
  placeholder?: string
  disabled?: boolean
}): ReactNode {
  return (
    <textarea
      className="o-van-ban"
      value={value}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
    />
  )
}

export function Nhan({
  children,
  loai = 'mo',
}: {
  children: ReactNode
  loai?: 'mo' | 'thanh-cong' | 'canh-bao' | 'loi' | 'chinh'
}): ReactNode {
  const lop = loai === 'mo' ? 'badge badge--mo' : loai === 'chinh' ? 'badge' : `badge badge--${loai}`
  return <span className={lop}>{children}</span>
}

export function ThongBao({
  children,
  loai = 'thong-tin',
}: {
  children: ReactNode
  loai?: 'thong-tin' | 'loi' | 'canh-bao' | 'thanh-cong'
}): ReactNode {
  return <div className={`thong-bao thong-bao--${loai}`}>{children}</div>
}

export function DangTai({ nhan }: { nhan?: string }): ReactNode {
  // Nhãn mặc định phải đi qua catalog: đây là thành phần dùng chung, nên hard-code
  // tiếng Việt ở đây sẽ khiến mọi màn hình tiếng Anh quên truyền nhãn đều hiện tiếng Việt.
  const { t } = useI18n()
  return (
    <div className="trong">
      <span className="dang-tai" /> <span style={{ marginLeft: 8 }}>{nhan ?? t('common.loading')}</span>
    </div>
  )
}

export function Trong({ children }: { children: ReactNode }): ReactNode {
  return <div className="trong">{children}</div>
}

export function OSo({
  nhan,
  giaTri,
  moTa,
  loai,
}: {
  nhan: ReactNode
  giaTri: ReactNode
  moTa?: ReactNode
  loai?: 'thanh-cong' | 'canh-bao' | 'loi'
}): ReactNode {
  const mau = loai === 'thanh-cong' ? 'var(--mau-thanh-cong)' : loai === 'canh-bao' ? 'var(--mau-canh-bao)' : loai === 'loi' ? 'var(--mau-loi)' : 'var(--mau-chinh-dam)'
  return (
    <div className="card">
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--mau-chu-mo)' }}>
        {nhan}
      </div>
      <div className="so" style={{ fontSize: 24, fontWeight: 700, color: mau, marginTop: 2 }}>
        {giaTri}
      </div>
      {moTa ? <div style={{ fontSize: 12, color: 'var(--mau-chu-mo)' }}>{moTa}</div> : null}
    </div>
  )
}
