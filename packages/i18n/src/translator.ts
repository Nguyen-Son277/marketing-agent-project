/**
 * Runtime i18n dùng chung cho server và trình duyệt.
 *
 * Vì sao i18next ở dưới nhưng vẫn có lớp bọc: đã kiểm chứng i18next KHÔNG kiểm tra
 * khoá lúc biên dịch (một khoá sai vẫn biên dịch bình thường — `@ts-expect-error`
 * thậm chí bị báo là thừa). Mục tiêu của dự án là "thiếu bản dịch là lỗi biên dịch",
 * nên lớp bọc này gõ kiểu `t()` theo union khoá của catalog. i18next lo phần nội suy
 * và plural; lớp bọc lo phần an toàn kiểu.
 *
 * Cả hai phía dùng CHUNG gói này: server dịch thông báo lỗi, trình duyệt dịch giao
 * diện và dịch lại lỗi. Một nguồn catalog nên hai phía không thể lệch nhau.
 */
import i18next, { type i18n as I18nInstance } from 'i18next'
import { en } from './catalogs/en.ts'
import { vi, type Catalog } from './catalogs/vi.ts'
import { DEFAULT_LOCALE, FALLBACK_LOCALE, LOCALES, isLocale, type Locale } from './locale.ts'

/** Mọi khoá hợp lệ, suy trực tiếp từ catalog tiếng Việt. */
export type MessageKey = keyof typeof vi

/** Giá trị tham số nội suy; chỉ nhận kiểu mà i18next nội suy được. */
export type MessageParams = Record<string, string | number>

/** Hàm dịch: khoá bị giới hạn theo catalog, tham số là tuỳ chọn. */
export type Translate = (key: MessageKey, params?: MessageParams) => string

/**
 * Bảo đảm catalog tiếng Anh phủ đủ khoá — và không có khoá lạ.
 *
 * Kiểm tra này chạy lúc biên dịch, nên thiếu một bản dịch làm `tsc` đỏ. Đây là lớp
 * bảo vệ chính; `tests` còn thêm một lớp nữa vì kiểu chỉ bắt được khoá khai báo
 * tường minh trong file.
 */
const _enComplete: Catalog = en
void _enComplete

let instance: I18nInstance | undefined

/**
 * Khởi tạo i18next một lần cho cả tiến trình.
 *
 * Vì sao dùng singleton: i18next giữ trạng thái ngôn ngữ bên trong, và mỗi lần
 * `init` mới sẽ ghi đè ngôn ngữ đang dùng. Server phục vụ nhiều request cùng lúc với
 * nhiều ngôn ngữ khác nhau, nên thay vì đổi ngôn ngữ toàn cục, ta lấy một hàm dịch
 * gắn cứng ngôn ngữ (`getFixedT`) cho từng request.
 */
function ensureInstance(): I18nInstance {
  if (instance) return instance
  instance = i18next.createInstance()
  void instance.init({
    // Không tự dò ngôn ngữ từ môi trường: ngôn ngữ luôn do nơi gọi quyết định tường
    // minh, nếu không thì hành vi sẽ phụ thuộc máy đang chạy.
    lng: DEFAULT_LOCALE,
    fallbackLng: FALLBACK_LOCALE,
    supportedLngs: [...LOCALES],
    resources: {
      vi: { translation: vi },
      en: { translation: en },
    },
    interpolation: {
      // Không escape: chuỗi đã đi qua React (tự escape) hoặc qua JSON. Escape ở đây
      // sẽ biến "&" thành "&amp;" trong thông báo lỗi và trong API.
      escapeValue: false,
    },
    returnNull: false,
    // i18next trả về chính khoá khi thiếu bản dịch — hành vi này là chủ đích: khoá
    // hiện ra là tín hiệu rõ ràng rằng có lỗi, tốt hơn một chuỗi rỗng im lặng.
    // Không bật `debug` vì nó ghi ra console ở mỗi khoá thiếu, và gói này chạy ở cả
    // trình duyệt lẫn server.
    saveMissing: false,
  })
  return instance
}

/**
 * Lấy hàm dịch cho một ngôn ngữ.
 *
 * Kết quả gắn cứng ngôn ngữ nên dùng an toàn cho nhiều request đồng thời.
 */
export function translator(locale: Locale): Translate {
  const fixed = ensureInstance().getFixedT(locale)
  return (key, params) => {
    const value = params ? fixed(key, params) : fixed(key)
    // i18next trả về khoá khi thiếu; chuẩn hoá thành chuỗi để kiểu trả về luôn là string.
    return typeof value === 'string' ? value : String(value)
  }
}

/** Hàm dịch của ngôn ngữ mặc định, dùng ở nơi chưa biết ngôn ngữ (test, log). */
export const t: Translate = (key, params) => translator(DEFAULT_LOCALE)(key, params)

/** Đổi ngôn ngữ của instance toàn cục — chỉ dùng cho test. */
export async function setGlobalLocaleForTest(locale: Locale): Promise<void> {
  await ensureInstance().changeLanguage(locale)
}

/**
 * Kiểm tra catalog có đủ khoá ở MỌI ngôn ngữ.
 *
 * Trả về danh sách khoá thiếu để test in ra thành thông điệp đọc được, thay vì chỉ
 * "expected true to be false".
 */
export function findMissingTranslations(): { locale: Locale; key: MessageKey }[] {
  const catalogs: Record<Locale, Partial<Record<MessageKey, string>>> = { vi, en }
  const keys = Object.keys(vi) as MessageKey[]
  const missing: { locale: Locale; key: MessageKey }[] = []
  for (const locale of LOCALES) {
    const catalog = catalogs[locale]
    for (const key of keys) {
      const value = catalog[key]
      if (typeof value !== 'string' || value.trim().length === 0) missing.push({ locale, key })
    }
  }
  return missing
}

export { vi, en }
export { isLocale }
export type { Locale, Catalog }
