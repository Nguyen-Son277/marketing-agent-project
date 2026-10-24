/**
 * Test khớp tên tệp với cơ chế dò tìm của `main.ts`.
 *
 * Vì sao test này tồn tại: `main.ts` nạp route bằng chuỗi động
 * `./routes/${name}-routes.ts` và chỉ ghi cảnh báo khi nạp hụt. Một tệp đặt sai tên
 * sẽ khiến tính năng "biến mất" trong im lặng ở production mà typecheck vẫn sạch.
 * Test này import đúng các tệp mà `main.ts` sẽ tìm, nên đổi tên tệp là CI đỏ ngay.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { toolRoutes } from '../src/routes/tools-routes.ts'
import { teamRoutes } from '../src/routes/team-routes.ts'
import { knowledgeRoutes } from '../src/routes/knowledge-routes.ts'
import { chatRoutes } from '../src/routes/chat-routes.ts'
import { taskRoutes } from '../src/routes/tasks-routes.ts'
import { settingsRoutes } from '../src/routes/settings-routes.ts'
import { costRoutes } from '../src/routes/costs-routes.ts'
import { diagramRoutes } from '../src/routes/diagram-routes.ts'
import { dashboardRoutes } from '../src/routes/dashboard-routes.ts'
import { createRoutesTestContext, optionalRouteModules, type RoutesTestContext } from './helpers/routes-helpers.ts'

/** Khớp nguyên danh sách `OPTIONAL_ROUTE_MODULES` trong `apps/server/src/main.ts`. */
const DISCOVERY = [
  { name: 'tools', factory: toolRoutes },
  { name: 'team', factory: teamRoutes },
  { name: 'knowledge', factory: knowledgeRoutes },
  { name: 'chat', factory: chatRoutes },
  { name: 'tasks', factory: taskRoutes },
  { name: 'settings', factory: settingsRoutes },
  { name: 'costs', factory: costRoutes },
  { name: 'diagram', factory: diagramRoutes },
  { name: 'dashboard', factory: dashboardRoutes },
] as const

let ctx: RoutesTestContext | undefined

afterEach(async () => {
  await ctx?.close()
  ctx = undefined
})

describe('route discovery', () => {
  it('mỗi module main.ts dò tìm đều export factory đúng tên', () => {
    for (const entry of DISCOVERY) {
      const module = entry.factory()
      expect(module.name, `module ${entry.name} khai sai tên`).toBe(entry.name)
      expect(typeof module.register).toBe('function')
    }
  })

  it('buildApp đăng ký được toàn bộ route của các module', async () => {
    ctx = await createRoutesTestContext()
    const app = ctx.app
    const paths = [
      ['GET', '/api/companies/x/tools'],
      ['GET', '/api/companies/x/team'],
      ['GET', '/api/companies/x/knowledge'],
      ['GET', '/api/companies/x/conversations'],
      ['GET', '/api/companies/x/tasks'],
      ['GET', '/api/companies/x/providers'],
      ['GET', '/api/companies/x/costs'],
      ['GET', '/api/companies/x/diagram'],
      ['GET', '/api/companies/x/dashboard'],
      ['GET', '/api/artifacts/x'],
      ['POST', '/api/conversations/x/plan'],
      ['GET', '/api/conversations/x/stream'],
    ] as const
    for (const [method, path] of paths) {
      expect(app.router.match(method, path), `thiếu route ${method} ${path}`).toBeDefined()
    }
    expect(optionalRouteModules()).toHaveLength(10)
  })
})
