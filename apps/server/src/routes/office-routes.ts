/** HTTP endpoints for the AI Office campus and its live company event stream. */
import { officeDeskPingSchema, officeDispatchSchema, parseOrThrow } from '@marketing-agent/shared'
import { requireMembership } from '../http/middleware.ts'
import type { AppContext } from '../context.ts'
import type { Router } from '../http/router.ts'
import { dispatchOfficeTask, getAgentDeskDetail, getOfficeOverview, listOfficeTasks, pingAgentDesk } from '../services/office-service.ts'

export function registerOfficeRoutes(router: Router, ctx: AppContext): void {
  const { repos } = ctx
  const base = '/api/companies/:companyId/office'
  const guard = [requireMembership(repos)]

  router.get(`${base}/overview`, (request) => {
    const companyId = request.params.companyId!
    request.json(200, getOfficeOverview(companyId, repos))
  }, guard)

  router.get(`${base}/desks/:role`, (request) => {
    const companyId = request.params.companyId!
    request.json(200, getAgentDeskDetail(companyId, request.params.role!, repos))
  }, guard)

  router.get(`${base}/tasks`, (request) => {
    const companyId = request.params.companyId!
    request.json(200, listOfficeTasks(companyId, {
      role: request.query('role'),
      status: request.query('status'),
    }, repos))
  }, guard)

  router.post(`${base}/dispatch`, async (request) => {
    const companyId = request.params.companyId!
    const input = parseOrThrow(officeDispatchSchema, await request.body(), 'giao việc văn phòng')
    request.json(201, await dispatchOfficeTask(companyId, input, repos))
  }, guard)

  router.post(`${base}/desks/:role/ping`, async (request) => {
    const companyId = request.params.companyId!
    const input = parseOrThrow(officeDeskPingSchema, await request.body(), 'ping bàn agent')
    request.json(200, pingAgentDesk(companyId, request.params.role!, input, repos))
  }, guard)

  router.get(`${base}/stream`, (request) => {
    const companyId = request.params.companyId!
    const response = request.res
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    response.write(`data: ${JSON.stringify({ type: 'office.connected', at: new Date().toISOString() })}\n\n`)

    const unsubscribe = ctx.events.subscribe(companyId, (event) => {
      if (!/^(office|task|workflow|agent)\./.test(event.type)) return
      if (response.destroyed || response.writableEnded) return
      response.write(`event: message\ndata: ${JSON.stringify(event)}\n\n`)
    })
    const heartbeat = setInterval(() => {
      if (!response.destroyed && !response.writableEnded) response.write(': ping\n\n')
    }, 15_000)

    const cleanup = () => {
      clearInterval(heartbeat)
      unsubscribe()
    }
    request.req.once('close', cleanup)
    response.once('close', cleanup)
    response.once('error', cleanup)
  }, guard)
}