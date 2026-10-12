/**
 * Chế độ sáng/tối, ở dạng đọc được từ ngoài React.
 *
 * Vì sao tách khỏi provider React: `index.html` phải đặt theme TRƯỚC lần vẽ đầu tiên
 * để không chớp nền trắng khi người dùng chọn tối. Script khởi tạo trong HTML không
 * import được module TS, nhưng nó và provider phải dùng CÙNG một khoá lưu và cùng quy
 * tắc dự phòng — nếu lệch, lần vẽ đầu và lần render sau sẽ nhảy theme.
 *
 * Quy tắc: đã chọn thủ công thì lựa chọn đó thắng; chưa chọn thì theo hệ điều hành;
 * không đọc được gì thì mặc định sáng.
 */

export const THEMES = ['light', 'dark'] as const
export type ThemeMode = (typeof THEMES)[number]

/** Trùng với hằng số trong `index.html`; đổi một nơi phải đổi cả hai. */
export const THEME_STORAGE_KEY = 'ma.theme'
export const THEME_ATTRIBUTE = 'data-theme'

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

/** Có lựa chọn thủ công hay không, tách khỏi `readTheme` để biết có nên theo hệ điều hành. */
export function hasStoredTheme(): boolean {
  try {
    return isThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    // Chặn localStorage (chế độ riêng tư) — coi như chưa chọn.
    return false
  }
}

function systemTheme(): ThemeMode {
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/** Theme hiệu lực: lựa chọn đã lưu → hệ điều hành → sáng. */
export function readTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemeMode(stored)) return stored
  } catch {
    // Không đọc được thì rơi xuống hệ điều hành.
  }
  return systemTheme()
}

/** Ghi lựa chọn thủ công; gọi từ cả hook React lẫn mã ngoài React. */
export function writeTheme(theme: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Không lưu được thì theme vẫn có hiệu lực cho phiên hiện tại.
  }
}

/**
 * Đặt theme lên `<html>`.
 *
 * `colorScheme` phải đặt cùng lúc: nếu chỉ đổi biến CSS, các ô `input type=date` và
 * thanh cuộn vẫn do trình duyệt vẽ theo chế độ cũ và lệch hẳn khỏi phần còn lại.
 */
export function applyDocumentTheme(theme: ThemeMode): void {
  document.documentElement.setAttribute(THEME_ATTRIBUTE, theme)
  document.documentElement.style.colorScheme = theme
}

/** Theo dõi đổi theme của hệ điều hành; dùng khi người dùng chưa chọn thủ công. */
export function onSystemThemeChange(listener: (theme: ThemeMode) => void): () => void {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!query) return () => undefined
  const handler = (event: MediaQueryListEvent): void => listener(event.matches ? 'dark' : 'light')
  query.addEventListener('change', handler)
  return () => query.removeEventListener('change', handler)
}

/**
 * Theo dõi thay đổi từ TAB khác.
 *
 * `storage` chỉ bắn cho tab không thực hiện thay đổi, nên không có vòng lặp ghi qua lại.
 */
export function onStoredThemeChange(listener: (theme: ThemeMode) => void): () => void {
  const handler = (event: StorageEvent): void => {
    if (event.key !== THEME_STORAGE_KEY) return
    if (isThemeMode(event.newValue)) listener(event.newValue)
    // `newValue` null nghĩa là bị xoá: quay về theo hệ điều hành.
    else if (event.newValue === null) listener(systemTheme())
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
