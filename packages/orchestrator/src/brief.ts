/**
 * Trích brief 6 trường từ lời nói tự nhiên của người dùng.
 *
 * Vì sao đây là phần quan trọng nhất của BriefGate: nếu không trích được, brief không
 * bao giờ đủ và người dùng bị kẹt ở vòng hỏi-đáp vĩnh viễn — hệ thống không bao giờ
 * lập được kế hoạch. Đây là kiểu hỏng tệ nhất vì nó im lặng.
 *
 * Chiến lược hai lớp:
 *
 * 1. **Trích theo nhãn** (tất định, miễn phí). Người dùng Việt Nam rất hay viết
 *    "Mục tiêu: X, KPI: Y". Nhận dạng theo nhãn và dấu phân cách xử lý được phần
 *    lớn trường hợp mà không tốn token và không phụ thuộc model.
 * 2. **Nhờ model trích hộ** khi lớp 1 vẫn thiếu trường. Model chạy với hướng dẫn
 *    rất chặt và trả JSON; chỉ những trường model trả về mới được điền, nên lớp này
 *    không thể ghi đè giá trị người dùng đã nêu rõ.
 *
 * Không lớp nào được BỊA giá trị. Trường không tìm thấy thì để trống, và BriefGate
 * sẽ hỏi tiếp — đúng như thiết kế.
 */
import { truncate, type LlmToolCall } from '@marketing-agent/shared'
import { BRIEF_FIELDS, type Brief } from './types.ts'

/** Nhãn nhận dạng cho từng trường, gồm cả biến thể tiếng Anh. */
const NHAN: Record<keyof Brief, readonly string[]> = {
  objective: ['mục tiêu', 'muc tieu', 'objective', 'goal'],
  kpi: ['kpi', 'chỉ số', 'chi so', 'chỉ tiêu', 'chi tieu', 'metric'],
  scope: ['phạm vi', 'pham vi', 'scope', 'giới hạn', 'gioi han'],
  deadline: ['thời hạn', 'thoi han', 'deadline', 'hạn chót', 'han chot', 'hạn'],
  budget: ['ngân sách', 'ngan sach', 'budget', 'kinh phí', 'kinh phi'],
  constraints: ['ràng buộc', 'rang buoc', 'constraint', 'lưu ý', 'luu y', 'điều kiện', 'dieu kien'],
}

/** Chuyển chuỗi về dạng so sánh không dấu, chữ thường. */
function chuanHoa(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
}

/**
 * Vị trí của mọi nhãn trong văn bản, đã bỏ dấu.
 *
 * `requireColon` chọn giữa hai chế độ:
 *  - `true`: chỉ nhận "mục tiêu: X" (chính xác cao, dùng làm lớp ưu tiên).
 *  - `false`: nhận cả "mục tiêu X" trong văn xuôi (chính xác thấp hơn, dùng làm
 *    lớp dự phòng). Cần chế độ này vì người dùng thật viết "Chốt brief: mục tiêu
 *    tăng 30% đăng ký dùng thử ...; KPI 150 lead ..." — nhãn không có dấu hai chấm.
 *    Đã kiểm chứng: nếu chỉ hỗ trợ dấu hai chấm thì 5/6 trường bị bỏ sót.
 */
