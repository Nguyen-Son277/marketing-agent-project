import { SETTINGS_NOTIFICATION_OPERATIONS, validation, type NotificationPreferences, type SettingsNotificationRequest } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { requireAuthState, requireMembership, requireManage } from '../http/middleware.ts'
import type { Router } from '../http/router.ts'

export function registerNotificationRoutes(router:Router,repos:Repos):void {
  const base='/api/companies/:companyId'
  const guard=[requireMembership(repos)]
  router.get(`${base}/notifications`,r=>{
    const limit=r.query('limit'),cursor=r.query('cursor')
    r.json(200,repos.notifications.list(r.params.companyId!,requireAuthState(r).user.id,{...(limit!==undefined?{limit:Number(limit)}:{}),...(cursor?{cursor}:{})}))
  },guard)
  router.get(`${base}/notifications/unread-count`,r=>r.json(200,{count:repos.notifications.unreadCount(r.params.companyId!,requireAuthState(r).user.id)}),guard)
  router.post(`${base}/notifications/settings`,async r=>{
    const body=await r.body<unknown>()
    const keys=['operationId','operation','status']
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==3||Object.keys(body).some(key=>!keys.includes(key))) throw validation('Settings result must contain only operationId, operation and status')
    const {operationId,operation,status}=body as Record<string,unknown>
    if(typeof operationId!=='string'||operationId.length<1||operationId.length>128||operationId.trim()!==operationId||/[\u0000-\u001f\u007f]/.test(operationId)) throw validation('operationId must be a nonempty string of up to 128 characters without whitespace padding or control characters')
    if(typeof operation!=='string'||!SETTINGS_NOTIFICATION_OPERATIONS.some(value=>value===operation)) throw validation('Unsupported settings operation')
    if(status!=='success'&&status!=='warning'&&status!=='error') throw validation('Unsupported settings result status')
    r.json(200,{item:repos.notifications.settingsResult(r.params.companyId!,requireAuthState(r).user.id,{operationId,operation,status} as SettingsNotificationRequest)})
  },[...guard,requireManage])
  router.post(`${base}/notifications/read-all`,async r=>{
    const body=await r.body<unknown>()
    const through=body&&typeof body==='object'&&'through' in body ? body.through : undefined
    if(typeof through!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(through)||!Number.isFinite(Date.parse(through))) throw validation('through must be an ISO timestamp')
    const at=new Date(through).toISOString()
    if(Date.parse(at)>Date.now()) throw validation('through cannot be in the future')
    const throughIds=body&&typeof body==='object'&&'throughIds' in body ? body.throughIds : undefined
    if(throughIds!==undefined&&(!Array.isArray(throughIds)||throughIds.length>100||throughIds.some(id=>typeof id!=='string'||id.length>200))) throw validation('throughIds must be an array of up to 100 notification IDs')
    repos.notifications.readAll(r.params.companyId!,requireAuthState(r).user.id,at,throughIds as string[]|undefined)
    r.json(200,{ok:true})
  },guard)
  router.post(`${base}/notifications/:id/read`,r=>{
    repos.notifications.read(r.params.companyId!,requireAuthState(r).user.id,r.params.id!)
    r.json(200,{ok:true})
  },guard)
  router.get(`${base}/notification-preferences`,r=>r.json(200,repos.notifications.preferences(r.params.companyId!,requireAuthState(r).user.id)),guard)
  router.put(`${base}/notification-preferences`,async r=>{
    const body=await r.body<unknown>()
    const keys=['agent','actionRequired','budget']
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length===0||Object.entries(body).some(([k,v])=>!keys.includes(k)||typeof v!=='boolean')) throw validation('Preferences must contain only agent, actionRequired, budget booleans')
    r.json(200,repos.notifications.savePreferences(r.params.companyId!,requireAuthState(r).user.id,body as Partial<NotificationPreferences>))
  },guard)
}
