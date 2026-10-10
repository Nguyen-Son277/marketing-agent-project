/**
 * Ngôn ngữ hệ thống hỗ trợ.
 *
 * Vì sao chỉ hai ngôn ngữ và khai báo ở một chỗ: mọi quyết định về ngôn ngữ (chọn
 * mặc định, thứ tự ưu tiên khi trình duyệt gửi nhiều thứ tiếng, nhãn hiển thị trên
 * nút chuyển) đều đọc từ danh sách này. Thêm ngôn ngữ thứ ba chỉ cần thêm một mục
 * ở đây cộng một catalog — không phải sửa logic rải rác.
 */

export const LOCALES = ['vi', 'en'] as const

export type Locale = (typeof LOCALES)[number]

/** Ngôn ngữ dùng khi không xác định được lựa chọn nào. */
export const DEFAULT_LOCALE: Locale = 'vi'

/** Ngôn ngữ dùng khi một khoá chưa có bản dịch ở ngôn ngữ đang chọn. */
export const FALLBACK_LOCALE: Locale = 'vi'

export interface LocaleCapability {
  /** Mã ISO 639-1: giá trị lưu trong CSDL và gửi giữa client–server. */
  readonly code: Locale
  /** Nhãn hiển thị trên nút chuyển ngôn ngữ. */
  readonly label: string
  /** Tên đầy đủ, dùng cho thuộc tính aria-label và trang cài đặt. */
  readonly name: string
  /** Thẻ dùng cho `<html lang>`; cũng là cơ sở cho định dạng ngày/số. */
  readonly htmlLang: string
  /** Mã dùng với `Intl.NumberFormat` / `Intl.DateTimeFormat`. */
  readonly intlTag: string
}

export const LOCALE_CAPABILITIES: Readonly<Record<Locale, LocaleCapability>> = {
  vi: { code: 'vi', label: 'VI', name: 'Tiếng Việt', htmlLang: 'vi', intlTag: 'vi-VN' },
  en: { code: 'en', label: 'EN', name: 'English', htmlLang: 'en', intlTag: 'en-US' },
}

/** Danh sách để giao diện duyệt khi vẽ nút chuyển ngôn ngữ, theo thứ tự hiển thị. */
export const LOCALE_LIST: readonly LocaleCapability[] = LOCALES.map((code) => LOCALE_CAPABILITIES[code])

/** Kiểm tra một chuỗi bất kỳ có phải ngôn ngữ được hỗ trợ. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * Chuẩn hoá một thẻ ngôn ngữ về ngôn ngữ được hỗ trợ gần nhất.
 *
 * Chấp nhận thẻ đầy đủ và thẻ rút gọn vì trình duyệt gửi nhiều dạng: `vi`, `vi-VN`,
 * `en-US`, `en-GB`. So khớp cả thẻ đầy đủ (không phân biệt hoa thường) rồi mới tới
 * phần ngôn ngữ chính — đây là hành vi mà tiêu chuẩn HTTP gọi là language range.
 */
export function normalizeLocaleTag(tag: string): Locale | undefined {
  const trimmed = tag.trim().toLowerCase()
  if (trimmed.length === 0) return undefined

  for (const code of LOCALES) {
    if (trimmed === code) return code
    if (trimmed === LOCALE_CAPABILITIES[code].intlTag.toLowerCase()) return code
  }
  // Thẻ rút gọn: `vi-VN` → `vi`, và cả `vi_HN` (một số hệ thống dùng gạch dưới).
  const primary = trimmed.split(/[-_]/)[0] ?? ''
  return isLocale(primary) ? primary : undefined
}

/** Thẻ `Intl` của một ngôn ngữ, để định dạng ngày và số. */
export function intlTagFor(locale: Locale): string {
  return LOCALE_CAPABILITIES[locale].intlTag
}
