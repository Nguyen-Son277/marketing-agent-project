/**
 * Nút chuyển chế độ sáng | tối.
 *
 * Vì sao là nút gạt hai lựa chọn thay vì một nút bật/tắt: người dùng thấy ngay đang ở
 * chế độ nào mà không phải đoán từ biểu tượng, và chỉ cần một cú bấm để đổi. Đây cũng
 * là cách bộ chọn ngôn ngữ ngay cạnh đang làm, nên hai nút trông cùng một hệ.
 */
import { useI18n } from '../lib/i18n.tsx'
import { useTheme } from '../lib/theme.tsx'
import { THEMES, type ThemeMode } from '../lib/theme-store.ts'

const NHAN: Readonly<Record<ThemeMode, 'theme.light' | 'theme.dark'>> = {
  light: 'theme.light',
  dark: 'theme.dark',
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme()
  const { t } = useI18n()

  return (
    <div className={compact ? 'theme-switcher theme-switcher--gon' : 'theme-switcher'} role="group" aria-label={t('theme.label')}>
      {THEMES.map((mode) => {
        const active = mode === theme
        const ten = t(NHAN[mode])
        return (
          <button
            key={mode}
            type="button"
            className={`theme-switcher__option${active ? ' is-active' : ''}`}
            aria-pressed={active}
            title={active ? t('theme.current', { name: ten }) : t('theme.switchTo', { name: ten })}
            onClick={() => {
              if (!active) setTheme(mode)
            }}
          >
            {/* Biểu tượng chỉ để nhận ra nhanh; chữ vẫn luôn hiện vì trạng thái không
                được chỉ dựa vào biểu tượng hay màu. `aria-hidden` để trình đọc màn hình
                không đọc trùng. */}
            <span aria-hidden>{mode === 'light' ? '\u2600' : '\u263D'}</span>
            {ten}
          </button>
        )
      })}
    </div>
  )
}
