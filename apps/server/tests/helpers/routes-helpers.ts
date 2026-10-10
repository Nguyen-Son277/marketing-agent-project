/**
 * Khung dựng server thật cho test tầng route.
 *
 * Vì sao dùng app thật + HTTP loopback thay vì gọi handler trực tiếp: quyền, cookie,
 * mã trạng thái và SSE chỉ đúng khi đi qua đúng chuỗi middleware của sản phẩm. Test
 * gọi handler sẽ bỏ qua chính thứ dễ sai nhất — hàng rào tenancy.
 *
 * Mỗi test dựng một `Repos` in-memory riêng; cache singleton trong `agent-services.ts`
 * khoá theo đối tượng `Repos`, nên các test không dùng lẫn orchestrator của nhau.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRepos, type Repos } from '@marketing-agent/db'
import { seedCatalog } from '@marketing-agent/seed'
import { buildApp, type App, type OptionalRouteModule } from '../../src/app.ts'
import { EventBus, type AppContext } from '../../src/context.ts'
import { loadConfig } from '../../src/config.ts'
import { SESSION_COOKIE } from '../../src/http/middleware.ts'
import { cookieHeader, startTestServer, type TestClient, type TestResponse } from './test-client.ts'
import { toolRoutes } from '../../src/routes/tool-routes.ts'
import { teamRoutes } from '../../src/routes/team-routes.ts'
import { knowledgeRoutes } from '../../src/routes/knowledge-routes.ts'
import { chatRoutes } from '../../src/routes/chat-routes.ts'
import { taskRoutes } from '../../src/routes/task-routes.ts'
import { settingsRoutes } from '../../src/routes/settings-routes.ts'
import { costRoutes } from '../../src/routes/cost-routes.ts'
import { diagramRoutes } from '../../src/routes/diagram-routes.ts'
import { dashboardRoutes } from '../../src/routes/dashboard-routes.ts'

const SECRET = 'unit-test-app-secret-0123456789'

export interface RoutesTestContext {
  readonly repos: Repos
  readonly app: App
  readonly client: TestClient
  /** Vùng FILE của agent (`<companiesRoot>/<companyId>/`). */
  readonly companiesRoot: string
  /** Gốc kho kiến thức (`<kbRoot>/<slug>/kb`). */
  readonly kbRoot: string
  close(): Promise<void>
}

/** Toàn bộ module route mà `main.ts` nạp ở production. */
export function optionalRouteModules(): OptionalRouteModule[] {
  return [
    toolRoutes(),
    teamRoutes(),
    knowledgeRoutes(),
    chatRoutes(),
    taskRoutes(),
    settingsRoutes(),
    costRoutes(),
    diagramRoutes(),
    dashboardRoutes(),
  ]
}

export async function createRoutesTestContext(): Promise<RoutesTestContext> {
  const repos = createRepos({ file: ':memory:', allowWeakSecret: true, appSecret: SECRET })
  seedCatalog(repos)
  // Hai gốc riêng biệt đúng như production. Trộn hai gốc từng là lỗi thật, nên test
  // cố ý tách ra để bắt được sự nhầm lẫn.
  const base = mkdtempSync(join(tmpdir(), 'ma-routes-test-'))
  const companiesRoot = join(base, 'company-files')
  const kbRoot = join(base, 'companies')
  const context: AppContext = {
    config: loadConfig({
      appSecret: SECRET,
      databasePath: ':memory:',
      isProduction: false,
      webDist: undefined,
      companiesRoot,
      kbRoot,
      // Ép provider nhúng `hash`: test phải chạy offline và tất định, không thử nạp model ONNX.
      embedding: { provider: 'hash', model: 'test-hash', baseUrl: undefined, apiKey: undefined },
    }),
    repos,
    events: new EventBus(),
    listToolNames: () => [],
  }
  const app = buildApp({ context, optionalModules: optionalRouteModules() })
  const client = await startTestServer(app)
  return {
    repos,
    app,
    client,
    companiesRoot,
    kbRoot,
    async close() {
      await client.close()
      repos.db.close()
      rmSync(base, { recursive: true, force: true })
    },
  }
}

export interface RegisteredUser {
  readonly userId: string
  readonly cookie: Record<string, string>
}

export async function registerUser(
  ctx: RoutesTestContext,
  email: string,
  name = 'Người dùng',
): Promise<RegisteredUser> {
  const response = await ctx.client.request('POST', '/api/auth/register', {
    body: { email, password: 'matkhau-rat-dai-123', name },
  })
  if (response.status !== 201) throw new Error(`Đăng ký thất bại: ${response.status} ${response.body}`)
  const user = ctx.repos.auth.findUserByEmail(email)
  if (!user) throw new Error('Không tìm thấy người dùng vừa đăng ký')
  return { userId: user.id, cookie: cookieHeader(response, SESSION_COOKIE) }
}

/** Tạo công ty qua HTTP để nhận đủ presets, route và ACL như production. */
export async function createCompany(
  ctx: RoutesTestContext,
  cookie: Record<string, string>,
  name: string,
): Promise<{ id: string; slug: string }> {
  const response = await ctx.client.request('POST', '/api/companies', { body: { name }, headers: cookie })
  if (response.status !== 201) throw new Error(`Tạo công ty thất bại: ${response.status} ${response.body}`)
  const company = response.json<{ company: { id: string; slug: string } }>().company
  return company
}

export interface TenantFixture {
  readonly ownerCookie: Record<string, string>
  readonly company: { id: string; slug: string }
}

/** Chủ sở hữu một công ty mới, đã có cookie phiên. */
export async function tenant(
  ctx: RoutesTestContext,
  email: string,
  companyName: string,
): Promise<TenantFixture> {
  const owner = await registerUser(ctx, email)
  const company = await createCompany(ctx, owner.cookie, companyName)
  return { ownerCookie: owner.cookie, company }
}

/** Thêm một người dùng đã đăng ký vào công ty với vai trò cho trước. */
export async function addMember(
  ctx: RoutesTestContext,
  companyId: string,
  email: string,
  role: 'owner' | 'admin' | 'member' | 'viewer',
): Promise<RegisteredUser> {
  const user = await registerUser(ctx, email)
  ctx.repos.auth.addMembership(companyId, user.userId, role)
  return user
}

/** Ghi một tài liệu vào kho kiến thức của công ty (không cần thư mục trên đĩa). */
export function seedDocument(
  ctx: RoutesTestContext,
  companyId: string,
  input: { path: string; title: string; category: string; content: string },
): void {
  ctx.repos.knowledge.upsertDocumentAndChunks(
    {
      companyId,
      path: input.path,
      title: input.title,
      category: input.category,
      tags: [],
      content: input.content,
      source: 'file',
    },
    [{ ordinal: 0, text: input.content, headingPath: null, tokens: 10 }],
  )
}

/** Tạo file Markdown thật trong thư mục KB của công ty để thử `/knowledge/reindex`. */
export function writeKbFile(companiesRoot: string, slug: string, relativePath: string, content: string): void {
  const dir = join(companiesRoot, slug, 'kb')
  mkdirSync(join(dir, ...relativePath.split('/').slice(0, -1)), { recursive: true })
  writeFileSync(join(dir, ...relativePath.split('/')), content, 'utf8')
}

export function errorCode(response: TestResponse): string {
  return response.json<{ error: { code: string } }>().error.code
}
