/**
 * Test bất biến bố cục của màn Trao đổi với Leader.
 *
 * Vì sao test đọc file CSS thay vì render giao diện: lỗi đang sửa là lỗi BỐ CỤC — khung
 * nhập tin bị đẩy ra ngoài màn hình vì `.chat` trông vào một hằng số `calc(100vh - 150px)`
 * không khớp chiều cao thật của phần đầu trang. Không test chức năng nào bắt được lỗi đó:
 * mọi thứ vẫn "chạy đúng", chỉ có điều người dùng không nhìn thấy ô nhập. Một phép kiểm
 * trên chính các quy tắc CSS là cách duy nhất bắt được nó mà không cần trình duyệt thật.
 *
 * Các bất biến ở đây suy ra trực tiếp từ yêu cầu:
 *  - khung chat nhận hết chiều cao còn lại (`flex: 1`) và được phép co lại (`min-height: 0`);
 *  - chỉ có MỘT vùng cuộn là khung tin nhắn;
 *  - khung nhập cao tối đa 30% chiều cao màn hình và không kéo giãn bằng tay;
 *  - nhánh màn hình hẹp không được đặt lại `height: auto` cho khung chat.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * CSS đã bỏ chú thích.
 *
 * Phải bỏ trước khi phân tích: chú thích nằm ngay trước một quy tắc sẽ dính vào phần
 * selector, làm phép so khớp trượt — đúng cái bẫy đã làm test này đỏ lần đầu.
 */
const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

/**
 * Lấy thân của tất cả quy tắc khớp `selector` (không tính media query).
 *
 * Không dùng regex DOTALL trên toàn file vì lần trước chính kiểu đó đã xoá oan mã nguồn;
 * ở đây ta duyệt từng khối `selector { ... }` ở cấp cao nhất bằng bộ đếm ngoặc.
 */
function ruleBodies(selector: string): string[] {
  const bodies: string[] = []
  // Không dùng regex DOTALL trên toàn file vì lần trước chính kiểu đó đã xoá oan mã nguồn;
  // ở đây tìm vị trí mở ngoặc rồi đếm ngoặc để lấy đúng thân khối.
  let from = 0
  while (true) {
    const open = css.indexOf('{', from)
    if (open < 0) break
    const selectorText = css.slice(css.lastIndexOf('}', open) + 1, open)
    // So khớp theo từng selector trong danh sách phân tách bằng dấu phẩy: quy tắc gộp
    // như `.hoi__pa, .hoi__pa:hover` phải được nhận là có chứa `.hoi__pa`.
    const matches = selectorText
      .split(',')
      .some((part) => part.trim().replace(/\s+/g, ' ') === selector.replace(/\s+/g, ' '))
    let depth = 1
    let index = open + 1
    while (index < css.length && depth > 0) {
      if (css[index] === '{') depth += 1
      else if (css[index] === '}') depth -= 1
      index += 1
    }
    if (matches) bodies.push(css.slice(open + 1, index - 1))
    from = index
  }
  return bodies
}

/**
 * Chỉ lấy các khối quy tắc nằm NGOÀI mọi @media.
 *
 * Cần tách vì một quy tắc cùng tên có thể tồn tại ở cả hai nơi; phép kiểm cấp cao nhất
 * phải chỉ soi bản ngoài @media, còn nhánh màn hình hẹp được kiểm riêng.
 */
