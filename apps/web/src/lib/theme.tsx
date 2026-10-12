/**
 * Provider chế độ sáng/tối.
 *
 * Vì sao cần một provider thay vì đọc theme trong từng component: nút chuyển phải hiện
 * trạng thái đang dùng, và mọi nút trên mọi màn phải đổi cùng lúc. Một nguồn sự thật
 * duy nhất cũng tránh việc hai nút ở hai màn hiện hai trạng thái khác nhau.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  applyDocumentTheme,
  hasStoredTheme,
  onStoredThemeChange,
  onSystemThemeChange,
  readTheme,
  writeTheme,
  type ThemeMode,
} from './theme-store.ts'

export interface ThemeState {
  readonly theme: ThemeMode
  /** Người dùng đã chọn thủ công chưa; chưa chọn thì đang theo hệ điều hành. */
  readonly followsSystem: boolean
  setTheme(theme: ThemeMode): void
}

const ThemeContext = createContext<ThemeState | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [theme, setThemeState] = useState<ThemeMode>(() => readTheme())
  const [followsSystem, setFollowsSystem] = useState<boolean>(() => !hasStoredTheme())

  /**
   * Áp theme lên `<html>` ở MỌI lần theme đổi.
   *
   * `index.html` đã đặt trước khi vẽ, nhưng vẫn phải áp lại ở đây: sau khi React mount,
   * nguồn sự thật là state này, và một lần lệch giữa hai nơi sẽ khiến nút chuyển hiện
   * sai trạng thái so với màu thật của trang.
   */
  useEffect(() => {
    applyDocumentTheme(theme)
  }, [theme])

  const setTheme = useCallback((next: ThemeMode) => {
    writeTheme(next)
    setFollowsSystem(false)
    setThemeState(next)
  }, [])

  useEffect(() => {
    // Tab khác đổi theme: áp ngay và cập nhật nút, nhưng KHÔNG ghi lại storage.
    const offStored = onStoredThemeChange((next) => {
      setThemeState(next)
      setFollowsSystem(!hasStoredTheme())
    })
    return offStored
  }, [])

  useEffect(() => {
    // Chỉ theo hệ điều hành khi người dùng chưa tự chọn.
    if (!followsSystem) return
    return onSystemThemeChange(setThemeState)
  }, [followsSystem])

  const value = useMemo<ThemeState>(
    () => ({ theme, followsSystem, setTheme }),
    [theme, followsSystem, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme phải dùng bên trong <ThemeProvider>')
  return context
}
