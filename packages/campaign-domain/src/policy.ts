import type {
  AutomationDecision,
  AutomationPolicyRecord,
  CampaignChannel,
  CampaignItemRecord,
} from '@marketing-agent/shared'
import { nowIso } from '@marketing-agent/shared'

export interface PolicyEvaluationInput {
  readonly channel: CampaignChannel
  readonly scheduledAt: string
  readonly now?: Date
  readonly postsUsedToday: number
  readonly emailsUsedToday: number
  readonly consentOptedIn?: boolean
  readonly link?: string | null
}

/** Return false for an invalid IANA zone instead of letting DateTimeFormat throw. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format()
    return true
  } catch {
    return false
  }
}

export function minutesOfDay(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return -1
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return -1
  return hour * 60 + minute
}

/**
 * Quiet hours are evaluated in the policy's client timezone. A range crossing
 * midnight (22:00 → 07:00) is supported explicitly.
 */
export function isInQuietHours(date: Date, policy: Pick<AutomationPolicyRecord, 'timezone' | 'quietStart' | 'quietEnd'>): boolean {
  if (!policy.quietStart || !policy.quietEnd || !isValidTimeZone(policy.timezone)) return false
  const start = minutesOfDay(policy.quietStart)
  const end = minutesOfDay(policy.quietEnd)
  if (start < 0 || end < 0 || start === end) return false
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: policy.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  const current = hour * 60 + minute
  return start < end ? current >= start && current < end : current >= start || current < end
}

export function evaluateAutomationPolicy(
  policy: AutomationPolicyRecord,
  input: PolicyEvaluationInput,
): AutomationDecision {
  const checkedAt = nowIso()
  const allow = (reason: string): AutomationDecision => ({
    decision: 'allow',
    reason,
    policyVersion: policy.version,
    checkedAt,
  })
  const deny = (decision: AutomationDecision['decision'], reason: string): AutomationDecision => ({
    decision,
    reason,
    policyVersion: policy.version,
    checkedAt,
  })

  if (!policy.enabled) return deny('pause', 'Automation policy đang tắt')
  if (policy.killSwitch) return deny('pause', 'Kill switch đang bật')
  if (!policy.channels.includes(input.channel)) return deny('quarantine', `Kênh ${input.channel} chưa được cho phép`)
  if (!isValidTimeZone(policy.timezone)) return deny('quarantine', `Múi giờ ${policy.timezone} không hợp lệ`)

  const scheduledAt = new Date(input.scheduledAt)
  if (!Number.isFinite(scheduledAt.getTime())) return deny('quarantine', 'Thời điểm lịch không hợp lệ')
  const now = input.now ?? new Date()
  if (scheduledAt.getTime() > now.getTime() + 365 * 24 * 60 * 60 * 1000) {
    return deny('quarantine', 'Không cho phép lập lịch xa hơn một năm')
  }
  if (isInQuietHours(scheduledAt, policy)) return deny('suppress', 'Nằm trong giờ yên lặng của client')

  if (input.channel === 'email') {
    if (!input.consentOptedIn) return deny('suppress', 'Contact chưa có consent opt-in hợp lệ')
    if (policy.maxEmailsPerDay > 0 && input.emailsUsedToday >= policy.maxEmailsPerDay) {
      return deny('pause', 'Đã đạt quota email trong ngày')
    }
  } else if (policy.maxPostsPerDay > 0 && input.postsUsedToday >= policy.maxPostsPerDay) {
    return deny('pause', 'Đã đạt quota bài đăng trong ngày')
  }

  if (input.link) {
    if (!/^https?:\/\//i.test(input.link)) return deny('quarantine', 'Link chỉ được dùng HTTP hoặc HTTPS')
    if (policy.allowedHosts.length > 0) {
      try {
        const host = new URL(input.link).hostname.toLowerCase()
        const allowed = policy.allowedHosts.some((value) => {
          let normalized = value.toLowerCase().trim()
          try { normalized = new URL(normalized.includes('://') ? normalized : `https://${normalized}`).hostname.toLowerCase() } catch { /* fall through to a non-match */ }
          return host === normalized || host.endsWith(`.${normalized}`)
        })
        if (!allowed) return deny('quarantine', 'Link không nằm trong URL allowlist của policy')
      } catch {
        return deny('quarantine', 'Link không hợp lệ')
      }
    }
  }
  return allow('Đạt policy tự động hóa')
}

export function countItemsForDay(items: readonly CampaignItemRecord[], channel: CampaignChannel, day: string): number {
  return items.filter((item) => item.channel === channel && item.scheduledAt?.slice(0, 10) === day && item.status === 'accepted').length
}

/** Mechanical preflight that runs before any autonomous connector call. */
export function automationContentErrors(input: { channel: CampaignChannel; title: string; content: string }): string[] {
  const errors: string[] = []
  if (input.title.trim().length === 0) errors.push('Thiếu tiêu đề')
  if (input.content.trim().length === 0) errors.push('Thiếu nội dung')
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(input.content)) errors.push('Nội dung chứa ký tự điều khiển')
  if (/<\/?script\b/i.test(input.content) || /javascript:/i.test(input.content)) errors.push('Nội dung chứa mã script bị cấm')
  if (input.channel !== 'email' && input.content.length > 30_000) errors.push('Nội dung social vượt 30.000 ký tự')
  return errors
}

