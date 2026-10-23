import type { CampaignChannel, ToolContext } from '@marketing-agent/shared'
import type { AppContext } from '../context.ts'
import { toolRegistryFor } from './agent-services.ts'
import { automationContentErrors, evaluateAutomationPolicy } from '@marketing-agent/campaign-domain'

const LEASE_MS = 60_000
const MAX_ATTEMPTS = 3

export interface CampaignWorkerHandle {
  readonly tick: () => Promise<void>
  readonly close: () => Promise<void>
}

/**
 * Durable CampaignLoop executor. SQLite remains the source of truth: this
 * process only leases jobs, calls an existing integration tool, and commits the
 * result. A crash leaves an expired lease that the next tick can reclaim.
 */
export function startCampaignWorker(ctx: AppContext, options: { intervalMs?: number } = {}): CampaignWorkerHandle {
  const intervalMs = options.intervalMs ?? 1_000
  let closed = false
  let ticking = false
  const timer = setInterval(() => {
    void tick()
  }, intervalMs)
  timer.unref()

  async function tick(): Promise<void> {
    if (closed || ticking) return
    ticking = true
    try {
      const jobs = ctx.repos.campaigns.leaseDueJobs(new Date(), LEASE_MS, 20)
      for (const job of jobs) await executeJob(job)
    } catch (error) {
      console.error('[campaign-loop] worker tick thất bại:', error)
    } finally {
      ticking = false
    }
  }

  async function executeJob(job: ReturnType<AppContext['repos']['campaigns']['leaseDueJobs']>[number]): Promise<void> {
    if (!ctx.repos.campaigns.isJobLeased(job.id)) return
    const policy = ctx.repos.campaigns.ensurePolicy(job.companyId)
    const item = job.item
    const contentErrors = automationContentErrors(item)
    if (contentErrors.length > 0) {
      const reason = contentErrors.join('; ')
      ctx.repos.campaigns.completeJob(job.id, 'suppressed', null, reason)
      ctx.repos.accounting.audit({ companyId: job.companyId, action: 'campaign.execution.suppressed', target: job.id, payload: { reason } })
      publishSuppressed(ctx, job.companyId, job.id, reason)
      return
    }
    const now = new Date()
    const scheduledAt = item.scheduledAt ?? job.runAt
    const localDay = dateInZone(now, policy.timezone)
    const postsUsedToday = ctx.repos.campaigns.countAcceptedForDay(job.companyId, item.channel === 'email' ? 'meta' : item.channel, localDay, policy.timezone)
    const emailsUsedToday = ctx.repos.campaigns.countAcceptedForDay(job.companyId, 'email', localDay, policy.timezone)
    const contact = job.contactId ? ctx.repos.campaigns.requireContact(job.companyId, job.contactId) : undefined
    const decision = evaluateAutomationPolicy(policy, {
      channel: item.channel,
      scheduledAt,
      now,
      postsUsedToday,
      emailsUsedToday,
      ...(contact ? { consentOptedIn: contact.consentStatus === 'opted_in' } : {}),
      ...(item.link ? { link: item.link } : {}),
    })

    ctx.events.publish({
      type: 'campaign.execution.checked',
      companyId: job.companyId,
      payload: { jobId: job.id, campaignItemId: item.id, decision: decision.decision, reason: decision.reason },
      at: decision.checkedAt,
    })

    if (decision.decision !== 'allow') {
      const status = decision.decision === 'pause' ? 'cancelled' : 'suppressed'
      ctx.repos.campaigns.completeJob(job.id, status, null, decision.reason)
      ctx.repos.accounting.audit({ companyId: job.companyId, action: `campaign.execution.${status}`, target: job.id, payload: { reason: decision.reason } })
      publishSuppressed(ctx, job.companyId, job.id, decision.reason)
      return
    }

    if (item.channel === 'email' && !process.env.PUBLIC_BASE_URL) {
      const reason = 'Thiếu PUBLIC_BASE_URL nên không thể gửi email autonomous có unsubscribe'
      ctx.repos.campaigns.completeJob(job.id, 'suppressed', null, reason)
      ctx.repos.accounting.audit({ companyId: job.companyId, action: 'campaign.execution.suppressed', target: job.id, payload: { reason } })
      publishSuppressed(ctx, job.companyId, job.id, reason)
      return
    }

    const registry = await toolRegistryFor(ctx)
    if (!registry) {
      await retryOrFail(job, 'Chưa nạp được integration tool registry')
      return
    }

    const { toolName, args, agentRole } = await buildInvocation(ctx, job, contact?.email)
    const toolContext: ToolContext = {
      companyId: job.companyId,
      agentRole,
      agentDefId: agentRole,
      taskId: null,
      conversationId: null,
      automation: { jobId: job.id, policyVersion: policy.version },
      log: (message, data) => {
        if (data === undefined) console.log(`[campaign-loop] ${message}`)
        else console.log(`[campaign-loop] ${message}`, data)
      },
    }
    const result = await registry.execute(toolName, args, toolContext, [toolName])
    if (result.isError) {
      await retryOrFail(job, result.content)
      return
    }

    const providerRef = providerReference(result.data)
    ctx.repos.campaigns.completeJob(job.id, 'accepted', providerRef, null)
    ctx.repos.campaigns.incrementMetric(job.companyId, {
      campaignItemId: item.id,
      channel: item.channel,
      metricDate: new Date().toISOString().slice(0, 10),
      metrics: item.channel === 'email' ? { accepted: 1 } : { published: 1 },
    })
    ctx.repos.accounting.audit({ companyId: job.companyId, action: 'campaign.execution.accepted', target: job.id, payload: { channel: item.channel, providerRef } })
    ctx.repos.notifications.emit(job.companyId, `campaign:${job.id}:accepted`, 'agent', {
      type: 'campaign_success',
      severity: 'info',
      title: 'Campaign execution accepted / Campaign đã thực thi',
      body: `Kênh ${item.channel} đã được provider chấp nhận. / Channel ${item.channel} was accepted by the provider.`,
      link: '#/campaign-loop',
    })
    ctx.events.publish({
      type: 'campaign.execution.accepted',
      companyId: job.companyId,
      payload: { jobId: job.id, campaignItemId: item.id, channel: item.channel, providerRef },
      at: new Date().toISOString(),
    })
  }

  async function retryOrFail(job: ReturnType<AppContext['repos']['campaigns']['leaseDueJobs']>[number], error: string): Promise<void> {
    if (job.attempts < MAX_ATTEMPTS) {
      const delay = Math.min(15 * 60_000, 5_000 * 2 ** (job.attempts - 1))
      ctx.repos.campaigns.rescheduleJob(job.id, new Date(Date.now() + delay).toISOString(), safeError(error))
      ctx.events.publish({ type: 'campaign.execution.retrying', companyId: job.companyId, payload: { jobId: job.id, attempt: job.attempts, nextRunAt: new Date(Date.now() + delay).toISOString() }, at: new Date().toISOString() })
      return
    }
    ctx.repos.campaigns.completeJob(job.id, 'failed', null, safeError(error))
    ctx.repos.accounting.audit({ companyId: job.companyId, action: 'campaign.execution.failed', target: job.id, payload: { error: safeError(error) } })
    ctx.repos.notifications.emit(job.companyId, `campaign:${job.id}:failed`, 'actionRequired', {
      type: 'campaign_failure',
      severity: 'error',
      title: 'Campaign execution failed / Campaign thất bại',
      body: 'Một job CampaignLoop thất bại sau khi retry. Hãy kiểm tra CampaignLoop. / A CampaignLoop job failed after retries. Check CampaignLoop.',
      link: '#/campaign-loop',
    })
    ctx.events.publish({ type: 'campaign.execution.failed', companyId: job.companyId, payload: { jobId: job.id, error: safeError(error) }, at: new Date().toISOString() })
  }

  return {
    tick,
    async close() {
      if (closed) return
      closed = true
      clearInterval(timer)
      while (ticking) await new Promise<void>((resolve) => setTimeout(resolve, 5))
    },
  }
}

