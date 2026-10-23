import { describe, expect, it } from 'vitest'
import { automationContentErrors, evaluateAutomationPolicy, isInQuietHours } from '../src/index.ts'
import type { AutomationPolicyRecord } from '@marketing-agent/shared'

const basePolicy: AutomationPolicyRecord = {
  companyId: 'cmp_1',
  enabled: true,
  timezone: 'Asia/Ho_Chi_Minh',
  channels: ['meta', 'linkedin', 'email'],
  maxPostsPerDay: 2,
  maxEmailsPerDay: 100,
  allowedHosts: [],
  quietStart: null,
  quietEnd: null,
  killSwitch: false,
  version: 3,
  updatedBy: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('CampaignLoop automation policy', () => {
  it('blocks disabled policies and kill switches', () => {
    expect(evaluateAutomationPolicy({ ...basePolicy, enabled: false }, { channel: 'meta', scheduledAt: '2026-01-02T00:00:00.000Z', postsUsedToday: 0, emailsUsedToday: 0 }).decision).toBe('pause')
    expect(evaluateAutomationPolicy({ ...basePolicy, killSwitch: true }, { channel: 'meta', scheduledAt: '2026-01-02T00:00:00.000Z', postsUsedToday: 0, emailsUsedToday: 0 }).decision).toBe('pause')
  })

  it('enforces channel, quota and consent rules', () => {
    expect(evaluateAutomationPolicy({ ...basePolicy, channels: ['email'] }, { channel: 'meta', scheduledAt: '2026-01-02T00:00:00.000Z', postsUsedToday: 0, emailsUsedToday: 0 }).decision).toBe('quarantine')
    expect(evaluateAutomationPolicy(basePolicy, { channel: 'meta', scheduledAt: '2026-01-02T00:00:00.000Z', postsUsedToday: 2, emailsUsedToday: 0 }).decision).toBe('pause')
    expect(evaluateAutomationPolicy(basePolicy, { channel: 'email', scheduledAt: '2026-01-02T00:00:00.000Z', postsUsedToday: 0, emailsUsedToday: 0, consentOptedIn: false }).decision).toBe('suppress')
    expect(evaluateAutomationPolicy(basePolicy, { channel: 'email', scheduledAt: '2026-01-02T00:00:00.000Z', postsUsedToday: 0, emailsUsedToday: 100, consentOptedIn: true }).decision).toBe('pause')
  })

  it('supports quiet hours that cross midnight in the client timezone', () => {
    const policy = { ...basePolicy, timezone: 'Asia/Ho_Chi_Minh', quietStart: '22:00', quietEnd: '07:00' }
    expect(isInQuietHours(new Date('2026-01-02T16:00:00.000Z'), policy)).toBe(true)
    expect(isInQuietHours(new Date('2026-01-02T23:00:00.000Z'), policy)).toBe(true)
    expect(isInQuietHours(new Date('2026-01-02T08:00:00.000Z'), policy)).toBe(false)
  })

  it('enforces an optional URL allowlist', () => {
    const policy = { ...basePolicy, allowedHosts: ['example.com'] }
    expect(evaluateAutomationPolicy(policy, { channel: 'meta', scheduledAt: '2026-01-02T00:00:00.000Z', postsUsedToday: 0, emailsUsedToday: 0, link: 'https://sub.example.com/post' }).decision).toBe('allow')
    expect(evaluateAutomationPolicy(policy, { channel: 'meta', scheduledAt: '2026-01-02T00:00:00.000Z', postsUsedToday: 0, emailsUsedToday: 0, link: 'https://evil.test/post' }).decision).toBe('quarantine')
  })

  it('rejects unsafe autonomous content before connector execution', () => {
    expect(automationContentErrors({ channel: 'meta', title: 'x', content: '<script>alert(1)</script>' })).toContain('Nội dung chứa mã script bị cấm')
    expect(automationContentErrors({ channel: 'email', title: '', content: 'body' })).toContain('Thiếu tiêu đề')
  })
})
