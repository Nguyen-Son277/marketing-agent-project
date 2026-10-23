/**
 * Tool composition.
 *
 * `buildToolRegistry` assembles every tool this deployment offers. The registry
 * is built once per process; which tools an individual agent may actually call is
 * decided per run from its preset grant, so a single registry serves every agent.
 *
 * Knowledge-base tools are injected rather than imported. `packages/kb` owns
 * them and depends on `db`; keeping the wiring here means this package stays
 * usable (and testable) without a knowledge base present.
 */
import type { ToolDefinition } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { ToolRegistry, type ToolDescriptor } from './registry.ts'
import { createCoreTools, type CoreToolOptions } from './core.ts'
import { createCoordinationTools, type CoordinationHost } from './coordination.ts'
import { createHttpTools, createResearchTools } from './http-tools.ts'
import { createSearchConsoleTools } from './google/search-console.ts'
import { createAnalyticsTools } from './google/analytics.ts'
import { createMetaTools } from './meta.ts'
import { createLinkedInTools } from './linkedin.ts'
import { createEmailTools } from './email.ts'
import { createPaidAdsTools } from './paid-ads.ts'
import { IntegrationStore } from './integrations.ts'
import { createWorkforceTools } from './workforce.ts'
import { createSocialBrowserTools } from './social-browser.ts'

export interface BuildToolRegistryOptions {
  /** Required by the core tools; omit to build a registry without file tools. */
  readonly repos?: Repos
  readonly coreOptions?: CoreToolOptions
  /** Coordination tools; omit before the orchestrator exists. */
  readonly coordinationHost?: CoordinationHost
  /** Tools owned by other packages (for example `kb_search`). */
  readonly extraTools?: readonly ToolDefinition[]
  /** Hosts `http_fetch` may reach. Empty/omitted still blocks private ranges. */
  readonly allowedHosts?: readonly string[]
  /** Firecrawl base URL override, for a self-hosted crawler. */
  readonly firecrawlBaseUrl?: string
  /** Include the integration-backed tools (Firecrawl, Google, Meta, LinkedIn). */
  readonly integrations?: boolean
}

export interface BuiltToolRegistry {
  readonly registry: ToolRegistry
  readonly integrationStore: IntegrationStore | undefined
}

export function buildToolRegistry(options: BuildToolRegistryOptions = {}): BuiltToolRegistry {
  const tools: ToolDefinition[] = []
  if(options.repos) tools.push(...createWorkforceTools(options.repos))

  const http = createHttpTools({ allowedHosts: options.allowedHosts })
  tools.push(http.httpFetch)

  if (options.repos && options.coreOptions) {
    tools.push(...createSocialBrowserTools(options.repos, options.coreOptions.companiesRoot))
    const core = createCoreTools(options.repos, options.coreOptions)
    tools.push(core.filesRead, core.filesWrite, core.filesList, core.artifactPublish)
  }

  if (options.coordinationHost) {
    const coordination = createCoordinationTools(options.coordinationHost)
    tools.push(
      coordination.taskCreate,
      coordination.taskAssign,
      coordination.agentAsk,
      coordination.agentEscalate,
      coordination.blockerReport,
    )
  }

  let integrationStore: IntegrationStore | undefined
  if (options.integrations !== false && options.repos) {
    integrationStore = new IntegrationStore(options.repos)

    const research = createResearchTools(integrationStore, { baseUrl: options.firecrawlBaseUrl })
    tools.push(research.webSearch, research.webScrape, research.competitorWatch)

    const gsc = createSearchConsoleTools(integrationStore)
    tools.push(gsc.gscQuery, gsc.gscInspectUrl)

    const analytics = createAnalyticsTools(integrationStore)
    tools.push(analytics.ga4Report, analytics.sheetsWrite)

    const meta = createMetaTools(integrationStore)
    tools.push(meta.metaInsights, meta.metaPublish)

    const linkedin = createLinkedInTools(integrationStore)
    tools.push(linkedin.linkedinPublish, linkedin.linkedinInsights)

    const email = createEmailTools(integrationStore)
    tools.push(email.emailSend)

    const ads = createPaidAdsTools(integrationStore)
    tools.push(ads.adsMeta, ads.adsGoogle)
  }

  tools.push(...(options.extraTools ?? []))

  return { registry: new ToolRegistry(tools), integrationStore }
}

/** Names only, for readiness output and the settings screen. */
export function listToolNames(options: BuildToolRegistryOptions = {}): string[] {
  return buildToolRegistry(options).registry.list().map((tool) => tool.name)
}

export function describeTools(options: BuildToolRegistryOptions = {}): ToolDescriptor[] {
  return buildToolRegistry(options).registry.list()
}

export { ToolRegistry } from './registry.ts'
export type { ToolDescriptor } from './registry.ts'
export { IntegrationStore } from './integrations.ts'
export type { CoordinationHost, PlannedTaskInput, PlannedTaskResult } from './coordination.ts'
export type { CoreToolOptions } from './core.ts'
export { hasCycle, topologicalOrder } from './coordination.ts'
export { isBlockedHost, isHostAllowed, htmlToText } from './http-tools.ts'
export type { IntegrationConfigMap, IntegrationStatus } from './integrations.ts'
export {
  defineTool,
  optionalNumberArg,
  optionalStringArg,
  optionalStringArrayArg,
  requireStringArg,
} from './registry.ts'
export { fetchWithTimeout, parseJsonResponse, readBounded, extractErrorMessage } from './http-client.ts'
export { sendMail, buildMimeMessage, extractAddress, buildMessageId } from './email.ts'
export type { SendMailInput } from './email.ts'
export { SocialBrowserService, createSocialBrowserTools, browserAssetPath, assertBrowserWorkerEndpoint } from './social-browser.ts'
