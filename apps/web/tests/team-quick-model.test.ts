/**
 * Test quy tắc của "Cấu hình nhanh model".
 *
 * Trọng tâm là hai bất biến dễ vỡ nhất: gán theo tier KHÔNG được đụng tới tier để trống, và
 * lưu CHỈ gửi những agent thay đổi, chỉ với trường model. Một lỗi ở đây làm mất cấu hình của
 * người dùng trên diện rộng nên phải khoá bằng test.
 */
import { describe, expect, it } from 'vitest'
import type { AgentRole, TeamMemberView } from '@marketing-agent/shared'
import {
  cungDanhSach,
  dsVaiTroThayDoi,
  ganModelChinhTatCa,
  ganModelChinhTheoTier,
  taoBanNhapNhanh,
  thanhCapNhat,
  themDuPhongTatCa,
} from '../src/lib/team-quick-model.ts'

function member(role: string, over: Partial<TeamMemberView> = {}): TeamMemberView {
  return {
    agentDefId: `def-${role}`,
    role: role as AgentRole,
    name: role,
    displayName: role,
    description: '',
    enabled: true,
    isLeader: false,
    tier: 'standard',
    modelFk: null,
    modelId: null,
    modelLabel: null,
    providerName: null,
    fallbackModelFks: [],
    reasoningEffort: null,
    maxTokens: null,
    contextBudgetTokens: 60_000,
    requireApproval: true,
    skills: [],
    tools: [],
    knowledge: [],
    ...over,
  }
}

const doi: readonly TeamMemberView[] = [
  member('marketing-leader', { tier: 'deep', modelFk: 'm-pro' }),
  member('content-writer', { tier: 'standard', modelFk: 'm-flash', fallbackModelFks: ['m-old'] }),
  member('social-media', { tier: 'light' }),
]

describe('taoBanNhapNhanh', () => {
  it('đổi modelFk null thành chuỗi rỗng để <select> dùng được', () => {
    const banNhap = taoBanNhapNhanh(doi)
    expect(banNhap['marketing-leader']?.modelFk).toBe('m-pro')
    expect(banNhap['social-media']?.modelFk).toBe('')
  })

  it('sao chép danh sách dự phòng, không dùng chung mảng với server', () => {
    const goc = [member('a', { fallbackModelFks: ['m-old'] })]
    const banNhap = taoBanNhapNhanh(goc)
    // Sửa mảng của "server" sau khi đã tạo bản nháp: bản nháp phải không đổi.
    ;(goc[0]?.fallbackModelFks as string[]).push('m-ngoai')
    expect(banNhap['a']?.fallbackModelFks).toEqual(['m-old'])
  })
})

describe('ganModelChinhTatCa', () => {
  it('gán model cho mọi agent, giữ nguyên dự phòng', () => {
    const banNhap = ganModelChinhTatCa(taoBanNhapNhanh(doi), 'm-moi')
    expect(Object.values(banNhap).every((entry) => entry.modelFk === 'm-moi')).toBe(true)
    expect(banNhap['content-writer']?.fallbackModelFks).toEqual(['m-old'])
  })

  it('model rỗng là thao tác vô nghĩa nên trả nguyên trạng', () => {
    const truoc = taoBanNhapNhanh(doi)
    expect(ganModelChinhTatCa(truoc, '')).toBe(truoc)
  })
})

describe('ganModelChinhTheoTier', () => {
  it('chỉ đổi agent thuộc tier có chọn model', () => {
    const banNhap = ganModelChinhTheoTier(doi, taoBanNhapNhanh(doi), {
      light: '',
      standard: 'm-standard',
      deep: 'm-deep',
    })
    expect(banNhap['marketing-leader']?.modelFk).toBe('m-deep')
    expect(banNhap['content-writer']?.modelFk).toBe('m-standard')
    expect(banNhap['social-media']?.modelFk).toBe('')
  })

  it('tier để trống KHÔNG xoá model của agent thuộc tier đó', () => {
    const truoc = taoBanNhapNhanh(doi)
    const sau = ganModelChinhTheoTier(doi, truoc, { light: '', standard: '', deep: 'm-deep' })
    // light để trống: social-media giữ nguyên '' và content-writer giữ m-flash.
    expect(sau['social-media']?.modelFk).toBe('')
    expect(sau['content-writer']?.modelFk).toBe('m-flash')
    expect(sau['marketing-leader']?.modelFk).toBe('m-deep')
  })

  it('không có gì đổi thì trả nguyên tham chiếu', () => {
    const truoc = taoBanNhapNhanh(doi)
    expect(ganModelChinhTheoTier(doi, truoc, { light: '', standard: '', deep: '' })).toBe(truoc)
  })
})

