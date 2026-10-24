import { randomBytes, createHash } from 'node:crypto'
import { z } from 'zod'
import { AppError, parseOrThrow, type IntegrationKind } from '@marketing-agent/shared'
import type { AppContext } from '../context.ts'
import { requireAuthState, requireManage, requireMembership } from '../http/middleware.ts'
import type { Router } from '../http/router.ts'
import type { OAuthProvider } from '@marketing-agent/db'

const providerSchema = z.enum(['google', 'meta', 'linkedin'])
const appSchema = z.object({ clientId: z.string().trim().min(1).max(500), clientSecret: z.string().trim().min(1).max(2000), name: z.string().trim().max(120).optional() })
const kindByProvider: Record<OAuthProvider, IntegrationKind> = { google: 'google-analytics', meta: 'meta', linkedin: 'linkedin' }
const googleKinds = new Set<IntegrationKind>(['google-search-console', 'google-analytics', 'google-sheets', 'google-ads'])
const googleScopes = ['openid', 'email', 'https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/adwords']
const oauthProvider = (value: string): OAuthProvider => { const parsed = providerSchema.safeParse(value); if (!parsed.success) throw new AppError('validation', 'Nhà cung cấp OAuth không hợp lệ'); return parsed.data }

function callbackBase(ctx: AppContext): string {
  const base = (ctx.config.oauthCallbackBaseUrl ?? ctx.config.publicBaseUrl)?.replace(/\/+$/, '')
  if (!base) throw new AppError('needs_configuration', 'Thiếu PUBLIC_BASE_URL hoặc OAUTH_CALLBACK_BASE_URL để kết nối OAuth')
  try { const url = new URL(base); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol'); return url.toString().replace(/\/+$/, '') } catch { throw new AppError('needs_configuration', 'PUBLIC_BASE_URL phải là URL HTTP/HTTPS hợp lệ') }
}

function callbackUri(ctx: AppContext, provider: OAuthProvider): string { return `${callbackBase(ctx)}/oauth/${provider}/callback` }
function frontendRedirect(ctx: AppContext, provider: OAuthProvider, params: Record<string, string>): string {
  const url = new URL(`${callbackBase(ctx)}/settings`)
  url.searchParams.set('oauth', provider)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}
function integrationKind(provider: OAuthProvider, requested: string | undefined): IntegrationKind {
  if (provider !== 'google') return kindByProvider[provider]
  if (requested && googleKinds.has(requested as IntegrationKind)) return requested as IntegrationKind
  return 'google-analytics'
}
function pkceVerifier(): string { return randomBytes(32).toString('base64url') }
function pkceChallenge(value: string): string { return createHash('sha256').update(value).digest('base64url') }

async function exchange(provider: OAuthProvider, code: string, app: { clientId: string; clientSecret: string }, redirectUri: string, verifier?: string): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
  if (verifier) body.set('code_verifier', verifier)
  const endpoint = provider === 'google' ? 'https://oauth2.googleapis.com/token' : provider === 'meta' ? 'https://graph.facebook.com/v20.0/oauth/access_token' : 'https://www.linkedin.com/oauth/v2/accessToken'
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body })
  const text = await response.text()
  let data: Record<string, unknown>
  try { data = JSON.parse(text) as Record<string, unknown> } catch { throw new AppError('provider_error', `OAuth ${provider} trả về dữ liệu không hợp lệ`) }
  if (!response.ok || typeof data.access_token !== 'string' && typeof data.refresh_token !== 'string') throw new AppError('provider_error', `OAuth ${provider} từ chối cấp quyền`)
  return data
}

