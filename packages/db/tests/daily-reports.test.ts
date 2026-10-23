import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepos, type Repos } from '../src/index.ts'
import { dailyWorkingDay, dailyVietnamDate, dailyGroupSchema, dailyReportDateSchema, dailySubmissionSchema } from '@marketing-agent/shared'
let repos:Repos
const at=(t:string)=>new Date(`2026-10-15T${t}+07:00`)
beforeEach(()=>{repos=createRepos({file:':memory:',allowWeakSecret:true});repos.db.run(`INSERT INTO companies(id,name,slug,created_at) VALUES('company','Company','company','now')`)})
afterEach(()=>repos.db.close())
function fixture(){const g=repos.dailyReports.save('company',{name:'Team',title:'Daily Team Work Report',enabled:true,modelId:null,members:['Alice','Bob','Châu']},undefined,undefined,at('10:00:00'));const r=repos.dailyReports.ensureRound(g.id,'2026-10-15');return {g,r}}
describe('daily reports repository',()=>{
 it('validates real calendar dates including leap years',()=>{
  expect(dailyReportDateSchema.safeParse('2028-02-29').success).toBe(true)
  for(const date of ['2026-02-29','2026-04-31','2026-01-00','2026-1-01','2026-01-01T00:00:00Z'])expect(dailyReportDateSchema.safeParse(date).success,date).toBe(false)
 })
 it('preserves future rosters and independent tokens across edits and scheduler ticks',()=>{
  const {g}=fixture(),first=repos.dailyReports.createRoundForDate(g.id,'2026-10-17',at('10:00:00'))
  const original=repos.dailyReports.round(first.round.id,true),view=repos.dailyReports.viewToken(first.round.id)
  expect(first.created).toBe(true)
  repos.dailyReports.save('company',{name:'New name',title:'New title',enabled:true,modelId:null,members:['New person']},g.id,g.version,at('11:00:00'))
  repos.dailyReports.tick(at('12:00:00'))
  const repeated=repos.dailyReports.createRoundForDate(g.id,'2026-10-17',at('13:00:00'))
  expect(repeated.created).toBe(false)
  expect(repeated.round.members.map(m=>m.name)).toEqual(['Alice','Bob','Châu'])
  expect(repos.dailyReports.round(original.id,true).token).toBe(original.token)
  expect(repos.dailyReports.viewToken(original.id)).toBe(view)
  expect(repos.dailyReports.versions(original.id)).toEqual([])
  expect(repos.dailyReports.publicReport(view!).status).toBe('pending')
 })
 it('uses the Vietnam calendar and skips Sundays only',()=>{expect(dailyWorkingDay('2026-10-17')).toBe(true);expect(dailyWorkingDay('2026-10-18')).toBe(false);expect(dailyVietnamDate(new Date('2026-10-15T18:00:00Z'))).toBe('2026-10-16')})
 it('validates distinguishable names',()=>{expect(dailyGroupSchema.safeParse({name:'X',members:['Alice','alice']}).success).toBe(false)})
 it('accepts submissions and edits at any time, including before the reporting date and after midnight',()=>{
  const {r}=fixture(),input={memberId:r.members[0]!.id,work:'Work'}
  expect(repos.dailyReports.submit(r.id,input,new Date('2026-10-14T23:00:00+07:00'))).toMatchObject({version:1,late:false})
  expect(repos.dailyReports.submit(r.id,{...input,work:'Morning correction',version:1},at('08:00:00'))).toMatchObject({version:2,late:false})
  expect(repos.dailyReports.submit(r.id,{...input,work:'Next day correction',version:2},new Date('2026-10-16T01:00:00+07:00'))).toMatchObject({version:3,late:true})
  expect(repos.dailyReports.round(r.id).date).toBe('2026-10-15')
  expect(repos.dailyReports.versions(r.id)[0]!.snapshot.members[0]!.work).toBe('Morning correction')
 })
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
 it('loads a report by member and permits edits without a receipt, requiring the latest version',()=>{
  const {r}=fixture(),input={memberId:r.members[0]!.id,work:'Original',blockers:'',nextSteps:''}
  expect(repos.dailyReports.memberSubmission(r.id,input.memberId)).toBeNull()
  repos.dailyReports.submit(r.id,input,at('08:00:00'))
  const saved=repos.dailyReports.memberSubmission(r.id,input.memberId)!
  expect(saved).toMatchObject({...input,isDayOff:false,version:1})
  expect(saved).not.toHaveProperty('editKey')
  expect(()=>repos.dailyReports.submit(r.id,{...input,work:'Without loading'},at('16:21:00'))).toThrow('thay đổi')
  expect(()=>repos.dailyReports.submit(r.id,{...input,version:99},at('16:21:00'))).toThrow('thay đổi')
  repos.dailyReports.submit(r.id,{...input,work:'After deadline',version:saved.version},at('16:51:00'))
  expect(()=>repos.dailyReports.submit(r.id,{...input,version:saved.version},at('16:52:00'))).toThrow('thay đổi')
  expect(repos.dailyReports.versions(r.id)[0]!.snapshot.members[0]!.work).toBe('Original')
  expect(repos.dailyReports.snapshot(r.id,at('17:00:00')).members[0]!.status).toBe('updated_after_deadline')
  expect(repos.db.get<{n:number}>('SELECT count(*) AS n FROM daily_report_revisions')!.n).toBe(2)
 })
 it('records day off without work details and can correct it without rewriting the cutoff snapshot',()=>{
  const {r}=fixture(),memberId=r.members[0]!.id
  repos.dailyReports.submit(r.id,{memberId,isDayOff:true,work:'Accidentally entered',blockers:'Old blocker',nextSteps:'Old plan'},at('08:00:00'))
  expect(repos.dailyReports.memberSubmission(r.id,memberId)).toMatchObject({isDayOff:true,work:'',blockers:'',nextSteps:'',version:1})
  repos.dailyReports.seal(r.id,at('16:50:00'))
  expect(repos.dailyReports.versions(r.id)[0]!.snapshot.members[0]).toMatchObject({isDayOff:true,status:'on_time',revision:1})
  repos.dailyReports.submit(r.id,{memberId,version:1,work:'Worked after all'},at('18:00:00'))
  expect(repos.dailyReports.memberSubmission(r.id,memberId)).toMatchObject({isDayOff:false,work:'Worked after all',version:2})
  expect(repos.dailyReports.snapshot(r.id,at('18:01:00')).members[0]).toMatchObject({isDayOff:false,status:'updated_after_deadline'})
  expect(repos.dailyReports.versions(r.id)[0]!.snapshot.members[0]!.isDayOff).toBe(true)
  repos.dailyReports.submit(r.id,{memberId:r.members[1]!.id,isDayOff:true},at('18:00:00'))
  expect(repos.dailyReports.snapshot(r.id,at('18:01:00')).members[1]).toMatchObject({isDayOff:true,status:'late_submission'})
 })
 it('requires either work or day off and only loads members from the selected round',()=>{
  expect(dailySubmissionSchema.safeParse({memberId:'member',work:'   '}).success).toBe(false)
  expect(dailySubmissionSchema.safeParse({memberId:'member',isDayOff:true}).success).toBe(true)
  expect(dailySubmissionSchema.safeParse({memberId:'member',isDayOff:'true'}).success).toBe(false)
  const {r}=fixture()
  expect(()=>repos.dailyReports.memberSubmission(r.id,'unknown')).toThrow('Thành viên')
  expect(()=>repos.dailyReports.submit(r.id,{memberId:'unknown',isDayOff:true},at('08:00:00'))).toThrow('Thành viên')
 })
 it('does not mutate existing roster or snapshots when group changes',()=>{const {g,r}=fixture();repos.dailyReports.save('company',{name:'Renamed',title:'New',enabled:true,modelId:null,members:['New person']},g.id,1,at('17:00:00'));expect(repos.dailyReports.round(r.id).members.map(m=>m.name)).toEqual(['Alice','Bob','Châu']);expect(()=>repos.dailyReports.save('company',{name:'X',title:'X',enabled:true,modelId:null,members:['X']},g.id,1)).toThrow()})
 it('scheduler is idempotent and recovers missed dates without Sundays',()=>{const {g}=fixture();repos.dailyReports.tick(new Date('2026-10-19T17:00:00+07:00'));repos.dailyReports.tick(new Date('2026-10-19T17:01:00+07:00'));expect(repos.dailyReports.rounds(g.id).map(r=>r.date)).toEqual(['2026-10-19','2026-10-17','2026-10-16','2026-10-15']);for(const r of repos.dailyReports.rounds(g.id))expect(repos.dailyReports.versions(r.id)).toHaveLength(1)})
 it('claims jobs once and restores interrupted jobs on restart',()=>{const {r}=fixture();repos.dailyReports.seal(r.id,at('16:50:00'));const job=repos.dailyReports.claimJob()!;expect(repos.dailyReports.claimJob()).toBeUndefined();repos.dailyReports.recoverJobs();expect(repos.dailyReports.claimJob()!.id).toBe(job.id);repos.dailyReports.failJob(job.id,'failure');repos.dailyReports.retry(r.id,job.id);expect(repos.dailyReports.claimJob()!.id).toBe(job.id)})
 it('validates tokens and stores only encrypted/token hashes',()=>{const {r}=fixture(),withToken=repos.dailyReports.round(r.id,true);expect(repos.dailyReports.byToken(withToken.token!).id).toBe(r.id);expect(()=>repos.dailyReports.byToken('wrong')).toThrow();const stored=repos.db.get<Record<string,unknown>>('SELECT * FROM daily_report_rounds WHERE id=?',[r.id]);expect(Object.values(stored!).includes(withToken.token)).toBe(false)})
})
