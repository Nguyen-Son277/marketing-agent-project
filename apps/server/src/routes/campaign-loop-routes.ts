import { isValidTimeZone, parseContactCsv } from '@marketing-agent/campaign-domain'
import {
  createAgencySchema,
  createAudienceSchema,
  createCampaignSchema,
  importAudienceSchema,
  parseOrThrow,
  updateAutomationPolicySchema,
  validation,
  forbidden,
  type AgencyRole,
  type CampaignChannel,
  type CampaignItemStatus,
  type CampaignStatus,
  type ConsentStatus,
  type ExecutionJobStatus,
} from '@marketing-agent/shared'
import type {
  AgencyClientView,
  AgencyResponse,
  AgencyView,
  AudienceContactView,
  AudienceView,
  AutomationPolicyView,
  CampaignItemView,
  CampaignLoopResponse,
  CampaignView,
  ExecutionAttemptView,
  ExecutionJobView,
  MetricSnapshotView,
} from '@marketing-agent/shared'
import { slugify } from '@marketing-agent/shared'
import type { AppContext } from '../context.ts'
import { requireAgencyAccess, requireAuth, requireCampaignAccess, requireAuthState } from '../http/middleware.ts'
import type { RequestContext, Router } from '../http/router.ts'
import { createCompanyForUser } from '../services/company-service.ts'
import { ensureUniqueSlug } from './auth-routes.ts'

