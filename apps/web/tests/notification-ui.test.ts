import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const bell = source('../src/components/NotificationBell.tsx')
const shell = source('../src/Shell.tsx')
const vi = source('../../../packages/i18n/src/catalogs/vi/notifications.ts')
const en = source('../../../packages/i18n/src/catalogs/en/notifications.ts')

describe('notification accessibility and scope wiring', () => {
  it('uses the native accessible modal and an explicitly labelled bell', () => {
    expect(bell).toContain('<HopThoai')
    expect(bell).toContain('aria-haspopup="dialog" aria-expanded={open}')
    expect(bell).toContain("aria-label={t('notifications.bell', { count: state.count })}")
    expect(bell).toContain('<fieldset')
    expect(bell).toContain('type="checkbox"')
    expect(bell).toContain('role="alert"')
    expect(bell).toContain('role="status"')
    expect(bell).toContain('aria-busy={state.loading}')
  })
  it('remounts per identity and scopes browser opt-in independently from permission', () => {
    expect(shell).toContain('key={`${user.id}:${companyId}`}')
    expect(bell).toContain('`ma.notifications:${userId}:${companyId}`')
    expect(bell).toContain("localStorage.getItem(key) === 'true'")
    expect(bell).toContain('onClick={() => void toggleBrowser()}')
    expect(bell.match(/Notification\.requestPermission\(/g)).toHaveLength(1)
    expect(bell).toContain('if (!mounted.current) return')
    expect(bell).toContain('if (!active) { notification.close(); return }')
    expect(bell).toContain('for (const notification of desktop) notification.close()')
  })
  it('removes focus, visibility and online listeners and stops polling', () => {
    for (const event of ['focus', 'online', 'visibilitychange']) {
      expect(bell).toContain(`addEventListener('${event}', onFocus)`)
      expect(bell).toContain(`removeEventListener('${event}', onFocus)`)
    }
    expect(bell).toContain('current.stop()')
    expect(bell).toContain('clearTimeout(timer)')
  })
  it('translates all UI labels including preference and severity variants', () => {
    const keys = [...bell.matchAll(/t\('(notifications\.[^']+)'/g)].map((match) => match[1])
    keys.push(...['agent', 'actionRequired', 'budget'].map((name) => `notifications.preference.${name}`))
    keys.push(...['info', 'warning', 'error'].map((name) => `notifications.severity.${name}`))
    for (const key of keys) {
      expect(vi).toContain(`'${key}'`)
      expect(en).toContain(`'${key}'`)
    }
  })
})
