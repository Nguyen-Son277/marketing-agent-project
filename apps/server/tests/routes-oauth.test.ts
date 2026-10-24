import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoutesTestContext, tenant, type RoutesTestContext } from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext
beforeEach(async () => { ctx = await createRoutesTestContext() })
afterEach(async () => { vi.unstubAllGlobals(); await ctx.close() })

describe('OAuth và tài nguyên kết nối', () => {
  it('từ chối callback thiếu state, state đã dùng và callback khác provider', async () => {
    const missing = await ctx.client.request('GET', '/oauth/google/callback?code=abc')
    expect(missing.status).toBe(400)

    const { company } = await tenant(ctx, 'oauth-state@example.com', 'OAuth state')
    const user = ctx.repos.auth.findUserByEmail('oauth-state@example.com')!
    ctx.repos.oauth.createState({
      state: 'oauth-state-value', companyId: company.id, userId: user.id, provider: 'google',
      redirectUri: 'https://example.test/oauth/google/callback', expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    const mismatch = await ctx.client.request('GET', '/oauth/meta/callback?state=oauth-state-value&code=abc')
    expect(mismatch.status).toBe(401)
    const reused = await ctx.client.request('GET', '/oauth/google/callback?state=oauth-state-value&code=abc')
    expect(reused.status).toBe(401)
  })

  it('từ chối bắt đầu OAuth nếu chưa khai báo URL callback', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'oauth-start@example.com', 'OAuth start')
    ctx.repos.oauth.upsertApp({ companyId: company.id, provider: 'google', clientId: 'client', clientSecret: 'secret' })
    const response = await ctx.client.request('GET', `/oauth/google/start?companyId=${company.id}`, { headers: ownerCookie })
    expect(response.status).toBe(424)
  })

  it('cho phép lần sau chỉ bấm kết nối khi OAuth app đã lưu', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'oauth-app@example.com', 'OAuth app')
    const save = await ctx.client.request('PATCH', `/api/companies/${company.id}/oauth/google/app`, { headers: ownerCookie, body: { clientId: 'client-id', clientSecret: 'client-secret', name: 'Marketing app' } })
    expect(save.status).toBe(200)
    const app = await ctx.client.request('GET', `/api/companies/${company.id}/oauth/google/app`, { headers: ownerCookie })
    expect(app.status).toBe(200)
    expect(app.json<{ configured: boolean; name: string | null }>()).toMatchObject({ configured: true, name: 'Marketing app' })
    expect(app.body).not.toContain('client-secret')
  })

  it('trả danh sách Page và ad account mà không lộ access token', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'oauth-options@example.com', 'OAuth options')
    const integration = ctx.repos.accounting.upsertIntegration({
      companyId: company.id, kind: 'meta', name: 'Meta', config: { accessToken: 'secret-access-token' }, status: 'connected',
    })
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith(ctx.client.baseUrl)) return realFetch(input, init)
      if (url.includes('/me/accounts')) return new Response(JSON.stringify({ data: [{ id: 'page-1', name: 'Trang chính', access_token: 'should-not-leak' }] }), { headers: { 'content-type': 'application/json' } })
      if (url.includes('/me/adaccounts')) return new Response(JSON.stringify({ data: [{ id: 'act_2', name: 'Tài khoản ads' }] }), { headers: { 'content-type': 'application/json' } })
      return new Response('{}', { headers: { 'content-type': 'application/json' } })
    }))
    const response = await ctx.client.request('GET', `/api/companies/${company.id}/integrations/meta/options`, { headers: ownerCookie })
    expect(response.status).toBe(200)
    expect(response.body).not.toContain('secret-access-token')
    expect(response.body).not.toContain('should-not-leak')
    expect(response.json<{ options: { id: string; name: string; type?: string }[] }>().options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'page-1', name: 'Trang chính', type: 'page' }),
      expect.objectContaining({ id: 'act_2', name: 'Tài khoản ads', type: 'ad-account' }),
    ]))
    expect(ctx.repos.oauth.listResources(integration.id)).toEqual([])
  })

  it('lưu resource mặc định đúng tenant và xóa kết nối cùng token đã mã hóa', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'oauth-defaults@example.com', 'OAuth defaults')
    const integration = ctx.repos.accounting.upsertIntegration({ companyId: company.id, kind: 'linkedin', name: 'LinkedIn', config: { accessToken: 'secret' }, status: 'connected' })
    const saved = await ctx.client.request('PATCH', `/api/companies/${company.id}/integrations/${integration.id}/defaults`, { headers: ownerCookie, body: { defaults: { organizationUrn: 'urn:li:organization:123' } } })
    expect(saved.status).toBe(200)
    expect(ctx.repos.accounting.resolveIntegrationConfig(integration)).toEqual({ accessToken: 'secret' })
    expect(ctx.repos.accounting.resolveIntegrationConfig(ctx.repos.accounting.requireIntegration(integration.id, company.id))).toMatchObject({ organizationUrn: 'urn:li:organization:123' })
    expect(ctx.repos.oauth.listResources(integration.id)).toEqual([expect.objectContaining({ resourceId: 'urn:li:organization:123', selected: true })])
    const deleted = await ctx.client.request('DELETE', `/api/companies/${company.id}/integrations/${integration.id}`, { headers: ownerCookie })
    expect(deleted.status).toBe(200)
    expect(ctx.repos.accounting.findIntegration(company.id, 'linkedin')).toBeUndefined()
  })
})
