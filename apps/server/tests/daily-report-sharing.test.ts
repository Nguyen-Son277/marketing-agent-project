import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyPublicReport, DailyRoundCreateResponse } from '@marketing-agent/shared'
import { createRoutesTestContext, tenant, type RoutesTestContext, type TenantFixture } from './helpers/routes-helpers.ts'
import { sendError } from '../src/app.ts'
import { AppError } from '@marketing-agent/shared'
import type { ServerResponse } from 'node:http'

let ctx: RoutesTestContext, owner: TenantFixture
const origin = 'https://marketing.nguyenminhson.me'
beforeEach(async () => {
  ctx = await createRoutesTestContext()
  owner = await tenant(ctx, 'share@example.com', 'Sharing company')
  vi.stubEnv('PUBLIC_BASE_URL', origin)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T10:00:00+07:00'))
})
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); await ctx.close() })
function group() {
  return ctx.repos.dailyReports.save(owner.company.id, { name: 'Team', title: 'Daily team report', enabled: true, modelId: null, members: ['Alice', 'Châu'] })
}
function base(groupId: string) { return `/api/companies/${owner.company.id}/daily-report-groups/${groupId}/rounds` }
async function prepare(groupId: string, date = '2026-10-16') {
  return ctx.client.request('POST', base(groupId), { body: { date }, headers: owner.ownerCookie })
}
const key = (url: string): string => url.split('/').at(-1)!

