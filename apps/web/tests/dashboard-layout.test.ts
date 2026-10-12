/**
 * Chặn tái diễn các lỗi track grid, card lệch hàng và dashboard không dùng hết main.
 *
 * Test mã nguồn chỉ bảo vệ các quy tắc rõ ràng; việc nội dung thật có bị cắt không còn
 * phải đo trong trình duyệt ở nhiều kích thước, không thể suy ra chỉ từ CSS.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const css = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
const dashboard = read('../src/screens/BangDieuKhien.tsx')
const shell = read('../src/Shell.tsx')

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `thiếu selector ${selector}`).toBeGreaterThanOrEqual(0)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

function mobileRules(): string {
  const marker = '@media (max-width: 860px)'
  const start = css.indexOf(marker)
  const open = css.indexOf('{', start)
  let depth = 1
  let index = open + 1
  while (index < css.length && depth > 0) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    index += 1
  }
  return css.slice(open + 1, index - 1)
}

describe('main co đúng theo cửa sổ', () => {
  it('desktop không để track nội dung lớn theo kích thước tối thiểu của con', () => {
    expect(rule('.app')).toContain('grid-template-columns: 248px minmax(0, 1fr)')
    expect(rule('.app')).toContain('grid-template-rows: auto minmax(0, 1fr)')
    expect(rule('.app__main')).toContain('min-height: 0')
    expect(rule('.app__main')).toContain('overflow-y: auto')
    expect(rule('.app__nav')).toContain('min-height: 0')
  })

  it('mobile có ba hàng rõ ràng và menu chỉ chiếm một hàng ngang', () => {
    const mobile = mobileRules()
    expect(mobile).toContain('grid-template-rows: auto auto minmax(0, 1fr)')
    expect(mobile).toContain('.app__nav > div')
    expect(mobile).toContain('flex: 0 0 auto')
    expect(mobile).toContain('white-space: nowrap')
  })

  it('giữ main chat không cuộn trang và thu khoảng đệm trên màn hẹp', () => {
    expect(rule('.app__main--cao-day')).toContain('overflow: hidden')
    expect(shell).toContain("route === 'trao-doi' ? 'app__main app__main--cao-day' : 'app__main'")
    expect(css).toContain('.app__main--cao-day { padding: 10px; }')
  })

  it('tên công ty/người dùng dài không ép header tràn ngang', () => {
    expect(rule('.app__company-picker')).toContain('min-width: 0')
    expect(rule('.app__company-picker')).toContain('max-width: min(320px, 100%)')
    expect(rule('.app__user')).toContain('text-overflow: ellipsis')
    expect(shell).toContain('className="o-chon app__company-picker"')
  })
})

describe('dashboard responsive và đủ nội dung', () => {
  it('dùng toàn chiều rộng kể cả khi đang tải hoặc lỗi', () => {
    expect(dashboard).not.toContain('<Trang>')
    expect(dashboard).toContain('<Trang rong>')
    expect(dashboard).toContain('className="dashboard"')
  })

  it('giữ đủ năm chỉ số và các khối thông tin đang có', () => {
    for (const key of ['openTasks', 'doneTasks', 'conversations', 'documents', 'agentsEnabled', 'costToday', 'tasksByStatus', 'recentActivity', 'quickActions']) {
      expect(dashboard, `thiếu ${key}`).toContain(`dashboard.${key}`)
    }
    expect(dashboard).toContain('TASK_STATUSES.map')
    expect(dashboard).toContain('duLieu.recentActivity.map')
  })

  it('card trong grid không nhận margin của danh sách card dọc', () => {
    expect(css).toContain('.dashboard__stats > .card,')
    expect(css).toContain('.dashboard__overview > .card,')
    expect(rule('.dashboard__bottom > .card')).toContain('margin: 0')
    expect(rule('.dashboard__stats')).toContain('align-items: stretch')
  })

  it('panel co về một cột và hoạt động dài được xuống dòng', () => {
    expect(css).toContain('@media (max-width: 1000px)')
    expect(css).toContain('.dashboard__bottom { grid-template-columns: minmax(0, 1fr); }')
    expect(rule('.dashboard__activity-summary')).toContain('overflow-wrap: anywhere')
    expect(dashboard).not.toContain('minWidth: 200')
  })

  it('không hiện bản chụp của công ty trước sau khi đổi công ty', () => {
    expect(dashboard).toContain('banChup?.company.id === companyId ? banChup : null')
    expect(dashboard).toContain('if (!cancelled) setDuLieu(ketQua)')
    expect(dashboard).toContain('{loi ? <LoiManHinh loi={loi} /> : null}')
  })

  it('thanh tiến độ có tên truy cập và hành động giữ điều hướng', () => {
    expect(dashboard).toContain('aria-label={nhan}')
    expect(dashboard).toContain("onNavigate('trao-doi')")
    expect(dashboard).toContain("onNavigate('cong-viec')")
    expect(css).toContain('.btn:focus-visible')
  })
})
