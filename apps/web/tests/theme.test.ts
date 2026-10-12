/**
 * Chế độ sáng/tối.
 *
 * Hai nhóm bất biến:
 *  - logic đọc/ghi theme, chạy trên `window` giả vì môi trường test là Node;
 *  - quy tắc "mọi màu phải là biến theme" và "mọi khung màn hình phải có nút chuyển",
 *    những thứ mà `tsc` và build không kiểm được.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
  applyDocumentTheme,
  hasStoredTheme,
  isThemeMode,
  onStoredThemeChange,
  onSystemThemeChange,
  readTheme,
  writeTheme,
} from '../src/lib/theme-store.ts'

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

interface FakeWorld {
  readonly store: Map<string, string>
  readonly attributes: Map<string, string>
  readonly style: Record<string, string>
  systemDark: boolean
  hasMatchMedia: boolean
  throwOnStorage: boolean
  readonly listeners: Map<string, Set<(event: unknown) => void>>
}

let world: FakeWorld

/** `window`/`document` tối thiểu mà `theme-store` chạm tới; đủ để kiểm mọi nhánh dự phòng. */
function install(): void {
  world = {
    store: new Map(),
    attributes: new Map(),
    style: {},
    systemDark: false,
    hasMatchMedia: true,
    throwOnStorage: false,
    listeners: new Map(),
  }
  const localStorage = {
    getItem: (key: string) => {
      if (world.throwOnStorage) throw new Error('storage bị chặn')
      return world.store.get(key) ?? null
    },
    setItem: (key: string, value: string) => {
      if (world.throwOnStorage) throw new Error('storage bị chặn')
      world.store.set(key, value)
    },
  }
  const matchMedia = (query: string) => ({
    matches: world.systemDark,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      const set = world.listeners.get(type) ?? new Set()
      set.add(listener)
      world.listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      world.listeners.get(type)?.delete(listener)
    },
  })
  const windowStub: Record<string, unknown> = {
    localStorage,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      const set = world.listeners.get(type) ?? new Set()
      set.add(listener)
      world.listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      world.listeners.get(type)?.delete(listener)
    },
  }
  // Getter chứ không phải giá trị: test đổi `hasMatchMedia` sau khi cài để kiểm nhánh
  // "trình duyệt không hỗ trợ matchMedia", và stub phải phản ánh thay đổi đó.
  Object.defineProperty(windowStub, 'matchMedia', {
    get: () => (world.hasMatchMedia ? matchMedia : undefined),
  })
  vi.stubGlobal('window', windowStub)
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: (name: string, value: string) => world.attributes.set(name, value),
      getAttribute: (name: string) => world.attributes.get(name) ?? null,
      style: world.style,
    },
  })
}

beforeEach(install)
afterEach(() => vi.unstubAllGlobals())

describe('logic chế độ sáng/tối', () => {
  it('lựa chọn đã lưu thắng hệ điều hành', () => {
    writeTheme('dark')
    world.systemDark = false
    expect(readTheme()).toBe('dark')
    expect(hasStoredTheme()).toBe(true)
    world.store.set(THEME_STORAGE_KEY, 'light')
    world.systemDark = true
    expect(readTheme()).toBe('light')
  })

  it('chưa chọn thì theo hệ điều hành, không có matchMedia thì mặc định sáng', () => {
    world.systemDark = true
    expect(readTheme()).toBe('dark')
    world.hasMatchMedia = false
    expect(readTheme()).toBe('light')
  })

  it('giá trị lạ hoặc localStorage bị chặn không làm hỏng ứng dụng', () => {
    world.store.set(THEME_STORAGE_KEY, 'xanh')
    expect(hasStoredTheme()).toBe(false)
    world.systemDark = true
    expect(readTheme()).toBe('dark')
    world.throwOnStorage = true
    expect(hasStoredTheme()).toBe(false)
    expect(() => writeTheme('dark')).not.toThrow()
    expect(readTheme()).toBe('dark')
  })

  it('áp theme đặt cả thuộc tính lẫn color-scheme cho trình duyệt', () => {
    applyDocumentTheme('dark')
    expect(world.attributes.get(THEME_ATTRIBUTE)).toBe('dark')
    expect(world.style.colorScheme).toBe('dark')
  })

  it('đổi ở tab khác được áp, xoá khoá thì quay về hệ điều hành', () => {
    const thayDoi: string[] = []
    const off = onStoredThemeChange((theme) => thayDoi.push(theme))
    for (const listener of world.listeners.get('storage') ?? []) {
      listener({ key: THEME_STORAGE_KEY, newValue: 'dark' })
      listener({ key: 'khoa-khac', newValue: 'dark' })
      world.systemDark = true
      listener({ key: THEME_STORAGE_KEY, newValue: null })
    }
    expect(thayDoi).toEqual(['dark', 'dark'])
    off()
    expect(world.listeners.get('storage')?.size ?? 0).toBe(0)
  })

  it('theo dõi hệ điều hành và dọn listener khi ngừng', () => {
    const thayDoi: string[] = []
    const off = onSystemThemeChange((theme) => thayDoi.push(theme))
    for (const listener of world.listeners.get('change') ?? []) listener({ matches: true })
    expect(thayDoi).toEqual(['dark'])
    off()
    expect(world.listeners.get('change')?.size ?? 0).toBe(0)
  })

  it('không có matchMedia thì theo dõi hệ điều hành là no-op', () => {
    world.hasMatchMedia = false
    const off = onSystemThemeChange(() => undefined)
    expect(() => off()).not.toThrow()
  })

  it('chỉ nhận đúng hai chế độ', () => {
    expect(isThemeMode('light')).toBe(true)
    expect(isThemeMode('dark')).toBe(true)
    expect(isThemeMode('system')).toBe(false)
  })
})

