/**
 * Định dạng ngày và số theo ngôn ngữ.
 *
 * Vì sao gom vào một chỗ: giao diện từng hard-code `vi-VN` rải rác, nên khi thêm tiếng
 * Anh thì mỗi chỗ là một dịp để quên. Các hàm ở đây là điểm duy nhất biết về `Intl`,
 * nên đổi cách hiển thị chỉ phải sửa một nơi.
 *
 * Dùng `Intl` của nền tảng thay vì thư viện: Node 22 và mọi trình duyệt mục tiêu đều
 * có sẵn dữ liệu ngôn ngữ, nên thêm thư viện chỉ làm bundle phình ra mà không thêm gì.
 */
import { intlTagFor, type Locale } from './locale.ts'

/** Ngày dạng ngắn: `10/10/2026` (vi) hoặc `10/10/2026` (en-US). */
export function formatDate(value: Date | string | number, locale: Locale): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(intlTagFor(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

/** Ngày kèm giờ, dùng cho log hoạt động và danh sách công việc. */
export function formatDateTime(value: Date | string | number, locale: Locale): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat(intlTagFor(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** Số có phân tách hàng nghìn theo ngôn ngữ. */
export function formatNumber(value: number, locale: Locale, options: Intl.NumberFormatOptions = {}): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(intlTagFor(locale), options).format(value)
}

/**
 * Số tiền USD.
 *
 * Vì sao luôn là USD: chi phí model đến từ nhà cung cấp và được lưu bằng USD, nên quy
 * đổi sang tiền bản địa sẽ là một con số sai trừ khi có tỉ giá — và một tỉ giá cứng
 * trong mã nguồn là thông tin sai theo thời gian. Hiển thị đúng đơn vị thật.
 */
export function formatCurrencyUsd(value: number, locale: Locale): string {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat(intlTagFor(locale), {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value)
}

/** Chuyển đầu vào về `Date`, trả `undefined` nếu không hợp lệ thay vì `Invalid Date`. */
function toDate(value: Date | string | number): Date | undefined {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}
