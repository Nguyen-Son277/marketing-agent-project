import { mcpRoutes } from '../src/routes/mcp-routes.ts'
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import {
  createRoutesTestContext,
  tenant,
  registerUser,
  type RoutesTestContext,
} from './helpers/routes-helpers.ts'
let ctx: RoutesTestContext
beforeEach(async () => {
  ctx = await createRoutesTestContext()
})
afterEach(async () => {
  await ctx.close()
})
describe('WordPress HTTP boundaries', () => {
  it('stores multi-site credentials without exposing them and grants tools only in company', async () => {
    const { ownerCookie, company } = await tenant(
      ctx,
      'wp-owner@example.test',
      'WP',
    )
    const root = `/api/companies/${company.id}/wordpress`
    const added = await ctx.client.request('POST', `${root}/sites`, {
      headers: ownerCookie,
      body: {
        name: 'Site A',
        url: 'https://wordpress.example.test',
        username: 'wpadmin',
        applicationPassword: 'application-secret',
      },
    })
    expect(added.status).toBe(201)
    expect(added.body).not.toContain('application-secret')
    const site = added.json<{ site: { id: string } }>().site
    const other = await tenant(ctx, 'wp-other@example.test', 'Other')
    expect(
      (
        await ctx.client.request('GET', `${root}/sites`, {
          headers: other.ownerCookie,
        })
      ).status,
    ).toBe(404)
    const viewer = await registerUser(ctx, 'wp-viewer@example.test')
    ctx.repos.auth.addMembership(company.id, viewer.userId, 'viewer')
    expect(
      (
        await ctx.client.request('GET', `${root}/sites`, {
          headers: viewer.cookie,
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await ctx.client.request('POST', `${root}/jobs`, {
          headers: viewer.cookie,
          body: {
            siteId: site.id,
            action: 'create',
            idempotencyKey: 'wp-test-001',
            data: { title: 'New' },
          },
        })
      ).status,
    ).toBe(403)
    const def = ctx.repos.team.findAgentDefByRole('seo-technical')!,
      preset = ctx.repos.team.findPreset(company.id, def.id)!
    expect(
      ctx.repos.team
        .listPresetTools(preset.id)
        .some((t) => t.toolName === 'wordpress_seo'),
    ).toBe(true)
    expect((await ctx.client.request('GET', `${root}/sites`)).status).toBe(401)
  })
  it('validates inputs, preserves job idempotency and cancels pending work when connection revoked', async () => {
    const { ownerCookie, company } = await tenant(
        ctx,
        'wp-jobs@example.test',
        'Jobs',
      ),
      root = `/api/companies/${company.id}/wordpress`
    const invalid = await ctx.client.request('POST', `${root}/sites`, {
      headers: ownerCookie,
      body: {
        name: 'Bad',
        url: 'http://example.test',
        username: 'admin',
        applicationPassword: 'secret-test',
      },
    })
    expect(invalid.status).toBe(400)
    const created = await ctx.client.request('POST', `${root}/sites`, {
        headers: ownerCookie,
        body: {
          name: 'Good',
          url: 'https://example.test',
          username: 'admin',
          applicationPassword: 'secret-test',
        },
      }),
      siteId = created.json<{ site: { id: string } }>().site.id
    const input = {
      siteId,
      action: 'create',
      resource: 'pages',
      data: { title: 'New' },
      idempotencyKey: 'unique-key-001',
    }
    const first = await ctx.client.request('POST', `${root}/jobs`, {
        headers: ownerCookie,
        body: input,
      }),
      second = await ctx.client.request('POST', `${root}/jobs`, {
        headers: ownerCookie,
        body: input,
      })
    expect(first.status).toBe(201)
    expect(first.json<{ job: { id: string } }>().job.id).toBe(
      second.json<{ job: { id: string } }>().job.id,
    )
    await ctx.client.request('DELETE', `${root}/sites/${siteId}`, {
      headers: ownerCookie,
    })
    expect(ctx.repos.wordpress.jobs(company.id)[0]?.status).toBe('cancelled')
    expect(
      (
        await ctx.client.request('POST', `${root}/jobs`, {
          headers: ownerCookie,
          body: { ...input, idempotencyKey: 'new-key-002' },
        })
      ).status,
    ).toBe(409)
  })
  it('binds MCP credentials to the trusted creator and rejects revoked management permissions', async () => {
    mcpRoutes().register(ctx.app.router, ctx.app.context)
    const { ownerCookie, company } = await tenant(
      ctx,
      'wp-mcp@example.test',
      'MCP',
    )
    const added = await ctx.client.request(
      'POST',
      `/api/companies/${company.id}/mcp-servers`,
      {
        headers: ownerCookie,
        body: {
          name: 'Test',
          transport: 'streamable_http',
          endpoint: 'https://mcp.example.test',
        },
      },
    )
    expect(added.status).toBe(201)
    const data = added.json<{ server: { id: string }; inboundApiKey: string }>()
    const actor = ctx.repos.db.get<{ id: string }>(
      'SELECT actor_user_id AS id FROM mcp_servers WHERE id=?',
      [data.server.id],
    )!.id
    ctx.repos.db.run(
      "UPDATE memberships SET role='viewer' WHERE company_id=? AND user_id=?",
      [company.id, actor],
    )
    const denied = await ctx.client.request('POST', `/mcp/${company.id}`, {
      headers: { 'x-api-key': data.inboundApiKey },
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'wordpress_sites', arguments: { actorUserId: actor } },
      },
    })
    expect(denied.status).toBe(403)
    ctx.repos.db.run('UPDATE mcp_servers SET actor_user_id=NULL WHERE id=?', [
      data.server.id,
    ])
    expect(
      (
        await ctx.client.request('POST', `/mcp/${company.id}`, {
          headers: { 'x-api-key': data.inboundApiKey },
          body: {},
        })
      ).status,
    ).toBe(401)
  })
})
