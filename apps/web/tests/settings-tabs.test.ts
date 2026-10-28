import { describe, expect, it } from 'vitest'
import { SETTINGS_TABS, settingsTabForKey, settingsTabFromHash } from '../src/lib/settings-tabs.ts'

describe('settings tab navigation', () => {
  it('restores all seven tabs from direct URLs and safely defaults for old or invalid links', () => {
    expect(SETTINGS_TABS).toHaveLength(7)
    for (const tab of SETTINGS_TABS) expect(settingsTabFromHash(`#/cai-dat?tab=${tab.id}`)).toBe(tab.id)
    for (const hash of ['#/cai-dat', '#/cai-dat?tab=unknown', '#/cai-dat?tab=', '#/other?tab=models']) expect(settingsTabFromHash(hash)).toBe('providers')
    expect(settingsTabFromHash('#/cai-dat?other=1&tab=knowledge')).toBe('knowledge')
    expect(settingsTabFromHash('#/cai-dat?tab=wordpress')).toBe('wordpress')
  })
  it('cycles with arrows, supports Home/End and leaves unrelated keys alone', () => {
    expect(settingsTabForKey('ArrowLeft', 0)).toBe('limits')
    expect(settingsTabForKey('ArrowRight', 6)).toBe('providers')
    expect(settingsTabForKey('ArrowRight', 1)).toBe('routes')
    expect(settingsTabForKey('ArrowRight', 4)).toBe('wordpress')
    expect(settingsTabForKey('ArrowRight', 5)).toBe('limits')
    expect(settingsTabForKey('ArrowLeft', 5)).toBe('integrations')
    expect(settingsTabForKey('Home', 5)).toBe('providers')
    expect(settingsTabForKey('End', 0)).toBe('limits')
    expect(settingsTabForKey('Tab', 1)).toBeNull()
  })
})
