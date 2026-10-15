import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepos, type Repos } from '../src/index.ts'
import { dailyWorkingDay, dailyVietnamDate, dailyGroupSchema } from '@marketing-agent/shared'
let repos:Repos
const at=(t:string)=>new Date(`2026-10-15T${t}+07:00`)
beforeEach(()=>{repos=createRepos({file:':memory:',allowWeakSecret:true});repos.db.run(`INSERT INTO companies(id,name,slug,created_at) VALUES('company','Company','company','now')`)})
afterEach(()=>repos.db.close())
function fixture(){const g=repos.dailyReports.save('company',{name:'Team',title:'Daily Team Work Report',enabled:true,modelId:null,members:['Alice','Bob','Châu']},undefined,undefined,at('10:00:00'));const r=repos.dailyReports.ensureRound(g.id,'2026-10-15');return {g,r}}
describe('daily reports repository',()=>{
 it('uses the Vietnam calendar and skips Sundays only',()=>{expect(dailyWorkingDay('2026-10-17')).toBe(true);expect(dailyWorkingDay('2026-10-18')).toBe(false);expect(dailyVietnamDate(new Date('2026-10-15T18:00:00Z'))).toBe('2026-10-16')})
 it('validates distinguishable names',()=>{expect(dailyGroupSchema.safeParse({name:'X',members:['Alice','alice']}).success).toBe(false)})
 it('rejects before opening and after local midnight',()=>{const {r}=fixture(),input={memberId:r.members[0]!.id,work:'Work',blockers:'',nextSteps:''};expect(()=>repos.dailyReports.submit(r.id,input,at('16:19:59'))).toThrow();expect(()=>repos.dailyReports.submit(r.id,input,new Date('2026-10-16T00:00:00+07:00'))).toThrow()})
 it('preserves cutoff snapshot, marks late and missing distinctly',()=>{
  const {r}=fixture();repos.dailyReports.submit(r.id,{memberId:r.members[0]!.id,work:'Published 3 posts',blockers:'',nextSteps:''},at('16:49:59'))
  repos.dailyReports.submit(r.id,{memberId:r.members[1]!.id,work:'Made 2 designs',blockers:'',nextSteps:''},at('16:50:00'))
  const original=repos.dailyReports.versions(r.id)[0]!
  expect(original.snapshot.members.map(m=>m.status)).toEqual(['on_time','overdue','overdue'])
  expect(original.snapshot.members[1]!.work).toBe('')
  repos.dailyReports.updateReport(r.id,at('17:00:00'))
  const versions=repos.dailyReports.versions(r.id)
  expect(versions).toHaveLength(2);expect(versions[0]!.snapshot.members.map(m=>m.status)).toEqual(['on_time','late_submission','overdue']);expect(versions[1]).toEqual(original)
 })
 it('requires edit key and matching version; retains all revisions',()=>{
  const {r}=fixture(),input={memberId:r.members[0]!.id,work:'Original',blockers:'',nextSteps:''}
  const receipt=repos.dailyReports.submit(r.id,input,at('16:20:00'))
  expect(()=>repos.dailyReports.submit(r.id,{...input,work:'Impersonation'},at('16:21:00'))).toThrow()
  expect(()=>repos.dailyReports.submit(r.id,{...input,editKey:receipt.editKey,version:99},at('16:21:00'))).toThrow()
  repos.dailyReports.submit(r.id,{...input,work:'After deadline',editKey:receipt.editKey,version:1},at('16:51:00'))
  expect(repos.dailyReports.versions(r.id)[0]!.snapshot.members[0]!.work).toBe('Original')
  expect(repos.dailyReports.snapshot(r.id,at('17:00:00')).members[0]!.status).toBe('updated_after_deadline')
  expect(repos.db.get<{n:number}>('SELECT count(*) AS n FROM daily_report_revisions')!.n).toBe(2)
 })
 it('does not mutate existing roster or snapshots when group changes',()=>{const {g,r}=fixture();repos.dailyReports.save('company',{name:'Renamed',title:'New',enabled:true,modelId:null,members:['New person']},g.id,1,at('17:00:00'));expect(repos.dailyReports.round(r.id).members.map(m=>m.name)).toEqual(['Alice','Bob','Châu']);expect(()=>repos.dailyReports.save('company',{name:'X',title:'X',enabled:true,modelId:null,members:['X']},g.id,1)).toThrow()})
 it('scheduler is idempotent and recovers missed dates without Sundays',()=>{const {g}=fixture();repos.dailyReports.tick(new Date('2026-10-19T17:00:00+07:00'));repos.dailyReports.tick(new Date('2026-10-19T17:01:00+07:00'));expect(repos.dailyReports.rounds(g.id).map(r=>r.date)).toEqual(['2026-10-19','2026-10-17','2026-10-16','2026-10-15']);for(const r of repos.dailyReports.rounds(g.id))expect(repos.dailyReports.versions(r.id)).toHaveLength(1)})
 it('claims jobs once and restores interrupted jobs on restart',()=>{const {r}=fixture();repos.dailyReports.seal(r.id,at('16:50:00'));const job=repos.dailyReports.claimJob()!;expect(repos.dailyReports.claimJob()).toBeUndefined();repos.dailyReports.recoverJobs();expect(repos.dailyReports.claimJob()!.id).toBe(job.id);repos.dailyReports.failJob(job.id,'failure');repos.dailyReports.retry(r.id,job.id);expect(repos.dailyReports.claimJob()!.id).toBe(job.id)})
 it('validates tokens and stores only encrypted/token hashes',()=>{const {r}=fixture(),withToken=repos.dailyReports.round(r.id,true);expect(repos.dailyReports.byToken(withToken.token!).id).toBe(r.id);expect(()=>repos.dailyReports.byToken('wrong')).toThrow();const stored=repos.db.get<Record<string,unknown>>('SELECT * FROM daily_report_rounds WHERE id=?',[r.id]);expect(Object.values(stored!).includes(withToken.token)).toBe(false)})
})
