/**
 * Xác định ngôn ngữ từ yêu cầu HTTP.
 *
 * Vì sao cần lớp này thay vì tin vào một giá trị: ngôn ngữ đến từ ba nguồn với độ tin
 * cậy khác nhau — lựa chọn của người dùng trong trình duyệt, thẻ `Accept-Language` do
 * trình duyệt gửi tự động, và giá trị mặc định. Hàm ở đây gộp chúng theo thứ tự ưu
 * tiên đó, và quan trọng hơn: nó KHÔNG BAO GIỜ trả về ngôn ngữ không được hỗ trợ, nên
 * phần còn lại của hệ thống không phải phòng thủ.
 */
import { DEFAULT_LOCALE, normalizeLocaleTag, type Locale } from './locale.ts'

/**
 * Phân tích thẻ `Accept-Language` theo chất lượng (`q`).
 *
 * Định dạng thật gặp trong thực tế: `vi`, `vi-VN,vi;q=0.9,en;q=0.8`,
 * `en-US,en;q=0.9`, `*`, và cả chuỗi rác. Tham số chất lượng quyết định thứ tự ưu
 * tiên; mặc định là 1 khi không ghi. Thẻ `*` bị bỏ qua vì nó nghĩa là "ngôn ngữ nào
 * cũng được", và ta đã có mặc định riêng.
 */
export function parseAcceptLanguage(header: string | undefined | null): Locale[] {
  if (!header || header.trim().length === 0) return []

  const scored: { locale: Locale; quality: number; order: number }[] = []
  const parts = header.split(',')

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]?.trim() ?? ''
    if (part.length === 0) continue

    const [rawTag, ...parameters] = part.split(';')
    const tag = (rawTag ?? '').trim()
    if (tag.length === 0 || tag === '*') continue

    // `q=0` nghĩa là người dùng TỪ CHỐI ngôn ngữ đó, nên phải loại chứ không chỉ hạ ưu tiên.
    let quality = 1
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(parameter)
      if (match?.[1]) {
        const parsed = Number.parseFloat(match[1])
        if (Number.isFinite(parsed)) quality = parsed
      }
    }
    if (quality <= 0) continue

    const locale = normalizeLocaleTag(tag)
    if (locale) scored.push({ locale, quality, order: index })
  }

  // Sắp theo chất lượng giảm dần; cùng chất lượng thì giữ thứ tự xuất hiện trong thẻ,
  // vì thứ tự đó chính là ý định của người dùng.
  scored.sort((a, b) => (b.quality - a.quality) || (a.order - b.order))

  const seen = new Set<Locale>()
  const result: Locale[] = []
  for (const item of scored) {
    if (seen.has(item.locale)) continue
    seen.add(item.locale)
    result.push(item.locale)
  }
  return result
}

/**
 * Chọn ngôn ngữ hiệu lực từ các nguồn theo thứ tự ưu tiên.
 *
 * Thứ tự: lựa chọn tường minh của người dùng → thẻ `Accept-Language` → mặc định. Lựa
 * chọn tường minh đứng trước vì đó là điều người dùng đã chủ động nói; `Accept-Language`
 * chỉ là suy đoán của trình duyệt.
 */
export function resolveLocale(input: {
  /** Ngôn ngữ người dùng đã chọn, ví dụ từ cột `language` của phiên. */
  readonly preferred?: string | undefined
  /** Giá trị thô của header `Accept-Language`. */
  readonly acceptLanguage?: string | undefined
}): Locale {
  const explicit = input.preferred ? normalizeLocaleTag(input.preferred) : undefined
  if (explicit) return explicit

  const fromHeader = parseAcceptLanguage(input.acceptLanguage)
  if (fromHeader.length > 0 && fromHeader[0]) return fromHeader[0]

  return DEFAULT_LOCALE
}
