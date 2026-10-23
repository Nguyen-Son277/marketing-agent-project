import { beforeEach, describe, expect, it } from 'vitest'
import { createRepos, type Repos } from '../src/index.ts'
import { nowIso } from '@marketing-agent/shared'

let repos: Repos

beforeEach(() => {
  repos = createRepos({ file: ':memory:', appSecret: 'campaign-test-secret-123' })
  const user = repos.auth.createUser({ email: 'owner@example.test', password: 'password-12345', name: 'Owner', approvalStatus: 'approved' })
  repos.db.run('INSERT INTO companies(id,name,slug,created_at) VALUES(?,?,?,?)', ['cmp_test', 'Client', 'client', nowIso()])
  repos.auth.addMembership('cmp_test', user.id, 'owner')
})

describe('CampaignRepo', () => {
  it('keeps agency/client access scoped and creates a default policy', () => {
    const user = repos.auth.findUserByEmail('owner@example.test')!
    const agency = repos.campaigns.createAgency(user.id, 'Agency', 'agency')
    repos.campaigns.linkCompany(agency.id, 'cmp_test')
    expect(repos.campaigns.companyAccess(user.id, 'cmp_test').companyRole).toBe('owner')
    expect(repos.campaigns.getPolicy('cmp_test')).toBeUndefined()
    expect(repos.campaigns.ensurePolicy('cmp_test').enabled).toBe(false)
    expect(repos.campaigns.listAgencyClients(agency.id, user.id)[0]?.id).toBe('cmp_test')
  })

  it('deduplicates consent imports and never re-enables an unsubscribed contact', () => {
    const audience = repos.campaigns.createAudience('cmp_test', 'Opt in')
    const contact = { email: 'a@example.test', name: 'A', source: 'form', consentAt: nowIso(), consentVersion: 'v1' }
    expect(repos.campaigns.importContacts('cmp_test', audience.id, [contact, contact]).inserted).toBe(1)
    const stored = repos.campaigns.listContacts('cmp_test', audience.id)[0]!
    repos.campaigns.unsubscribe(stored.id)
    const result = repos.campaigns.importContacts('cmp_test', audience.id, [contact])
    expect(result.skippedUnsubscribed).toBe(1)
    expect(repos.campaigns.requireContact('cmp_test', stored.id).consentStatus).toBe('unsubscribed')
    const token = repos.campaigns.makeUnsubscribeToken(stored.id)
    expect(repos.campaigns.resolveUnsubscribeToken(token).contactId).toBe(stored.id)
  })

  it('queues one idempotent job per email contact and leases/replays safely', () => {
    const audience = repos.campaigns.createAudience('cmp_test', 'Opt in')
    repos.campaigns.importContacts('cmp_test', audience.id, [
      { email: 'a@example.test', name: null, source: 'form', consentAt: nowIso(), consentVersion: 'v1' },
      { email: 'b@example.test', name: null, source: 'form', consentAt: nowIso(), consentVersion: 'v1' },
    ])
    const campaign = repos.campaigns.createCampaign({
      companyId: 'cmp_test',
      userId: repos.auth.findUserByEmail('owner@example.test')!.id,
      name: 'Launch',
      timezone: 'Asia/Ho_Chi_Minh',
      items: [{ channel: 'email', title: 'Hello', content: 'Body', audienceId: audience.id, scheduledAt: '2026-01-01T00:00:00.000Z' }],
    })
    repos.campaigns.updatePolicy('cmp_test', repos.auth.findUserByEmail('owner@example.test')!.id, { enabled: true, maxEmailsPerDay: 10 })
    repos.campaigns.activateCampaign('cmp_test', campaign.id)
    expect(repos.campaigns.listJobs('cmp_test')).toHaveLength(2)
    const leased = repos.campaigns.leaseDueJobs(new Date('2026-01-01T00:00:01.000Z'), 60_000, 10)
    expect(leased).toHaveLength(2)
    repos.campaigns.completeJob(leased[0]!.id, 'accepted', 'msg-1', null)
    expect(repos.campaigns.listJobs('cmp_test').filter((job) => job.status === 'accepted')).toHaveLength(1)
    repos.campaigns.activateCampaign('cmp_test', campaign.id)
    expect(repos.campaigns.listJobs('cmp_test')).toHaveLength(2)
  })

  it('requeues cancelled jobs on resume without duplicating accepted jobs', () => {
    const campaign = repos.campaigns.createCampaign({
      companyId: 'cmp_test',
      userId: repos.auth.findUserByEmail('owner@example.test')!.id,
      name: 'Post',
      timezone: 'Asia/Ho_Chi_Minh',
      items: [{ channel: 'meta', title: 'Post', content: 'Hello', scheduledAt: '2026-01-01T00:00:00.000Z' }],
    })
    repos.campaigns.updatePolicy('cmp_test', repos.auth.findUserByEmail('owner@example.test')!.id, { enabled: true, maxPostsPerDay: 10 })
    repos.campaigns.activateCampaign('cmp_test', campaign.id)
    const first = repos.campaigns.listJobs('cmp_test')[0]!
    repos.campaigns.pauseCampaign('cmp_test', campaign.id)
    expect(repos.campaigns.listJobs('cmp_test')[0]!.status).toBe('cancelled')
    repos.campaigns.resumeCampaign('cmp_test', campaign.id)
    expect(repos.campaigns.listJobs('cmp_test')[0]!.status).toBe('queued')
    repos.campaigns.completeJob(first.id, 'accepted', 'post-1', null)
    repos.campaigns.activateCampaign('cmp_test', campaign.id)
    expect(repos.campaigns.listJobs('cmp_test')).toHaveLength(1)
  })

  it('cancels queued jobs immediately when the kill switch is enabled', () => {
    const ownerId = repos.auth.findUserByEmail('owner@example.test')!.id
    const campaign = repos.campaigns.createCampaign({ companyId: 'cmp_test', userId: ownerId, name: 'Kill', timezone: 'Asia/Ho_Chi_Minh', items: [{ channel: 'linkedin', title: 'Kill', content: 'Stop', scheduledAt: '2026-01-01T00:00:00.000Z' }] })
    repos.campaigns.updatePolicy('cmp_test', ownerId, { enabled: true, maxPostsPerDay: 10 })
    repos.campaigns.activateCampaign('cmp_test', campaign.id)
    repos.campaigns.updatePolicy('cmp_test', ownerId, { killSwitch: true })
    expect(repos.campaigns.listJobs('cmp_test')[0]!.status).toBe('cancelled')
  })

  it('increments execution metrics instead of overwriting contact-level sends', () => {
    const ownerId = repos.auth.findUserByEmail('owner@example.test')!.id
    const campaign = repos.campaigns.createCampaign({ companyId: 'cmp_test', userId: ownerId, name: 'Metrics', timezone: 'Asia/Ho_Chi_Minh', items: [{ channel: 'email', title: 'Metrics', content: 'Hello' }] })
    const itemId = campaign.items[0]!.id
    repos.campaigns.incrementMetric('cmp_test', { campaignItemId: itemId, channel: 'email', metricDate: '2026-01-01', metrics: { accepted: 1 } })
    repos.campaigns.incrementMetric('cmp_test', { campaignItemId: itemId, channel: 'email', metricDate: '2026-01-01', metrics: { accepted: 1 } })
    expect(JSON.parse(repos.campaigns.listMetrics('cmp_test')[0]!.metricsJson)).toEqual({ accepted: 2 })
  })
})