async function buildInvocation(
  ctx: AppContext,
  job: ReturnType<AppContext['repos']['campaigns']['leaseDueJobs']>[number],
  recipient: string | undefined,
): Promise<{ toolName: string; args: Record<string, unknown>; agentRole: ToolContext['agentRole'] }> {
  const item = job.item
  if (item.channel === 'meta') {
    return { toolName: 'meta_publish', agentRole: 'social-media', args: { message: item.content, ...(item.link ? { link: item.link } : {}), published: true } }
  }
  if (item.channel === 'linkedin') {
    return { toolName: 'linkedin_publish', agentRole: 'social-media', args: { commentary: item.content, ...(item.link ? { link: item.link } : {}), published: true } }
  }
  if (!recipient) throw new Error('Email job thiếu contact opted-in')
  let body = item.content
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '')
  if (base && job.contactId) {
    const token = ctx.repos.campaigns.makeUnsubscribeToken(job.contactId)
    body += `\n\nHuỷ đăng ký: ${base}/api/public/campaign-loop/unsubscribe/${token}`
  }
  return { toolName: 'email_send', agentRole: 'email-crm', args: { to: [recipient], subject: item.title, body, send: true } }
}

function providerReference(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  for (const key of ['postId', 'messageId', 'id']) {
    if (typeof record[key] === 'string') return record[key]
  }
  return null
}

function safeError(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').slice(0, 500)
}

function publishSuppressed(ctx: AppContext, companyId: string, jobId: string, reason: string): void {
  ctx.events.publish({ type: 'campaign.execution.suppressed', companyId, payload: { jobId, reason }, at: new Date().toISOString() })
}

function dateInZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
    const values = new Map(parts.map((part) => [part.type, part.value]))
    return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

