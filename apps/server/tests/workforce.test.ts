/** Nghiệm thu quyền và vòng đời việc con người qua HTTP thật. */
import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { createRoutesTestContext, tenant, createCompany, type RoutesTestContext } from './helpers/routes-helpers.ts'
import { cookieHeader } from './helpers/test-client.ts'
import { SESSION_COOKIE } from '../src/http/middleware.ts'
import { workforceWeek, vietnamDate } from '@marketing-agent/shared'
let ctx:RoutesTestContext
beforeEach(async()=>{ctx=await createRoutesTestContext()})
afterEach(async()=>{await ctx.close()})
const password='initial-password-123',newPassword='new-password-4567'
async function fixture(){
 const owner=await tenant(ctx,'wf-manager@example.com','A')
 const b=await createCompany(ctx,owner.ownerCookie,'B'),c=await createCompany(ctx,owner.ownerCookie,'C')
 const result=await ctx.client.request('POST','/api/workforce/employees',{headers:owner.ownerCookie,body:{name:'Designer',email:'designer@example.com',password,companyIds:[owner.company.id,b.id,c.id]}})
 expect(result.status).toBe(201);expect(result.body).not.toContain(password)
 const employee=result.json<{employee:{id:string}}>().employee
 const login=await ctx.client.request('POST','/api/auth/login',{body:{email:'designer@example.com',password}})
 const cookie=cookieHeader(login,SESSION_COOKIE)
 const reviewer=ctx.repos.auth.findUserByEmail('fixture-admin@example.com')!
 return {owner,b,c,employee,cookie,reviewer}
}
async function enable(f:Awaited<ReturnType<typeof fixture>>){
 ctx.repos.auth.approveUser(f.employee.id,f.reviewer.id)
 const changed=await ctx.client.request('POST','/api/auth/change-password',{headers:f.cookie,body:{currentPassword:password,newPassword}})
 expect(changed.status).toBe(200)
 return cookieHeader(changed,SESSION_COOKIE)
}
function input(companyId:string,assigneeUserId:string){return {companyId,assigneeUserId,title:'Banner',brief:'Thiết kế 3 banner',kind:'image',priority:2,plannedWeek:workforceWeek(vietnamDate()),plannedDate:vietnamDate(),deadline:new Date(Date.now()+86400000).toISOString()}}

