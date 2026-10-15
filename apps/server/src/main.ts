/**
 * Process entry point.
 *
 * Boot order is deliberate: load `.env`, validate configuration (failing fast on
 * a missing APP_SECRET), open the database and apply migrations, report catalog
 * readiness, then serve. Shutdown closes the HTTP listener first and the
 * database last so in-flight writes finish.
 */
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRepos, type Repos } from '@marketing-agent/db'
import { toAppError } from '@marketing-agent/shared'
import { buildApp, type OptionalRouteModule } from './app.ts'
import { loadConfig, loadDotEnv, type ServerConfig } from './config.ts'
import { EventBus, type AppContext } from './context.ts'
import { startKnowledgeClassificationWorker } from './services/knowledge-classifier.ts'
import { embeddingFor } from './services/agent-services.ts'
import { startDailyReportWorker } from './services/daily-report-worker.ts'
import { preflight } from './services/company-service.ts'

export interface StartedServer {
  readonly server: Server
  readonly config: ServerConfig
  readonly repos: Repos
  close(): Promise<void>
}

export async function startServer(overrides: Partial<ServerConfig> = {}): Promise<StartedServer> {
  loadDotEnv()
  const config = loadConfig(overrides)

  // The database directory must exist before better-sqlite3 opens the file.
  if (config.databasePath !== ':memory:') {
    mkdirSync(resolve(config.databasePath, '..'), { recursive: true })
  }
  const repos = createRepos({ file: config.databasePath, appSecret: config.appSecret })
  if (!existsSync(config.companiesRoot)) mkdirSync(config.companiesRoot, { recursive: true })

  const events = new EventBus()
  const modules = await loadOptionalModules()
  const context: AppContext = {
    config,
    repos,
    events,
    listToolNames: () => modules.toolNames,
  }

  const app = buildApp({ context, optionalModules: modules.routeModules })

  const status = preflight(repos)
  if (status.ready) {
    console.log(
      `[boot] catalog sẵn sàng: ${status.agentDefs} agent · ${status.skills} kỹ năng · ${status.models} model`,
    )
  } else {
    console.warn(`[boot] CẢNH BÁO: ${status.problem}`)
    console.warn('[boot] Máy chủ vẫn chạy, nhưng tạo công ty sẽ thất bại cho tới khi catalog được cài.')
  }
  if (modules.routeModules.length === 0) {
    console.warn('[boot] Chưa nạp được module route tùy chọn nào (gói đang được xây dựng).')
  }

  const server = createServer((req, res) => {
    void app.handle(req, res)
  })

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(config.port, config.host, () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : config.port
  console.log(`[boot] Marketing Agent đang chạy tại http://${config.host}:${port}`)
  if (!config.isProduction) {
    console.log('[boot] Giao diện dev: chạy `pnpm dev:web` ở terminal khác (Vite proxy sang cổng này).')
  }

  // Sweep expired sessions hourly; cheap and keeps the table from growing.
  const sweeper = setInterval(() => {
    try {
      repos.auth.purgeExpiredSessions()
    } catch (error) {
      console.error('[maintenance] dọn session hết hạn thất bại:', error)
    }
  }, 60 * 60 * 1000)
  sweeper.unref()
  const dailyWorker = startDailyReportWorker(repos)
  const knowledgeWorker = startKnowledgeClassificationWorker(repos,{embeddingFor:async()=>embeddingFor(context),intervalMs:2000})

  return {
    server,
    config,
    repos,
    async close() {
      clearInterval(sweeper)
      await knowledgeWorker.close()
      await dailyWorker.close()
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
      repos.db.close()
    },
  }
}

/**
 * Load optional route modules. They are imported dynamically because each one
 * depends on a package built in a later phase; a failed import must degrade to a
 * warning, not a boot failure. The specifier is built at runtime so a
 * not-yet-created module is a caught runtime error rather than a compile error.
 */
const OPTIONAL_ROUTE_MODULES: readonly { name: string; exportName: string }[] = [
  { name: 'tools', exportName: 'toolRoutes' },
  { name: 'team', exportName: 'teamRoutes' },
  { name: 'knowledge', exportName: 'knowledgeRoutes' },
  { name: 'chat', exportName: 'chatRoutes' },
  { name: 'tasks', exportName: 'taskRoutes' },
  { name: 'settings', exportName: 'settingsRoutes' },
  { name: 'costs', exportName: 'costRoutes' },
  { name: 'diagram', exportName: 'diagramRoutes' },
  { name: 'dashboard', exportName: 'dashboardRoutes' },
]

async function loadOptionalModules(): Promise<{
  routeModules: OptionalRouteModule[]
  toolNames: string[]
}> {
  const modules: OptionalRouteModule[] = []
  let toolNames: string[] = []

  for (const entry of OPTIONAL_ROUTE_MODULES) {
    const specifier = `./routes/${entry.name}-routes.ts`
    try {
      const loaded = (await import(specifier)) as Record<string, unknown>
      const factory = loaded[entry.exportName]
      if (typeof factory === 'function') {
        modules.push((factory as () => OptionalRouteModule)())
      }
    } catch (error) {
      console.warn(
        `[routes] module "${entry.name}" chưa sẵn sàng: ${toAppError(error).message}`,
      )
    }
  }

  try {
    // Same runtime-specifier trick as the route modules: the tools package is
    // built in a later phase and may be absent in a partial checkout.
    const specifier = '@marketing-agent/tools'
    const tools = (await import(specifier)) as Record<string, unknown>
    const build = tools['buildToolRegistry']
    if (typeof build === 'function') {
      const registry = (build as (options: unknown) => { list(): { name: string }[] })({})
      toolNames = registry.list().map((tool) => tool.name)
    }
  } catch {
    toolNames = []
  }

  return { routeModules: modules, toolNames }
}

/** Run when invoked directly (`tsx apps/server/src/main.ts`). */
const invokedDirectly =
  process.argv[1] !== undefined && /main\.(ts|js)$/.test(process.argv[1].replace(/\\/g, '/'))

if (invokedDirectly) {
  const started = await startServer()
  let shuttingDown = false
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[shutdown] nhận ${signal}, đang dừng…`)
    try {
      await started.close()
      process.exit(0)
    } catch (error) {
      console.error('[shutdown] lỗi khi dừng:', error)
      process.exit(1)
    }
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}
