import { z } from 'zod'
import { AppError, notFound, dailyGroupSchema, dailySubmissionSchema, parseOrThrow } from '@marketing-agent/shared'
import type { AppContext } from '../context.ts'
import type { Router, RequestContext } from '../http/router.ts'
import { requireMembership, requireManage, requireAuthState } from '../http/middleware.ts'
import { exportDailyReport } from '../services/daily-report-export.ts'

export function registerDailyReportRoutes(router:Router,app:AppContext) {
 const {repos}=app,r= repos.dailyReports
 const root='/api/companies/:companyId/daily-report-groups',guard=[requireMembership(repos),requireManage]
 function group(ctx:RequestContext){const g=r.group(ctx.params.groupId!);if(g.companyId!==ctx.params.companyId)throw notFound('Không tìm thấy nhóm');return g}
 function round(ctx:RequestContext){const g=group(ctx),v=r.round(ctx.params.roundId!);if(v.groupId!==g.id)throw notFound('Không tìm thấy đợt');return v}
 function audit(ctx:RequestContext,action:string,target:string){repos.accounting.audit({companyId:ctx.params.companyId!,userId:requireAuthState(ctx).user.id,action:`daily_reports.${action}`,target})}
 function share(token:string){const raw=process.env.PUBLIC_BASE_URL; if(!raw)return {url:null,warning:'Chưa cấu hình PUBLIC_BASE_URL. Link phải truy cập được từ thiết bị của nhân viên.'}
  try{const url=new URL(raw);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error();return {url:`${url.origin}${url.pathname.replace(/\/$/,'')}/#/daily-report/${token}`,warning:['localhost','127.0.0.1','[::1]'].includes(url.hostname)?'Địa chỉ localhost chỉ dùng được trên máy chủ.':null}}
  catch{return {url:null,warning:'PUBLIC_BASE_URL không hợp lệ; cần địa chỉ HTTP(S) truy cập được.'}}
 }
 router.get(root,ctx=>{r.tick();ctx.json(200,{groups:r.list(ctx.params.companyId!),models:repos.llm.listModels(ctx.params.companyId!).filter(m=>m.enabled&&m.provider.enabled).map(m=>({id:m.id,label:m.label}))})},guard)
 router.post(root,async ctx=>{const input=parseOrThrow(dailyGroupSchema,await ctx.body(),'nhóm báo cáo');const g=r.save(ctx.params.companyId!,input);r.tick();audit(ctx,'created',g.id);ctx.json(201,{group:g})},guard)
 router.patch(`${root}/:groupId`,async ctx=>{group(ctx);const input=parseOrThrow(z.object({version:z.number().int().positive(),group:dailyGroupSchema}),await ctx.body(),'nhóm báo cáo');const g=r.save(ctx.params.companyId!,input.group,ctx.params.groupId!,input.version);audit(ctx,'updated',g.id);ctx.json(200,{group:g})},guard)
 router.get(`${root}/:groupId/rounds`,ctx=>{group(ctx);r.tick();ctx.json(200,{rounds:r.rounds(ctx.params.groupId!)})},guard)
 router.get(`${root}/:groupId/rounds/:roundId`,ctx=>{round(ctx);const detail=r.detail(ctx.params.roundId!);const {token,...safeRound}=detail.round;ctx.json(200,{...detail,round:safeRound,share:share(token!)})},guard)
 router.post(`${root}/:groupId/rounds/:roundId/update`,ctx=>{round(ctx);const id=r.updateReport(ctx.params.roundId!);audit(ctx,'version_created',id);ctx.json(201,{id})},guard)
 router.post(`${root}/:groupId/rounds/:roundId/versions/:versionId/retry`,ctx=>{round(ctx);r.retry(ctx.params.roundId!,ctx.params.versionId!);audit(ctx,'retry',ctx.params.versionId!);ctx.json(200,{ok:true})},guard)
 router.get(`${root}/:groupId/rounds/:roundId/versions/:versionId/export`,async ctx=>{
  round(ctx);const format=parseOrThrow(z.enum(['docx','pdf']),ctx.query('format'),'định dạng'),v=r.versions(ctx.params.roundId!).find(v=>v.id===ctx.params.versionId)
  if(!v)throw notFound('Không tìm thấy phiên bản');if(v.status!=='ready')throw new AppError('conflict','Bản tiếng Anh chưa sẵn sàng')
  const body=await exportDailyReport(v,format);ctx.res.writeHead(200,{'Content-Type':format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="daily-report-${v.snapshot.date}-v${v.number}.${format}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});ctx.res.end(body)
 },guard)
 // Bounded, per-process abuse protection. Does not trust client-supplied forwarding headers.
 const requests=new Map<string,{count:number;reset:number}>()
 function publicGuard(ctx:RequestContext,limit:number){ctx.res.setHeader('Cache-Control','no-store');ctx.res.setHeader('Referrer-Policy','no-referrer')
  const origin=ctx.req.headers.origin
  if(origin){const expected=process.env.PUBLIC_BASE_URL?new URL(process.env.PUBLIC_BASE_URL).origin:ctx.url.origin;if(origin!==expected)throw new AppError('forbidden','Nguồn yêu cầu không hợp lệ')}
  const now=Date.now(),key=`${ctx.req.socket.remoteAddress}:${ctx.method}`;for(const [k,v]of requests)if(v.reset<=now)requests.delete(k)
  const entry=requests.get(key)??{count:0,reset:now+60000};if(requests.size>=10000&&!requests.has(key))throw new AppError('rate_limited','Máy chủ đang bận');entry.count++;requests.set(key,entry);if(entry.count>limit)throw new AppError('rate_limited','Bạn gửi quá nhiều yêu cầu. Vui lòng thử lại sau một phút.')
 }
 const pub='/api/public/daily-reports/:token'
 router.get(pub,ctx=>{publicGuard(ctx,90);const v=r.byToken(ctx.params.token!),g=r.group(v.groupId);ctx.json(200,{groupName:g.name,date:v.date,opensAt:v.opensAt,deadline:v.deadline,closesAt:v.closesAt,serverNow:new Date().toISOString(),members:v.members})})
 router.post(pub,async ctx=>{publicGuard(ctx,15);const v=r.byToken(ctx.params.token!),body=parseOrThrow(dailySubmissionSchema,await ctx.body(),'báo cáo');ctx.json(201,r.submit(v.id,body))})
}
