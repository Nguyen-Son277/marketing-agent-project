/**
 * Test trích brief.
 *
 * Đây là bài test bảo vệ đường sống của sản phẩm: nếu không trích được brief thì
 * BriefGate không bao giờ mở và người dùng bị kẹt ở vòng hỏi-đáp vĩnh viễn, không
 * bao giờ tới được bước lập kế hoạch. Lỗi này im lặng nên phải có test.
 *
 * Ca quan trọng nhất là `extractLabeledBrief` với định dạng người Việt hay dùng
 * ("Mục tiêu: …, KPI: …") và `parseExtractedBrief` với JSON mà model thật trả về,
 * gồm cả trường hợp model bọc trong markdown fence.
 */
import { describe, expect, it } from 'vitest'
import {
  extractLabeledBrief,
  mergeBriefFields,
  parseExtractedBrief,
} from '../src/brief.ts'
import { checkBrief } from '../src/planner.ts'

describe('extractLabeledBrief', () => {
  it('trích đủ 6 trường khi người dùng ghi theo nhãn', () => {
    const text = [
      'Chốt brief:',
      'Mục tiêu: Tăng 30% đăng ký dùng thử trong quý 4',
      'KPI: 150 lead chất lượng mỗi tháng, CPL ≤ 120.000đ',
      'Phạm vi: chỉ Facebook và SEO, không chạy TikTok',
      'Thời hạn: 31/12/2026',
      'Ngân sách: 80.000.000 VNĐ tiền quảng cáo',
      'Ràng buộc: không dùng ảnh khách hàng chưa xin phép',
    ].join('\n')

    const brief = extractLabeledBrief(text)
    expect(brief.objective).toContain('Tăng 30%')
    expect(brief.kpi).toContain('150 lead')
    expect(brief.scope).toContain('Facebook')
    expect(brief.deadline).toContain('31/12/2026')
    expect(brief.budget).toContain('80.000.000')
    expect(brief.constraints).toContain('không dùng ảnh')
  })

  it('không để giá trị lẫn sang mục sau', () => {
    const brief = extractLabeledBrief('Mục tiêu: Tăng doanh thu\nKPI: 100 đơn mỗi tháng')
    expect(brief.objective).toBe('Tăng doanh thu')
    expect(brief.kpi).toBe('100 đơn mỗi tháng')
  })

  it('đọc được nhãn viết trên cùng một dòng, phân tách bằng dấu chấm phẩy', () => {
    const brief = extractLabeledBrief('Mục tiêu: tăng lead; KPI: 50 lead/tháng; Ngân sách: 20 triệu')
    expect(brief.objective).toBe('tăng lead')
    expect(brief.kpi).toBe('50 lead/tháng')
    expect(brief.budget).toBe('20 triệu')
  })

  it('chấp nhận biến thể không dấu và tiếng Anh', () => {
    const brief = extractLabeledBrief('muc tieu: tang doanh thu\nbudget: 10 million\ndeadline: 2026-12-31')
    expect(brief.objective).toBe('tang doanh thu')
    expect(brief.budget).toBe('10 million')
    expect(brief.deadline).toBe('2026-12-31')
  })

  it('bỏ qua đoạn quá ngắn thay vì nhận nhầm', () => {
    const brief = extractLabeledBrief('Mục tiêu: x')
    expect(brief.objective).toBeUndefined()
  })

  it('trả về rỗng khi người dùng chỉ viết văn xuôi không nhãn', () => {
    expect(extractLabeledBrief('Tôi muốn làm marketing cho sản phẩm mới')).toEqual({})
  })

  it('trích được văn xuôi khi nhãn KHÔNG có dấu hai chấm', () => {
    // Đây là định dạng người dùng thật đã dùng và làm hỏng BriefGate: chỉ "Chốt
    // brief:" có dấu hai chấm, các nhãn còn lại nối bằng dấu chấm phẩy. Nếu chỉ hỗ
    // trợ nhãn có dấu hai chấm thì 5/6 trường bị bỏ sót.
    const prose =
      'Chốt brief: mục tiêu tăng 30% đăng ký dùng thử Sapa POS trong quý 4; ' +
      'KPI 150 lead chất lượng mỗi tháng với CPL không quá 120.000đ; ' +
      'phạm vi chỉ kênh Facebook và SEO, KHÔNG chạy TikTok lần này; ' +
      'thời hạn 31/12/2026; ngân sách 80 triệu VNĐ tiền quảng cáo; ' +
      'ràng buộc: không dùng ảnh khách hàng chưa xin phép.'

    const brief = extractLabeledBrief(prose)
    expect(Object.keys(brief).sort()).toEqual(['budget', 'constraints', 'deadline', 'kpi', 'objective', 'scope'])
    expect(brief.objective).toContain('tăng 30%')
    expect(brief.kpi).toContain('150 lead')
    expect(brief.scope).toContain('Facebook')
    expect(brief.deadline).toContain('31/12/2026')
    expect(brief.budget).toContain('80 triệu')
    expect(brief.constraints).toContain('không dùng ảnh khách hàng')
  })

  it('ưu tiên nhãn có dấu hai chấm khi cả hai dạng cùng xuất hiện', () => {
    const brief = extractLabeledBrief('Mục tiêu: Tăng doanh thu; mục tiêu tăng lợi nhuận')
    // Nhãn có dấu hai chấm đứng trước nên thắng.
    expect(brief.objective).toBe('Tăng doanh thu')
  })

  it('không coi từ nằm giữa câu là nhãn', () => {
    // "hạn" xuất hiện trong câu nhưng không phải nhãn ở đầu mục.
    const brief = extractLabeledBrief('Chúng tôi cần xong trong hạn sớm nhất có thể')
    expect(brief.deadline).toBeUndefined()
  })
})