export function campaignLoopRoutes() {
  return {
    name: 'campaign-loop',
    register(router: Router, ctx: AppContext): void {
      const repos = ctx.repos

      router.get('/api/agencies', (request) => {
        const userId = requireAuthState(request).user.id
        const agencies = repos.campaigns.listAgenciesForUser(userId).map(toAgencyView)
        request.json(200, { agencies })
      }, [requireAuth])

      router.post('/api/agencies', async (request) => {
        const user = requireAuthState(request).user
        const input = parseOrThrow(createAgencySchema, await request.body(), 'agency')
        const slug = uniqueAgencySlug(repos, input.name)
        const agency = repos.campaigns.createAgency(user.id, input.name, slug)
        repos.accounting.audit({ userId: user.id, action: 'agency.create', target: agency.id })
        request.json(201, { agency: { ...toAgencyView(agency), role: 'owner' as const }, clients: [] })
      }, [requireAuth])

      router.get('/api/agencies/:agencyId', (request) => {
        const userId = requireAuthState(request).user.id
        const agency = repos.campaigns.requireAgencyMembership(request.params.agencyId!, userId)
        const record = repos.campaigns.requireAgency(request.params.agencyId!)
        const response: AgencyResponse = {
          agency: { ...toAgencyView(record), role: agency.role },
          clients: repos.campaigns.listAgencyClients(request.params.agencyId!, userId).map(toAgencyClientView),
        }
        request.json(200, response)
      }, [requireAgencyAccess(repos)])

      router.post('/api/agencies/:agencyId/clients', async (request) => {
        const user = requireAuthState(request).user
        const input = parseOrThrow(createAgencyClientSchema, await request.body(), 'client workspace')
        const result = createCompanyForUser(repos, { name: input.name, slug: ensureUniqueSlug(repos, input.name), user })
        repos.campaigns.linkCompany(request.params.agencyId!, result.company.id)
        repos.accounting.audit({ userId: user.id, companyId: result.company.id, action: 'agency.client.create', target: request.params.agencyId! })
        request.json(201, { company: result.company, role: result.role })
      }, [requireAgencyAccess(repos, true)])

      router.get('/api/companies/:companyId/campaign-loop', (request) => {
        const companyId = request.params.companyId!
        const response: CampaignLoopResponse = {
          campaigns: repos.campaigns.listCampaigns(companyId).map(toCampaignView),
          policy: toPolicyView(repos.campaigns.ensurePolicy(companyId)),
          audiences: repos.campaigns.listAudiences(companyId).map(toAudienceView),
          jobs: repos.campaigns.listJobs(companyId).map(toJobView),
          metrics: repos.campaigns.listMetrics(companyId).map(toMetricView),
        }
        request.json(200, response)
      }, [requireCampaignAccess(repos)])

      router.get('/api/companies/:companyId/automation-policy', (request) => {
        request.json(200, { policy: toPolicyView(repos.campaigns.ensurePolicy(request.params.companyId!)) })
      }, [requireCampaignAccess(repos)])

      router.patch('/api/companies/:companyId/automation-policy', async (request) => {
        assertCampaignManage(request)
        const input = parseOrThrow(updateAutomationPolicySchema, await request.body(), 'automation policy')
        if (input.timezone && !isValidTimeZone(input.timezone)) throw validation('Múi giờ IANA không hợp lệ')
        const userId = requireAuthState(request).user.id
        const policy = repos.campaigns.updatePolicy(request.params.companyId!, userId, input)
        repos.accounting.audit({ companyId: request.params.companyId!, userId, action: 'campaign.policy.update', target: request.params.companyId!, payload: { version: policy.version, enabled: policy.enabled, killSwitch: policy.killSwitch } })
        request.json(200, { policy: toPolicyView(policy) })
      }, [requireCampaignAccess(repos, true)])

      router.get('/api/companies/:companyId/campaigns', (request) => {
        request.json(200, { campaigns: repos.campaigns.listCampaigns(request.params.companyId!).map(toCampaignView) })
      }, [requireCampaignAccess(repos)])

      router.post('/api/companies/:companyId/campaigns', async (request) => {
        const userId = requireAuthState(request).user.id
        const input = parseOrThrow(createCampaignSchema, await request.body(), 'chiến dịch')
        if (!isValidTimeZone(input.timezone)) throw validation('Múi giờ IANA không hợp lệ')
        const campaign = repos.campaigns.createCampaign({ companyId: request.params.companyId!, userId, ...input })
        repos.accounting.audit({ companyId: request.params.companyId!, userId, action: 'campaign.create', target: campaign.id })
        request.json(201, { campaign: toCampaignView(campaign) })
      }, [requireCampaignAccess(repos, true)])

      for (const action of ['activate', 'pause', 'resume'] as const) {
        router.post(`/api/companies/:companyId/campaigns/:campaignId/${action}`, (request) => {
          const companyId = request.params.companyId!
          const campaignId = request.params.campaignId!
          const campaign = action === 'activate'
            ? repos.campaigns.activateCampaign(companyId, campaignId)
            : action === 'pause'
              ? repos.campaigns.pauseCampaign(companyId, campaignId)
              : repos.campaigns.resumeCampaign(companyId, campaignId)
          repos.accounting.audit({ companyId, userId: requireAuthState(request).user.id, action: `campaign.${action}`, target: campaignId })
          request.json(200, { campaign: toCampaignView(campaign) })
        }, [requireCampaignAccess(repos, true)])
      }

      router.get('/api/companies/:companyId/audiences', (request) => {
        request.json(200, { audiences: repos.campaigns.listAudiences(request.params.companyId!).map(toAudienceView) })
      }, [requireCampaignAccess(repos)])

      router.post('/api/companies/:companyId/audiences', async (request) => {
        const input = parseOrThrow(createAudienceSchema, await request.body(), 'audience')
        const audience = repos.campaigns.createAudience(request.params.companyId!, input.name)
        repos.accounting.audit({ companyId: request.params.companyId!, userId: requireAuthState(request).user.id, action: 'campaign.audience.create', target: audience.id })
        request.json(201, { audience: toAudienceView({ ...audience, contactCount: 0, optedInCount: 0, unsubscribedCount: 0 }) })
      }, [requireCampaignAccess(repos, true)])

      router.get('/api/companies/:companyId/audiences/:audienceId/contacts', (request) => {
        request.json(200, { contacts: repos.campaigns.listContacts(request.params.companyId!, request.params.audienceId!).map(toContactView) })
      }, [requireCampaignAccess(repos)])

      router.post('/api/companies/:companyId/audiences/:audienceId/import', async (request) => {
        const body = await request.body<unknown>()
        const companyId = request.params.companyId!
        const audienceId = request.params.audienceId!
        const contacts = parseImportBody(body)
        const result = repos.campaigns.importContacts(companyId, audienceId, contacts)
        repos.accounting.audit({ companyId, userId: requireAuthState(request).user.id, action: 'campaign.audience.import', target: audienceId, payload: result })
        request.json(200, { result, audience: toAudienceView(repos.campaigns.listAudiences(companyId).find((item) => item.id === audienceId)!) })
      }, [requireCampaignAccess(repos, true)])

      router.get('/api/companies/:companyId/execution-jobs', (request) => {
        request.json(200, { jobs: repos.campaigns.listJobs(request.params.companyId!).map(toJobView) })
      }, [requireCampaignAccess(repos)])

      router.get('/api/companies/:companyId/execution-jobs/:jobId/attempts', (request) => {
        const attempts: ExecutionAttemptView[] = repos.campaigns.listAttempts(request.params.companyId!, request.params.jobId!).map((attempt) => ({ ...attempt, status: attempt.status as ExecutionJobStatus }))
        request.json(200, { attempts })
      }, [requireCampaignAccess(repos)])

      router.get('/api/companies/:companyId/campaign-metrics', (request) => {
        request.json(200, { metrics: repos.campaigns.listMetrics(request.params.companyId!).map(toMetricView) })
      }, [requireCampaignAccess(repos)])

      router.get('/api/public/campaign-loop/unsubscribe/:token', (request) => {
        unsubscribe(request, repos)
      })
      router.post('/api/public/campaign-loop/unsubscribe/:token', (request) => {
        unsubscribe(request, repos)
      })
    },
  }
}