describe('themDuPhongTatCa', () => {
  it('thêm vào cuối danh sách của mọi agent', () => {
    const sau = themDuPhongTatCa(taoBanNhapNhanh(doi), 'm-fb')
    expect(sau['marketing-leader']?.fallbackModelFks).toEqual(['m-fb'])
    expect(sau['content-writer']?.fallbackModelFks).toEqual(['m-old', 'm-fb'])
    expect(sau['social-media']?.fallbackModelFks).toEqual(['m-fb'])
  })

  it('bỏ qua agent đã có model đó', () => {
    const truoc = taoBanNhapNhanh([member('a', { fallbackModelFks: ['m-fb'] })])
    expect(themDuPhongTatCa(truoc, 'm-fb')).toBe(truoc)
  })

  it('không vượt quá 5 model dự phòng', () => {
    const truoc = taoBanNhapNhanh([member('a', { fallbackModelFks: ['1', '2', '3', '4', '5'] })])
    expect(themDuPhongTatCa(truoc, 'm-moi')).toBe(truoc)
    const bon = taoBanNhapNhanh([member('a', { fallbackModelFks: ['1', '2', '3', '4'] })])
    expect(themDuPhongTatCa(bon, 'm-moi')['a']?.fallbackModelFks).toEqual(['1', '2', '3', '4', 'm-moi'])
  })

  it('model rỗng trả nguyên trạng', () => {
    const truoc = taoBanNhapNhanh(doi)
    expect(themDuPhongTatCa(truoc, '')).toBe(truoc)
  })
})

describe('dsVaiTroThayDoi và thanhCapNhat', () => {
  it('không đổi gì thì không vai trò nào bị coi là thay đổi', () => {
    const banNhap = taoBanNhapNhanh(doi)
    expect(dsVaiTroThayDoi(doi, banNhap)).toEqual([])
    expect(thanhCapNhat(doi, banNhap)).toEqual([])
  })

  it('bắt thay đổi model chính và dự phòng, kể cả đổi thứ tự dự phòng', () => {
    const banNhap = ganModelChinhTatCa(taoBanNhapNhanh(doi), 'm-moi')
    expect(dsVaiTroThayDoi(doi, banNhap).sort()).toEqual(['content-writer', 'marketing-leader', 'social-media'])

    const doiThuTu = {
      ...taoBanNhapNhanh([member('a', { fallbackModelFks: ['1', '2'] })]),
      a: { modelFk: '', fallbackModelFks: ['2', '1'] },
    }
    expect(dsVaiTroThayDoi([member('a', { fallbackModelFks: ['1', '2'] })], doiThuTu)).toEqual(['a'])
  })

  it('bỏ model chính thì gửi null, và chỉ kèm dự phòng khi dự phòng đổi', () => {
    const goc = [member('a', { modelFk: 'm-cu' })]
    const chiDoiModel = { ...taoBanNhapNhanh(goc), a: { modelFk: '', fallbackModelFks: [] } }
    expect(thanhCapNhat(goc, chiDoiModel)).toEqual([{ role: 'a', modelFk: null }])

    const doiCaHai = { ...taoBanNhapNhanh(goc), a: { modelFk: 'm-moi', fallbackModelFks: ['x'] } }
    expect(thanhCapNhat(goc, doiCaHai)).toEqual([
      { role: 'a', modelFk: 'm-moi', fallbackModelFks: ['x'] },
    ])
  })
})

describe('cungDanhSach', () => {
  it('so sánh theo nội dung và thứ tự', () => {
    expect(cungDanhSach([], [])).toBe(true)
    expect(cungDanhSach(['a'], ['a'])).toBe(true)
    expect(cungDanhSach(['a'], ['b'])).toBe(false)
    expect(cungDanhSach(['a', 'b'], ['b', 'a'])).toBe(false)
    expect(cungDanhSach(['a'], ['a', 'b'])).toBe(false)
  })
})