export function oauthRoutes() {
  return {
    name: 'oauth',
    register(router: Router, ctx: AppContext): void {
      const repos = ctx.repos

      router.patch('/api/companies/:companyId/oauth/:provider/app', async (request) => {
        const companyId = request.params.companyId!
        const provider = oauthProvider(request.params.provider!)
        const input = parseOrThrow(appSchema, await request.body(), 'OAuth app')
        repos.oauth.upsertApp({ companyId, provider, ...input })
        repos.accounting.audit({ companyId, action: 'oauth.app.upsert', target: provider })
        request.json(200, { provider, configured: true })
      }, [requireMembership(repos), requireManage])

      router.get('/oauth/:provider/start', async (request) => {
        const auth = requireAuthState(request)
        const companyId = request.query('companyId')
        if (!companyId) throw new AppError('validation', 'OAuth start thiếu companyId')
        const membership = repos.auth.membership(companyId, auth.user.id)
        if (!membership || !['owner', 'admin'].includes(membership.role)) throw new AppError('forbidden', 'Cần quyền quản trị công ty')
        const provider = oauthProvider(request.params.provider!)
        const app = repos.oauth.findApp(companyId, provider)
        if (!app) throw new AppError('needs_configuration', `Chưa cấu hình OAuth app cho ${provider}`)
        const resolved = repos.oauth.resolveApp(app)
        const requestedKind = request.query('kind')
        const redirectUri = `${callbackUri(ctx, provider)}${requestedKind ? `?kind=${encodeURIComponent(requestedKind)}` : ''}`
        const state = randomBytes(32).toString('base64url')
        const verifier = pkceVerifier()
        repos.oauth.createState({ state, companyId, userId: auth.user.id, provider, redirectUri, codeVerifier: verifier, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() })
        const url = provider === 'google' ? new URL('https://accounts.google.com/o/oauth2/v2/auth') : provider === 'meta' ? new URL('https://www.facebook.com/v20.0/dialog/oauth') : new URL('https://www.linkedin.com/oauth/v2/authorization')
        url.searchParams.set('client_id', resolved.clientId)
        url.searchParams.set('redirect_uri', redirectUri)
        url.searchParams.set('response_type', 'code')
        url.searchParams.set('state', state)
        url.searchParams.set('code_challenge', pkceChallenge(verifier)); url.searchParams.set('code_challenge_method', 'S256')
        if (provider === 'google') { url.searchParams.set('scope', googleScopes.join(' ')); url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent') }
        if (provider === 'meta') { url.searchParams.set('scope', 'pages_show_list,pages_read_engagement,ads_read,instagram_basic'); url.searchParams.set('auth_type', 'rerequest') }
        if (provider === 'linkedin') url.searchParams.set('scope', 'openid profile email w_member_social')
        request.redirect(url.toString())
      }, [])

      router.get('/oauth/:provider/callback', async (request) => {
        const provider = oauthProvider(request.params.provider!)
        const stateValue = request.query('state'); const code = request.query('code'); const oauthError = request.query('error')
        if (!stateValue) throw new AppError('validation', 'OAuth callback thiếu state')
        const state = repos.oauth.consumeState(stateValue)
        if (!state || state.provider !== provider || new Date(state.expiresAt).getTime() <= Date.now()) throw new AppError('unauthorized', 'OAuth state không hợp lệ hoặc đã hết hạn')
        if (oauthError || !code) request.redirect(frontendRedirect(ctx, provider, { status: 'error', error: oauthError ?? 'missing_code' }));
        else {
          try {
            const app = repos.oauth.findApp(state.companyId, provider)
            if (!app) throw new AppError('needs_configuration', 'OAuth app không còn tồn tại')
            const tokens = await exchange(provider, code, repos.oauth.resolveApp(app), state.redirectUri, repos.oauth.resolveCodeVerifier(state))
            const kind = provider === 'google' ? integrationKind(provider, request.query('kind')) : kindByProvider[provider]
            const config: Record<string, unknown> = { ...tokens, clientId: repos.oauth.resolveApp(app).clientId, clientSecret: repos.oauth.resolveApp(app).clientSecret }
            if (provider === 'google' && !config.refresh_token) config.refreshToken = undefined
            if (config.access_token) config.accessToken = config.access_token
            if (config.refresh_token) config.refreshToken = config.refresh_token
            const existing = repos.accounting.findIntegration(state.companyId, kind)
            const name = existing?.name ?? (provider === 'google' ? `Google ${kind}` : provider[0]!.toUpperCase() + provider.slice(1))
            repos.accounting.upsertIntegration({ companyId: state.companyId, kind, name, config, status: 'connected' })
            repos.accounting.audit({ companyId: state.companyId, userId: state.userId, action: 'oauth.connected', target: `${provider}:${kind}` })
            request.redirect(frontendRedirect(ctx, provider, { status: 'connected', kind }))
          } catch (error) { request.redirect(frontendRedirect(ctx, provider, { status: 'error', error: error instanceof Error ? error.message : 'oauth_failed' })) }
        }
      })

      router.get('/api/companies/:companyId/integrations/:kind/options', async (request) => {
        const companyId = request.params.companyId!
        const kind = request.params.kind as IntegrationKind
        const record = repos.accounting.findIntegration(companyId, kind)
        if (!record) throw new AppError('not_found', 'Không tìm thấy kết nối')
        const config = repos.accounting.resolveIntegrationConfig<Record<string, unknown>>(record) ?? {}
        const token = String(config.accessToken ?? config.access_token ?? '')
        if (!token) return request.json(200, { options: [] })
        const options = (kind === 'google-search-console' ? await providerJson('https://www.googleapis.com/webmasters/v3/sites', token, 'siteEntry') : kind === 'google-analytics' ? await providerJson('https://analyticsadmin.googleapis.com/v1beta/properties', token, 'properties') : kind === 'google-ads' ? await providerJson('https://googleads.googleapis.com/v18/customers:listAccessibleCustomers', token, 'resourceNames') : kind === 'meta' ? await providerJson('https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token', token, 'data') : kind === 'linkedin' ? await providerJson('https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee', token, 'elements') : []).map((item) => {
          if (typeof item === 'string') return { id: item, name: item.split('/').pop() ?? item }
          const value = item as Record<string, unknown>
          const id = String(value.siteUrl ?? value.id ?? value.organizationalTarget ?? '')
          return { id, name: String(value.name ?? id) }
        })
        request.json(200, { options })
      }, [requireMembership(repos)])

      router.patch('/api/companies/:companyId/integrations/:integrationId/defaults', async (request) => {
        const companyId = request.params.companyId!
        const rawBody = await request.body<Record<string, unknown>>()
        const body = (rawBody?.defaults && typeof rawBody.defaults === 'object' ? rawBody.defaults : rawBody) as Record<string, unknown>
        const allowed = ['siteUrl', 'propertyId', 'customerId', 'pageId', 'adAccountId', 'organizationUrn', 'developerToken']
        const patch = Object.fromEntries(Object.entries(body ?? {}).filter(([key]) => allowed.includes(key) && typeof body?.[key] === 'string'))
        const record = repos.accounting.updateIntegrationConfig(companyId, request.params.integrationId!, patch)
        request.json(200, { integration: { id: record.id, kind: record.kind, status: record.status, configured: Boolean(record.configEnc) } })
      }, [requireMembership(repos), requireManage])

      router.post('/api/companies/:companyId/integrations/:integrationId/reconnect', async (request) => {
        const companyId = request.params.companyId!
        const record = repos.accounting.requireIntegration(request.params.integrationId!, companyId)
        const provider: OAuthProvider | undefined = record.kind.startsWith('google-') ? 'google' : record.kind === 'meta' ? 'meta' : record.kind === 'linkedin' ? 'linkedin' : undefined
        if (!provider) throw new AppError('validation', 'Kết nối này không dùng OAuth')
        const base = callbackBase(ctx)
        const url = new URL(`${base}/oauth/${provider}/start`); url.searchParams.set('kind', record.kind); url.searchParams.set('companyId', companyId)
        request.redirect(url.toString(), 303)
      }, [requireMembership(repos), requireManage])
    },
  }
}

async function providerJson(url: string, token: string, key: string): Promise<unknown[]> {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
  if (!response.ok) return []
  const body = await response.json() as Record<string, unknown>
  const value = body[key]
  return Array.isArray(value) ? value : []
}
