/** Mode giao việc bỏ BriefGate; model chỉ tạo nháp, quyền dựa trên người gửi HTTP. */
import { afterEach,beforeEach,describe,it,expect } from 'vitest'
import { createRoutesTestContext,tenant,configureCompanyModel,type RoutesTestContext } from './helpers/routes-helpers.ts'
import { setAgentRuntimeOverrides } from '../src/services/agent-services.ts'
import { scriptedAdapter,toolTurn,textTurn } from '../../../packages/agent-runtime/tests/fixtures.ts'
import { createWorkforceTools } from '../../../packages/tools/src/workforce.ts'
import { workforceWeek,vietnamDate,type ToolContext } from '@marketing-agent/shared'
let ctx:RoutesTestContext
beforeEach(async()=>{ctx=await createRoutesTestContext()})
afterEach(async()=>{await ctx.close()})
describe('draft designer qua agent',()=>{
 it('trusted context cần actor; retry call không trùng nháp và không auto assign',async()=>{
  const owner=await tenant(ctx,'tool-wf@example.com','Tool WF')
  const actor=ctx.repos.auth.findUserByEmail('tool-wf@example.com')!
  const employee=ctx.repos.workforce.createEmployee(actor.id,{name:'Designer',email:'d@example.com',password:'initial-password-123',companyIds:[owner.company.id]})
  const conv=ctx.repos.work.createConversation({companyId:owner.company.id,userId:actor.id,title:'Design'})
  const tool=createWorkforceTools(ctx.repos).find(t=>t.name==='employee_task_draft')!
  const args={assigneeUserId:employee.id,title:'Banner',brief:'3 banners',kind:'image',plannedWeek:workforceWeek(vietnamDate()),deadline:new Date(Date.now()+86400000).toISOString()}
  const context:ToolContext={companyId:owner.company.id,agentRole:'marketing-leader',agentDefId:'leader',conversationId:conv.id,taskId:null,log:()=>{},requestId:'req',toolCallId:'call'}
  await expect(tool.handler({...args,actorUserId:actor.id},context)).rejects.toThrow('ngữ cảnh giao việc đáng tin cậy')
  const first=await tool.handler(args,{...context,actorUserId:actor.id})
  const next=await tool.handler(args,{...context,actorUserId:actor.id})
  expect(first.content).toBe(next.content)
  expect(ctx.repos.db.get<{n:number}>('SELECT COUNT(*) AS n FROM employee_tasks')?.n).toBe(1)
  expect(ctx.repos.db.get<{status:string}>('SELECT status FROM employee_tasks')?.status).toBe('draft')
 })
 it('mode workforce tạo nháp qua model tool và khôi phục thẻ qua GET hội thoại',async()=>{
  const owner=await tenant(ctx,'chat-wf@example.com','Chat WF'),actor=ctx.repos.auth.findUserByEmail('chat-wf@example.com')!
  configureCompanyModel(ctx,owner.company.id)
  const employee=ctx.repos.workforce.createEmployee(actor.id,{name:'Designer',email:'d@example.com',password:'initial-password-123',companyIds:[owner.company.id]})
  const args={assigneeUserId:employee.id,title:'Video',brief:'Video giới thiệu',kind:'video',plannedWeek:workforceWeek(vietnamDate()),deadline:new Date(Date.now()+86400000).toISOString()}
  setAgentRuntimeOverrides(ctx.repos,{adapter:scriptedAdapter([toolTurn([{id:'draft-call',name:'employee_task_draft',argumentsJson:JSON.stringify(args)}]),textTurn('Đã tạo nháp, cần quản lý xác nhận.')])})
  const conv=await ctx.client.request('POST',`/api/companies/${owner.company.id}/conversations`,{headers:owner.ownerCookie,body:{title:'Designer'}})
  const id=conv.json<{conversation:{id:string}}>().conversation.id
  const response=await ctx.client.request('POST',`/api/conversations/${id}/messages`,{headers:owner.ownerCookie,body:{mode:'workforce',content:'Giao designer làm video'}})
  expect(response.status).toBe(200)
  const body=response.json<{missingFields:string[];reply:{workforceDraftIds:string[]}}>()
  expect(body.missingFields).toEqual([])
  expect(body.reply.workforceDraftIds).toHaveLength(1)
  const detail=await ctx.client.request('GET',`/api/conversations/${id}`,{headers:owner.ownerCookie})
  expect(detail.body).toContain(body.reply.workforceDraftIds[0])
  const task=ctx.repos.workforce.task(actor.id,body.reply.workforceDraftIds[0])
  expect(task.status).toBe('draft')
 })
})