describe('parseExtractedBrief', () => {
  it('đọc JSON thuần', () => {
    const brief = parseExtractedBrief(
      '{"objective":"Tăng đăng ký","kpi":"50 lead","scope":"Facebook","deadline":"31/12","budget":"20tr","constraints":"không ảnh khách"}',
    )
    expect(brief.objective).toBe('Tăng đăng ký')
    expect(brief.constraints).toBe('không ảnh khách')
  })

  it('đọc JSON bọc trong markdown fence như model hay trả về', () => {
    const output = ['Đây là kết quả:', '```json', '{"objective":"Tăng lead","kpi":""}', '```'].join('\n')
    const brief = parseExtractedBrief(output)
    expect(brief.objective).toBe('Tăng lead')
    expect(brief.kpi).toBeUndefined()
  })

  it('bỏ qua trường rỗng và trường quá ngắn', () => {
    const brief = parseExtractedBrief('{"objective":"Tăng lead","kpi":"","scope":"x"}')
    expect(brief.objective).toBe('Tăng lead')
    expect(brief.kpi).toBeUndefined()
    expect(brief.scope).toBeUndefined()
  })

  it('trả về rỗng khi model trả văn xuôi thay vì JSON', () => {
    expect(parseExtractedBrief('Tôi không tìm thấy thông tin nào trong hội thoại.')).toEqual({})
  })

  it('trả về rỗng khi JSON hỏng', () => {
    expect(parseExtractedBrief('{"objective": "Tăng lead"')).toEqual({})
  })
})

describe('mergeBriefFields', () => {
  const empty = undefined

  it('điền vào chỗ trống và giữ giá trị đã có', () => {
    const merged = mergeBriefFields(
      { objective: 'Mục tiêu cũ đã chốt' } as never,
      { objective: 'Mục tiêu mới', kpi: '50 lead' },
    )
    // Giá trị đã xác nhận không bị ghi đè bởi lượt sau.
    expect(merged.objective).toBe('Mục tiêu cũ đã chốt')
    expect(merged.kpi).toBe('50 lead')
  })

  it('tích luỹ qua nhiều lượt trả lời tới khi đủ 6 trường', () => {
    let brief = mergeBriefFields(empty, { objective: 'Tăng lead' })
    expect(checkBrief(brief).missing).toHaveLength(5)

    brief = mergeBriefFields(brief, { kpi: '50 lead/tháng' })
    brief = mergeBriefFields(brief, { scope: 'Facebook và SEO' })
    brief = mergeBriefFields(brief, { deadline: '31/12/2026' })
    brief = mergeBriefFields(brief, { budget: '20 triệu' })
    expect(checkBrief(brief).complete).toBe(false)

    brief = mergeBriefFields(brief, { constraints: 'không dùng ảnh khách hàng' })
    expect(checkBrief(brief).complete).toBe(true)
  })

  it('bắt đầu từ brief rỗng khi chưa có gì', () => {
    const brief = mergeBriefFields(empty, { objective: 'Mục tiêu đủ dài' })
    expect(brief.kpi).toBe('')
    expect(brief.constraints).toBe('')
  })
})
