/**
 * Test cho gói i18n.
 *
 * Trọng tâm là những chỗ dễ sai âm thầm: thiếu bản dịch, tham số nội suy không được
 * thay, và phân tích `Accept-Language` — giao thức này có nhiều dạng thật mà nếu đoán
 * sai thì người dùng nhận giao diện sai ngôn ngữ mà không có lỗi nào.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_CAPABILITIES,
  LOCALE_LIST,
  findMissingTranslations,
  formatCurrencyUsd,
  formatDate,
  formatDateTime,
  formatNumber,
  intlTagFor,
  isLocale,
  normalizeLocaleTag,
  parseAcceptLanguage,
  resolveLocale,
  translator,
  vi,
  en,
} from '../src/index.ts'

describe('catalog', () => {
  it('có đủ bản dịch ở mọi ngôn ngữ', () => {
    const missing = findMissingTranslations()
    // In ra khoá thiếu để thông điệp lỗi đọc được, thay vì chỉ "expected true to be false".
    expect(missing.map((item) => `${item.locale}:${item.key}`)).toEqual([])
  })

  it('tiếng Anh có đúng tập khoá như tiếng Việt', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort())
  })

  it('không có bản dịch nào rỗng hoặc chỉ khoảng trắng', () => {
    const empty = [...Object.entries(vi), ...Object.entries(en)]
      .filter(([, value]) => typeof value !== 'string' || value.trim().length === 0)
      .map(([key]) => key)
    expect(empty).toEqual([])
  })

  it('nội suy tham số ở cả hai ngôn ngữ', () => {
    expect(translator('vi')('common.serverReturnedError', { message: 'hỏng' })).toContain('hỏng')
    expect(translator('en')('common.serverReturnedError', { message: 'boom' })).toContain('boom')
  })

  it('dịch được cùng một khoá sang hai ngôn ngữ khác nhau', () => {
    const viText = translator('vi')('nav.dashboard')
    const enText = translator('en')('nav.dashboard')
    expect(viText).toBe('Bảng điều khiển')
    expect(enText).toBe('Dashboard')
    expect(viText).not.toBe(enText)
  })

  it('có bản dịch cho mọi danh mục tri thức', () => {
    // Liệt kê khoá tường minh: kiểu khoá là union literal, nên viết `kbCategory.${x}`
    // sẽ không gán được — và chính điều đó bảo đảm không có khoá nào bị bịa ra.
    const keys = [
      'kbCategory.00-cong-ty',
      'kbCategory.10-brand',
      'kbCategory.20-thi-truong',
      'kbCategory.30-kenh',
      'kbCategory.40-du-lieu',
      'kbCategory.90-ket-qua',
    ] as const
    for (const key of keys) {
      expect(translator('vi')(key).length).toBeGreaterThan(0)
      expect(translator('en')(key).length).toBeGreaterThan(0)
    }
  })

  it('có bản dịch cho mọi trạng thái công việc', () => {
    const keys = [
      'taskStatus.draft',
      'taskStatus.assigned',
      'taskStatus.in_progress',
      'taskStatus.blocked',
      'taskStatus.review',
      'taskStatus.done',
      'taskStatus.failed',
      'taskStatus.cancelled',
    ] as const
    for (const key of keys) {
      expect(translator('vi')(key).length).toBeGreaterThan(0)
      expect(translator('en')(key).length).toBeGreaterThan(0)
    }
  })
})

describe('normalizeLocaleTag', () => {
  it('nhận thẻ đơn giản và thẻ đầy đủ', () => {
    expect(normalizeLocaleTag('vi')).toBe('vi')
    expect(normalizeLocaleTag('en')).toBe('en')
    expect(normalizeLocaleTag('vi-VN')).toBe('vi')
    expect(normalizeLocaleTag('en-US')).toBe('en')
    expect(normalizeLocaleTag('en-GB')).toBe('en')
  })

  it('không phân biệt hoa thường', () => {
    expect(normalizeLocaleTag('VI')).toBe('vi')
    expect(normalizeLocaleTag('En-Us')).toBe('en')
  })

  it('chấp nhận dạng gạch dưới', () => {
    expect(normalizeLocaleTag('vi_VN')).toBe('vi')
  })

  it('trả undefined cho ngôn ngữ không hỗ trợ', () => {
    expect(normalizeLocaleTag('ja')).toBeUndefined()
    expect(normalizeLocaleTag('fr-FR')).toBeUndefined()
    expect(normalizeLocaleTag('')).toBeUndefined()
    expect(normalizeLocaleTag('   ')).toBeUndefined()
  })
})

describe('parseAcceptLanguage', () => {
  it('giữ thứ tự khi không có tham số chất lượng', () => {
    expect(parseAcceptLanguage('vi,en')).toEqual(['vi', 'en'])
  })

  it('sắp theo chất lượng giảm dần', () => {
    expect(parseAcceptLanguage('en;q=0.5,vi;q=0.9')).toEqual(['vi', 'en'])
  })

  it('loại ngôn ngữ bị từ chối bằng q=0', () => {
    // q=0 nghĩa là "đừng dùng ngôn ngữ này", không phải "ưu tiên thấp nhất".
    expect(parseAcceptLanguage('vi;q=0,en')).toEqual(['en'])
  })

  it('bỏ qua thẻ đại diện *', () => {
    expect(parseAcceptLanguage('*')).toEqual([])
    expect(parseAcceptLanguage('*,en')).toEqual(['en'])
  })

  it('bỏ qua ngôn ngữ không hỗ trợ nhưng giữ ngôn ngữ hỗ trợ', () => {
    expect(parseAcceptLanguage('ja,en;q=0.8')).toEqual(['en'])
  })

  it('trả mảng rỗng cho chuỗi rác thay vì ném lỗi', () => {
    expect(parseAcceptLanguage('!!!,;;;')).toEqual([])
    expect(parseAcceptLanguage('')).toEqual([])
    expect(parseAcceptLanguage(undefined)).toEqual([])
    expect(parseAcceptLanguage(null)).toEqual([])
  })

  it('không lặp lại cùng một ngôn ngữ', () => {
    expect(parseAcceptLanguage('vi-VN,vi;q=0.9,vi;q=0.8')).toEqual(['vi'])
  })

  it('xử lý được thẻ thực tế của trình duyệt', () => {
    expect(parseAcceptLanguage('vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5')).toEqual(['vi', 'en'])
  })

  it('bỏ qua tham số chất lượng không hợp lệ và dùng mặc định', () => {
    expect(parseAcceptLanguage('vi;q=abc,en')).toEqual(['vi', 'en'])
  })
})

describe('resolveLocale', () => {
  it('ưu tiên lựa chọn tường minh hơn header', () => {
    expect(resolveLocale({ preferred: 'en', acceptLanguage: 'vi-VN,vi;q=0.9' })).toBe('en')
  })

  it('dùng header khi chưa có lựa chọn tường minh', () => {
    expect(resolveLocale({ acceptLanguage: 'en-US,en;q=0.9' })).toBe('en')
  })

  it('bỏ qua lựa chọn tường minh không hợp lệ', () => {
    expect(resolveLocale({ preferred: 'ja', acceptLanguage: 'en' })).toBe('en')
    expect(resolveLocale({ preferred: 'ja' })).toBe(DEFAULT_LOCALE)
  })

  it('rơi về mặc định khi không có thông tin nào', () => {
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE)
    expect(resolveLocale({ acceptLanguage: 'ja,ko' })).toBe(DEFAULT_LOCALE)
  })
})

describe('locale capabilities', () => {
  it('mọi ngôn ngữ đều có nhãn hiển thị và thẻ Intl', () => {
    for (const locale of LOCALES) {
      const capability = LOCALE_CAPABILITIES[locale]
      expect(capability.code).toBe(locale)
      expect(capability.label.length).toBeGreaterThan(0)
      expect(capability.name.length).toBeGreaterThan(0)
      expect(capability.htmlLang.length).toBeGreaterThan(0)
      expect(capability.intlTag).toMatch(/^[a-z]{2}-[A-Z]{2}$/)
    }
  })

  it('danh sách hiển thị phủ đủ ngôn ngữ', () => {
    expect(LOCALE_LIST.map((item) => item.code)).toEqual([...LOCALES])
  })

  it('isLocale nhận đúng và loại đúng', () => {
    expect(isLocale('vi')).toBe(true)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('ja')).toBe(false)
    expect(isLocale(42)).toBe(false)
    expect(isLocale(undefined)).toBe(false)
  })

  it('intlTagFor trả thẻ dùng được với Intl', () => {
    expect(intlTagFor('vi')).toBe('vi-VN')
    expect(intlTagFor('en')).toBe('en-US')
  })
})

describe('định dạng theo ngôn ngữ', () => {
  it('định dạng số khác nhau giữa hai ngôn ngữ', () => {
    // Phân tách hàng nghìn của vi là dấu chấm, của en-US là dấu phẩy.
    expect(formatNumber(1234567, 'vi')).toBe('1.234.567')
    expect(formatNumber(1234567, 'en')).toBe('1,234,567')
  })

  it('định dạng ngày theo ngôn ngữ', () => {
    const date = new Date('2026-10-10T12:00:00Z')
    expect(formatDate(date, 'vi')).toMatch(/\d{2}\/\d{2}\/\d{4}/)
    expect(formatDate(date, 'en')).toMatch(/\d{2}\/\d{2}\/\d{4}/)
    expect(formatDateTime(date, 'vi').length).toBeGreaterThan(10)
  })

  it('hiển thị chi phí bằng USD vì đó là đơn vị thật của nhà cung cấp', () => {
    expect(formatCurrencyUsd(12.5, 'en')).toContain('$')
    expect(formatCurrencyUsd(0.0123, 'en')).toContain('$')
  })

  it('trả dấu gạch cho giá trị không phải số thay vì NaN', () => {
    expect(formatNumber(Number.NaN, 'vi')).toBe('—')
    expect(formatCurrencyUsd(Number.NaN, 'vi')).toBe('—')
    expect(formatDate('không-phải-ngày', 'vi')).toBe('—')
  })
})
