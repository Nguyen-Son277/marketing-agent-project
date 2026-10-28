import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoutesTestContext, tenant, type RoutesTestContext, type TenantFixture } from './helpers/routes-helpers.ts'
import { exportDailyReport, dailyReportLines } from '../src/services/daily-report-export.ts'
import { createDailySynthesizer } from '../src/services/daily-report-worker.ts'
import type { DailyMemberSubmissionResponse, DailyReportVersion } from '@marketing-agent/shared'
import { ModelRegistry } from '@marketing-agent/llm'
import { saveLimits } from '../src/services/company-settings.ts'
let ctx:RoutesTestContext,t:TenantFixture
beforeEach(async()=>{ctx=await createRoutesTestContext();t=await tenant(ctx,'daily@example.com','Daily company')})
afterEach(async()=>{vi.useRealTimers();await ctx.close()})
function group(){return ctx.repos.dailyReports.save(t.company.id,{name:'Team',title:'Daily Team Work Report',enabled:true,modelId:null,members:['Alice','Châu']},undefined,undefined,new Date('2026-10-15T10:00:00+07:00'))}
describe('daily reporting HTTP and exports',()=>{
 it('protects management routes and blocks cross-company round IDs',async()=>{
  const g=group(),r=ctx.repos.dailyReports.ensureRound(g.id,'2026-10-15'),base=`/api/companies/${t.company.id}/daily-report-groups`
  expect((await ctx.client.request('GET',base)).status).toBe(401)
  const other=await tenant(ctx,'other-daily@example.com','Other')
  expect((await ctx.client.request('GET',base,{headers:other.ownerCookie})).status).toBe(404)
  expect((await ctx.client.request('GET',`/api/companies/${other.company.id}/daily-report-groups/${g.id}/rounds/${r.id}`,{headers:other.ownerCookie})).status).toBe(404)
 })
 it('public metadata is anonymous and does not expose work or edit keys',async()=>{
  const g=group(),r=ctx.repos.dailyReports.ensureRound(g.id,'2026-10-15'),secret=ctx.repos.dailyReports.round(r.id,true).token!,url=`/api/public/daily-reports/${secret}`
  const response=await ctx.client.request('GET',url);expect(response.status).toBe(200);expect(response.body).not.toContain('editKey');expect(response.body).not.toContain('companyId');expect(response.body).not.toContain('work')
  expect((await ctx.client.request('POST',url,{body:{memberId:r.members[0]!.id,work:'Test'},headers:{Origin:'https://untrusted.example'}})).status).toBe(403)
 })
 it('loads anonymous reports by name and accepts edits anytime while preventing stale overwrites',async()=>{
  const g=group(),r=ctx.repos.dailyReports.ensureRound(g.id,'2026-10-15'),url=`/api/public/daily-reports/${ctx.repos.dailyReports.round(r.id,true).token!}`
  const memberId=r.members[0]!.id,memberUrl=`${url}/members/${memberId}`
  expect((await ctx.client.request('GET',memberUrl)).json()).toEqual({submission:null})
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-15T08:00:00+07:00'))
  const result=await ctx.client.request('POST',url,{body:{memberId:r.members[0]!.id,work:'Completed three tasks'}})
  expect(result.status).toBe(201);expect(result.json<{version:number}>().version).toBe(1)
  const loaded=await ctx.client.request('GET',memberUrl),submission=loaded.json<DailyMemberSubmissionResponse>().submission!
  expect(loaded.headers.get('cache-control')).toBe('no-store')
  expect(submission).toMatchObject({memberId,work:'Completed three tasks',isDayOff:false,version:1})
  for(const secret of ['editKey','edit_hash','submission_id','companyId'])expect(loaded.body).not.toContain(secret)
  expect((await ctx.client.request('POST',url,{body:{memberId:r.members[0]!.id,work:'Overwrite'}})).status).toBe(409)
  vi.setSystemTime(new Date('2026-10-15T16:50:00+07:00'))
  expect((await ctx.client.request('POST',url,{body:{memberId:r.members[1]!.id,work:'Late report'}})).status).toBe(201)
  expect(ctx.repos.dailyReports.versions(r.id)[0]!.snapshot.members[1]!.status).toBe('overdue')
  vi.setSystemTime(new Date('2026-10-16T01:00:00+07:00'))
  expect((await ctx.client.request('POST',url,{body:{memberId,work:'Corrected from another device',version:submission.version}})).status).toBe(201)
  expect((await ctx.client.request('GET',memberUrl)).json<DailyMemberSubmissionResponse>().submission).toMatchObject({work:'Corrected from another device',version:2})
  expect((await ctx.client.request('POST',url,{body:{memberId,work:'Stale edit',version:submission.version}})).status).toBe(409)
  expect((await ctx.client.request('GET',`${url}/members/unknown`)).status).toBe(404)
  expect((await ctx.client.request('GET',memberUrl,{headers:{Origin:'https://untrusted.example'}})).status).toBe(403)
 })
 it('validates empty reports, saves day off and restores it when a name is selected',async()=>{
  const g=group(),r=ctx.repos.dailyReports.ensureRound(g.id,'2026-10-15'),url=`/api/public/daily-reports/${ctx.repos.dailyReports.round(r.id,true).token!}`,memberId=r.members[0]!.id
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-15T08:00:00+07:00'))
  expect((await ctx.client.request('POST',url,{body:{memberId,work:'   '}})).status).toBe(400)
  expect((await ctx.client.request('POST',url,{body:{memberId,isDayOff:true}})).status).toBe(201)
  expect((await ctx.client.request('GET',`${url}/members/${memberId}`)).json<DailyMemberSubmissionResponse>().submission).toMatchObject({isDayOff:true,work:'',version:1})
  expect((await ctx.client.request('POST',url,{body:{memberId,work:'Corrected work',isDayOff:false,version:1}})).status).toBe(201)
  expect((await ctx.client.request('GET',`${url}/members/${memberId}`)).json<DailyMemberSubmissionResponse>().submission).toMatchObject({isDayOff:false,work:'Corrected work',version:2})
 })
 it('includes day off in English synthesis, public summaries and exported documents without needing a model',async()=>{
  const g=group(),r=ctx.repos.dailyReports.createRoundForDate(g.id,'2026-10-15',new Date('2026-10-15T08:00:00+07:00')).round
  const memberId=r.members[0]!.id
  ctx.repos.dailyReports.submit(r.id,{memberId,isDayOff:true},new Date('2026-10-15T08:00:00+07:00'))
  ctx.repos.dailyReports.seal(r.id,new Date('2026-10-15T16:50:00+07:00'))
  const job=ctx.repos.dailyReports.claimJob()!,english=await createDailySynthesizer(ctx.repos)(job.snapshot,t.company.id,null,new AbortController().signal)
  expect(english.individuals).toEqual([{memberId,work:'Day off',blockers:'',nextSteps:''}])
  expect(english.executiveSummary).toContain('day off')
  ctx.repos.dailyReports.completeJob(job.id,english)
  const report=(await ctx.client.request('GET',`/api/public/daily-report-views/${ctx.repos.dailyReports.viewToken(r.id)!}`)).json<{members:unknown[]}>()
  expect(report.members[0]).toMatchObject({isDayOff:true,work:'Day off',status:'on_time'})
  const version=ctx.repos.dailyReports.versions(r.id)[0]!,lines=dailyReportLines(version)
  expect(lines.some(line=>line.text==='Day off')).toBe(true)
  expect(lines.some(line=>line.text.includes('Day off: 1'))).toBe(true)
  expect((await exportDailyReport(version,'docx')).subarray(0,2).toString()).toBe('PK')
  expect((await exportDailyReport(version,'pdf')).subarray(0,5).toString()).toBe('%PDF-')
 })
 it('returns no English report when synthesis has no configured model',async()=>{const g=group(),r=ctx.repos.dailyReports.ensureRound(g.id,'2026-10-15');ctx.repos.dailyReports.submit(r.id,{memberId:r.members[0]!.id,work:'Finished',blockers:'',nextSteps:''},new Date('2026-10-15T16:30:00+07:00'));const s=ctx.repos.dailyReports.snapshot(r.id,new Date('2026-10-15T17:00:00+07:00'));await expect(createDailySynthesizer(ctx.repos)(s,t.company.id,null,new AbortController().signal)).rejects.toThrow('model')})
 it('generates actual DOCX ZIP and Unicode PDF from the same snapshot',async()=>{
  const g=group(),r=ctx.repos.dailyReports.ensureRound(g.id,'2026-10-15');ctx.repos.dailyReports.seal(r.id,new Date('2026-10-15T17:00:00+07:00'))
  const v:DailyReportVersion={...ctx.repos.dailyReports.versions(r.id)[0]!,status:'ready',english:{executiveSummary:'No reports were submitted.',individuals:[]}}
  const docx=await exportDailyReport(v,'docx'),pdf=await exportDailyReport(v,'pdf')
  expect(docx.subarray(0,2).toString()).toBe('PK');expect(pdf.subarray(0,5).toString()).toBe('%PDF-');expect(pdf.length).toBeGreaterThan(5000)
  expect(dailyReportLines(v).some(l=>l.text.includes('Châu'))).toBe(true)
  expect(dailyReportLines(v).some(l=>l.text.includes('Overdue'))).toBe(true)
  expect(()=>dailyReportLines({...v,status:'failed'})).toThrow()
 })
 it('validates mocked English output and records usage without tools',async()=>{
  const g=group(),r=ctx.repos.dailyReports.ensureRound(g.id,'2026-10-15');ctx.repos.dailyReports.submit(r.id,{memberId:r.members[0]!.id,work:'Hoàn tất 3 bài viết',blockers:'',nextSteps:''},new Date('2026-10-15T16:30:00+07:00'))
  const provider=ctx.repos.llm.createProvider({companyId:t.company.id,name:'Mock',kind:'openai_compatible',baseUrl:'http://mock.invalid'})
  const model=ctx.repos.llm.createModel({providerId:provider.id,modelId:'mock',label:'Mock'})
  const snapshot=ctx.repos.dailyReports.snapshot(r.id,new Date('2026-10-15T17:00:00+07:00'))
  const spy=vi.spyOn(ModelRegistry.prototype,'selectAdapterFor').mockReturnValue({keyId:null,keyLabel:null,mode:'failover',adapter:{kind:'openai_compatible',async *chat(request){expect(request.tools).toBeUndefined();yield {type:'text',text:JSON.stringify({executiveSummary:'Three posts completed.',individuals:[{memberId:r.members[0]!.id,work:'Completed 3 posts.',blockers:'',nextSteps:''}]})};yield {type:'done',finishReason:'stop',usage:{promptTokens:100,completionTokens:50,cachedTokens:0}}}}})
  try{const result=await createDailySynthesizer(ctx.repos)(snapshot,t.company.id,model.id,new AbortController().signal);expect(result.individuals[0]!.work).toBe('Completed 3 posts.');expect(ctx.repos.accounting.listRuns(t.company.id)[0]!.status).toBe('succeeded')
   spy.mockReturnValue({keyId:null,keyLabel:null,mode:'failover',adapter:{kind:'openai_compatible',async *chat(){yield {type:'text',text:'{"executiveSummary":"Invented","individuals":[]}'};yield {type:'done',finishReason:'stop',usage:{promptTokens:50,completionTokens:20,cachedTokens:0}}}}})
   await expect(createDailySynthesizer(ctx.repos)(snapshot,t.company.id,model.id,new AbortController().signal)).rejects.toThrow('khớp')
   saveLimits(ctx.repos,t.company.id,{taskCostUsd:0.0001});const expensive=ctx.repos.llm.createModel({providerId:provider.id,modelId:'costly',label:'Costly',costOutPerMtok:100});await expect(createDailySynthesizer(ctx.repos)(snapshot,t.company.id,expensive.id,new AbortController().signal)).rejects.toThrow('Ngân sách')
  }finally{spy.mockRestore()}
 })
 it('requires permission and ready version for export',async()=>{const g=group(),r=ctx.repos.dailyReports.ensureRound(g.id,'2026-10-15');ctx.repos.dailyReports.seal(r.id,new Date('2026-10-15T17:00:00+07:00'));const v=ctx.repos.dailyReports.versions(r.id)[0]!,url=`/api/companies/${t.company.id}/daily-report-groups/${g.id}/rounds/${r.id}/versions/${v.id}/export?format=pdf`;expect((await ctx.client.request('GET',url)).status).toBe(401);expect((await ctx.client.request('GET',url,{headers:t.ownerCookie})).status).toBe(409)})
})