describe('daily report dates and independent sharing links', () => {
  it('prepares a future round once and returns stable, separate URLs on the configured domain', async () => {
    const g = group(), first = await prepare(g.id), data = first.json<DailyRoundCreateResponse>()
    expect(first.status).toBe(201)
    expect(data.round.date).toBe('2026-10-16')
    expect(data.round).not.toHaveProperty('token')
    expect(data.share.url).toMatch(new RegExp(`^${origin}/#/daily-report/[A-Za-z0-9_-]{43}$`))
    expect(data.share.viewUrl).toMatch(new RegExp(`^${origin}/#/daily-report-view/[A-Za-z0-9_-]{43}$`))
    expect(key(data.share.url!)).not.toBe(key(data.share.viewUrl!))
    const repeated = await prepare(g.id)
    expect(repeated.status).toBe(200)
    expect(repeated.json()).toEqual(data)
    const detail = await ctx.client.request('GET', `${base(g.id)}/${data.round.id}`, { headers: owner.ownerCookie })
    expect(detail.json<{ share: unknown }>().share).toEqual(data.share)
    const stored = ctx.repos.db.get<Record<string, unknown>>('SELECT * FROM daily_report_view_links WHERE round_id=?', [data.round.id])!
    expect(Object.values(stored)).not.toContain(key(data.share.viewUrl!))
  })
  it('rejects invalid dates, Sundays and missing past rounds without creating links', async () => {
    const g = group()
    for (const date of ['2026-02-31', '2026-13-01', '15/10/2026', '', '2026-10-18', '2026-10-14']) {
      expect((await prepare(g.id, date)).status, date).toBe(400)
    }
    expect(ctx.repos.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM daily_report_view_links')!.n).toBe(0)
    const paused = ctx.repos.dailyReports.save(owner.company.id, { name: 'Paused', title: 'Report', enabled: false, modelId: null, members: ['Alice'] })
    expect((await prepare(paused.id)).status).toBe(400)
  })
  it('can share an existing historical round after the group is paused, preserving submission links', async () => {
    const g = group(), old = ctx.repos.dailyReports.ensureRound(g.id, '2026-10-14')
    const original = ctx.repos.dailyReports.round(old.id, true).token
    ctx.repos.dailyReports.save(owner.company.id, { ...g, enabled: false, members: g.members.map(member => member.name) }, g.id, g.version)
    const response = await prepare(g.id, old.date), data = response.json<DailyRoundCreateResponse>()
    expect(response.status).toBe(200)
    expect(data.round.id).toBe(old.id)
    expect(key(data.share.url!)).toBe(original)
    expect((await ctx.client.request('GET', `/api/public/daily-reports/${original}`)).status).toBe(200)
  })
  it('protects creation with management permission and tenant scope', async () => {
    const g = group()
    expect((await ctx.client.request('POST', base(g.id), { body: { date: '2026-10-16' } })).status).toBe(401)
    const other = await tenant(ctx, 'other-share@example.com', 'Other company')
    expect((await ctx.client.request('POST', base(g.id), { body: { date: '2026-10-16' }, headers: other.ownerCookie })).status).toBe(404)
    const wrongCompany = base(g.id).replace(owner.company.id, other.company.id)
    expect((await ctx.client.request('POST', wrongCompany, { body: { date: '2026-10-16' }, headers: other.ownerCookie })).status).toBe(404)
    ctx.repos.db.run("UPDATE memberships SET role='viewer' WHERE company_id=?", [owner.company.id])
    expect((await prepare(g.id)).status).toBe(403)
  })
  it('filters exact dates beyond the 120-round history and rejects invalid filters', async () => {
    const g = group(), old = ctx.repos.dailyReports.ensureRound(g.id, '2025-01-01')
    for (let day = 1; day <= 130; day++) {
      const date = new Date(Date.UTC(2025, 0, day + 1)).toISOString().slice(0, 10)
      ctx.repos.dailyReports.ensureRound(g.id, date)
    }
    const response = await ctx.client.request('GET', `${base(g.id)}?date=${old.date}`, { headers: owner.ownerCookie })
    expect(response.status).toBe(200)
    expect(response.json<{ rounds: { id: string }[] }>().rounds.map(round => round.id)).toEqual([old.id])
    expect((await ctx.client.request('GET', `${base(g.id)}?date=2026-02-30`, { headers: owner.ownerCookie })).status).toBe(400)
  })
  it('publishes only the latest ready English projection, keeping the previous ready version during updates', async () => {
    const g = group(), data = (await prepare(g.id, '2026-10-15')).json<DailyRoundCreateResponse>()
    const viewUrl = `/api/public/daily-report-views/${key(data.share.viewUrl!)}`
    const pending = await ctx.client.request('GET', viewUrl)
    expect(pending.status).toBe(200)
    expect(pending.json<DailyPublicReport>()).toMatchObject({ status: 'pending', members: [], executiveSummary: null })
    const input = { memberId: data.round.members[0]!.id, work: 'PRIVATE ORIGINAL', blockers: 'PRIVATE BLOCKER', nextSteps: 'PRIVATE PLAN' }
    ctx.repos.dailyReports.submit(data.round.id, input, new Date('2026-10-15T16:25:00+07:00'))
    ctx.repos.dailyReports.seal(data.round.id, new Date('2026-10-15T16:50:00+07:00'))
    const first = ctx.repos.dailyReports.claimJob()!
    ctx.repos.dailyReports.completeJob(first.id, { executiveSummary: 'First summary.', individuals: [{ memberId: input.memberId, work: 'Translated work.', blockers: '', nextSteps: '' }] })
    const ready = await ctx.client.request('GET', viewUrl), report = ready.json<DailyPublicReport>()
    expect(ready.headers.get('cache-control')).toBe('no-store')
    expect(ready.headers.get('referrer-policy')).toBe('no-referrer')
    expect(report).toMatchObject({ status: 'ready', number: 1, executiveSummary: 'First summary.' })
    expect(report.members).toEqual([{ name: 'Alice', status: 'on_time', isDayOff: false, work: 'Translated work.', blockers: '', nextSteps: '' }, { name: 'Châu', status: 'overdue', isDayOff: false, work: '', blockers: '', nextSteps: '' }])
    for (const secret of ['PRIVATE ORIGINAL', 'PRIVATE BLOCKER', 'PRIVATE PLAN', 'snapshot', 'editKey', 'memberId', 'companyId', 'modelId', 'token', 'error']) expect(ready.body).not.toContain(secret)
    ctx.repos.dailyReports.updateReport(data.round.id, new Date('2026-10-15T17:00:00+07:00'))
    expect((await ctx.client.request('GET', viewUrl)).json<DailyPublicReport>().number).toBe(1)
    const second = ctx.repos.dailyReports.claimJob()!
    ctx.repos.dailyReports.failJob(second.id, 'private provider configuration')
    expect((await ctx.client.request('GET', viewUrl)).json<DailyPublicReport>().number).toBe(1)
    ctx.repos.dailyReports.retry(data.round.id, second.id)
    ctx.repos.dailyReports.claimJob()
    ctx.repos.dailyReports.completeJob(second.id, { executiveSummary: 'Updated summary.', individuals: [] })
    expect((await ctx.client.request('GET', viewUrl)).json<DailyPublicReport>()).toMatchObject({ number: 2, executiveSummary: 'Updated summary.' })
  })
  it('does not allow view tokens to submit, submission tokens to view, or POST on the public viewer', async () => {
    const data = (await prepare(group().id)).json<DailyRoundCreateResponse>()
    const view = key(data.share.viewUrl!), submission = key(data.share.url!)
    expect((await ctx.client.request('GET', `/api/public/daily-reports/${view}`)).status).toBe(404)
    expect((await ctx.client.request('POST', `/api/public/daily-reports/${view}`, { body: { memberId: data.round.members[0]!.id, work: 'Attempt' } })).status).toBe(404)
    expect((await ctx.client.request('GET', `/api/public/daily-reports/${view}/members/${data.round.members[0]!.id}`)).status).toBe(404)
    expect((await ctx.client.request('GET', `/api/public/daily-report-views/${submission}`)).status).toBe(404)
    expect((await ctx.client.request('POST', `/api/public/daily-report-views/${view}`, { body: {} })).status).not.toBe(200)
    expect((await ctx.client.request('GET', `/api/public/daily-report-views/${view}`, { headers: { Origin: 'https://untrusted.example' } })).status).toBe(403)
  })
  it('keeps both URLs null with a clear warning when the public base URL is absent or invalid', async () => {
    const g = group()
    for (const value of ['', 'not-a-url', 'https://user:password@example.com', 'https://example.com?key=bad']) {
      vi.stubEnv('PUBLIC_BASE_URL', value)
      const response = await prepare(g.id)
      expect(response.json<DailyRoundCreateResponse>().share).toMatchObject({ url: null, viewUrl: null, warning: expect.any(String) })
    }
  })
  it('redacts tokens in viewer error logs', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = { headersSent: false, writeHead: vi.fn(), end: vi.fn() } as unknown as ServerResponse
    sendError(res, new AppError('internal', 'Failure'), false, `/api/public/daily-report-views/${'S'.repeat(43)}`)
    expect(log.mock.calls[0]![0]).toBe('[error] /api/public/daily-report-views/[redacted]:')
  })
})
