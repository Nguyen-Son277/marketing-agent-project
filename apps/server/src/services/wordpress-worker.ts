import { WordpressService, SocialBrowserService } from '@marketing-agent/tools'
import type { AppContext } from '../context.ts'
const cancellations = new WeakMap<AppContext, (id: string) => void>()
export function cancelWordpressJob(ctx: AppContext, id: string): void {
  cancellations.get(ctx)?.(id)
}

export function startWordpressWorker(ctx: AppContext) {
  ctx.repos.wordpress.recover()
  const service = new WordpressService(
    ctx.repos,
    undefined,
    async (job, site, operation, values, signal) => {
      const repo = ctx.repos.socialBrowser,
        channel = repo.channel(job.companyId, site.browserChannelId!)
      if (new URL(channel.entryUrl).origin !== new URL(site.url).origin)
        throw new Error('Browser channel không thuộc website')
      const content = repo.saveContent(job.companyId, {
        title: `WordPress ${operation}`,
        body: `WordPress ${operation}`,
      })
      const browserJob = repo.createJob(job.companyId, job.actorId, {
        channelId: channel.id,
        contentId: content.id,
        kind: 'publish',
        instructions: `WordPress adapter ${operation}`,
        idempotencyKey: `wordpress:${job.id}:${operation}:${String(values.stage ?? 'execute')}`,
      })
      repo.claim(job.companyId, browserJob.id)
      try {
        const result = await new SocialBrowserService(
          ctx.repos,
          ctx.config.companiesRoot,
        ).wordpress(
          job.companyId,
          job.actorId,
          browserJob.id,
          { ...values, siteUrl: site.url, operation },
          signal,
        )
        repo.setJob(
          job.companyId,
          browserJob.id,
          result.status === 'waiting_human' ? 'waiting_human' : 'succeeded',
          'WordPress job kiểm chứng kết quả riêng',
          site.url,
        )
        return result
      } catch (error) {
        repo.setJob(
          job.companyId,
          browserJob.id,
          'waiting_human',
          'Cần kiểm tra WordPress; không tự thử lại',
        )
        throw error
      }
    },
  )
  let stopped = false,
    active: Promise<void> | undefined,
    controller: AbortController | undefined,
    activeId: string | undefined
  const tick = () => {
    if (stopped || active) return
    const job = ctx.repos.wordpress.claim()
    if (!job) return
    controller = new AbortController()
    activeId = job.id
    active = service
      .execute(job, controller.signal)
      .catch((error) => {
        ctx.repos.wordpress.state(
          job.companyId,
          job.id,
          'uncertain',
          undefined,
          error instanceof Error ? error.message : 'Worker thất bại',
        )
      })
      .finally(() => {
        active = undefined
        controller = undefined
        activeId = undefined
      })
  }
  const timer = setInterval(tick, 1000)
  timer.unref()
  const cancel = (id: string) => {
    if (id === activeId) controller?.abort()
  }
  cancellations.set(ctx, cancel)
  return {
    cancel,
    async close() {
      stopped = true
      clearInterval(timer)
      controller?.abort()
      await active
      cancellations.delete(ctx)
    },
  }
}
