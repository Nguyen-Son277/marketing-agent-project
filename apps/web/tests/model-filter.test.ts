/**
 * Test cho bộ lọc và chọn model.
 *
 * Trọng tâm là bất biến "chọn tất cả chỉ tác động lên dòng đang hiện". Gateway nội bộ trả về
 * 726 model, nên nếu bất biến này vỡ thì một cú bấm sẽ nhập hàng trăm model vào hệ thống —
 * hậu quả nặng và khó hoàn tác.
 */
import { describe, expect, it } from 'vitest'
import type { FetchedModelView } from '@marketing-agent/shared'
import { chonTatCaDangHien, chuanHoaTimKiem, daoChon, demDaChon, locModel } from '../src/lib/model-filter.ts'

const model = (modelId: string, label = modelId, alreadyAdded = false): FetchedModelView => ({
  modelId,
  label,
  alreadyAdded,
})

const danhSach: readonly FetchedModelView[] = [
  model('claude-opus-5-5', 'Claude Opus 5.5'),
  model('claude-sonnet-5-5', 'Claude Sonnet 5.5'),
  model('deepseek-v4-flash', 'DeepSeek V4 Flash'),
  model('gpt-4o-mini', 'GPT-4o mini'),
  model('da-them-roi', 'Đã thêm rồi', true),
]

describe('chuanHoaTimKiem', () => {
  it('bỏ dấu tiếng Việt và hạ chữ thường', () => {
    expect(chuanHoaTimKiem('Đã Thêm Rồi')).toBe('da them roi')
    expect(chuanHoaTimKiem('ĐỐI THỦ')).toBe('doi thu')
  })

  it('gộp ký tự phân tách thành một khoảng trắng', () => {
    expect(chuanHoaTimKiem('claude-opus_5.5')).toBe('claude opus 5 5')
    expect(chuanHoaTimKiem('  nhiều   khoảng   trắng  ')).toBe('nhieu khoang trang')
  })

  it('chuỗi rỗng và chỉ ký tự lạ trả về rỗng', () => {
    expect(chuanHoaTimKiem('')).toBe('')
    expect(chuanHoaTimKiem('!!!')).toBe('')
  })
})

describe('locModel', () => {
  it('mặc định ẩn model đã có trong hệ thống', () => {
    const ketQua = locModel(danhSach, { tuKhoa: '', chiChuaThem: true })
    expect(ketQua.map((m) => m.modelId)).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'deepseek-v4-flash',
      'gpt-4o-mini',
    ])
  })

  it('hiện cả model đã có khi tắt bộ lọc', () => {
    const ketQua = locModel(danhSach, { tuKhoa: '', chiChuaThem: false })
    expect(ketQua).toHaveLength(5)
  })

  it('tìm theo mã model, không phân biệt hoa thường', () => {
    expect(locModel(danhSach, { tuKhoa: 'CLAUDE', chiChuaThem: false }).map((m) => m.modelId)).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ])
  })

  it('tìm theo tên hiển thị', () => {
    expect(locModel(danhSach, { tuKhoa: 'flash', chiChuaThem: false }).map((m) => m.modelId)).toEqual([
      'deepseek-v4-flash',
    ])
  })

  it('nhiều từ khoá phải cùng xuất hiện, không phải chỉ một từ', () => {
    // "claude opus" phải thu hẹp còn đúng một model; nếu chỉ cần một từ khớp thì sẽ ra cả
    // opus lẫn sonnet — và đó là điều người dùng không mong đợi khi gõ hai từ.
    expect(locModel(danhSach, { tuKhoa: 'claude opus', chiChuaThem: false }).map((m) => m.modelId)).toEqual([
      'claude-opus-5-5',
    ])
  })

  it('tìm không phân biệt dấu', () => {
    expect(locModel(danhSach, { tuKhoa: 'da them', chiChuaThem: false }).map((m) => m.modelId)).toEqual([
      'da-them-roi',
    ])
  })

  it('không khớp gì thì trả mảng rỗng, không phải cả danh sách', () => {
    expect(locModel(danhSach, { tuKhoa: 'khong-co-model-nao-ten-vay', chiChuaThem: false })).toEqual([])
  })

  it('áp dụng cả lọc đã thêm lẫn từ khoá', () => {
    // "da them" khớp model đã có, nhưng bộ lọc đang ẩn model đã có → kết quả rỗng. Đây là
    // chỗ dễ hiểu nhầm thành "tìm kiếm hỏng", nên hành vi phải được ghi lại bằng test.
    expect(locModel(danhSach, { tuKhoa: 'da them', chiChuaThem: true })).toEqual([])
  })
})