describe('theme phải áp dụng ở mọi khung màn hình', () => {
  it('index.html đặt theme trước khi tải bundle và khai báo color-scheme', () => {
    const html = read('../index.html')
    expect(html).toContain('color-scheme" content="light dark"')
    // Cùng khoá với module; lệch khoá là nháy nền sáng ở lần tải sau.
    expect(html).toContain(`'${THEME_STORAGE_KEY}'`)
    expect(html).toContain("setAttribute('data-theme'")
    // Script phải nằm TRƯỚC script module, nếu không nó chạy sau lần vẽ đầu.
    expect(html.indexOf('data-theme')).toBeLessThan(html.indexOf('type="module"'))
  })

  it('mọi khung màn hình đều có nút chuyển', () => {
    for (const file of [
      '../src/Shell.tsx',
      '../src/screens/AdminDuyetTaiKhoan.tsx',
      '../src/screens/GiaoViecNhanVien.tsx',
      '../src/screens/DangNhap.tsx',
      '../src/screens/ChoDuyet.tsx',
      '../src/screens/DoiMatKhau.tsx',
      '../src/screens/ChonCongTy.tsx',
    ]) {
      const source = read(file)
      expect(source, file).toContain("ThemeSwitcher")
      expect(source, file).toContain('<ThemeSwitcher')
    }
  })

  it('provider bọc App và nút chuyển không dựa vào mỗi biểu tượng', () => {
    const main = read('../src/main.tsx')
    expect(main).toContain('<ThemeProvider>')
    expect(main.indexOf('<ThemeProvider>')).toBeLessThan(main.indexOf('<App />'))
    const switcher = read('../src/components/ThemeSwitcher.tsx')
    expect(switcher).toContain('type="button"')
    expect(switcher).toContain('aria-pressed={active}')
    expect(switcher).toContain('role="group"')
    // Nhãn chữ luôn hiện; biểu tượng chỉ là phụ.
    expect(switcher).toContain('{ten}')
  })

  it('cả hai theme đều có bảng màu riêng cho mọi token', () => {
    const css = read('../src/styles.css')
    const light = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='dark']"))
    const dark = css.slice(css.indexOf(":root[data-theme='dark']"), css.indexOf(":root[data-theme='light']"))
    const tokens = (block: string) =>
      new Set([...block.matchAll(/^\s*(--[a-z-]+):/gm)].map((m) => m[1]))
    const lightTokens = tokens(light)
    const darkTokens = tokens(dark)
    // `--font*`/`--khoang*`/`--ban-kinh*` là bố cục, không đổi theo theme.
    const layout = new Set(['--font', '--font-mono', '--khoang', '--khoang-lon', '--ban-kinh', '--ban-kinh-nho'])
    for (const token of lightTokens) {
      if (layout.has(token)) continue
      expect(darkTokens, `theme tối thiếu ${token}`).toContain(token)
    }
    expect(lightTokens.size).toBeGreaterThan(20)
  })

  it('không còn màu viết thẳng ngoài bảng token', () => {
    const css = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
    // Bỏ các dòng ĐỊNH NGHĨA token; còn lại không được chứa mã màu, nếu không chúng
    // sẽ giữ nguyên ở cả hai theme và tạo mảng trắng/chữ tối khó đọc.
    const rules = css
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
    expect(rules.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []).toEqual([])
  })

  it('mọi cặp chữ/nền chính đạt tương phản tối thiểu 4,5:1 ở cả hai theme', () => {
    const css = read('../src/styles.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const block = (start: string, end: string) => css.slice(css.indexOf(start), css.indexOf(end))
    type Colour = { readonly rgb: readonly [number, number, number]; readonly alpha: number }
    const parse = (text: string): Map<string, Colour> => {
      const map = new Map<string, Colour>()
      for (const line of text.split('\n')) {
        const match = line.match(/^\s*(--[a-z-]+):\s*(.+?);\s*$/)
        if (!match) continue
        const hex = match[2]!.match(/^#([0-9a-fA-F]{6})$/)
        if (hex) {
          const h = hex[1]!
          map.set(match[1]!, {
            rgb: [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number],
            alpha: 1,
          })
          continue
        }
        // Chữ mờ dùng `rgb(r g b / a%)`: phải composite lên nền mới ra màu thật.
        const rgb = match[2]!.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*([\d.]+)%\s*)?\)$/)
        if (rgb) {
          map.set(match[1]!, {
            rgb: [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] as [number, number, number],
            alpha: rgb[4] === undefined ? 1 : Number(rgb[4]) / 100,
          })
        }
      }
      return map
    }
    const light = parse(block(':root {', ":root[data-theme='dark']"))
    const dark = parse(block(":root[data-theme='dark']", ":root[data-theme='light']"))

    const luminance = (rgb: readonly [number, number, number]): number => {
      const [r, g, b] = rgb.map((value) => {
        const c = value / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }) as [number, number, number]
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const over = (fg: Colour, bg: Colour): readonly [number, number, number] =>
      fg.rgb.map((value, index) => value * fg.alpha + bg.rgb[index]! * (1 - fg.alpha)) as [number, number, number]
    const contrast = (fg: Colour, bg: Colour): number => {
      const [hi, lo] = [luminance(over(fg, bg)), luminance(bg.rgb)].sort((x, y) => y - x) as [number, number]
      return (hi + 0.05) / (lo + 0.05)
    }

    const pairs: readonly (readonly [string, string])[] = [
      ['--mau-chu', '--mau-nen'],
      ['--mau-chu-mo', '--mau-nen'],
      ['--mau-chu-mo', '--mau-be-mat'],
      // Nền badge/nền phụ: đây là chỗ màu xám nhạt từng không đủ tương phản.
      ['--mau-chu-mo', '--mau-nen-phu'],
      ['--mau-chu-mo', '--mau-bang-dau-nen'],
      ['--mau-chu-mo', '--mau-cot-nen'],
      ['--mau-chu-tren-chinh', '--mau-chinh'],
      ['--mau-chu-tren-chinh-mo', '--mau-chinh'],
      ['--mau-chu-tren-phu', '--mau-phu'],
      ['--mau-chu-tren-nguy-hiem', '--mau-nut-nguy-hiem-nen'],
      ['--mau-chu-loi', '--mau-loi-nen'],
      ['--mau-chu-canh-bao', '--mau-canh-bao-nen'],
      ['--mau-chu-thanh-cong', '--mau-thanh-cong-nen'],
      ['--mau-chinh-dam', '--mau-chinh-nhat'],
      ['--mau-chinh', '--mau-be-mat'],
    ]

    for (const [name, palette] of [['sáng', light], ['tối', dark]] as const) {
      for (const [foreground, background] of pairs) {
        const fg = palette.get(foreground)
        const bg = palette.get(background)
        expect(fg, `${name}: thiếu ${foreground}`).toBeTruthy()
        expect(bg, `${name}: thiếu ${background}`).toBeTruthy()
        expect(contrast(fg!, bg!), `${name}: ${foreground} trên ${background}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('nút chuyển có nhãn vi/en và khối công cụ không tràn màn hẹp', () => {    for (const catalog of ['vi', 'en']) {
      const text = read(`../../../packages/i18n/src/catalogs/${catalog}.ts`)
      for (const key of ['theme.label', 'theme.light', 'theme.dark', 'theme.switchTo', 'theme.current']) {
        expect(text, `${catalog} thiếu ${key}`).toContain(`'${key}'`)
      }
    }
    const css = read('../src/styles.css')
    // Khối công cụ ở màn chưa đăng nhập là absolute: phải có trần bề rộng và cho xuống dòng.
    expect(css).toContain('.dang-nhap__cong-cu')
    expect(css).toContain('max-width: calc(100% - 36px)')
    expect(css).toContain('flex-wrap: wrap')
  })
})