describe('workforce employee access',()=>{
 it('pending cần admin duyệt; sau duyệt bắt đổi password, thu hồi phiên cũ',async()=>{
  const f=await fixture()
  expect((await ctx.client.request('GET','/api/workforce/tasks',{headers:f.cookie})).status).toBe(403)
  ctx.repos.auth.approveUser(f.employee.id,f.reviewer.id)
  expect((await ctx.client.request('GET','/api/workforce/tasks',{headers:f.cookie})).status).toBe(403)
  const same=await ctx.client.request('POST','/api/auth/change-password',{headers:f.cookie,body:{currentPassword:password,newPassword:password}})
  expect(same.status).toBe(409)
  const cookie=await enable(f)
  expect((await ctx.client.request('GET','/api/auth/me',{headers:f.cookie})).status).toBe(401)
  expect((await ctx.client.request('GET','/api/workforce/tasks',{headers:cookie})).status).toBe(200)
  for(const path of ['/api/companies','/api/admin/users',`/api/companies/${f.owner.company.id}/tasks`])expect((await ctx.client.request('GET',path,{headers:cookie})).status).toBe(403)
  expect((await ctx.client.request('GET','/api/workforce/employees',{headers:cookie})).status).toBe(403)
 })
 it('gom việc 3 công ty, nháp không lộ, user khác không truy cập id',async()=>{
  const f=await fixture(),cookie=await enable(f)
  const ids:string[]=[]
  for(const company of [f.owner.company,f.b,f.c]){
   const r=await ctx.client.request('POST','/api/workforce/tasks',{headers:f.owner.ownerCookie,body:{task:input(company.id,f.employee.id),draft:false}})
   expect(r.status).toBe(201);ids.push(r.json<{task:{id:string}}>().task.id)
  }
  const draft=await ctx.client.request('POST','/api/workforce/tasks',{headers:f.owner.ownerCookie,body:{task:input(f.b.id,f.employee.id),draft:true}})
  const list=await ctx.client.request('GET','/api/workforce/tasks',{headers:cookie})
  expect(list.json<{total:number}>().total).toBe(3)
  expect((await ctx.client.request('GET',`/api/workforce/tasks/${draft.json<{task:{id:string}}>().task.id}`,{headers:cookie})).status).toBe(404)
  const other=await tenant(ctx,'wf-other@example.com','Foreign')
  expect((await ctx.client.request('GET',`/api/workforce/tasks/${ids[0]}`,{headers:other.ownerCookie})).status).toBe(404)
  expect((await ctx.client.request('POST','/api/workforce/tasks',{headers:f.owner.ownerCookie,body:{task:input(other.company.id,f.employee.id)}})).status).toBe(404)
 })
 it('báo cáo, review, yêu cầu sửa và hoàn thành đúng version; nhân viên không tự duyệt',async()=>{
  const f=await fixture(),cookie=await enable(f)
  const r=await ctx.client.request('POST','/api/workforce/tasks',{headers:f.owner.ownerCookie,body:{task:input(f.owner.company.id,f.employee.id),draft:false}})
  const id=r.json<{task:{id:string}}>().task.id
  expect((await ctx.client.request('POST',`/api/workforce/tasks/${id}/review`,{headers:cookie,body:{version:1,decision:'approve'}})).status).toBe(403)
  const start=await ctx.client.request('POST',`/api/workforce/tasks/${id}/start`,{headers:cookie,body:{version:1}})
  expect(start.status).toBe(200)
  const bad=await ctx.client.request('POST',`/api/workforce/tasks/${id}/reports`,{headers:cookie,body:{version:2,kind:'submit',content:'Xong',links:['javascript:alert(1)']}})
  expect(bad.status).toBe(400)
  const submit=await ctx.client.request('POST',`/api/workforce/tasks/${id}/reports`,{headers:cookie,body:{version:2,kind:'submit',content:'Đã làm xong',links:['https://drive.google.com/test']}})
  expect(submit.status).toBe(201)
  expect(submit.json<{task:{status:string}}>().task.status).toBe('review')
  expect((await ctx.client.request('POST',`/api/workforce/tasks/${id}/review`,{headers:f.owner.ownerCookie,body:{version:2,decision:'approve'}})).status).toBe(409)
  expect((await ctx.client.request('POST',`/api/workforce/tasks/${id}/review`,{headers:f.owner.ownerCookie,body:{version:3,decision:'request_changes',note:'Sửa màu'}})).status).toBe(200)
  expect((await ctx.client.request('POST',`/api/workforce/tasks/${id}/reports`,{headers:cookie,body:{version:4,kind:'submit',content:'Đã sửa',links:['https://figma.com/test']}})).status).toBe(201)
  const done=await ctx.client.request('POST',`/api/workforce/tasks/${id}/review`,{headers:f.owner.ownerCookie,body:{version:5,decision:'approve'}})
  expect(done.json<{task:{status:string}}>().task.status).toBe('done')
  const detail=await ctx.client.request('GET',`/api/workforce/tasks/${id}`,{headers:cookie})
  expect(detail.json<{reports:unknown[]}>().reports).toHaveLength(2)
  expect((await ctx.client.request('POST',`/api/workforce/tasks/${id}/reopen`,{headers:f.owner.ownerCookie,body:{version:6,note:'Sửa lần nữa'}})).status).toBe(200)
 })
 it('thu hồi công ty cần xác nhận khi có việc đang mở và mất quyền ngay',async()=>{
  const f=await fixture(),cookie=await enable(f)
  const t=await ctx.client.request('POST','/api/workforce/tasks',{headers:f.owner.ownerCookie,body:{task:input(f.b.id,f.employee.id)}})
  const body={companyIds:[f.owner.company.id,f.c.id],active:true}
  expect((await ctx.client.request('PATCH',`/api/workforce/employees/${f.employee.id}`,{headers:f.owner.ownerCookie,body})).status).toBe(409)
  expect((await ctx.client.request('PATCH',`/api/workforce/employees/${f.employee.id}`,{headers:f.owner.ownerCookie,body:{...body,confirmRemoval:true}})).status).toBe(200)
  const login=await ctx.client.request('POST','/api/auth/login',{body:{email:'designer@example.com',password:newPassword}})
  const fresh=cookieHeader(login,SESSION_COOKIE)
  expect((await ctx.client.request('GET',`/api/workforce/tasks/${t.json<{task:{id:string}}>().task.id}`,{headers:fresh})).status).toBe(404)
  expect((await ctx.client.request('GET','/api/auth/me',{headers:cookie})).status).toBe(401)
 })
})
