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
/** Catalog i18n của mục Cài đặt, đọc một lần ở cấp module cho mọi khối test dùng chung. */
const vi = doc('../../../packages/i18n/src/catalogs/vi/settings.ts')
const en = doc('../../../packages/i18n/src/catalogs/en/settings.ts')

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

describe('mục Kết nối: chỉ mở biểu mẫu từ nút thêm', () => {
  const ketNoi = caiDat.slice(caiDat.indexOf('function PhanKetNoi'), caiDat.indexOf('function PhanGioiHan'))

  it('mặc định đóng và có nút mở cạnh tiêu đề', () => {
    expect(ketNoi).toContain('[moThemKetNoi, setMoThemKetNoi] = useState(false)')
    expect(ketNoi).toContain('onClick={moKetNoiMoi}')
    expect(ketNoi).toContain("t('settings.integrations.add')")
    expect(vi).toContain("'settings.integrations.add': 'Thêm kết nối'")
    expect(en).toContain("'settings.integrations.add': 'Add integration'")
  })

  it('các trường nhập nằm trong HopThoai, không hiển thị dưới bảng', () => {
    const start = ketNoi.indexOf('<HopThoai\n')
    const end = ketNoi.indexOf('</HopThoai>', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    for (const field of ['value={kind}', 'value={ten}', 'value={configJson}', '{loiLuu ? <ThongBao']) {
      const position = ketNoi.indexOf(field)
      expect(position, field).toBeGreaterThan(start)
      expect(position, field).toBeLessThan(end)
    }
    expect(ketNoi).toContain('onDong={dongHopThoaiKetNoi}')
  })

  it('đóng và mở đều đặt lại nháp, giữ cấu hình bí mật khỏi lần mở sau', () => {
    const reset = ketNoi.slice(ketNoi.indexOf('function xoaBieuMauKetNoi'), ketNoi.indexOf('function dongHopThoaiKetNoi'))
    expect(reset).toContain("setKind('firecrawl')")
    expect(reset).toContain("setTen('')")
    expect(reset).toContain("setConfigJson('{}')")
    expect(reset).toContain("setFirecrawlKey('')")
    expect(reset).toContain("setFirecrawlUrl('')")
    expect(reset).toContain('setLoiLuu(null)')
    const close = ketNoi.slice(ketNoi.indexOf('function dongHopThoaiKetNoi'), ketNoi.indexOf('function moKetNoiMoi'))
    expect(close).toContain('xoaBieuMauKetNoi()')
    const open = ketNoi.slice(ketNoi.indexOf('function moKetNoiMoi'), ketNoi.indexOf('useEffect'))
    expect(open).toContain('xoaBieuMauKetNoi()')
  })

  it('Firecrawl có nhánh riêng chỉ cần key, JSON vẫn dành cho dịch vụ khác', () => {
    expect(ketNoi).toContain("{kind === 'firecrawl' ? (")
    expect(ketNoi).toContain('type="password" visibilityResetKey={moThemKetNoi} value={firecrawlKey}')
    expect(ketNoi).toContain('buildFirecrawlConfig(firecrawlKey, firecrawlUrl)')
    expect(ketNoi).toContain('firecrawlConnectionName(ten)')
    expect(ketNoi).toContain('onChange={doiLoaiKetNoi}')
  })

  it('giữ kiểm tra tên và JSON, chỉ đóng sau khi API lưu thành công', () => {
    const save = ketNoi.slice(ketNoi.indexOf('async function luu'), ketNoi.indexOf('async function test'))
    expect(save).toContain("t('settings.integrations.needName')")
    expect(save).toContain('JSON.parse(configJson)')
    expect(save).toContain('Array.isArray(parsed)')
    expect(save.indexOf('dongHopThoaiKetNoi()')).toBeGreaterThan(save.indexOf('await api.upsertIntegration'))
    const error = save.slice(save.indexOf('catch (error)'), save.indexOf('finally'))
    expect(error).not.toContain('dongHopThoaiKetNoi()')
    expect(error).toContain('if (hopKetNoiMoRef.current) setLoiLuu(message)')
    expect(error).toContain('else setLoiNgoaiHop(message)')
  })

  it('không mở lượt mới khi đang lưu và bỏ phản hồi của công ty cũ', () => {
    expect(ketNoi).toContain('if (dangLuuKetNoiRef.current) return')
    expect(ketNoi).toContain('onClick={moKetNoiMoi} disabled={dangLuu}')
    expect(ketNoi).toContain('companyId === congTyKetNoiRef.current')
    expect(ketNoi).toContain('luotLuu === luotKetNoiRef.current')
    expect(ketNoi).toContain('if (!vanDungNguCanh()) return')
    expect(ketNoi).toContain('luotKetNoiRef.current += 1')
  })

  it('giữ nút kiểm tra kết nối và hướng dẫn không nhắc form bên dưới', () => {
    expect(ketNoi).toContain('await api.testIntegration(companyId, integration.id)')
    expect(ketNoi).toContain("t('settings.integrations.test')")
    expect(vi).not.toContain('Thêm kết nối bằng biểu mẫu bên dưới')
    expect(en).not.toContain('No integrations yet. Add one below')
  })
})

describe('mục Model: biểu mẫu nhập tay nằm trong hộp thoại', () => {
  /**
   * Vì sao kiểm bằng cách đọc mã: yêu cầu là "biểu mẫu chỉ hiện sau khi bấm nút". `tsc` và
   * `vite build` đều không nói gì về việc một khối JSX quay lại vị trí tĩnh, và một lần sửa
   * vô ý là biểu mẫu lại luôn hiện — đúng thứ người dùng vừa yêu cầu bỏ đi.
   */
  const phanModel = caiDat.slice(caiDat.indexOf('function PhanModel'))

  it('biểu mẫu nằm giữa cặp thẻ HopThoai, không phải ở vị trí tĩnh', () => {
    // Mốc văn bản thay vì regex nhiều dòng: regex tham lam đã gây hỏng file nhiều lần trong
    // dự án này, nên ở đây chỉ so sánh thứ tự chỉ số.
    const moDau = phanModel.indexOf('<HopThoai\n')
    expect(moDau, 'thiếu HopThoai bao biểu mẫu').toBeGreaterThan(-1)

    const viTriNhapModel = phanModel.indexOf('settings.models.form.modelIdPlaceholder')
    expect(viTriNhapModel, 'thiếu ô nhập mã model').toBeGreaterThan(moDau)

    // Thẻ đóng của hộp thoại phải nằm SAU ô nhập — nếu không, biểu mẫu đã bị đẩy ra ngoài.
    const dongThe = phanModel.indexOf('</HopThoai>', moDau)
    expect(dongThe).toBeGreaterThan(viTriNhapModel)
  })

  it('có nút mở hộp thoại dùng khoá riêng của nút', () => {
    // Nhãn nút tách khỏi tiêu đề hộp thoại, cùng lý do đã tách cho nhà cung cấp.
    expect(caiDat).toMatch(/t\('settings\.models\.add'\)/)
    expect(caiDat).toMatch(/'settings\.models\.add'/)
    expect(vi).toMatch(/'settings\.models\.add'/)
    expect(en).toMatch(/'settings\.models\.add'/)
  })

  it('mở và đóng hộp thoại đều đi qua hàm xoá biểu mẫu', () => {
    // Mở mà không xoá thì hiện dữ liệu lần trước; đóng mà không xoá thì lần sau bấm nút
    // người dùng thấy nguyên biểu mẫu cũ và rất dễ gửi nhầm.
    expect(phanModel).toMatch(/function moThemModelMoi\(\): void \{/)
    expect(phanModel).toMatch(/function dongHopThoaiModel\(\): void \{/)
    const thanDong = phanModel.slice(
      phanModel.indexOf('function dongHopThoaiModel'),
      phanModel.indexOf('function moThemModelMoi'),
    )
    expect(thanDong).toMatch(/xoaBieuMauModel\(\)/)
    const thanMo = phanModel.slice(phanModel.indexOf('function moThemModelMoi'))
    expect(thanMo.slice(0, 200)).toMatch(/xoaBieuMauModel\(\)/)
  })

  it('lưu thành công thì đóng hộp thoại', () => {
    const thanLuu = phanModel.slice(phanModel.indexOf('async function luu()'), phanModel.indexOf('async function xoaModel()'))
    expect(thanLuu).toMatch(/dongHopThoaiModel\(\)/)
  })

  it('lỗi của biểu mẫu hiện trong hộp thoại, lỗi xoá hiện ở đầu mục', () => {
    // Hai loại lỗi khác ngữ cảnh nên phải hiện ở hai chỗ: để lỗi biểu mẫu ở đầu mục thì bị
    // lớp phủ che khi hộp thoại mở; để lỗi xoá trong hộp thoại thì không ai thấy vì hộp thoại
    // đã đóng. Đoạn "đầu mục" là phần JSX TRƯỚC hộp thoại đầu tiên.
    const viTriHopThoaiDauTien = phanModel.indexOf('<HopThoai')
    expect(viTriHopThoaiDauTien).toBeGreaterThan(-1)
    const phanDauMuc = phanModel.slice(0, viTriHopThoaiDauTien)

    expect(phanDauMuc).toMatch(/\{loiXoa \? \(/)
    expect(phanDauMuc).not.toMatch(/\{loiLuu \? \(/)
    // Và lỗi biểu mẫu phải nằm trong hộp thoại.
    expect(phanModel).toMatch(/\{loiLuu \? <ThongBao loai="loi">/)
  })
})
