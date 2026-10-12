/**
 * Bất biến mã nguồn của tính năng "Cấu hình nhanh model".
 *
 * Vì sao đọc file thay vì render: đây là các yêu cầu về cấu trúc (nút nằm ở đúng màn, dùng
 * hộp thoại dùng chung, không quay lại hộp thoại của trình duyệt, khoá dịch có đủ ở cả hai
 * ngôn ngữ). `tsc` và `vite build` không nói gì về chúng, và một lần sửa vô ý là chúng quay
 * lại. Cách kiểm này giống `settings-dialog.test.ts`.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const doc = (duongDan: string): string =>
  readFileSync(fileURLToPath(new URL(duongDan, import.meta.url)), 'utf8')

const doiAgent = doc('../src/screens/DoiAgent.tsx')
const hopThoaiNhanh = doc('../src/components/HopThoaiCauHinhNhanhModel.tsx')
const helper = doc('../src/lib/team-quick-model.ts')
const viTeam = doc('../../../packages/i18n/src/catalogs/vi/team.ts')
const enTeam = doc('../../../packages/i18n/src/catalogs/en/team.ts')

describe('màn Đội agent có nút cấu hình nhanh', () => {
  it('dùng nút mở hộp thoại và render hộp thoại dùng chung', () => {
    expect(doiAgent).toMatch(/from '\.\.\/components\/HopThoaiCauHinhNhanhModel\.tsx'/)
    expect(doiAgent).toMatch(/<HopThoaiCauHinhNhanhModel/)
    expect(doiAgent).toContain("t('team.quickOpen')")
  })

  it('lưu xong thì tải lại dữ liệu để bảng phản ánh trạng thái thật', () => {
    // `onKetThuc` phải gọi `taiLai()`: một phần lưu có thể lỗi, và người dùng cần thấy đúng
    // agent nào đã nhận model mới.
    const khoi = doiAgent.slice(doiAgent.indexOf('<HopThoaiCauHinhNhanhModel'))
    expect(khoi).toContain('taiLai()')
  })
})

describe('hộp thoại cấu hình nhanh', () => {
  it('dùng HopThoai dùng chung, không dùng hộp thoại trình duyệt', () => {
    expect(hopThoaiNhanh).toMatch(/from '\.\/HopThoai\.tsx'/)
    expect(hopThoaiNhanh).toMatch(/<HopThoai/)
    expect(hopThoaiNhanh).not.toContain('window.confirm(')
    expect(hopThoaiNhanh).not.toContain('window.alert(')
  })

  it('dùng hàm thuần ở lib thay vì tự tính trong JSX', () => {
    expect(hopThoaiNhanh).toMatch(/from '\.\.\/lib\/team-quick-model\.ts'/)
    expect(hopThoaiNhanh).toContain('thanhCapNhat(')
    expect(hopThoaiNhanh).toContain('ganModelChinhTheoTier(')
  })

  it('gửi song song và không để một agent lỗi chặn các agent khác', () => {
    expect(hopThoaiNhanh).toContain('Promise.allSettled')
  })
})

describe('quy tắc lưu chỉ đụng tới trường model', () => {
  it('payload không chứa kỹ năng, tool, quyền kiến thức hay bật/tắt', () => {
    // Bất biến quan trọng nhất của tệp helper: cấu hình nhanh không được ghi đè cấu hình
    // riêng mà người dùng đã chỉnh trong từng thẻ agent.
    const khoi = helper.slice(helper.indexOf('export function thanhCapNhat'))
    expect(khoi).not.toContain('skills')
    expect(khoi).not.toContain('tools')
    expect(khoi).not.toContain('knowledge')
    expect(khoi).not.toContain('enabled')
  })
})

describe('khoá dịch của cấu hình nhanh', () => {
  it('mọi khoá team.quick* dùng trong component đều có ở cả vi và en', () => {
    const khoa = [...new Set(hopThoaiNhanh.match(/team\.quick[A-Za-z]+/g) ?? [])]
    expect(khoa.length).toBeGreaterThan(10)
    for (const key of khoa) {
      expect(viTeam, `thiếu ở vi: ${key}`).toContain(`'${key}':`)
      expect(enTeam, `thiếu ở en: ${key}`).toContain(`'${key}':`)
    }
  })

  it('khoá nút mở ở màn Đội agent cũng có đủ hai ngôn ngữ', () => {
    expect(viTeam).toContain("'team.quickOpen':")
    expect(enTeam).toContain("'team.quickOpen':")
  })
})
