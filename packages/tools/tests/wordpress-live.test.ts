import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
const keyFile = process.env.WORDPRESS_TEST_KEY_FILE
const enabled = !!keyFile && existsSync(keyFile)
const base = 'http://127.0.0.1:8097/wp-json/'
async function wp(
  path: string,
  method = 'GET',
  body?: unknown,
  user = 'fixture',
) {
  const password = readFileSync(keyFile!, 'utf8').trim()
  const response = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, data: (await response.json()) as any }
}
describe.skipIf(!enabled)('Real WordPress bridge fixture', () => {
  it('checks identity, capabilities, authentication and fails closed without full backup', async () => {
    const bridge = await wp('marketing-agent/v1/capabilities')
    expect(bridge.status).toBe(200)
    expect(bridge.data.protocol).toBe(1)
    expect([401, 403]).toContain(
      (
        await wp(
          'marketing-agent/v1/capabilities',
          'GET',
          undefined,
          'not-a-user',
        )
      ).status,
    )
    const admin = await wp('marketing-agent/v1/admin', 'POST', {
      operation: 'settings',
      values: { blogname: 'Unsafe' },
    })
    expect(admin.status).toBe(409)
  })
  it('creates, updates, rejects stale snapshot, trashes and restores a real page', async () => {
    const created = await wp('marketing-agent/v1/content', 'POST', {
      action: 'create',
      resource: 'pages',
      data: {
        title: 'Fixture page',
        content: '<!-- wp:paragraph --><p>Original</p><!-- /wp:paragraph -->',
        status: 'draft',
      },
    })
    expect(created.status).toBe(200)
    const before = (await wp(`wp/v2/pages/${created.data.id}?context=edit`))
      .data
    const updated = await wp('marketing-agent/v1/content', 'POST', {
      action: 'update',
      resource: 'pages',
      id: before.id,
      expected: before,
      data: { title: 'Updated fixture' },
    })
    expect(updated.status).toBe(200)
    const stale = await wp('marketing-agent/v1/content', 'POST', {
      action: 'update',
      resource: 'pages',
      id: before.id,
      expected: before,
      data: { title: 'Must fail' },
    })
    expect(stale.status).toBe(409)
    const current = (await wp(`wp/v2/pages/${before.id}?context=edit`)).data
    const trashed = await wp('marketing-agent/v1/content', 'POST', {
      action: 'trash',
      resource: 'pages',
      id: before.id,
      expected: current,
      data: {},
    })
    expect(trashed.status).toBe(200)
    expect(trashed.data.status).toBe('trash')
    const expected = (await wp(`wp/v2/pages/${before.id}?context=edit`)).data
    const restored = await wp('marketing-agent/v1/restore', 'POST', {
      resource: 'pages',
      id: before.id,
      before: current,
      expected,
    })
    expect(restored.status).toBe(200)
    expect(restored.data.title.raw).toBe('Updated fixture')
    expect(restored.data.status).toBe('draft')
  })
  it('writes and reads Yoast and Rank Math metadata without writing both', async () => {
    const created = await wp('marketing-agent/v1/content', 'POST', {
        action: 'create',
        resource: 'posts',
        data: { title: 'SEO fixture', status: 'draft' },
      }),
      id = created.data.id
    for (const seoPlugin of ['yoast', 'rankmath']) {
      const expected = (await wp(`wp/v2/posts/${id}?context=edit`)).data,
        expectedSeo = (
          await wp('marketing-agent/v1/seo-state', 'POST', { id, seoPlugin })
        ).data
      const result = await wp('marketing-agent/v1/content', 'POST', {
        action: 'seo',
        resource: 'posts',
        id,
        seoPlugin,
        expected,
        expectedSeo,
        data: {
          title: `${seoPlugin} title`,
          description: 'Fixture description',
          robots: ['noindex', 'follow'],
        },
      })
      expect(result.status, JSON.stringify(result.data)).toBe(200)
      expect(result.data._ma_seo.title).toBe(`${seoPlugin} title`)
    }
    expect(
      (await wp('marketing-agent/v1/seo-state', 'POST', { id })).status,
    ).toBe(409)
  })
  it('manages taxonomy and image alt text through real REST endpoints', async () => {
    const category = await wp('marketing-agent/v1/content', 'POST', {
      action: 'create',
      resource: 'categories',
      data: { name: `Fixture category ${Date.now()}` },
    })
    expect(category.status, JSON.stringify(category.data)).toBe(200)
    const media = await wp('marketing-agent/v1/content', 'POST', {
      action: 'create',
      resource: 'media',
      data: {
        filename: 'fixture.png',
        file_base64:
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKf8AAAAASUVORK5CYII=',
        alt_text: 'Original alt',
      },
    })
    expect(media.status, JSON.stringify(media.data)).toBe(200)
    const expected = (await wp(`wp/v2/media/${media.data.id}?context=edit`))
      .data
    const optimized = await wp('marketing-agent/v1/content', 'POST', {
      action: 'optimize',
      resource: 'media',
      id: media.data.id,
      expected,
      data: { alt_text: 'Accessible image' },
    })
    expect(optimized.status, JSON.stringify(optimized.data)).toBe(200)
    expect(
      (await wp(`wp/v2/media/${media.data.id}?context=edit`)).data.alt_text,
    ).toBe('Accessible image')
    const page = await wp('marketing-agent/v1/content', 'POST', {
      action: 'create',
      resource: 'posts',
      data: {
        title: 'Image post',
        featured_media: media.data.id,
        categories: [category.data.id],
        status: 'draft',
      },
    })
    expect(page.status).toBe(200)
    expect(page.data.categories).toContain(category.data.id)
    expect(page.data.featured_media).toBe(media.data.id)
  })
})
