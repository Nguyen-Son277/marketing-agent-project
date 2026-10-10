/**
 * Đa ngôn ngữ (vi/en) cho cả server và giao diện.
 *
 * Gói này cố ý KHÔNG phụ thuộc package nội bộ nào khác: tầng thấp (`db`, `kb`, `llm`)
 * cần dịch thông báo lỗi, mà những tầng đó phải giữ thuần và không được kéo theo
 * nghiệp vụ. Chỉ phụ thuộc `i18next`.
 */
export {
  LOCALES,
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  LOCALE_CAPABILITIES,
  LOCALE_LIST,
  isLocale,
  normalizeLocaleTag,
  intlTagFor,
} from './locale.ts'
export type { Locale, LocaleCapability } from './locale.ts'

export {
  translator,
  t,
  findMissingTranslations,
  setGlobalLocaleForTest,
  vi,
  en,
} from './translator.ts'
export type { MessageKey, MessageParams, Translate, Catalog } from './translator.ts'

export { parseAcceptLanguage, resolveLocale } from './resolve.ts'

/** Tiện ích định dạng ngày và số theo ngôn ngữ, để giao diện không hard-code locale. */
export { formatDate, formatDateTime, formatNumber, formatCurrencyUsd } from './format.ts'
