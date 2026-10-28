import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRepos, type Repos } from '@marketing-agent/db'
import { seedCatalog, seedCompany } from '@marketing-agent/seed'
import {
  wordpressJobSchema,
  wordpressSiteSchema,
} from '@marketing-agent/shared'
import { WordpressService, createWordpressTools } from '../src/wordpress.ts'

let repos: Repos, companyId: string, actor: string, siteId: string
beforeEach(() => {
  repos = createRepos({ file: ':memory:', allowWeakSecret: true })
  seedCatalog(repos)
  const seeded = seedCompany(repos, {
    companyName: 'WP tenant',
    ownerEmail: 'wp@example.test',
    ownerPassword: 'password-123456',
  })
  companyId = seeded.company.id
  actor = seeded.owner!.id
  const user = repos.auth.findUserByEmail('wp@example.test')!
  repos.db.run("UPDATE users SET approval_status='approved' WHERE id=?", [
    user.id,
  ])
  siteId = repos.wordpress.save(
    companyId,
    wordpressSiteSchema.parse({
      name: 'Site',
      url: 'https://wordpress.example.test',
      username: 'admin',
      applicationPassword: 'secret-application-password',
    }),
  ).id
})
afterEach(() => repos.db.close())
const input = (action: string, extra: Record<string, unknown> = {}) =>
  wordpressJobSchema.parse({
    siteId,
    action,
    resource: 'pages',
    resourceId: 7,
    data: { title: 'New' },
    idempotencyKey: crypto.randomUUID(),
    ...extra,
  })
async function execute(
  service: WordpressService,
  action: string,
  extra: Record<string, unknown> = {},
) {
  const j = repos.wordpress.enqueue(companyId, actor, input(action, extra))
  const claimed = repos.wordpress.claim()!
  await service.execute(claimed)
  return repos.wordpress.job(companyId, j.id)
}

