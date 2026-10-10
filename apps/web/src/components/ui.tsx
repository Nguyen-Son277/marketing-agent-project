/**
 * Thành phần giao diện dùng chung.
 *
 * Vì sao không dùng thư viện UI: số lượng thành phần cần thiết nhỏ (nút, ô nhập,
 * thẻ, nhãn, thông báo), và mỗi thư viện thêm vào là một phụ thuộc phải cập nhật
 * trong bản tự host. Các thành phần ở đây giữ đúng một trách nhiệm và không tự
 * quản lý trạng thái, nên màn hình nào cũng ghép được.
 */
import type { ChangeEvent, ReactNode } from 'react'

export function Trang({ children, rong = false }: { children: ReactNode; rong?: boolean }): ReactNode {
  return <div className={rong ? 'the the--rong' : 'the'}>{children}</div>
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
}): ReactNode {
  const lop = ['btn', bien === 'phu' ? 'btn--phu' : bien === 'nguy-hiem' ? 'btn--nguy-hiem' : '', nho ? 'btn--nho' : '', rong ? 'btn--rong' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <button className={lop} onClick={onClick} disabled={disabled || dangTai} type={type} title={title}>
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

export function DangTai({ nhan = 'Đang tải…' }: { nhan?: string }): ReactNode {
  return (
    <div className="trong">
      <span className="dang-tai" /> <span style={{ marginLeft: 8 }}>{nhan}</span>
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

/** Định dạng tiền USD; chi phí model luôn nhỏ nên hiển thị 4 chữ số thập phân. */
export function tienUsd(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0 USD'
  if (value < 0.01) return `${(value * 100).toFixed(3)} cent`
  return `${value.toFixed(4)} USD`
}

/** Định dạng số nguyên kiểu Việt Nam. */
export function soNguyen(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('vi-VN') : '—'
}

/** Định dạng thời điểm ISO thành giờ:phút ngày/tháng. */
export function thoiDiem(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