function timNhan(text: string, requireColon: boolean): { field: keyof Brief; start: number; end: number }[] {
  const lower = chuanHoa(text)
  const found: { field: keyof Brief; start: number; end: number }[] = []
  for (const field of BRIEF_FIELDS) {
    for (const nhan of NHAN[field]) {
      const pattern = requireColon ? new RegExp(`${nhan}\\s*[:：]`, 'g') : new RegExp(nhan, 'g')
      let match: RegExpExecArray | null
      while ((match = pattern.exec(lower)) !== null) {
        found.push({ field, start: match.index, end: match.index + match[0].length })
      }
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

/**
 * Cắt giá trị của từng nhãn.
 *
 * Điểm kết thúc là cái nào tới trước: **nhãn kế tiếp** hoặc **dấu phân cách mục**
 * (`;` `,` hoặc xuống dòng). Cần cả hai vì có trường hợp nhãn chỉ xuất hiện một lần
 * trong cả văn bản (khi đó không có nhãn kế tiếp để chặn), và nếu chỉ dựa vào nhãn
 * kế tiếp thì giá trị sẽ chạy tới hết câu — nuốt luôn cả câu sau.
 */
function catTheoNhan(text: string, marks: readonly { field: keyof Brief; start: number; end: number }[]): Partial<Brief> {
  const out: Partial<Record<keyof Brief, string>> = {}
  for (const [index, mark] of marks.entries()) {
    if (out[mark.field] !== undefined) continue
    const next = marks[index + 1]
    const boundary = next ? next.start : text.length
    const rest = text.slice(mark.end, boundary)
    const separator = rest.search(/[;,\n]/)
    const value = separator >= 0 ? rest.slice(0, separator) : rest
    const cleaned = value
      .replace(/^[\s:;,•\-]+/, '')
      .replace(/[;,\s]+$/, '')
      .trim()
    if (cleaned.length >= 3) out[mark.field] = truncate(cleaned, 600)
  }
  return out
}

/**
 * Trích các trường có nhãn rõ ràng.
 *
 * Giá trị của một nhãn chạy tới nhãn kế tiếp, hoặc tới hết chuỗi. Nhãn trùng lặp
 * (cùng trường xuất hiện hai lần) thì lần xuất hiện đầu thắng, vì đó thường là
 * phần người dùng viết có chủ đích.
 */
export function extractLabeledBrief(text: string): Partial<Brief> {
  // Mỗi lớp phải cắt giá trị CHỈ dựa trên nhãn của chính nó. Nếu trộn nhãn của hai
  // lớp vào một danh sách, một lần nhắc lại nhãn không có dấu hai chấm ở câu sau sẽ
  // bị coi là "nhãn kế tiếp" và giá trị của nhãn có dấu hai chấm bị cắt sai — hoặc
  // ngược lại, giá trị bị kéo dài tới hết câu như trước khi sửa.
  const strict = catTheoNhan(text, timNhan(text, true))
  const lenient = catTheoNhan(text, timNhan(text, false))
  const out: Partial<Record<keyof Brief, string>> = { ...strict }
  for (const field of BRIEF_FIELDS) {
    if (out[field] === undefined && lenient[field] !== undefined) out[field] = lenient[field]
  }
  return out
}

/**
 * Gộp brief cũ với giá trị mới trích được.
 *
 * Chỉ điền vào chỗ trống: giá trị người dùng đã xác nhận ở lượt trước không bị ghi
 * đè bởi một câu trả lời ngắn ở lượt sau. Muốn đổi thì phải nêu lại rõ ràng.
 */
export function mergeBriefFields(existing: Partial<Brief> | undefined, found: Partial<Brief>): Brief {
  const base: Brief = {
    objective: existing?.objective ?? '',
    kpi: existing?.kpi ?? '',
    scope: existing?.scope ?? '',
    deadline: existing?.deadline ?? '',
    budget: existing?.budget ?? '',
    constraints: existing?.constraints ?? '',
  }
  const record = base as unknown as Record<string, string>
  for (const field of BRIEF_FIELDS) {
    const value = found[field]
    if (value && value.trim().length >= 3 && record[field]!.trim().length === 0) {
      record[field] = value.trim()
    }
  }
  return base
}

/**
 * Hướng dẫn cho model khi cần trích hộ. Định dạng JSON được chốt cứng và có ví dụ,
 * vì model nhỏ (flash) dễ trả về văn xuôi nếu chỉ được mô tả bằng lời.
 */
export const BRIEF_EXTRACTION_INSTRUCTION = [
  'Đọc phần hội thoại dưới đây và trích ra 6 trường của brief marketing.',
  '',
  'QUY TẮC BẮT BUỘC:',
  '1. CHỈ dùng thông tin có thật trong hội thoại. TUYỆT ĐỐI không tự nghĩ ra hay suy diễn.',
  '2. Trường nào hội thoại không nói tới thì để chuỗi rỗng "".',
  '3. Sao chép nguyên văn ý của người dùng, không diễn giải lại cho đẹp.',
  '4. Trả về DUY NHẤT một object JSON, không thêm chữ nào khác, không dùng markdown fence.',
  '',
  'Định dạng:',
  '{"objective":"","kpi":"","scope":"","deadline":"","budget":"","constraints":""}',
  '',
  'Ý nghĩa:',
  '- objective: kết quả kinh doanh mong muốn',
  '- kpi: chỉ số đo được kèm mốc thời gian',
  '- scope: làm gì và KHÔNG làm gì',
  '- deadline: ngày cần xong',
  '- budget: tiền và/hoặc số giờ người',
  '- constraints: ràng buộc về thương hiệu, pháp lý, kênh bắt buộc, điều cấm',
].join('\n')

/**
 * Đọc JSON mà model trả về.
 *
 * Chấp nhận cả trường hợp model bọc trong markdown fence hoặc thêm chữ quanh JSON —
 * đây là hành vi phổ biến và từ chối nó sẽ làm mất dữ liệu người dùng đã cung cấp.
 */
export function parseExtractedBrief(output: string): Partial<Brief> {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(output)
  const candidate = (fence?.[1] ?? output).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null) return {}

  const record = parsed as Record<string, unknown>
  const out: Partial<Record<keyof Brief, string>> = {}
  for (const field of BRIEF_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value.trim().length >= 3) out[field] = value.trim()
  }
  return out
}

/** Lọc bỏ các bản ghi tool_call khỏi phần văn bản khi model lỡ gọi công cụ. */
export function withoutToolCalls(calls: readonly LlmToolCall[]): string {
  return calls.map((call) => call.name).join(', ')
}

/**
 * Kiểm tra tiêu đề có phải là tiêu đề mặc định của hệ thống.
 */
export function isDefaultConversationTitle(title: string | null | undefined): boolean {
  if (!title) return true
  const norm = title.trim().toLowerCase()
  return (
    norm === '' ||
    norm === 'cuộc trao đổi mới' ||
    norm === 'new conversation' ||
    norm === 'cuộc trò chuyện mới' ||
    norm === 'untitled'
  )
}

/**
 * Làm sạch và định dạng văn bản thành một tiêu đề hội thoại ngắn gọn, súc tích (<= 60 ký tự).
 */
export function cleanConversationTitle(text: string, maxLength = 60): string {
  if (!text) return ''
  // 1. Loại bỏ markdown fences, headers, bullets, quotes, links
  let cleaned = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#+\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')

  // 2. Lấy dòng đầu tiên có chữ
  const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean)
  cleaned = lines[0] ?? ''

  // 3. Bỏ các từ chào hỏi, mở đầu xã giao
  cleaned = cleaned.replace(/^(xin\s+chào|chào\s+(bạn|leader|anh|chị|em|ad)?|hello|hi|dear)\s*[,.:;!-]?\s*/i, '')
  cleaned = cleaned.replace(/^(tôi\s+muốn|hãy\s+giúp\s+tôi|nhờ\s+leader|please\s+help\s+me\s+to|please)\s+/i, '')
  cleaned = cleaned.replace(/^(mục\s+tiêu|muc\s+tieu|objective|yêu\s+cầu|yeu\s+cau)\s*[:：]\s*/i, '')
  cleaned = cleaned.trim()

  if (!cleaned) return ''

  // 4. Cắt gọn tại ranh giới từ nếu vượt quá maxLength
  if (cleaned.length > maxLength) {
    const cut = cleaned.slice(0, maxLength)
    const lastSpace = cut.lastIndexOf(' ')
    cleaned = (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim() + '…'
  }

  // 5. Viết hoa chữ cái đầu
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

/**
 * Trích xuất tiêu đề phù hợp nhất từ nội dung trao đổi, mục tiêu brief hoặc tệp đính kèm.
 */
export function deriveConversationTitle(input: {
  content?: string
  objective?: string
  filenames?: readonly string[]
}): string {
  const objective = input.objective ? cleanConversationTitle(input.objective) : ''
  const content = input.content ? cleanConversationTitle(input.content) : ''

  const isObjectiveSubstantive =
    objective.length >= 10 && !/^\d+/.test(objective)

  if (isObjectiveSubstantive) {
    return objective
  }
  if (content && content.length >= 8) {
    return content
  }
  if (objective) {
    return objective
  }
  if (content) {
    return content
  }
  if (input.filenames && input.filenames.length > 0) {
    return cleanConversationTitle(`Tài liệu: ${input.filenames[0]}`)
  }
  return 'Cuộc trao đổi mới'
}