describe('WordPress jobs and execution', () => {
  it('encrypts credentials and hides cross-company website/job', () => {
    expect(JSON.stringify(repos.wordpress.sites(companyId))).not.toContain(
      'secret-application-password',
    )
    expect(repos.wordpress.credentials(companyId, siteId).password).toBe(
      'secret-application-password',
    )
    expect(() => repos.wordpress.site('other', siteId)).toThrow()
    expect(() => repos.wordpress.credentials('other', siteId)).toThrow()
    const row = repos.db.get<{ password_enc: string }>(
      'SELECT password_enc FROM wordpress_sites WHERE id=?',
      [siteId],
    )!
    expect(row.password_enc).not.toContain('secret-application-password')
  })
  it('checks trusted actor before enqueue and again before execution', async () => {
    expect(() =>
      repos.wordpress.enqueue(companyId, 'outsider', input('update')),
    ).toThrow()
    const job = repos.wordpress.enqueue(companyId, actor, input('update'))
    repos.db.run('DELETE FROM memberships WHERE user_id=? AND company_id=?', [
      actor,
      companyId,
    ])
    const remote = vi.fn()
    await expect(
      new WordpressService(repos, remote).execute(job),
    ).rejects.toThrow()
    expect(remote).not.toHaveBeenCalled()
  })
  it('keeps idempotency stable and locks writers per website', () => {
    const request = input('update')
    const first = repos.wordpress.enqueue(companyId, actor, request)
    expect(repos.wordpress.enqueue(companyId, actor, request).id).toBe(first.id)
    expect(() =>
      repos.wordpress.enqueue(companyId, actor, {
        ...request,
        data: { title: 'Different' },
      }),
    ).toThrow()
    repos.wordpress.enqueue(companyId, actor, input('update'))
    expect(repos.wordpress.claim()?.id).toBe(first.id)
    expect(repos.wordpress.claim()).toBeUndefined()
    repos.wordpress.recover()
    expect(repos.wordpress.job(companyId, first.id).status).toBe('uncertain')
    expect(repos.wordpress.claim()).toBeTruthy()
  })
  it('writes snapshot before sending update and preserves after state', async () => {
    const remote = vi.fn(async (_s, path, method, data) => {
      if (method === 'POST') {
        expect(repos.wordpress.jobs(companyId)[0]!.snapshot).toMatchObject({
          before: { id: 7, title: 'Old' },
          requested: { title: 'New' },
        })
        expect(data.expected).toEqual({ id: 7, title: 'Old' })
        return { id: 7, title: 'New' }
      }
      return { id: 7, title: 'Old' }
    })
    const job = await execute(new WordpressService(repos, remote), 'update')
    expect(job.status).toBe('completed')
    expect(job.snapshot).toMatchObject({ after: { id: 7, title: 'New' } })
  })
  it('requires approval for exact production deletion version and invalidates stale approval', async () => {
    let version = 1
    const remote = vi.fn(async (_s, path, method) =>
      method === 'POST' ? { id: 7, status: 'trash' } : { id: 7, version },
    )
    const service = new WordpressService(repos, remote)
    let job = await execute(service, 'trash', { data: {} })
    expect(job.status).toBe('awaiting_approval')
    expect(remote.mock.calls.filter((c: any) => c[2] === 'POST')).toHaveLength(0)
    repos.wordpress.approve(companyId, job.id, actor, job.approvalHash!)
    version = 2
    await service.execute(repos.wordpress.claim()!)
    job = repos.wordpress.job(companyId, job.id)
    expect(job.status).toBe('awaiting_approval')
    repos.wordpress.approve(companyId, job.id, actor, job.approvalHash!)
    await service.execute(repos.wordpress.claim()!)
    expect(repos.wordpress.job(companyId, job.id).status).toBe('completed')
  })
  it('does not retry ambiguous writes, and fails backup gate before admin mutation', async () => {
    const remote = vi.fn(async (_s, path, method) => {
      if (path.endsWith('backup-status')) return { verified: false }
      if (path.endsWith('/admin-state')) return { theme: 'old' }
      if (method === 'POST') throw new Error('connection lost after write')
      return { id: 7 }
    })
    expect(
      (await execute(new WordpressService(repos, remote), 'update')).status,
    ).toBe('uncertain')
    const admin = await execute(new WordpressService(repos, remote), 'admin', {
      data: { operation: 'theme_activate', target: 'new' },
    })
    expect(admin.status).toBe('failed')
    expect(admin.error).toContain('backup')
    expect(remote.mock.calls.some((c) => c[1].endsWith('/admin'))).toBe(false)
  })
  it('snapshots SEO metadata and restores only matching website/version', async () => {
    const current = { id: 7, title: { raw: 'Page' } }
    const remote = vi.fn(async (_s, path, method, data) =>
      path.endsWith('seo-state')
        ? { title: 'Old SEO' }
        : method === 'POST'
          ? { ...current, _ma_seo: { title: 'New SEO' } }
          : current,
    )
    const job = await execute(new WordpressService(repos, remote), 'seo')
    expect(job.snapshot).toMatchObject({
      before: { _ma_seo: { title: 'Old SEO' } },
      after: { _ma_seo: { title: 'New SEO' } },
    })
    const restore = await execute(
      new WordpressService(repos, remote),
      'restore',
      { sourceJobId: job.id, data: {} },
    )
    expect(restore.status).toBe('failed')
    expect(restore.error).toContain('đã đổi')
  })
  it('turns unsupported browser adapter into human handoff and guards tool actor', async () => {
    const job = await execute(new WordpressService(repos, vi.fn()), 'admin', {
      data: { operation: 'elementor', values: { postId: 7 } },
    })
    expect(job.status).toBe('waiting_human')
    const tool = createWordpressTools(repos).find(
      (t) => t.name === 'wordpress_sites',
    )!
    await expect(
      tool.handler(
        {},
        {
          companyId,
          agentRole: 'marketing-leader',
          agentDefId: 'leader',
          taskId: null,
          conversationId: null,
          log: () => {},
        },
      ),
    ).rejects.toThrow()
  })
  it('reads back acknowledged changes and restores a matching snapshot', async () => {
    let state = { id: 7, title: 'Original' }
    const remote = vi.fn(async (_s, path, method, data) => {
      if (method === 'POST')
        state = path.endsWith('/restore')
          ? data.before
          : { ...state, ...data.data }
      return structuredClone(state)
    })
    const service = new WordpressService(repos, remote)
    const updated = await execute(service, 'update')
    expect(updated.result).toMatchObject({
      _ma_verification: { readBackMatches: true, restStatus: 200 },
    })
    const restored = await execute(service, 'restore', {
      sourceJobId: updated.id,
      data: {},
    })
    expect(restored.status).toBe('completed')
    expect(state.title).toBe('Original')
  })
  it('measures managed media before/after and never repeats a write when verification fails', async () => {
    let state: Record<string, unknown> = { id: 7, alt_text: 'Old' }
    let broken = false
    const remote = vi.fn(async (_s, path, method, data) => {
      if (method === 'POST') {
        state = { ...state, ...data.data }
        return structuredClone(state)
      }
      if (broken) throw new Error('Read failed')
      return structuredClone(state)
    })
    const service = new WordpressService(repos, remote)
    const source = await execute(service, 'create', {
      resource: 'media',
      resourceId: undefined,
      data: { title: 'Managed image' },
    })
    const audit = vi
      .spyOn(service, 'audit')
      .mockResolvedValueOnce({ lcp: 1000 })
      .mockRejectedValueOnce(new Error('Chrome offline'))
    const optimized = await execute(service, 'optimize', {
      resource: 'media',
      sourceJobId: source.id,
      data: { alt_text: 'Better alt' },
      urls: ['https://wordpress.example.test/'],
    })
    expect(audit).toHaveBeenCalledTimes(2)
    expect(optimized.status).toBe('completed')
    expect(optimized.result).toMatchObject({
      _ma_verification: {
        readBackMatches: true,
        measurementError: expect.any(String),
      },
    })
    const posts = remote.mock.calls.filter((c) => c[2] === 'POST').length
    broken = true
    const created = await execute(service, 'create', { resourceId: undefined })
    expect(created.status).toBe('completed')
    expect(created.result).toMatchObject({
      _ma_verification: { readBackMatches: false },
    })
    expect(remote.mock.calls.filter((c) => c[2] === 'POST')).toHaveLength(
      posts + 1,
    )
  })
  it('refuses model-supplied domains and arbitrary HTTP fields before mutation', async () => {
    const remote = vi.fn(async () => ({ id: 7, title: 'Old' }))
    const job = await execute(new WordpressService(repos, remote), 'update', {
      data: {
        title: 'New',
        url: 'https://other.example.test',
        endpoint: '/wp/v2/users',
      },
    })
    expect(job.status).toBe('failed')
    expect(remote.mock.calls.filter((c: any) => c[2] === 'POST')).toHaveLength(0)
  })
  it('grants WordPress tools to web-technical role', () => {
    const tools = createWordpressTools(repos)
    for (const tool of tools) {
      expect(tool.roles).toContain('web-technical')
    }
  })
})
