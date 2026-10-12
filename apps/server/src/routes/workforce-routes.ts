/** API việc con người: mọi thao tác đi qua cùng service/repository có quyền và version. */
import { z } from 'zod'
import { createEmployeeSchema, updateEmployeeSchema, workforceTaskSchema, workforceActionSchema, workforceReportSchema, workforceDate, EMPLOYEE_TASK_STATUSES, parseOrThrow } from '@marketing-agent/shared'
import type { Repos } from '@marketing-agent/db'
import { requireAuthState } from '../http/middleware.ts'
import type { Router, RequestContext } from '../http/router.ts'
const listSchema=z.object({companyId:z.string().optional(),assigneeUserId:z.string().optional(),week:workforceDate.optional(),day:workforceDate.optional(),status:z.enum(EMPLOYEE_TASK_STATUSES).optional(),overdue:z.enum(['true','false']).optional(),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(50)})
export function registerWorkforceRoutes(router:Router,repos:Repos) {
  const actor=(ctx:RequestContext)=>requireAuthState(ctx).user.id
  const audit=(ctx:RequestContext,action:string,id:string)=>repos.accounting.audit({userId:actor(ctx),action:`workforce.${action}`,target:id})
  router.get('/api/workforce/companies',ctx=>ctx.json(200,{companies:repos.workforce.companies(actor(ctx))}))
  router.get('/api/workforce/employees',ctx=>ctx.json(200,{employees:repos.workforce.employees(actor(ctx))}))
  router.post('/api/workforce/employees',async ctx=>{
    const input=parseOrThrow(createEmployeeSchema,await ctx.body(),'tài khoản nhân viên')
    const employee=repos.db.tx(()=>{const e=repos.workforce.createEmployee(actor(ctx),input);audit(ctx,'employee_created',e.id);return e})
    ctx.json(201,{employee})
  })
  router.patch('/api/workforce/employees/:id',async ctx=>{
    const input=parseOrThrow(updateEmployeeSchema,await ctx.body(),'quyền nhân viên')
    const employee=repos.db.tx(()=>{const e=repos.workforce.updateEmployee(actor(ctx),ctx.params.id!,input);audit(ctx,'employee_updated',e.id);return e})
    ctx.json(200,{employee})
  })
  router.get('/api/workforce/tasks',ctx=>{
    const input=parseOrThrow(listSchema,Object.fromEntries(ctx.url.searchParams),'bộ lọc việc')
    ctx.json(200,repos.workforce.list(actor(ctx),{...input,overdue:input.overdue==='true'}))
  })
  router.post('/api/workforce/tasks',async ctx=>{
    const input=parseOrThrow(z.object({task:workforceTaskSchema,draft:z.boolean().default(false)}),await ctx.body(),'giao việc')
    const task=repos.db.tx(()=>{const t=repos.workforce.createTask(actor(ctx),input.task,{draft:input.draft});audit(ctx,'task_created',t.id);return t})
    ctx.json(201,{task})
  })
  router.get('/api/workforce/tasks/:id',ctx=>ctx.json(200,repos.workforce.detail(actor(ctx),ctx.params.id!)))
  router.patch('/api/workforce/tasks/:id',async ctx=>{
    const input=parseOrThrow(z.object({version:z.number().int().positive(),task:workforceTaskSchema}),await ctx.body(),'sửa việc')
    const task=repos.db.tx(()=>{const t=repos.workforce.updateTask(actor(ctx),ctx.params.id!,input.version,input.task);audit(ctx,'task_updated',t.id);return t})
    ctx.json(200,{task})
  })
  for(const action of ['assign','start','reopen','cancel'] as const) router.post(`/api/workforce/tasks/:id/${action}`,async ctx=>{
    const input=parseOrThrow(workforceActionSchema,await ctx.body(),'thao tác việc')
    const task=repos.db.tx(()=>{const t=repos.workforce.action(actor(ctx),ctx.params.id!,input.version,action,input.note);audit(ctx,action,t.id);return t})
    ctx.json(200,{task})
  })
  router.post('/api/workforce/tasks/:id/review',async ctx=>{
    const input=parseOrThrow(workforceActionSchema.extend({decision:z.enum(['approve','request_changes'])}),await ctx.body(),'duyệt việc')
    const task=repos.db.tx(()=>{const t=repos.workforce.action(actor(ctx),ctx.params.id!,input.version,input.decision,input.note);audit(ctx,input.decision,t.id);return t})
    ctx.json(200,{task})
  })
  router.post('/api/workforce/tasks/:id/reports',async ctx=>{
    const input=parseOrThrow(workforceReportSchema,await ctx.body(),'báo cáo việc')
    const detail=repos.db.tx(()=>{const d=repos.workforce.report(actor(ctx),ctx.params.id!,input);audit(ctx,'report',d.task.id);return d})
    ctx.json(201,detail)
  })
}