const createAgencyClientSchema = createAgencySchema

function assertCampaignManage(request: RequestContext): void {
  const access = request.state.campaignAccess as { companyRole?: string | null; agencyRole?: AgencyRole | null } | undefined
  const allowed = access?.companyRole === 'owner' || access?.companyRole === 'admin' || access?.agencyRole === 'owner' || access?.agencyRole === 'admin'
  if (!allowed) throw forbidden('Cần quyền owner/admin để thay đổi automation policy')
}

function parseImportBody(body: unknown): { email: string; name?: string | null; source: string; consentAt: string; consentVersion: string }[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw validation('Dữ liệu import audience không hợp lệ')
  const record = body as Record<string, unknown>
  if (typeof record.csv === 'string') {
    const source = typeof record.source === 'string' ? record.source : 'csv-import'
    const consentVersion = typeof record.consentVersion === 'string' ? record.consentVersion : 'v1'
    const consentAt = typeof record.consentAt === 'string' ? record.consentAt : new Date().toISOString()
    return parseContactCsv(record.csv, { source, consentVersion, consentAt })
  }
  const parsed = parseOrThrow(importAudienceSchema, body, 'danh sách audience')
  return parsed.contacts
}

function unsubscribe(request: RequestContext, repos: AppContext['repos']): void {
  const resolved = repos.campaigns.resolveUnsubscribeToken(request.params.token!)
  repos.campaigns.unsubscribe(resolved.contactId)
  request.text(200, 'Đã huỷ đăng ký nhận email. Bạn sẽ không nhận thêm email từ danh sách này.', 'text/plain; charset=utf-8')
}

function uniqueAgencySlug(repos: AppContext['repos'], name: string): string {
  const base = slugify(name) || 'agency'
  let slug = base
  let suffix = 2
  // `agencies.slug` is global; check it directly so a slug owned by another user cannot collide.
  while (repos.db.get('SELECT id FROM agencies WHERE slug=?', [slug])) {
    slug = `${base}-${suffix}`
    suffix += 1
  }
  return slug
}

function toAgencyView(value: { id: string; name: string; slug: string; createdAt: string; role?: AgencyRole }): AgencyView & { role: AgencyRole } {
  return { id: value.id, name: value.name, slug: value.slug, createdAt: value.createdAt, role: value.role ?? 'analyst' }
}

function toAgencyClientView(value: { id: string; name: string; slug: string; role: string | null; campaignCount: number; activeCampaigns: number; queuedJobs: number }): AgencyClientView {
  return { ...value, role: value.role as AgencyClientView['role'] }
}

function toPolicyView(value: ReturnType<AppContext['repos']['campaigns']['ensurePolicy']>): AutomationPolicyView {
  return { ...value }
}

function toCampaignView(value: ReturnType<AppContext['repos']['campaigns']['requireCampaign']>): CampaignView {
  return { ...value, status: value.status as CampaignStatus, items: value.items.map((item) => ({ ...item, channel: item.channel as CampaignChannel, status: item.status as CampaignItemStatus })) }
}

function toAudienceView(value: { id: string; name: string; createdAt: string; contactCount: number; optedInCount: number; unsubscribedCount: number }): AudienceView {
  return { ...value }
}

function toContactView(value: ReturnType<AppContext['repos']['campaigns']['listContacts']>[number]): AudienceContactView {
  return { ...value, consentStatus: value.consentStatus as ConsentStatus }
}

function toJobView(value: ReturnType<AppContext['repos']['campaigns']['listJobs']>[number]): ExecutionJobView {
  return { id: value.id, campaignItemId: value.campaignItemId, status: value.status as ExecutionJobStatus, runAt: value.runAt, attempts: value.attempts, providerRequestId: value.providerRequestId, error: value.error, updatedAt: value.updatedAt }
}

function toMetricView(value: ReturnType<AppContext['repos']['campaigns']['listMetrics']>[number]): MetricSnapshotView {
  let metrics: Record<string, number | string> = {}
  try {
    const parsed = JSON.parse(value.metricsJson) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metrics = parsed as Record<string, number | string>
  } catch { /* keep empty */ }
  return { id: value.id, campaignItemId: value.campaignItemId, channel: value.channel as CampaignChannel, metricDate: value.metricDate, metrics, createdAt: value.createdAt }
}

