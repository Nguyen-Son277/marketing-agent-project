import { afterEach,beforeEach,describe,expect,it } from 'vitest'
import { CostMeter } from '@marketing-agent/llm'
import { SETTINGS_NOTIFICATION_OPERATIONS, type NotificationItem } from '@marketing-agent/shared'
import { createRoutesTestContext,createCompany,tenant,registerUser,type RoutesTestContext } from './helpers/routes-helpers.ts'
let ctx:RoutesTestContext
beforeEach(async()=>{ctx=await createRoutesTestContext()})
afterEach(async()=>{await ctx.close()})
async function fixture(){
 const t=await tenant(ctx,'notify@example.com','Notify')
 const user=ctx.repos.auth.findUserByEmail('notify@example.com')!
 const def=ctx.repos.team.findAgentDefByRole('content-writer')!
 return {...t,user,def,base:`/api/companies/${t.company.id}`}
}
function finish(id:string,status:'succeeded'|'failed'|'cancelled'='succeeded',costUsd=0){return ctx.repos.accounting.finishRun(id,{status,tokensIn:0,tokensOut:0,costUsd,latencyMs:1,steps:1,error:'secret-provider-token'})}
describe('settings result notifications',()=>{
 it('requires authentication, membership and the existing manage roles',async()=>{
  const f=await fixture();const endpoint=`${f.base}/notifications/settings`
  const body={operationId:'auth-result',operation:'provider.save',status:'success'}
  expect((await ctx.client.request('POST',endpoint,{body})).status).toBe(401)
  const other=await registerUser(ctx,'settings-auth@example.com')
  expect((await ctx.client.request('POST',endpoint,{headers:other.cookie,body})).status).toBe(404)
  for(const role of ['viewer','member','admin'] as const){
   const member=await registerUser(ctx,`settings-${role}@example.com`)
   ctx.repos.auth.addMembership(f.company.id,member.userId,role)
   expect((await ctx.client.request('POST',endpoint,{headers:member.cookie,body})).status).toBe(role==='admin'?200:403)
  }
  expect((await ctx.client.request('POST',endpoint,{headers:f.ownerCookie,body})).status).toBe(200)
 })
 it('persists self-only results despite disabled preferences and returns the exact existing item on retry',async()=>{
  const f=await fixture();const other=await registerUser(ctx,'settings-admin@example.com')
  ctx.repos.auth.addMembership(f.company.id,other.userId,'admin')
  ctx.repos.notifications.savePreferences(f.company.id,f.user.id,{agent:false,actionRequired:false,budget:false})
  const endpoint=`${f.base}/notifications/settings`
  const body={operationId:'retry-id',operation:'model.fetch',status:'warning'}
  const first=await ctx.client.request('POST',endpoint,{headers:f.ownerCookie,body})
  expect(first.status).toBe(200)
  const original=first.json<{item:NotificationItem}>().item
  expect(original).toMatchObject({type:'settings_warning',severity:'warning',readAt:null,link:'#/cai-dat'})
  expect(original.body).toContain('model.fetch')
  expect(ctx.repos.notifications.list(f.company.id,other.userId).items).toEqual([])
  ctx.repos.notifications.read(f.company.id,f.user.id,original.id)
  const persisted=ctx.repos.notifications.list(f.company.id,f.user.id).items[0]!
  const retries=await Promise.all(Array.from({length:3},()=>ctx.client.request('POST',endpoint,{headers:f.ownerCookie,body:{...body,operation:'provider.delete',status:'error'}})))
  for(const retry of retries) expect(retry.json()).toEqual({item:persisted})
  expect(ctx.repos.notifications.list(f.company.id,f.user.id).items).toHaveLength(1)
  const otherItem=(await ctx.client.request('POST',endpoint,{headers:other.cookie,body})).json<{item:NotificationItem}>().item
  expect(otherItem.id).not.toBe(original.id)
  const secondCompany=await createCompany(ctx,f.ownerCookie,'Second settings tenant')
  const secondItem=(await ctx.client.request('POST',`/api/companies/${secondCompany.id}/notifications/settings`,{headers:f.ownerCookie,body})).json<{item:NotificationItem}>().item
  expect(secondItem.id).not.toBe(original.id)
 })
 it('accepts only allowlisted operations/statuses and rejects arbitrary text, recipients and URLs',async()=>{
  const f=await fixture();const endpoint=`${f.base}/notifications/settings`
  const body={operationId:'safe-id',operation:'key.test',status:'success'}
  const invalid:unknown[]=[null,[],{}, {...body,operationId:''},{...body,operationId:'x'.repeat(129)},{...body,operationId:' padded '},{...body,operationId:'bad\nID'},
   {...body,operation:'provider.response: secret'}, {...body,operation:'toString'}, {...body,status:'failed'},
   ...['title','body','url','link','providerResponse','userId','companyId'].map(key=>({...body,[key]:'secret-provider-token https://attacker.invalid'})),
  ]
  for(const payload of invalid) expect((await ctx.client.request('POST',endpoint,{headers:f.ownerCookie,body:payload})).status).toBe(400)
  expect(ctx.repos.notifications.list(f.company.id,f.user.id).items).toEqual([])
  for(const [index,operation] of SETTINGS_NOTIFICATION_OPERATIONS.entries()){
   const status=(['success','warning','error'] as const)[index%3]!
   const response=await ctx.client.request('POST',endpoint,{headers:f.ownerCookie,body:{operationId:`safe-${index}`,operation,status}})
   expect(response.status).toBe(200)
   const item=response.json<{item:NotificationItem}>().item
   expect(item.type).toBe(`settings_${status}`)
   expect(item.severity).toBe(status==='success'?'info':status)
   expect(item.link).toBe('#/cai-dat')
   expect(JSON.stringify(item)).not.toContain('secret-provider-token')
  }
  expect(ctx.repos.notifications.list(f.company.id,f.user.id).items).toHaveLength(SETTINGS_NOTIFICATION_OPERATIONS.length)
 })
})
describe('durable notifications',()=>{
 it('creates inbox through real accounting finish, dedupes finish and isolates user reads',async()=>{
  const f=await fixture();const other=await registerUser(ctx,'notify-other@example.com')
  ctx.repos.auth.addMembership(f.company.id,other.userId,'viewer')
  const id=ctx.repos.accounting.startRun({companyId:f.company.id,agentDefId:f.def.id})
  finish(id);finish(id)
  const response=await ctx.client.request('GET',`${f.base}/notifications`,{headers:f.ownerCookie})
  expect(response.status).toBe(200);const {items,nextCursor}=response.json<{items:{id:string;type:string;readAt:null}[];nextCursor:null}>()
  expect(items).toHaveLength(1);expect(items[0]!.type).toBe('agent_success');expect(nextCursor).toBeNull()
  const read=await ctx.client.request('POST',`${f.base}/notifications/${items[0]!.id}/read`,{headers:other.cookie});expect(read.status).toBe(404)
  expect((await ctx.client.request('POST',`${f.base}/notifications/${items[0]!.id}/read`,{headers:f.ownerCookie})).status).toBe(200)
  expect(ctx.repos.notifications.unreadCount(f.company.id,f.user.id)).toBe(0);expect(ctx.repos.notifications.unreadCount(f.company.id,other.userId)).toBe(1)
  expect(ctx.repos.accounting.usageSince(f.company.id,'2000-01-01').runs).toBe(1)
 })
 it('enforces membership, auth, boolean prefs and preference suppression without replay',async()=>{
  const f=await fixture();const outsider=await registerUser(ctx,'outsider@example.com')
  expect((await ctx.client.request('GET',`${f.base}/notifications`)).status).toBe(401)
  expect((await ctx.client.request('GET',`${f.base}/notifications`,{headers:outsider.cookie})).status).toBe(404)
  expect((await ctx.client.request('PUT',`${f.base}/notification-preferences`,{headers:f.ownerCookie,body:{agent:'false'}})).status).toBe(400)
  expect((await ctx.client.request('PUT',`${f.base}/notification-preferences`,{headers:f.ownerCookie,body:{agent:false}})).json()).toEqual({agent:false,actionRequired:true,budget:true})
  const id=ctx.repos.accounting.startRun({companyId:f.company.id,agentDefId:f.def.id});const record=finish(id)
  ctx.repos.notifications.savePreferences(f.company.id,f.user.id,{agent:true});ctx.repos.notifications.runFinished(record)
  expect(ctx.repos.notifications.unreadCount(f.company.id,f.user.id)).toBe(0)
  ctx.repos.auth.addMembership(f.company.id,outsider.userId,'member');ctx.repos.notifications.runFinished(record)
  expect(ctx.repos.notifications.unreadCount(f.company.id,outsider.userId)).toBe(0)
 })
 it('supports stable tied-timestamp pagination, count, cutoff read-all and validation',async()=>{
  const f=await fixture()
  for(let i=0;i<3;i++)finish(ctx.repos.accounting.startRun({companyId:f.company.id,agentDefId:f.def.id}))
  ctx.repos.db.run("UPDATE notifications SET created_at='2026-01-01T00:00:00.000Z'")
  const page=ctx.repos.notifications.list(f.company.id,f.user.id,{limit:2});const next=ctx.repos.notifications.list(f.company.id,f.user.id,{limit:2,cursor:page.nextCursor!})
  expect(new Set([...page.items,...next.items].map(i=>i.id)).size).toBe(3);expect(next.nextCursor).toBeNull()
  expect((await ctx.client.request('GET',`${f.base}/notifications?cursor=garbage`,{headers:f.ownerCookie})).status).toBe(400)
  expect((await ctx.client.request('GET',`${f.base}/notifications?limit=101`,{headers:f.ownerCookie})).status).toBe(400)
  expect((await ctx.client.request('GET',`${f.base}/notifications/unread-count`,{headers:f.ownerCookie})).json()).toEqual({count:3})
  expect((await ctx.client.request('POST',`${f.base}/notifications/read-all`,{headers:f.ownerCookie,body:{through:'2025-01-01T00:00:00Z'}})).status).toBe(200)
  expect(ctx.repos.notifications.unreadCount(f.company.id,f.user.id)).toBe(3)
  await ctx.client.request('POST',`${f.base}/notifications/read-all`,{headers:f.ownerCookie,body:{through:'2026-01-01T00:00:00Z'}})
  expect(ctx.repos.notifications.unreadCount(f.company.id,f.user.id)).toBe(0)
 })
 it('delivers safe failure only, skips cancelled and emits exact daily/task thresholds on finish',async()=>{
  const f=await fixture();ctx.repos.accounting.setSetting(`limits:${f.company.id}`,{dailyCostUsd:10,taskCostUsd:10})
  finish(ctx.repos.accounting.startRun({companyId:f.company.id,agentDefId:f.def.id}),'failed',10)
  finish(ctx.repos.accounting.startRun({companyId:f.company.id,agentDefId:f.def.id}),'cancelled')
  const items=ctx.repos.notifications.list(f.company.id,f.user.id).items
  expect(items.filter(i=>i.type==='agent_failure')).toHaveLength(1)
  expect(items.filter(i=>i.type==='budget_warning')).toHaveLength(0);expect(items.filter(i=>i.type==='budget_exceeded')).toHaveLength(2)
  expect(JSON.stringify(items)).not.toContain('secret-provider-token')
 })
 it('reports terminal budget stops even before charged usage',async()=>{
  const f=await fixture();const id=ctx.repos.accounting.startRun({companyId:f.company.id,agentDefId:f.def.id})
  ctx.repos.accounting.finishRun(id,{status:'budget_exceeded',tokensIn:0,tokensOut:0,costUsd:0,latencyMs:0,steps:0})
  expect(ctx.repos.notifications.list(f.company.id,f.user.id).items.map(i=>i.type)).toEqual(['budget_exceeded'])
 })
 it('preserves paid accounting on notification failure',async()=>{
  const f=await fixture();ctx.repos.db.raw.exec(`CREATE TRIGGER fail_notifications BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'delivery failed'); END`)
  const id=ctx.repos.accounting.startRun({companyId:f.company.id,agentDefId:f.def.id});expect(finish(id).status).toBe('succeeded')
  expect(ctx.repos.accounting.usageSince(f.company.id,'2000-01-01').runs).toBe(1)
  expect(ctx.repos.db.get<{n:number}>('SELECT COUNT(*) AS n FROM notification_events')!.n).toBe(0)
 })
 it('read-all boundary IDs leave unseen same-millisecond arrivals unread',async()=>{
  const f=await fixture();finish(ctx.repos.accounting.startRun({companyId:f.company.id,agentDefId:f.def.id}))
  const first=ctx.repos.notifications.list(f.company.id,f.user.id).items[0]!
  finish(ctx.repos.accounting.startRun({companyId:f.company.id,agentDefId:f.def.id}))
  ctx.repos.db.run('UPDATE notifications SET created_at=?',[first.createdAt])
  expect((await ctx.client.request('POST',`${f.base}/notifications/read-all`,{headers:f.ownerCookie,body:{through:first.createdAt,throughIds:[first.id]}})).status).toBe(200)
  expect(ctx.repos.notifications.unreadCount(f.company.id,f.user.id)).toBe(1)
  expect((await ctx.client.request('POST',`${f.base}/notifications/read-all`,{headers:f.ownerCookie,body:{through:first.createdAt,throughIds:Array(101).fill(first.id)}})).status).toBe(400)
  expect((await ctx.client.request('POST',`${f.base}/notifications/read-all`,{headers:f.ownerCookie,body:{through:first.createdAt,throughIds:[42]}})).status).toBe(400)
 })
 it('removes inbox and preferences on membership removal without replay on rejoin',async()=>{
  const f=await fixture();const record=finish(ctx.repos.accounting.startRun({companyId:f.company.id,agentDefId:f.def.id}))
  ctx.repos.notifications.savePreferences(f.company.id,f.user.id,{budget:false})
  ctx.repos.db.run('DELETE FROM memberships WHERE company_id=? AND user_id=?',[f.company.id,f.user.id])
  expect(ctx.repos.notifications.unreadCount(f.company.id,f.user.id)).toBe(0)
  expect((await ctx.client.request('GET',`${f.base}/notifications`,{headers:f.ownerCookie})).status).toBe(404)
  ctx.repos.auth.addMembership(f.company.id,f.user.id,'owner');ctx.repos.notifications.runFinished(record)
  expect(ctx.repos.notifications.unreadCount(f.company.id,f.user.id)).toBe(0)
  expect(ctx.repos.notifications.preferences(f.company.id,f.user.id).budget).toBe(true)
 })
 it('observes charged calls via CostMeter before finish without repeated threshold delivery',async()=>{
  const f=await fixture();const meter=new CostMeter(ctx.repos.accounting)
  ctx.repos.accounting.setSetting(`limits:${f.company.id}`,{dailyCostUsd:1,taskCostUsd:1})
  meter.open({companyId:f.company.id,agentDefId:f.def.id}) // production does not call checkBudget; open must enable observation
  const model={id:'test',costInPerMtok:1,costOutPerMtok:0} as Parameters<CostMeter['addUsage']>[0]
  meter.addUsage(model,{promptTokens:800000,completionTokens:0,cachedTokens:0})
  expect(ctx.repos.notifications.list(f.company.id,f.user.id).items.filter(i=>i.type==='budget_warning')).toHaveLength(2)
  meter.addUsage(model,{promptTokens:200000,completionTokens:0,cachedTokens:0});meter.checkBudget(f.company.id,{dailyCostUsd:1,taskCostUsd:1})
  expect(ctx.repos.notifications.list(f.company.id,f.user.id).items.filter(i=>i.type==='budget_exceeded')).toHaveLength(2)
  ctx.repos.accounting.setSetting(`limits:${f.company.id}`,{dailyCostUsd:1,taskCostUsd:1});meter.finish({status:'succeeded',steps:2})
  expect(ctx.repos.notifications.list(f.company.id,f.user.id).items).toHaveLength(5)
 })
})
