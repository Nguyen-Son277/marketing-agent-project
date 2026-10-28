import { z } from 'zod'
import {
  parseOrThrow,
  wordpressSiteSchema,
  wordpressJobSchema,
  conflict,
} from '@marketing-agent/shared'
import { WordpressService } from '@marketing-agent/tools'
import type { Router } from '../http/router.ts'
import type { AppContext } from '../context.ts'
import {
  requireAuthState,
  requireMembership,
  requireManage,
} from '../http/middleware.ts'
import { cancelWordpressJob } from '../services/wordpress-worker.ts'

export function registerWordpressRoutes(router: Router, ctx: AppContext): void {
  const repo = ctx.repos.wordpress,
    root = '/api/companies/:companyId/wordpress',
    read = [requireMembership(ctx.repos)],
    write = [...read, requireManage],
    service = new WordpressService(ctx.repos)
  router.get(
    `${root}/sites`,
    (r) => r.json(200, { sites: repo.sites(r.params.companyId!) }),
    read,
  )
  router.post(
    `${root}/sites`,
    async (r) => {
      const companyId = r.params.companyId!,
        actor = requireAuthState(r).user.id
      repo.manage(companyId, actor)
      const site = repo.save(
        companyId,
        parseOrThrow(wordpressSiteSchema, await r.body(), 'Website WordPress'),
      )
      const grants: Record<string, string[]> = {
        'marketing-leader': [
          'wordpress_sites',
          'wordpress_read',
          'wordpress_content',
          'wordpress_seo',
          'wordpress_admin',
          'wordpress_audit',
          'wordpress_optimize',
          'wordpress_restore',
        ],
        'content-writer': [
          'wordpress_sites',
          'wordpress_read',
          'wordpress_content',
        ],
        'seo-technical': [
          'wordpress_sites',
          'wordpress_read',
          'wordpress_content',
          'wordpress_seo',
          'wordpress_admin',
          'wordpress_audit',
          'wordpress_optimize',
        ],
        'design-video': [
          'wordpress_sites',
          'wordpress_read',
          'wordpress_content',
          'wordpress_admin',
        ],
      }
      for (const [role, names] of Object.entries(grants)) {
        const def = ctx.repos.team.listAgentDefs().find((d) => d.role === role),
          preset = def && ctx.repos.team.findPreset(companyId, def.id)
        if (preset)
          for (const name of names)
            ctx.repos.db.run(
              'INSERT OR IGNORE INTO agent_preset_tools(preset_id,company_id,tool_name,config_json) VALUES(?,?,?,NULL)',
              [preset.id, companyId, name],
            )
      }
      repo.event(companyId, site.id, null, 'connected', { actorId: actor })
      r.json(201, { site })
    },
    write,
  )
  router.patch(
    `${root}/sites/:siteId`,
    async (r) => {
      const input = parseOrThrow(
        wordpressSiteSchema
          .partial()
          .extend({ enabled: z.boolean().optional() }),
        await r.body(),
        'Sửa kết nối WordPress',
      )
      const site = repo.update(r.params.companyId!, r.params.siteId!, input)
      repo.event(site.companyId, site.id, null, 'connection.updated', {
        actorId: requireAuthState(r).user.id,
      })
      r.json(200, { site })
    },
    write,
  )
  router.delete(
    `${root}/sites/:siteId`,
    (r) => {
      repo.disable(r.params.companyId!, r.params.siteId!)
      repo.event(
        r.params.companyId!,
        r.params.siteId!,
        null,
        'connection.revoked',
        { actorId: requireAuthState(r).user.id },
      )
      r.json(200, { disabled: true })
    },
    write,
  )
  router.post(
    `${root}/sites/:siteId/test`,
    async (r) =>
      r.json(200, {
        capabilities: await service.check(
          r.params.companyId!,
          r.params.siteId!,
        ),
      }),
    write,
  )
  router.get(
    `${root}/sites/:siteId/events`,
    (r) =>
      r.json(200, {
        events: repo.events(r.params.companyId!, r.params.siteId!),
      }),
    read,
  )
  router.get(
    `${root}/jobs`,
    (r) => r.json(200, { jobs: repo.jobs(r.params.companyId!) }),
    read,
  )
  router.get(
    `${root}/jobs/:jobId`,
    (r) => r.json(200, { job: repo.job(r.params.companyId!, r.params.jobId!) }),
    read,
  )
  router.post(
    `${root}/jobs`,
    async (r) =>
      r.json(201, {
        job: repo.enqueue(
          r.params.companyId!,
          requireAuthState(r).user.id,
          parseOrThrow(wordpressJobSchema, await r.body(), 'WordPress job'),
        ),
      }),
    write,
  )
  router.post(
    `${root}/jobs/:jobId/approve`,
    async (r) => {
      const { hash } = parseOrThrow(
        z.object({ hash: z.string().length(64) }),
        await r.body(),
        'Duyệt xóa',
      )
      repo.approve(
        r.params.companyId!,
        r.params.jobId!,
        requireAuthState(r).user.id,
        hash,
      )
      r.json(200, { job: repo.job(r.params.companyId!, r.params.jobId!) })
    },
    write,
  )
  router.post(
    `${root}/jobs/:jobId/cancel`,
    (r) => {
      const job = repo.job(r.params.companyId!, r.params.jobId!)
      if (job.status === 'running') {
        cancelWordpressJob(ctx, job.id)
        r.json(202, {
          cancellationRequested: true,
          message:
            'Lệnh ghi đã gửi có thể đã áp dụng; kiểm tra kết quả trước khi thử lại.',
        })
        return
      }
      if (
        !['queued', 'awaiting_approval', 'waiting_human'].includes(job.status)
      )
        throw conflict('Job đã kết thúc')
      repo.state(job.companyId, job.id, 'cancelled')
      repo.event(job.companyId, job.siteId, job.id, 'cancelled', {
        actorId: requireAuthState(r).user.id,
      })
      r.json(200, { cancelled: true })
    },
    write,
  )
}