function topLevelBodies(selector: string): string[] {
  const ranges: { start: number; end: number }[] = []
  const marker = /@media[^{]*\{/g
  let match: RegExpExecArray | null
  while ((match = marker.exec(css)) !== null) {
    let depth = 1
    let index = marker.lastIndex
    while (index < css.length && depth > 0) {
      if (css[index] === '{') depth += 1
      else if (css[index] === '}') depth -= 1
      index += 1
    }
    ranges.push({ start: match.index, end: index })
    marker.lastIndex = index
  }
  return ruleBodies(selector).filter((body) => {
    const at = css.indexOf(body)
    return at >= 0 && !ranges.some((range) => at >= range.start && at < range.end)
  })
}

/** Gộp mọi khai báo của một selector, để chỉ cần khẳng định một lần. */
function declarations(selector: string): string {
  return ruleBodies(selector).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Lấy thân của khối `@media (...) { ... }` đầu tiên khớp điều kiện. */
function mediaBody(condition: string): string {
  const index = css.indexOf(condition)
  if (index < 0) return ''
  const open = css.indexOf('{', index)
  let depth = 1
  let cursor = open + 1
  while (cursor < css.length && depth > 0) {
    if (css[cursor] === '{') depth += 1
    else if (css[cursor] === '}') depth -= 1
    cursor += 1
  }
  return css.slice(open + 1, cursor - 1)
}

describe('bố cục khung chat', () => {
  it('khung chat nhận hết chiều cao còn lại và được phép co lại', () => {
    const chat = declarations('.chat')
    // `flex: 1` để nhận chỗ trống; thiếu nó thì khung chat chỉ cao bằng nội dung.
    expect(chat).toMatch(/flex:\s*1/)
    // `min-height: 0` là điều kiện bắt buộc để mục flex được phép nhỏ hơn nội dung. Thiếu
    // dòng này thì khung chat cao theo số tin nhắn và đẩy khung nhập ra ngoài màn hình —
    // đúng lỗi đang sửa, nên đây là khẳng định quan trọng nhất của file này.
    expect(chat).toMatch(/min-height:\s*0/)
  })

  it('không còn trông vào hằng số chiều cao màn hình', () => {
    // `calc(100vh - 150px)` là nguyên nhân gốc: hằng số 150px không khớp chiều cao thật
    // của phần đầu trang, nên khung chat tràn khỏi vùng nhìn thấy.
    expect(declarations('.chat')).not.toContain('100vh')
  })

  it('khung tin nhắn là vùng cuộn duy nhất', () => {
    const khung = declarations('.chat__khung')
    expect(khung).toMatch(/overflow-y:\s*auto/)
    expect(khung).toMatch(/flex:\s*1/)
    expect(khung).toMatch(/min-height:\s*0/)
  })

  it('khoá cuộn trang ở màn cao-đầy-đủ, để không có hai vùng cuộn', () => {
    expect(declarations('.app__main--cao-day')).toMatch(/overflow:\s*hidden/)
  })

  it('thẻ bao khung chat giãn hết chiều cao còn lại', () => {
    expect(declarations('.the--cao-day > .card')).toMatch(/flex:\s*1/)
    expect(declarations('.the--cao-day > .card')).toMatch(/min-height:\s*0/)
  })

  it('khung nhập cao tối đa 30% chiều cao màn hình', () => {
    const nhap = topLevelBodies('.chat__nhap textarea').join('\n')
    // `min(30dvh, 22rem)` là yêu cầu trực tiếp của người dùng. `dvh` để đúng khi thanh
    // địa chỉ trên di động hiện/ẩn, và `22rem` là trần để trên màn hình rất cao khung
    // nhập không chiếm quá nửa chỗ đọc tin.
    expect(nhap).toMatch(/max-height:\s*min\(\s*30dvh\s*,/)
    // `vh` đứng trước làm bản dự phòng cho trình duyệt chưa hỗ trợ `dvh`.
    expect(nhap).toMatch(/max-height:\s*min\(\s*30vh\s*,/)
    // Thứ tự khai báo: bản `vh` phải TRƯỚC bản `dvh`, nếu không trình duyệt cũ sẽ dùng
    // nhầm bản `dvh` mà nó không hiểu và mất luôn giới hạn chiều cao.
    expect(nhap.indexOf('30vh')).toBeLessThan(nhap.indexOf('30dvh'))
  })

  it('không cho kéo tay khung nhập vượt giới hạn', () => {
    // `resize: vertical` cho phép người dùng kéo khung nhập cao tuỳ ý, che mất vùng đọc.
    expect(topLevelBodies('.chat__nhap textarea').join('\n')).toMatch(/resize:\s*none/)
  })

  it('khung nhập không co lại khi khung tin nhắn dài ra', () => {
    expect(declarations('.chat__nhap')).toMatch(/flex:\s*0\s+0\s+auto/)
  })

  it('nhánh màn hình hẹp vẫn giữ khung cuộn cố định', () => {
    // Soi TRỰC TIẾP khối @media hẹp, không suy qua vị trí: trước đây nhánh này đặt
    // `.chat { height: auto; min-height: 60vh }`, làm mất khung cuộn cố định và khung
    // nhập lại bị đẩy khỏi màn hình. Dùng indexOf + đếm ngoặc để lấy đúng khối.
    const marker = '@media (max-width: 860px)'
    const start = css.indexOf(marker)
    expect(start, 'thiếu nhánh @media hẹp').toBeGreaterThanOrEqual(0)
    const open = css.indexOf('{', start)
    let depth = 1
    let index = open + 1
    while (index < css.length && depth > 0) {
      if (css[index] === '{') depth += 1
      else if (css[index] === '}') depth -= 1
      index += 1
    }
    const media = css.slice(open + 1, index - 1)
    const chatRule = /\.chat\s*\{([^}]*)\}/.exec(media)
    expect(chatRule, 'nhánh hẹp phải có quy tắc .chat').not.toBeNull()
    const body = chatRule?.[1] ?? ''
    expect(body).not.toMatch(/height:\s*auto/)
    // Phải giữ được khả năng co lại, nếu không khung chat cao theo nội dung.
    expect(body).toMatch(/min-height:\s*0/)
  })
})

describe('CSS thẻ chọn phương án', () => {
  it('có đủ lớp cho thẻ chọn và trạng thái đã trả lời', () => {
    for (const selector of ['.hoi', '.hoi__cau', '.hoi__pa', '.hoi__pa.is-chon', '.hoi__khac', '.hoi--xong']) {
      expect(ruleBodies(selector).length, `thiếu quy tắc ${selector}`).toBeGreaterThan(0)
    }
  })

  it('phương án đã chọn có dấu hiệu thị giác rõ ràng', () => {
    // Trạng thái chọn phải khác biệt cả viền lẫn nền, không chỉ đổi màu chữ: người dùng
    // phải nhìn ra mình đã chọn gì khi có nhiều phương án gần giống nhau.
    const chon = declarations('.hoi__pa.is-chon')
    expect(chon).toMatch(/border-color/)
    expect(chon).toMatch(/background/)
  })
})

/**
 * Bất biến cấu trúc JSX của màn Trao đổi.
 *
 * Vì sao kiểm cả mã nguồn chứ không chỉ CSS: CSS chỉ đúng khi cây phần tử đúng. Một lần
 * sửa bố cục vô ý lồng `.chat` vào trong một `div` khác, hoặc chuyển phần đầu vào cùng
 * thẻ với khung chat, là đủ để khung nhập bị đẩy khỏi màn hình trở lại — mà `tsc` và
 * `vite build` đều không nói gì.
 */
const traoDoi = readFileSync(fileURLToPath(new URL('../src/screens/TraoDoi.tsx', import.meta.url)), 'utf8')

describe('cấu trúc màn Trao đổi', () => {
  it('dùng chế độ cao đầy đủ', () => {
    expect(traoDoi).toMatch(/<Trang[^>]*caoDay/)
  })

  it('khung chat nằm trong thẻ chat, và thẻ chat là .card con trực tiếp', () => {
    // Thẻ chat phải là `.card` và chứa `.chat`; thứ tự xuất hiện trong file chứng minh
    // điều đó vì JSX lồng nhau theo thứ tự.
    const cardIndex = traoDoi.indexOf('<div className="card"')
    const thanIndex = traoDoi.indexOf('className="chat__than"')
    const chatIndex = traoDoi.indexOf('className="chat"')
    const khungIndex = traoDoi.indexOf('className="chat__khung"')
    const nhapIndex = traoDoi.indexOf('className="chat__nhap"')
    expect(cardIndex).toBeGreaterThan(-1)
    // `.chat__than` là lớp bọc mới; nếu nó biến mất thì `min-height: 0` của nó cũng mất và
    // khung chat sẽ cao theo nội dung, đẩy khung nhập ra ngoài màn hình.
    expect(thanIndex).toBeGreaterThan(cardIndex)
    expect(chatIndex).toBeGreaterThan(thanIndex)
    expect(khungIndex).toBeGreaterThan(chatIndex)
    expect(nhapIndex).toBeGreaterThan(khungIndex)
  })

  it('phần đầu màn hình KHÔNG nằm trong thẻ chứa khung chat', () => {
    // Ba nút điều khiển phải ở phần đầu. Nếu chúng nằm trong cùng `.card` với `.chat` thì
    // thẻ đó cao theo phần đầu và khung nhập lại bị đẩy xuống dưới.
    const cardIndex = traoDoi.indexOf('<div className="card"')
    const planButton = traoDoi.indexOf("chayBuoc('plan')")
    expect(planButton).toBeGreaterThan(-1)
    expect(planButton).toBeLessThan(cardIndex)
  })

  it('giữ cuộn thông minh: chỉ theo dõi khi người dùng ở gần đáy', () => {
    // Phải có theo dõi sự kiện cuộn và một ngưỡng khoảng cách, nếu không khung nhìn sẽ bị
    // kéo xuống trong lúc agent đang chạy và người dùng không đọc được tin cũ.
    expect(traoDoi).toMatch(/onScroll=/)
    expect(traoDoi).toMatch(/scrollHeight/)
  })

  it('thẻ chọn phương án được vẽ theo tin nhắn có clarify', () => {
    expect(traoDoi).toMatch(/message\.clarify/)
    expect(traoDoi).toMatch(/<TheChonPhuongAn/)
  })

  it('gửi câu trả lời có cấu trúc kèm nội dung đọc được', () => {
    // Server điền brief bằng `answers` (tất định); `content` để lịch sử chat đọc được.
    expect(traoDoi).toMatch(/answers/)
    expect(traoDoi).toMatch(/api\.sendMessage/)
  })
})

/**
 * Bất biến của thanh công cụ và bảng danh sách cuộc trao đổi.
 *
 * Vì sao kiểm bằng cách đọc mã nguồn: đây là những yêu cầu về BỐ CỤC và về việc đóng/mở —
 * `tsc` và `vite build` đều không nói gì nếu cột danh sách cũ quay lại, hay nếu bảng quên
 * đóng khi bấm ra ngoài.
 */
describe('danh sách cuộc trao đổi mở theo yêu cầu', () => {
  it('không còn cột danh sách cố định bên trái', () => {
    // Bố cục cũ: `.card` đặt `flexDirection: 'row'` với một cột `flex: '0 0 250px'` luôn hiện.
    expect(traoDoi).not.toContain("flex: '0 0 250px'")
    expect(traoDoi).not.toMatch(/<div className="card" style=\{\{ flexDirection: 'row'/)
  })

  it('có hai nút: mở danh sách và tạo cuộc mới', () => {
    expect(traoDoi).toMatch(/t\('chat\.listConversations'\)/)
    expect(traoDoi).toMatch(/t\('chat\.newConversation'\)/)
    // Cả hai nút phải nằm trong thanh công cụ.
    const thanh = traoDoi.indexOf('className="chat__thanh"')
    expect(thanh).toBeGreaterThan(-1)
    expect(traoDoi.indexOf("t('chat.listConversations')")).toBeGreaterThan(thanh)
    expect(traoDoi.indexOf("t('chat.newConversation')")).toBeGreaterThan(thanh)
  })

  it('bảng danh sách là lớp phủ, chỉ render khi mở', () => {
    // Nếu render vô điều kiện thì nó luôn chiếm chỗ — đúng thứ cần bỏ.
    expect(traoDoi).toMatch(/moDanhSach \? \(/)
    expect(traoDoi).toMatch(/className="ds-phien"/)
  })

  it('đóng được bằng Esc và bằng bấm ra ngoài', () => {
    // Gắn listener khi mở, và phải gỡ khi đóng để không rò rỉ theo mỗi lần mở.
    expect(traoDoi).toMatch(/addEventListener\('keydown'/)
    expect(traoDoi).toMatch(/addEventListener\('pointerdown'/)
    expect(traoDoi).toMatch(/removeEventListener\('keydown'/)
    expect(traoDoi).toMatch(/removeEventListener\('pointerdown'/)
    expect(traoDoi).toMatch(/event\.key === 'Escape'/)
  })

  it('bấm ra ngoài không tính cú bấm trên nút mở', () => {
    // Thiếu hai phép loại trừ này thì chính cú bấm mở bảng cũng bị coi là "bấm ra ngoài" và
    // bảng đóng ngay sau khi mở.
    expect(traoDoi).toMatch(/bangRef\.current\?\.contains/)
    expect(traoDoi).toMatch(/nutDanhSachRef\.current\?\.contains/)
  })

  it('chọn một cuộc thì đóng bảng', () => {
    const onChon = traoDoi.indexOf('setDangChon(cuoc.id)')
    expect(onChon).toBeGreaterThan(-1)
    // Ngay sau khi chọn phải đóng bảng; chọn xong mà để mở tiếp thì nó che khung chat.
    expect(traoDoi.slice(onChon, onChon + 200)).toMatch(/setMoDanhSach\(false\)/)
  })

  it('CSS giữ được bất biến khung nhập nằm trong tầm nhìn', () => {
    // Đây là dòng quan trọng nhất của khối CSS mới: thiếu `min-height: 0` ở lớp bọc thì `.chat`
    // bên trong cao theo nội dung và khung nhập bị đẩy khỏi màn hình trở lại.
    const than = declarations('.chat__than')
    expect(than).toMatch(/flex:\s*1/)
    expect(than).toMatch(/min-height:\s*0/)
    expect(than).toMatch(/position:\s*relative/)
    // Thanh công cụ không được giành chỗ của khung tin nhắn.
    expect(declarations('.chat__thanh')).toMatch(/flex:\s*0\s+0\s+auto/)
  })

  it('bảng danh sách bị giới hạn trong khung chat', () => {
    const bang = declarations('.ds-phien')
    expect(bang).toMatch(/position:\s*absolute/)
    // Có trần cả hai chiều, nếu không danh sách dài sẽ tràn khỏi khung.
    expect(bang).toMatch(/max-height:/)
    expect(bang).toMatch(/width:\s*min\(/)
  })

  it('câu chữ trạng thái rỗng nhắc đúng nút đang có', () => {
    // Bất biến chống câu chữ lệch khỏi giao diện: câu cũ nói "Bấm +" trong khi nút "+" đã bị
    // thay bằng nút "Tạo cuộc trao đổi mới" — hướng dẫn sai chỗ thì người dùng đi tìm một
    // thứ không tồn tại.
    const viChat = readFileSync(fileURLToPath(new URL('../../../packages/i18n/src/catalogs/vi/chat.ts', import.meta.url)), 'utf8')
    const enChat = readFileSync(fileURLToPath(new URL('../../../packages/i18n/src/catalogs/en/chat.ts', import.meta.url)), 'utf8')
    expect(viChat).toMatch(/'chat\.emptyList'/)
    expect(enChat).toMatch(/'chat\.emptyList'/)
    expect(viChat).not.toMatch(/'chat\.emptyList':[^\n]*Bấm \+/)
    expect(enChat).not.toMatch(/'chat\.emptyList':[^\n]*Press \+/)
    // Và hai khoá mới của thanh công cụ phải có ở cả hai ngôn ngữ.
    for (const khoa of ['chat.listConversations', 'chat.closeList']) {
      expect(viChat, `vi thiếu ${khoa}`).toMatch(new RegExp(`'${khoa.replace('.', '\\.')}'`))
      expect(enChat, `en thiếu ${khoa}`).toMatch(new RegExp(`'${khoa.replace('.', '\\.')}'`))
    }
  })
})
