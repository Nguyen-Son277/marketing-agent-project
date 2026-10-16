import { createHash } from 'node:crypto'
import { newId, nowIso, notFound, validation, type NotificationItem, type NotificationPreferences, type NotificationType, type NotificationsResponse, type RunRecord, type SettingsNotificationRequest } from '@marketing-agent/shared'
import type { Database } from '../database.ts'

type Category = keyof NotificationPreferences
interface Row { id:string; type:NotificationType; severity:NotificationItem['severity']; created_at:string; read_at:string|null; title:string; body:string; link:string|null }
const item = (r:Row):NotificationItem => ({id:r.id,type:r.type,severity:r.severity,createdAt:r.created_at,readAt:r.read_at,title:r.title,body:r.body,...(r.link ? {link:r.link} : {})})

export class NotificationsRepo {
  constructor(private readonly db:Database) {}

  preferences(companyId:string,userId:string):NotificationPreferences {
    const r=this.db.get<{agent:number;action_required:number;budget:number}>('SELECT * FROM notification_preferences WHERE company_id=? AND user_id=?',[companyId,userId])
    return r ? {agent:!!r.agent,actionRequired:!!r.action_required,budget:!!r.budget} : {agent:true,actionRequired:true,budget:true}
  }
  savePreferences(companyId:string,userId:string,patch:Partial<NotificationPreferences>):NotificationPreferences {
    return this.db.tx(()=>{
      const p={...this.preferences(companyId,userId),...patch}
      this.db.run(`INSERT INTO notification_preferences(company_id,user_id,agent,action_required,budget) VALUES(?,?,?,?,?) ON CONFLICT(company_id,user_id) DO UPDATE SET agent=excluded.agent,action_required=excluded.action_required,budget=excluded.budget`,[companyId,userId,+p.agent,+p.actionRequired,+p.budget])
      return p
    })
  }
  list(companyId:string,userId:string,options:{limit?:number;cursor?:string}={}):NotificationsResponse {
    const limit=options.limit ?? 20
    if(!Number.isInteger(limit)||limit<1||limit>100) throw validation('limit must be an integer from 1 to 100')
    const params:unknown[]=[companyId,userId]
    let condition=''
    if(options.cursor){
      let cursor:unknown
      try { cursor=JSON.parse(Buffer.from(options.cursor,'base64url').toString()) } catch { throw validation('Invalid notification cursor') }
      if(!Array.isArray(cursor)||cursor.length!==2||typeof cursor[0]!=='string'||typeof cursor[1]!=='string'||!Number.isFinite(Date.parse(cursor[0]))) throw validation('Invalid notification cursor')
      condition=' AND (created_at < ? OR (created_at = ? AND id < ?))';params.push(cursor[0],cursor[0],cursor[1])
    }
    params.push(limit+1)
    const rows=this.db.all<Row>(`SELECT * FROM notifications WHERE company_id=? AND user_id=?${condition} ORDER BY created_at DESC,id DESC LIMIT ?`,params)
    const more=rows.length>limit;const items=rows.slice(0,limit).map(item);const last=items.at(-1)
    return {items,nextCursor:more&&last ? Buffer.from(JSON.stringify([last.createdAt,last.id])).toString('base64url') : null}
  }
  unreadCount(companyId:string,userId:string):number { return this.db.get<{n:number}>('SELECT count(*) AS n FROM notifications WHERE company_id=? AND user_id=? AND read_at IS NULL',[companyId,userId])!.n }
  read(companyId:string,userId:string,id:string):void {
    const result=this.db.run('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE company_id=? AND user_id=? AND id=?',[nowIso(),companyId,userId,id])
    if(!result.changes) throw notFound('Notification not found')
  }
  readAll(companyId:string,userId:string,through:string,throughIds?:string[]):void {
    const boundary=throughIds===undefined ? 'created_at<=?' : `(created_at<? OR (created_at=? AND id IN (${throughIds.map(()=>'?').join(',')||'NULL'})))`
    const params=throughIds===undefined ? [through] : [through,through,...throughIds]
    this.db.run(`UPDATE notifications SET read_at=? WHERE company_id=? AND user_id=? AND read_at IS NULL AND ${boundary}`,[nowIso(),companyId,userId,...params])
  }