describe('daoChon', () => {
  it('thêm và bỏ chọn theo mã model', () => {
    const sau = daoChon([], model('a'))
    expect(sau).toEqual(['a'])
    expect(daoChon(sau, model('a'))).toEqual([])
  })

  it('không cho chọn model đã có trong hệ thống', () => {
    expect(daoChon([], model('x', 'X', true))).toEqual([])
  })
})

describe('demDaChon', () => {
  it('đếm đúng số model đã chọn còn trong danh sách', () => {
    expect(demDaChon(danhSach, ['claude-opus-5-5', 'gpt-4o-mini'])).toBe(2)
    expect(demDaChon(danhSach, ['khong-ton-tai'])).toBe(0)
  })
})

describe('chonTatCaDangHien', () => {
  it('chỉ chọn các model ĐANG HIỆN, không chọn phần bị lọc ẩn', () => {
    // Đây là bất biến quan trọng nhất của tệp. Người dùng gõ "claude" để thu hẹp rồi bấm
    // chọn tất cả; họ mong đợi chọn 2 model đang nhìn thấy, không phải cả danh sách.
    const dangHien = locModel(danhSach, { tuKhoa: 'claude', chiChuaThem: true })
    const daChon = chonTatCaDangHien(dangHien, [])
    expect(daChon.sort()).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
    // Và tuyệt đối không kéo theo model ngoài bộ lọc.
    expect(daChon).not.toContain('gpt-4o-mini')
    expect(daChon).not.toContain('deepseek-v4-flash')
  })

  it('bấm lần hai thì bỏ chọn đúng những dòng đang hiện', () => {
    const dangHien = locModel(danhSach, { tuKhoa: 'claude', chiChuaThem: true })
    const daChon = chonTatCaDangHien(dangHien, [])
    expect(chonTatCaDangHien(dangHien, daChon)).toEqual([])
  })

  it('bỏ chọn đang hiện nhưng GIỮ lựa chọn ở phần bị lọc ẩn', () => {
    // Người dùng đã chọn hết hai model đang hiện, cộng thêm một model nằm NGOÀI bộ lọc hiện
    // tại. Bấm "bỏ chọn tất cả" phải chỉ bỏ hai model đang hiện và giữ nguyên model kia —
    // nếu xoá cả thì đó là mất lựa chọn ngoài ý muốn.
    const dangHien = locModel(danhSach, { tuKhoa: 'claude', chiChuaThem: true })
    const daChon = ['claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-4o-mini']
    const ketQua = chonTatCaDangHien(dangHien, daChon)
    expect(ketQua).toEqual(['gpt-4o-mini'])
    // Khẳng định lại điều vừa nói bằng lời: model ngoài bộ lọc vẫn còn.
    expect(ketQua).not.toContain('claude-opus-5-5')
    expect(ketQua).not.toContain('claude-sonnet-5-5')
  })

  it('không chọn model đã có trong hệ thống', () => {
    const dangHien = locModel(danhSach, { tuKhoa: 'da them', chiChuaThem: false })
    expect(chonTatCaDangHien(dangHien, [])).toEqual([])
  })

  it('danh sách đang hiện rỗng thì không đổi gì', () => {
    expect(chonTatCaDangHien([], ['san-co'])).toEqual(['san-co'])
  })
})
