/**
 * Nút chuyển ngôn ngữ vi | en.
 *
 * Vì sao là nút gạt hai lựa chọn thay vì menu xổ xuống: chỉ có hai ngôn ngữ, nên một
 * nút hiện cả hai lựa chọn vừa cho thấy ngay đang ở ngôn ngữ nào, vừa cho đổi chỉ bằng
 * một cú bấm. Menu xổ xuống sẽ cần hai cú bấm cho cùng một việc.
 */
import { LOCALE_LIST } from '@marketing-agent/i18n'
import { useI18n } from '../lib/i18n.tsx'

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n()

  return (
    <div className="locale-switcher" role="group" aria-label={t('locale.label')}>
      {LOCALE_LIST.map((capability) => {
        const active = capability.code === locale
        return (
          <button
            key={capability.code}
            type="button"
            className={`locale-switcher__option${active ? ' is-active' : ''}`}
            aria-pressed={active}
            title={active ? t('locale.current', { name: capability.name }) : t('locale.switchTo', { name: capability.name })}
            onClick={() => {
              if (!active) setLocale(capability.code)
            }}
          >
            {compact ? capability.label : capability.name}
          </button>
        )
      })}
    </div>
  )
}