  /** Self-only settings feedback; independent of agent/budget preferences and fanout. */
  settingsResult(companyId:string,userId:string,result:SettingsNotificationRequest):NotificationItem {
    // Deterministic scoped ID makes retries atomic without a schema change or storing client text.
    const id=`settings_${createHash('sha256').update(JSON.stringify([companyId,userId,result.operationId])).digest('hex')}`
    return this.db.tx(()=>{
      const existing=this.db.get<Row>('SELECT * FROM notifications WHERE id=? AND company_id=? AND user_id=?',[id,companyId,userId])
      if(existing) return item(existing)
      const messages={
        success:{severity:'info',title:'Settings updated / Đã cập nhật cài đặt',body:'Settings operation completed successfully. / Thao tác cài đặt đã hoàn tất.'},
        warning:{severity:'warning',title:'Settings need attention / Cần kiểm tra cài đặt',body:'Settings operation completed with a warning. Check settings. / Thao tác cài đặt có cảnh báo. Hãy kiểm tra cài đặt.'},
        error:{severity:'error',title:'Settings operation failed / Thao tác cài đặt thất bại',body:'Settings operation did not complete successfully. Check settings. / Thao tác cài đặt chưa hoàn tất thành công. Hãy kiểm tra cài đặt.'},
      } as const
      const message=messages[result.status]
      const value:NotificationItem={id,type:`settings_${result.status}`,severity:message.severity,createdAt:nowIso(),readAt:null,title:message.title,body:`${result.operation}: ${message.body}`,link:'#/cai-dat'}
      this.db.run('INSERT INTO notifications(id,company_id,user_id,type,severity,created_at,title,body,link) VALUES(?,?,?,?,?,?,?,?,?)',[id,companyId,userId,value.type,value.severity,value.createdAt,value.title,value.body,value.link!])
      return value
    })
  }

  /** Event tombstones precede fanout: disabled preferences/new members never replay old events. */
  emit(companyId:string,dedupeKey:string,category:Category,value:Omit<NotificationItem,'id'|'createdAt'|'readAt'>):void {
    this.db.tx(()=>{
      const at=nowIso()
      if(!this.db.run('INSERT OR IGNORE INTO notification_events(company_id,dedupe_key,created_at) VALUES(?,?,?)',[companyId,dedupeKey,at]).changes) return
      const recipients=this.db.all<{user_id:string}>(`SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=? AND u.approval_status='approved' AND u.is_admin=0 AND u.account_type='user' AND u.must_change_password=0`,[companyId])
      for(const {user_id} of recipients){
        if(!this.preferences(companyId,user_id)[category]) continue
        this.db.run('INSERT INTO notifications(id,company_id,user_id,type,severity,created_at,title,body,link) VALUES(?,?,?,?,?,?,?,?,?)',[newId(),companyId,user_id,value.type,value.severity,at,value.title,value.body,value.link??null])
      }
    })
  }
  /** Persisted run terminal state, never raw provider errors or generated content. */
  runFinished(run:RunRecord):void {
    const label=this.db.get<{name:string}>('SELECT name FROM agent_defs WHERE id=?',[run.agentDefId])?.name ?? run.agentDefId
    if(run.status==='succeeded') this.emit(run.companyId,`run:${run.id}:terminal`,'agent',{type:'agent_success',severity:'info',title:'Agent completed / Agent hoàn tất',body:`${label}: An agent run completed successfully. / Một lượt chạy agent đã hoàn tất.`,link:'#/chi-phi'})
    else if(run.status==='budget_exceeded') this.emit(run.companyId,`run:${run.id}:terminal`,'budget',{type:'budget_exceeded',severity:'error',title:'Budget stopped run / Dừng do ngân sách',body:`${label}: This run stopped at an operating cost limit. / Lượt chạy đã dừng do giới hạn chi phí.`,link:'#/chi-phi'})
    else if(run.status==='failed') this.emit(run.companyId,`run:${run.id}:terminal`,'actionRequired',{type:'agent_failure',severity:'error',title:'Agent needs attention / Agent cần kiểm tra',body:`${label}: An agent run did not complete successfully. Check the run history. / Lượt chạy chưa hoàn tất thành công. Hãy kiểm tra lịch sử.`,link:'#/chi-phi'})
  }
  /** Matches CostMeter UTC-day and per-run cost limits, not rolling-24h UI/preflight. */
  budget(companyId:string,runId:string,runCost:number,limits:{dailyCostUsd?:number;taskCostUsd?:number},at=new Date()):void {
    const day=at.toISOString().slice(0,10)
    const spent=this.db.get<{n:number}>('SELECT COALESCE(SUM(cost_usd),0) AS n FROM runs WHERE company_id=? AND created_at>=? AND id<>?',[companyId,`${day}T00:00:00.000Z`,runId])!.n+runCost
    for(const [kind,used,limit,scope] of [['daily',spent,limits.dailyCostUsd,day],['task',runCost,limits.taskCostUsd,runId]] as const){
      if(limit===undefined||!Number.isFinite(limit)||limit<0) continue
      // A jump straight to 100% gets one alert, while consuming the 80% key.
      if(used>=limit && used>0) this.db.run('INSERT OR IGNORE INTO notification_events(company_id,dedupe_key,created_at) VALUES(?,?,?)',[companyId,`budget:${kind}:${scope}:${limit}:80`,nowIso()])
      for(const threshold of [80,100]){
        if(used<limit*threshold/100 || (limit===0 && used<=0)) continue
        this.emit(companyId,`budget:${kind}:${scope}:${limit}:${threshold}`,'budget',{type:threshold===100?'budget_exceeded':'budget_warning',severity:threshold===100?'error':'warning',title:`Budget ${threshold}% / Ngân sách ${threshold}%`,body:`${kind==='daily'?'Daily / Trong ngày':'Per-run / Mỗi lượt chạy'}: ${used.toFixed(4)} / ${limit} USD (${threshold}%).`,link:'#/chi-phi'})
      }
    }
  }
}
