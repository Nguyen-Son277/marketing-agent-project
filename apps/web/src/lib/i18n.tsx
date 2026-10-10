/**
 * Lớp đa ngôn ngữ cho giao diện.
 *
 * Vì sao dùng `react-i18next` ở đây thay vì tự viết context: nó xử lý sẵn việc
 * component vẽ lại khi đổi ngôn ngữ. Đổi ngôn ngữ phải áp dụng NGAY trên toàn bộ màn
 * hình đang mở, không cần tải lại trang — tự viết thì phải chống lại việc React bỏ
 * qua cập nhật ở những component đã ghi nhớ kết quả dịch.
 *
 * Vì sao lựa chọn ngôn ngữ lưu ở `localStorage` chứ không ở server: đây là sở thích
 * của từng người và phải áp dụng được cả ở màn hình đăng nhập, tức là trước khi có
 * phiên. Lưu ở server sẽ khiến người chưa đăng nhập không đổi được ngôn ngữ.
 */
import { useCallback, useMemo, type ReactNode } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import i18next, { type i18n as I18nInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import {
  DEFAULT_LOCALE,
  LOCALE_CAPABILITIES,
  isLocale,
  normalizeLocaleTag,
  vi,
  en,
  type Locale,
  type MessageKey,
  type MessageParams,
} from '@marketing-agent/i18n'

/** Khoá lưu lựa chọn trong `localStorage`; có tiền tố để không đụng khoá khác. */
const STORAGE_KEY = 'ma.locale'

/**
 * Lấy ngôn ngữ ban đầu: lựa chọn đã lưu trước, rồi tới ngôn ngữ trình duyệt.
 *
 * Thứ tự này quan trọng: nếu đảo lại thì mỗi lần mở trang, trình duyệt sẽ ghi đè lựa
 * chọn người dùng đã đặt, và nút chuyển ngôn ngữ trở nên vô dụng.
 */
function initialLocale(): Locale {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored && isLocale(stored)) return stored
  } catch {
    // Trình duyệt chặn localStorage (chế độ riêng tư của một số bản) — vẫn phải chạy.
  }
  for (const candidate of window.navigator.languages ?? []) {
    const normalized = normalizeLocaleTag(candidate)
    if (normalized) return normalized
  }
  const single = normalizeLocaleTag(window.navigator.language ?? '')
  return single ?? DEFAULT_LOCALE
}

/** Khởi tạo một instance i18next riêng cho giao diện. */
export function createWebI18n(): I18nInstance {
  const instance = i18next.createInstance()
  void instance.use(initReactI18next).init({
    lng: initialLocale(),
    fallbackLng: DEFAULT_LOCALE,
    resources: { vi: { translation: vi }, en: { translation: en } },
    interpolation: { escapeValue: false },
    returnNull: false,
    // Không ghi log ra console người dùng: gói đã có test bảo đảm đủ khoá.
    debug: false,
  })
  return instance
}

/** Đặt thuộc tính `lang` của thẻ `<html>` để trình đọc màn hình và CSS biết ngôn ngữ. */
export function applyDocumentLang(locale: Locale): void {
  document.documentElement.lang = LOCALE_CAPABILITIES[locale].htmlLang
}

export function I18nProvider({ instance, children }: { instance: I18nInstance; children: ReactNode }) {
  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>
}

/**
 * Hook dịch, gõ kiểu theo catalog.
 *
 * Vì sao không dùng thẳng `useTranslation` của react-i18next: hàm `t` của nó nhận
 * `string`, nên một khoá sai vẫn biên dịch. Hook này gò kiểu khoá về `MessageKey`, nhờ
 * đó gõ nhầm khoá là lỗi biên dịch — cùng mục tiêu với phía server.
 */
export function useI18n(): {
  t: (key: MessageKey, params?: MessageParams) => string
  locale: Locale
  setLocale: (locale: Locale) => void
  formatDate: (value: Date | string | number) => string
  formatDateTime: (value: Date | string | number) => string
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  formatCurrencyUsd: (value: number) => string
} {
  const { t: rawT, i18n: instance } = useTranslation()
  const locale = (isLocale(instance.language) ? instance.language : DEFAULT_LOCALE) as Locale

  const setLocale = useCallback(
    (next: Locale) => {
      void instance.changeLanguage(next)
      applyDocumentLang(next)
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        // Không lưu được thì ngôn ngữ vẫn đổi cho phiên hiện tại.
      }
    },
    [instance],
  )

  return useMemo(() => {
    const tag = LOCALE_CAPABILITIES[locale].intlTag
    return {
      t: (key, params) => {
        const value = params ? rawT(key, params) : rawT(key)
        return typeof value === 'string' ? value : String(value)
      },
      locale,
      setLocale,
      formatDate: (value) => {
        const date = value instanceof Date ? value : new Date(value)
        if (Number.isNaN(date.getTime())) return '—'
        return new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
      },
      formatDateTime: (value) => {
        const date = value instanceof Date ? value : new Date(value)
        if (Number.isNaN(date.getTime())) return '—'
        return new Intl.DateTimeFormat(tag, {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(date)
      },
      formatNumber: (value, options) => {
        if (!Number.isFinite(value)) return '—'
        return new Intl.NumberFormat(tag, options).format(value)
      },
      formatCurrencyUsd: (value) => {
        if (!Number.isFinite(value)) return '—'
        // Chi phí model lưu bằng USD; đổi sang tiền bản địa cần tỉ giá, mà tỉ giá cứng
        // trong mã nguồn là thông tin sai dần theo thời gian.
        return new Intl.NumberFormat(tag, {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: value < 1 ? 4 : 2,
        }).format(value)
      },
    }
  }, [locale, rawT, setLocale])
}
