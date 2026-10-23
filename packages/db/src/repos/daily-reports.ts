import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { AppError, notFound, forbidden, dailyBounds, dailyVietnamDate, dailyWorkingDay, dailyNextDate, dailyGroupSchema, dailySubmissionSchema, dailyReportDateSchema, type DailyGroupInput, type DailyGroup, type DailyRound, type DailySnapshot, type DailyReportVersion, type DailySubmissionInput, type DailySubmissionReceipt, type DailyPublicSubmission, type DailyEnglish, type DailyPublicReport } from '@marketing-agent/shared'
import type { Database } from '../database.ts'
import { SecretBox } from '../crypto.ts'
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const token = () => randomBytes(32).toString('base64url')
type GroupRow = {id:string;company_id:string;name:string;title:string;enabled:number;model_id:string|null;members_json:string;start_date:string;version:number}
type RoundRow = {id:string;group_id:string;date:string;opens_at:string;deadline:string;closes_at:string;members_json:string;sealed_at:string|null;token_enc:string;token_iv:string}
type VersionRow = {id:string;number:number;snapshot_json:string;english_json:string|null;status:DailyReportVersion['status'];error:string|null;created_at:string}
type RevisionRow = {version:number;work:string;blockers:string;next_steps:string;created_at:string;is_day_off:number}
const groupView = (r:GroupRow):DailyGroup => ({id:r.id,companyId:r.company_id,name:r.name,title:r.title,enabled:!!r.enabled,modelId:r.model_id,members:JSON.parse(r.members_json),startDate:r.start_date,version:r.version})
const roundView = (r:RoundRow):DailyRound => ({id:r.id,groupId:r.group_id,date:r.date,opensAt:r.opens_at,deadline:r.deadline,closesAt:r.closes_at,members:JSON.parse(r.members_json),sealedAt:r.sealed_at})
export class DailyReportsRepo {
 constructor(private db:Database,private secrets:SecretBox) {}
 private groupRow(id:string) { const r=this.db.get<GroupRow>('SELECT * FROM daily_report_groups WHERE id=?',[id]);if(!r)throw notFound('Không tìm thấy nhóm báo cáo');return r }
 private roundRow(id:string) { const r=this.db.get<RoundRow>('SELECT * FROM daily_report_rounds WHERE id=?',[id]);if(!r)throw notFound('Không tìm thấy đợt báo cáo');return r }
 group(id:string) {return groupView(this.groupRow(id))}
 list(companyId:string) {return this.db.all<GroupRow>('SELECT * FROM daily_report_groups WHERE company_id=? ORDER BY rowid DESC',[companyId]).map(groupView)}
 save(companyId:string,raw:DailyGroupInput,id?:string,version?:number,now=new Date()):DailyGroup {
  const input=dailyGroupSchema.parse(raw),old=id?this.groupRow(id):undefined
  if(old&&old.company_id!==companyId)throw notFound('Không tìm thấy nhóm')
  if(input.modelId){const model=this.db.get<{id:string}>(`SELECT m.id FROM llm_models m JOIN llm_providers p ON p.id=m.provider_id WHERE m.id=? AND p.company_id=? AND p.enabled=1 AND m.enabled=1`,[input.modelId,companyId]);if(!model)throw forbidden('Model không thuộc công ty hoặc đã tắt')}
  const previous:DailyGroup['members']=old?JSON.parse(old.members_json):[]
  const members=input.members.map(name=>({id:previous.find(m=>m.name===name)?.id??randomUUID(),name}))
  const gid=id??randomUUID()
  if(old){const result=this.db.run('UPDATE daily_report_groups SET name=?,title=?,enabled=?,model_id=?,members_json=?,version=version+1 WHERE id=? AND version=?',[input.name,input.title,+input.enabled,input.modelId,JSON.stringify(members),gid,version??0]);if(!result.changes)throw new AppError('conflict','Nhóm đã thay đổi, hãy tải lại')}
  else this.db.run('INSERT INTO daily_report_groups(id,company_id,name,title,enabled,model_id,members_json,start_date) VALUES(?,?,?,?,?,?,?,?)',[gid,companyId,input.name,input.title,+input.enabled,input.modelId,JSON.stringify(members),dailyVietnamDate(now)])
  return this.group(gid)
 }
 ensureRound(groupId:string,date:string):DailyRound {
  const existing=this.db.get<RoundRow>('SELECT * FROM daily_report_rounds WHERE group_id=? AND date=?',[groupId,date]);if(existing)return roundView(existing)
  const g=this.group(groupId),b=dailyBounds(date),key=token(),secret=this.secrets.encrypt(key),id=randomUUID()
  this.db.run('INSERT INTO daily_report_rounds(id,group_id,date,opens_at,deadline,closes_at,members_json,token_hash,token_enc,token_iv) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,groupId,date,b.opensAt,b.deadline,b.closesAt,JSON.stringify(g.members),hash(key),secret.enc,secret.iv])
  return roundView(this.roundRow(id))
 }
 rounds(groupId:string,date?:string) {
  this.groupRow(groupId)
  return (date === undefined
   ? this.db.all<RoundRow>('SELECT * FROM daily_report_rounds WHERE group_id=? ORDER BY date DESC LIMIT 120',[groupId])
   : this.db.all<RoundRow>('SELECT * FROM daily_report_rounds WHERE group_id=? AND date=?',[groupId,dailyReportDateSchema.parse(date)])).map(roundView)
 }
 /** Explicit creation can prepare future working days; existing rounds and rosters are immutable. */
 createRoundForDate(groupId:string,date:string,now=new Date()) {
  dailyReportDateSchema.parse(date)
  return this.db.tx(()=>{
   const g=this.group(groupId),existing=this.rounds(groupId,date)[0]
   if(!existing){
    if(!g.enabled)throw new AppError('validation','Nhóm đang tạm dừng. Bật nhóm trước khi tạo đợt mới.')
    if(date<dailyVietnamDate(now))throw new AppError('validation','Không thể tạo đợt mới cho ngày đã qua.')
    if(!dailyWorkingDay(date))throw new AppError('validation','Chủ nhật không nhận báo cáo. Chọn ngày từ thứ Hai đến thứ Bảy.')
   }
   const round=existing??this.ensureRound(groupId,date)
   if(!this.db.get('SELECT round_id FROM daily_report_view_links WHERE round_id=?',[round.id])){
    const key=token(),secret=this.secrets.encrypt(key)
    this.db.run('INSERT INTO daily_report_view_links(round_id,token_hash,token_enc,token_iv,created_at) VALUES(?,?,?,?,?)',[round.id,hash(key),secret.enc,secret.iv,now.toISOString()])
   }
   return {round,created:!existing}
  })
 }
 viewToken(roundId:string):string|null {
  this.roundRow(roundId)
  const row=this.db.get<{token_enc:string;token_iv:string}>('SELECT token_enc,token_iv FROM daily_report_view_links WHERE round_id=?',[roundId])
  return row?this.secrets.decrypt(row.token_enc,row.token_iv):null
 }
 publicReport(key:string):DailyPublicReport {
  if(!/^[A-Za-z0-9_-]{43}$/.test(key))throw notFound('Link không hợp lệ')
  const link=this.db.get<{round_id:string}>('SELECT round_id FROM daily_report_view_links WHERE token_hash=?',[hash(key)])
  if(!link)throw notFound('Link không hợp lệ')
  const round=this.round(link.round_id),group=this.group(round.groupId)
  const version=this.db.get<VersionRow>("SELECT * FROM daily_report_versions WHERE round_id=? AND status='ready' AND english_json IS NOT NULL ORDER BY number DESC LIMIT 1",[round.id])
  if(!version)return {groupName:group.name,title:group.title,date:round.date,status:'pending',number:null,publishedAt:null,executiveSummary:null,members:[]}
  const snapshot=JSON.parse(version.snapshot_json) as DailySnapshot,english=JSON.parse(version.english_json!) as DailyEnglish
  return {groupName:snapshot.groupName,title:snapshot.title,date:snapshot.date,status:'ready',number:version.number,publishedAt:version.created_at,executiveSummary:english.executiveSummary,
   members:snapshot.members.map(member=>{const translated=english.individuals.find(item=>item.memberId===member.memberId);return {name:member.name,status:member.status,isDayOff:!!member.isDayOff,work:member.isDayOff?'Day off':translated?.work??'',blockers:member.isDayOff?'':translated?.blockers??'',nextSteps:member.isDayOff?'':translated?.nextSteps??''}})}
 }
 round(id:string,withToken=false) {const r=this.roundRow(id);return {...roundView(r),...(withToken?{token:this.secrets.decrypt(r.token_enc,r.token_iv)}:{})}}
 byToken(key:string) {if(!/^[A-Za-z0-9_-]{43}$/.test(key))throw notFound('Link không hợp lệ');const r=this.db.get<RoundRow>('SELECT * FROM daily_report_rounds WHERE token_hash=?',[hash(key)]);if(!r)throw notFound('Link không hợp lệ');return roundView(r)}
 memberSubmission(roundId:string,memberId:string):DailyPublicSubmission|null {
  const r=this.round(roundId)
  if(!r.members.some(member=>member.id===memberId))throw notFound('Thành viên không hợp lệ')
  const latest=this.db.get<RevisionRow>(`SELECT v.* FROM daily_report_revisions v JOIN daily_report_submissions s ON s.id=v.submission_id WHERE s.round_id=? AND s.member_id=? ORDER BY v.version DESC LIMIT 1`,[roundId,memberId])
  return latest?{memberId,work:latest.work,blockers:latest.blockers,nextSteps:latest.next_steps,isDayOff:!!latest.is_day_off,version:latest.version,submittedAt:latest.created_at}:null
 }
 snapshot(roundId:string,now=new Date(),cutoff=false):DailySnapshot {
  const r=this.round(roundId),g=this.group(r.groupId),at=now.toISOString()
  const company=this.db.get<{name:string}>('SELECT name FROM companies WHERE id=?',[g.companyId])!
  const members=r.members.map(m=>{
   const rows=this.db.all<RevisionRow>(`SELECT v.* FROM daily_report_revisions v JOIN daily_report_submissions s ON s.id=v.submission_id WHERE s.round_id=? AND s.member_id=? ORDER BY v.version DESC`,[roundId,m.id])
   const eligible=rows.filter(v=>cutoff?v.created_at<r.deadline:v.created_at<=at),latest=eligible[0],onTime=rows.some(v=>v.created_at<r.deadline)
   const status=!latest?'overdue':latest.created_at<r.deadline?'on_time':onTime?'updated_after_deadline':'late_submission'
   return {memberId:m.id,name:m.name,status,work:latest?.work??'',blockers:latest?.blockers??'',nextSteps:latest?.next_steps??'',isDayOff:!!latest?.is_day_off,submittedAt:latest?.created_at??null,revision:latest?.version??null} as DailySnapshot['members'][number]
  })
  return {title:g.title,groupName:g.name,companyName:company.name,date:r.date,deadline:r.deadline,capturedAt:at,members}
 }
 submit(roundId:string,raw:DailySubmissionInput,now=new Date()):DailySubmissionReceipt {
  const input=dailySubmissionSchema.parse(raw)
  return this.db.tx(()=>{
   const r=this.round(roundId),at=now.toISOString()
   if(!r.members.some(m=>m.id===input.memberId))throw notFound('Thành viên không hợp lệ')
   if(at>=r.deadline)this.seal(roundId,now)
   let s=this.db.get<{id:string}>('SELECT id FROM daily_report_submissions WHERE round_id=? AND member_id=?',[roundId,input.memberId])
   // Keep the legacy receipt column populated; revisions now use the selected name and version.
   if(!s){s={id:randomUUID()};this.db.run('INSERT INTO daily_report_submissions VALUES(?,?,?,?)',[s.id,roundId,input.memberId,hash(token())])}
   const version=this.db.get<{n:number}>('SELECT COALESCE(MAX(version),0) AS n FROM daily_report_revisions WHERE submission_id=?',[s.id])!.n
   if(version&&input.version!==version)throw new AppError('conflict','Bài đã thay đổi, hãy tải lại phiên bản mới nhất')
   this.db.run('INSERT INTO daily_report_revisions(submission_id,version,work,blockers,next_steps,created_at,is_day_off) VALUES(?,?,?,?,?,?,?)',[s.id,version+1,input.isDayOff?'':input.work,input.isDayOff?'':input.blockers,input.isDayOff?'':input.nextSteps,at,+input.isDayOff])
   return {version:version+1,submittedAt:at,late:at>=r.deadline}
  })
 }
 private createVersion(roundId:string,snapshot:DailySnapshot) {
  const number=this.db.get<{n:number}>('SELECT COALESCE(MAX(number),0)+1 AS n FROM daily_report_versions WHERE round_id=?',[roundId])!.n
  const id=randomUUID();this.db.run(`INSERT INTO daily_report_versions(id,round_id,number,snapshot_json,status,created_at) VALUES(?,?,?,?,'pending',?)`,[id,roundId,number,JSON.stringify(snapshot),snapshot.capturedAt]);return id
 }
 seal(roundId:string,now=new Date()) {
  return this.db.tx(()=>{const r=this.round(roundId);if(r.sealedAt||now.toISOString()<r.deadline)return
   this.createVersion(roundId,this.snapshot(roundId,now,true));this.db.run('UPDATE daily_report_rounds SET sealed_at=? WHERE id=?',[now.toISOString(),roundId])})
 }
 updateReport(roundId:string,now=new Date()) {return this.db.tx(()=>{const r=this.round(roundId);if(now.toISOString()<r.deadline)throw new AppError('validation','Chưa tới hạn chốt');this.seal(roundId,now);return this.createVersion(roundId,this.snapshot(roundId,now))})}
 versions(roundId:string):DailyReportVersion[] {return this.db.all<VersionRow>('SELECT * FROM daily_report_versions WHERE round_id=? ORDER BY number DESC',[roundId]).map(r=>({id:r.id,number:r.number,snapshot:JSON.parse(r.snapshot_json),english:r.english_json?JSON.parse(r.english_json):null,status:r.status,error:r.error,createdAt:r.created_at}))}
 detail(roundId:string,now=new Date()) {this.seal(roundId,now);return {round:this.round(roundId,true),current:this.snapshot(roundId,now),versions:this.versions(roundId)}}
 tick(now=new Date()) {
  const today=dailyVietnamDate(now)
  this.db.tx(()=>{for(const row of this.db.all<GroupRow>('SELECT * FROM daily_report_groups WHERE enabled=1')){
   for(let date=row.start_date;date<=today;date=dailyNextDate(date))if(dailyWorkingDay(date))this.ensureRound(row.id,date)
  }
  for(const r of this.db.all<{id:string}>('SELECT id FROM daily_report_rounds WHERE sealed_at IS NULL AND deadline<=?',[now.toISOString()]))this.seal(r.id,now)})
 }
 recoverJobs(){this.db.run(`UPDATE daily_report_versions SET status='pending',started_at=NULL WHERE status='running'`)}
 claimJob(now=new Date()) {
  return this.db.tx(()=>{const row=this.db.get<{id:string;round_id:string;snapshot_json:string}>(`SELECT id,round_id,snapshot_json FROM daily_report_versions WHERE status='pending' ORDER BY created_at LIMIT 1`);if(!row)return undefined
   this.db.run(`UPDATE daily_report_versions SET status='running',started_at=? WHERE id=? AND status='pending'`,[now.toISOString(),row.id]);const round=this.round(row.round_id);return {id:row.id,group:this.group(round.groupId),snapshot:JSON.parse(row.snapshot_json) as DailySnapshot}})
 }
 completeJob(id:string,english:unknown) {this.db.run(`UPDATE daily_report_versions SET status='ready',english_json=?,error=NULL WHERE id=? AND status='running'`,[JSON.stringify(english),id])}
 failJob(id:string,message:string) {this.db.run(`UPDATE daily_report_versions SET status='failed',error=? WHERE id=? AND status='running'`,[message.slice(0,500),id])}
 retry(roundId:string,versionId:string) {const r=this.db.run(`UPDATE daily_report_versions SET status='pending',error=NULL WHERE id=? AND round_id=? AND status='failed'`,[versionId,roundId]);if(!r.changes)throw new AppError('conflict','Chỉ có thể thử lại bản bị lỗi')}
}
