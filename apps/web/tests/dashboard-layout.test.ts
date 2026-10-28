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
const vi = read('../../../packages/i18n/src/catalogs/vi.ts')
const en = read('../../../packages/i18n/src/catalogs/en.ts')

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
    expect(rule('.app__nav')).toContain('flex-direction: column')
    expect(rule('.app__nav-links')).toContain('flex: 1')
    expect(rule('.app__nav-links')).toContain('min-height: 0')
    expect(rule('.app__nav-toggle')).toContain('margin-top: 12px')
    expect(rule('.app__sidebar-user')).toContain('flex: 0 0 auto')
    expect(rule('.app__sidebar-user')).toContain('border-top: 1px solid var(--mau-vien)')
    expect(shell).toContain('className="app__sidebar-user"')
    expect(shell.indexOf('className="app__sidebar-user"')).toBeGreaterThan(shell.indexOf('className="app__nav-toggle"'))
    expect(rule('.app__nav-links')).toContain('overflow-y: auto')
    expect(shell).toContain('className="app__sidebar-signout"')
    expect(shell).toContain('className="app__sidebar-user-trigger"')
    expect(shell).toContain('aria-expanded={userMenuOpen}')
    expect(shell).toContain('setUserMenuOpen((open) => !open)')
    expect(css).toContain(".app--nav-thu-gon .app__sidebar-user[data-menu-open='true'] .app__sidebar-signout")
    expect(shell).toContain("aria-label={t('nav.signOut')}")
    expect(shell).toContain('onClick={() => void signOut()}')
    expect(rule('.app__sidebar-signout')).toContain('cursor: pointer')
    expect(shell).not.toContain("<Nut bien=\"phu\" nho onClick={() => void signOut()}>")
  })

  it('mobile có ba hàng rõ ràng và menu chỉ chiếm một hàng ngang', () => {
    const mobile = mobileRules()
    expect(mobile).toContain('grid-template-rows: auto auto minmax(0, 1fr)')
    expect(mobile).toContain('.app__nav-links > div')
    expect(mobile).toContain('flex: 0 0 auto')
    expect(mobile).toContain('white-space: nowrap')
    // Desktop đặt `.app__nav` thành cột dọc; mobile phải ghi đè về hàng ngang.
    expect(mobile).toContain('flex-direction: row')
  })

  it('giữ main chat không cuộn trang và thu khoảng đệm trên màn hẹp', () => {
    expect(rule('.app__main--cao-day')).toContain('overflow: hidden')
    expect(shell).toContain("route === 'trao-doi' ? 'app__main app__main--cao-day' : 'app__main'")
    expect(css).toContain('.app__main--cao-day { padding: 10px; }')
  })

  it('sidebar desktop thu về icon-only và khôi phục tên/accessibility khi mở', () => {
    expect(css).toContain('grid-template-columns: 72px minmax(0, 1fr)')
    expect(css).toContain('.app--nav-thu-gon {')
    expect(css).toContain('.app--nav-thu-gon .app__nav')
    expect(css).toContain('padding-inline: 8px')
    expect(css).toContain('justify-content: center')
    expect(css).toContain('transition: grid-template-columns 180ms ease')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('transition: none')
    expect(css).toContain('clip: rect(0, 0, 0, 0)')
    expect(css).not.toContain('.app--nav-thu-gon .app__nav-label { display: none')
    expect(css).toContain('font-size: 19px')
    expect(rule('.app')).toContain('grid-template-columns: 248px minmax(0, 1fr)')
    expect(shell).toContain("const NAV_COLLAPSED_KEY = 'ma.navCollapsed'")
    expect(shell).toContain('window.localStorage.getItem(NAV_COLLAPSED_KEY)')
    expect(shell).toContain('window.localStorage.setItem(NAV_COLLAPSED_KEY, String(value))')
    expect(shell).toContain('aria-expanded={!navCollapsed}')
    expect(shell).toContain('aria-controls="main-navigation"')
    expect(shell).toContain('aria-label={t(item.nhan)}')
    expect(shell).toContain('title={navCollapsed ? t(item.nhan) : undefined}')
    expect(shell).toContain('className="app__nav-icon"')
    expect(css).toContain('.app--nav-thu-gon .app__nav-label')
  })

  it('nút co/mở chỉ hiện icon sidebar, vẫn giữ nhãn và tooltip', () => {
    const toggle = shell.slice(shell.indexOf('className="app__nav-toggle"'), shell.indexOf('</nav>'))
    expect(toggle).toContain('<svg className="app__nav-toggle-icon"')
    expect(toggle).toContain('stroke="currentColor"')
    expect(toggle).toContain('aria-label={t(navCollapsed')
    expect(toggle).toContain('title={t(navCollapsed')
    expect(toggle).not.toContain('app__nav-toggle-text')
    expect(rule('.app__nav-toggle')).toContain('width: 42px')
    // Nút phải nằm SAU danh sách route trong DOM và dùng margin-top để neo xuống đáy.
    expect(shell.indexOf('app__nav-links')).toBeLessThan(shell.indexOf('className="app__nav-toggle"'))
    expect(rule('.app__nav')).toContain('flex-direction: column')
  })

  it('mobile giữ menu ngang và bỏ ảnh hưởng từ preference desktop', () => {
    const mobile = mobileRules()
    expect(mobile).toContain('.app--nav-thu-gon')
    expect(mobile).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(mobile).toContain('.app__nav-toggle')
    expect(mobile).toContain('display: none')
    expect(mobile).toContain('.app--nav-thu-gon .app__nav-label')
    expect(mobile).toContain('white-space: nowrap')
    // Desktop đặt nhóm thành grid khi thu gọn; mobile phải trả về hàng ngang.
    expect(mobile).toContain('.app--nav-thu-gon .app__nav-group-wrap')
    expect(mobile).toContain('display: flex')
  })

  it('có nhãn truy cập đã dịch vi/en cho nút sidebar', () => {
    for (const key of ['nav.label', 'nav.collapse', 'nav.expand']) {
      expect(vi).toContain(`'${key}'`)
      expect(en).toContain(`'${key}'`)
    }
    expect(shell).toContain("t(navCollapsed ? 'nav.expand' : 'nav.collapse')")
  })

  it('tên công ty/người dùng dài không ép header tràn ngang', () => {
    expect(rule('.app__company-picker')).toContain('min-width: 0')
    expect(rule('.app__company-picker')).toContain('max-width: min(320px, 100%)')
    expect(rule('.app__user')).toContain('text-overflow: ellipsis')
    expect(shell).toContain('className="o-chon app__company-picker"')
  })

  it('đặt bảng điều khiển ở vị trí đầu tiên trong danh sách route', () => {
    const routeBlockStart = shell.indexOf('export const ROUTES = [')
    const routeBlockEnd = shell.indexOf('] as const satisfies', routeBlockStart)
    const routeBlock = shell.slice(routeBlockStart, routeBlockEnd)
    const firstRoute = routeBlock.match(/{\s*id:\s*'([^']+)'/)?.[1]
    expect(firstRoute).toBe('bang-dieu-khien')
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
