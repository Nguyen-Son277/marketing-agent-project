/**
 * Ngôn ngữ hiện tại của giao diện, ở dạng đọc được từ ngoài React.
 *
 * Vì sao cần module riêng thay vì chỉ dùng hook: `lib/api.ts` phải gắn header
 * `Accept-Language` vào MỌI yêu cầu, nhưng nó không phải component nên không gọi được
 * hook. Nếu để `api.ts` import `i18n.tsx` thì hai module sẽ phụ thuộc vòng qua nhau.
 * Một biến ở module trung lập là cách nhỏ nhất và không có vòng lặp.
 *
 * Chỉ có một nguồn sự thật cho lựa chọn ngôn ngữ: khoá `ma.locale` trong
 * `localStorage`. Hàm ở đây đọc/ghi đúng khoá đó, nên `i18n.tsx` và `api.ts` không
 * bao giờ lệch nhau.
 */
import { DEFAULT_LOCALE, isLocale, normalizeLocaleTag, type Locale } from '@marketing-agent/i18n'

const STORAGE_KEY = 'ma.locale'

/** Biến nhớ trong tiến trình, để không phải đọc `localStorage` mỗi yêu cầu. */
let current: Locale | undefined

/** Đọc ngôn ngữ hiệu lực: biến nhớ → `localStorage` → ngôn ngữ trình duyệt → mặc định. */
export function readLocale(): Locale {
  if (current) return current
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && isLocale(stored)) {
      current = stored
      return stored
    }
  } catch {
    // Trình duyệt chặn localStorage (chế độ riêng tư của một số bản) — vẫn phải chạy.
  }
  for (const candidate of window.navigator.languages ?? []) {
    const normalized = normalizeLocaleTag(candidate)
    if (normalized) {
      current = normalized
      return normalized
    }
  }
  const single = normalizeLocaleTag(window.navigator.language ?? '')
  current = single ?? DEFAULT_LOCALE
  return current
}

/** Ghi ngôn ngữ đã chọn. Gọi từ cả hook React lẫn mã ngoài React. */
export function writeLocale(locale: Locale): void {
  current = locale
  try {
    window.localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Không lưu được thì ngôn ngữ vẫn có hiệu lực cho phiên hiện tại.
  }
}

/** Đặt `<html lang>`; tách ra đây để mọi nơi đổi ngôn ngữ đều nhớ cập nhật. */
export function applyDocumentLang(locale: Locale): void {
  document.documentElement.lang = locale === 'en' ? 'en' : 'vi'
}
