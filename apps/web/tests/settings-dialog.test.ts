/**
 * Bất biến mã nguồn của màn Cài đặt sau khi tối ưu giao diện.
 *
 * Vì sao test đọc file thay vì render: đây là những yêu cầu về "giao diện đã gọn chưa" và
 * "còn hộp thoại mặc định của trình duyệt không" — `tsc` và `vite build` đều không nói gì
 * về chúng, và một lần sửa vô ý là chúng quay lại. Kiểm bằng cách đọc mã là cách duy nhất
 * bắt được mà không cần trình duyệt thật.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const doc = (duongDan: string): string =>
  readFileSync(fileURLToPath(new URL(duongDan, import.meta.url)), 'utf8')

const caiDat = doc('../src/screens/CaiDat.tsx')
const ui = doc('../src/components/ui.tsx')
const hopThoai = doc('../src/components/HopThoai.tsx')

describe('màn Cài đặt dùng hộp thoại thay hộp thoại trình duyệt', () => {
  it('không còn window.confirm hay window.alert', () => {
    // Hộp thoại của trình duyệt khoá cả tab, không style được, không dịch được theo ngôn ngữ
    // giao diện, và chặn mọi thứ khác đang chạy. Đã thay bằng HopThoaiXacNhan.
    expect(caiDat).not.toContain('window.confirm(')
    expect(caiDat).not.toContain('window.alert(')
  })

  it('có dùng component hộp thoại dùng chung', () => {
    expect(caiDat).toMatch(/from '\.\.\/components\/HopThoai\.tsx'/)
    expect(caiDat).toMatch(/<HopThoai/)
  })
})

describe('hộp thoại dùng chung', () => {
  it('dùng <dialog> gốc để có sẵn Esc, lớp phủ và bẫy tiêu điểm', () => {
    expect(hopThoai).toMatch(/<dialog/)
  })

  it('kiểm tra dialog.open trước khi gọi showModal', () => {
    // Gọi `showModal()` trên hộp thoại đã mở là lỗi runtime, không phải cảnh báo. Đây là
    // chi tiết dễ sai nhất khi bọc `<dialog>` trong React.
    expect(hopThoai).toMatch(/!dialog\.open\)\s*dialog\.showModal\(\)/)
  })

  it('khoá cuộn trang khi mở và khôi phục khi đóng', () => {
    // `<dialog>` chặn tương tác nhưng KHÔNG chặn cuộn trang nền.
    expect(hopThoai).toMatch(/document\.body\.style\.overflow\s*=\s*'hidden'/)
    expect(hopThoai).toMatch(/document\.body\.style\.overflow\s*=\s*truoc/)
  })

  it('gắn tiêu đề với hộp thoại để trình đọc màn hình đọc đúng', () => {
    expect(hopThoai).toMatch(/aria-labelledby=\{titleId\}/)
    expect(hopThoai).toMatch(/id=\{titleId\}/)
  })

  it('lắng nghe sự kiện close để bắt cả trường hợp Esc', () => {
    expect(hopThoai).toMatch(/onClose=\{onDong\}/)
  })
})

describe('không còn helper định dạng cứng tiếng Việt', () => {
  it('ui.tsx đã bỏ tienUsd / soNguyen / thoiDiem', () => {
    // Ba hàm này hard-code `toLocaleString('vi-VN')`, đã được thay bằng `formatCurrencyUsd`,
    // `formatNumber`, `formatDateTime` theo ngôn ngữ đang chọn trong `useI18n`.
    for (const ten of ['tienUsd', 'soNguyen', 'thoiDiem']) {
      expect(ui, `ui.tsx còn ${ten}`).not.toContain(ten)
    }
  })
})

describe('bố cục mục Nhà cung cấp', () => {
  it('form không còn luôn hiện: nó nằm trong hộp thoại', () => {
    // Trước đây khối form là con trực tiếp của Card nên luôn hiện, làm màn nặng và rối.
    // Bất biến: trong mục Nhà cung cấp phải có một HopThoai chứa phần nhập liệu.
    const phanNhaCungCap = caiDat.slice(
      caiDat.indexOf('function PhanNhaCungCap'),
      caiDat.indexOf('function PhanKhoaProvider'),
    )
    expect(phanNhaCungCap.length).toBeGreaterThan(0)
    expect(phanNhaCungCap).toMatch(/<HopThoai/)
    expect(phanNhaCungCap).toMatch(/xuLyDong|onDong/)
  })
})

describe('catalog không còn khoá chết', () => {
  /**
   * Vì sao kiểm cả catalog: khi khối fetch model cũ trong bảng khoá bị thay bằng hộp thoại,
   * 13 khoá `settings.providers.fetch.*` trở nên không còn nơi dùng. Khoá chết không gây lỗi
   * biên dịch (union khoá chỉ lớn hơn), nên chúng nằm lại rất lâu và làm người sửa sau tưởng
   * còn hai nơi làm cùng một việc.
   */
  const vi = doc('../../../packages/i18n/src/catalogs/vi/settings.ts')
  const en = doc('../../../packages/i18n/src/catalogs/en/settings.ts')

  it('không còn khoá settings.providers.fetch.*', () => {
    // Chỉ còn lại trong comment giải thích; khẳng định không có khai báo khoá thật.
    expect(vi).not.toMatch(/^\s*'settings\.providers\.fetch\./m)
    expect(en).not.toMatch(/^\s*'settings\.providers\.fetch\./m)
  })

  it('có đúng một bộ khoá cho việc lấy model', () => {
    expect(vi).toMatch(/'settings\.models\.fetch\.open'/)
    expect(en).toMatch(/'settings\.models\.fetch\.open'/)
  })
})
