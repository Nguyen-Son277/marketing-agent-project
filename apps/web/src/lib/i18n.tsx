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
  vi,
  en,
  type Locale,
  type MessageKey,
  type MessageParams,
} from '@marketing-agent/i18n'
import { applyDocumentLang as applyLang, readLocale, writeLocale } from './locale-store.ts'
import { ApiError } from './api.ts'

export { applyLang as applyDocumentLang }

/** Khởi tạo một instance i18next riêng cho giao diện. */
export function createWebI18n(): I18nInstance {
  const instance = i18next.createInstance()
  void instance.use(initReactI18next).init({
    lng: readLocale(),
    fallbackLng: DEFAULT_LOCALE,
    resources: { vi: { translation: vi }, en: { translation: en } },
    interpolation: { escapeValue: false },
    returnNull: false,
    // Không ghi log ra console người dùng: gói đã có test bảo đảm đủ khoá.
    debug: false,
  })
  return instance
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
  translateError: (error: unknown) => string
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
      // Ghi qua `locale-store` để `lib/api.ts` cũng thấy ngôn ngữ mới cho các yêu cầu
      // tiếp theo — nếu chỉ đổi trong React thì header `Accept-Language` sẽ vẫn là
      // ngôn ngữ cũ và thông báo lỗi trả về sai ngôn ngữ.
      applyLang(next)
      writeLocale(next)
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
      /**
       * Dịch một lỗi bất kỳ thành câu hiển thị được, theo ngôn ngữ đang chọn.
       *
       * Vì sao cần hàm này thay vì dùng thẳng `error.message`: backend đã dịch theo
       * `Accept-Language` lúc gọi, nhưng người dùng có thể đổi ngôn ngữ sau đó. Có
       * `messageKey` thì dịch lại cho khớp màn hình; không có thì dùng câu backend trả
       * về, và nếu khoá lạ thì vẫn có câu dự phòng — không bao giờ trắng chữ.
       */
      translateError: (error) => {
        const key = error instanceof ApiError ? error.messageKey : undefined
        if (key) {
          const params = error instanceof ApiError ? error.messageParams : undefined
          const translated = params ? rawT(key as never, params) : rawT(key as never)
          if (typeof translated === 'string' && translated !== key) return translated
        }
        if (error instanceof ApiError && error.fallbackMessage.trim().length > 0) {
          return error.fallbackMessage
        }
        if (error instanceof Error && error.message.trim().length > 0) return error.message
        return rawT('common.unexpectedError')
      },
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
