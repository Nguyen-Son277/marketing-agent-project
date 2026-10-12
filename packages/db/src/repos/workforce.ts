/** Quyền việc nhân viên và workflow cùng một nơi cho HTTP và tool agent dùng. */
import { conflict, forbidden, newId, notFound, nowIso, workforceTaskSchema, workforceReportSchema, type PublicUser, type WorkforceTaskInput, type WorkforceTask, type WorkforceList, type WorkforceDetail, type EmployeeView, type WorkforceStatus, workforceWeek, vietnamDate } from '@marketing-agent/shared'
import type { Database } from '../database.ts'
import type { AuthRepo } from './auth.ts'

const taskSelect = `SELECT t.id,t.company_id AS companyId,c.name AS companyName,t.manager_id AS managerId,
 t.assignee_user_id AS assigneeUserId,u.name AS assigneeName,t.title,t.brief,t.kind,t.priority,
 t.planned_week AS plannedWeek,t.planned_date AS plannedDate,t.deadline,t.status,t.source,
 t.source_conversation_id AS sourceConversationId,t.version,t.created_at AS createdAt,t.updated_at AS updatedAt,t.completed_at AS completedAt
 FROM employee_tasks t JOIN companies c ON c.id=t.company_id JOIN users u ON u.id=t.assignee_user_id`

export class WorkforceRepo {
  constructor(private readonly db: Database, private readonly auth: AuthRepo) {}
  actor(id: string): PublicUser {
    const u = this.auth.findUserById(id)
    if (!u || u.approvalStatus !== 'approved' || u.mustChangePassword || u.isAdmin) throw forbidden('Không có quyền sử dụng phân hệ giao việc')
    return u
  }
  manager(id: string): PublicUser {
    const u=this.actor(id)
    if(u.accountType!=='user') throw forbidden('Chỉ quản lý được giao việc')
    return u
  }
  manageCompany(actorId: string, companyId: string): void {
    this.manager(actorId)
    const m=this.auth.membership(companyId,actorId)
    if(!m || !['owner','admin'].includes(m.role)) throw notFound('Không tìm thấy công ty trong phạm vi quản lý')
  }
  companies(actorId: string) {
    const u=this.actor(actorId)
    if(u.accountType==='user') return this.auth.listCompaniesForUser(actorId).filter(c=>['owner','admin'].includes(c.role)).map(c=>({id:c.id,name:c.name}))
    return this.db.all<{id:string;name:string}>(`SELECT c.id,c.name FROM employee_company_access a JOIN companies c ON c.id=a.company_id
      JOIN employee_profiles p ON p.user_id=a.user_id WHERE a.user_id=? AND p.active=1 AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=p.manager_id AND m.company_id=c.id AND m.role IN ('owner','admin')) ORDER BY c.name`,[actorId])
  }
  employees(actorId: string): EmployeeView[] {
    this.manager(actorId)
    return this.db.all<{id:string;name:string;email:string;active:number;approvalStatus:'pending'|'approved';mustChangePassword:number}>(`SELECT u.id,u.name,u.email,p.active,u.approval_status AS approvalStatus,u.must_change_password AS mustChangePassword
      FROM employee_profiles p JOIN users u ON u.id=p.user_id WHERE p.manager_id=? ORDER BY u.name`,[actorId]).map(u=>({...u,active:u.active===1,mustChangePassword:u.mustChangePassword===1,companyIds:this.db.all<{id:string}>('SELECT company_id AS id FROM employee_company_access WHERE user_id=?',[u.id]).map(c=>c.id)}))
  }
  createEmployee(actorId: string, input: {name:string;email:string;password:string;companyIds:string[]}): EmployeeView {
    this.manager(actorId)
    for(const id of input.companyIds) this.manageCompany(actorId,id)
    return this.db.tx(()=>{
      const u=this.auth.createUser({...input,accountType:'employee',mustChangePassword:true})
      this.db.run('INSERT INTO employee_profiles(user_id,manager_id,created_at) VALUES(?,?,?)',[u.id,actorId,nowIso()])
      for(const id of new Set(input.companyIds)) this.db.run('INSERT INTO employee_company_access VALUES(?,?)',[u.id,id])
      return this.employees(actorId).find(e=>e.id===u.id)!
    })
  }
  updateEmployee(actorId:string,id:string,input:{companyIds:string[];active:boolean;confirmRemoval:boolean}) {
    if(!this.employees(actorId).some(e=>e.id===id)) throw notFound('Không tìm thấy nhân viên')
    for(const company of input.companyIds) this.manageCompany(actorId,company)
    const pending=this.db.all<{companyId:string}>("SELECT company_id AS companyId FROM employee_tasks WHERE assignee_user_id=? AND status IN ('assigned','in_progress','review')",[id])
    if(!input.confirmRemoval && pending.some(t=>!input.active || !input.companyIds.includes(t.companyId))) throw conflict('Có việc chưa hoàn tất ở phạm vi bị thu hồi. Cần xác nhận thu hồi quyền.')
    this.db.tx(()=>{
      this.db.run('UPDATE employee_profiles SET active=? WHERE user_id=?',[input.active?1:0,id])
      this.db.run('DELETE FROM employee_company_access WHERE user_id=?',[id])
      for(const company of new Set(input.companyIds)) this.db.run('INSERT INTO employee_company_access VALUES(?,?)',[id,company])
      this.auth.deleteSessionsForUser(id)
    })
    return this.employees(actorId).find(e=>e.id===id)!
  }
  private scope(actorId:string): {sql:string;params:Record<string,unknown>} {
    const u=this.actor(actorId)
    const sql=u.accountType==='employee'
      ? `t.assignee_user_id=@actor AND t.status<>'draft' AND EXISTS(SELECT 1 FROM employee_profiles ep JOIN employee_company_access ea ON ea.user_id=ep.user_id WHERE ep.user_id=@actor AND ep.active=1 AND ea.company_id=t.company_id AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=ep.manager_id AND m.company_id=t.company_id AND m.role IN ('owner','admin')))`
      : `t.manager_id=@actor AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=@actor AND m.company_id=t.company_id AND m.role IN ('owner','admin'))`
    return {sql,params:{actor:actorId}}
  }
  task(actorId:string,id:string): WorkforceTask {
    const scope=this.scope(actorId)
    const t=this.db.get<WorkforceTask>(`${taskSelect} WHERE t.id=@id AND (${scope.sql})`,{...scope.params,id})
    if(!t) throw notFound('Không tìm thấy công việc')
    return t
  }
  list(actorId:string, filter:{companyId?:string;assigneeUserId?:string;week?:string;day?:string;status?:WorkforceStatus;overdue?:boolean;page:number;pageSize:number}): WorkforceList {
    const scope=this.scope(actorId), parts=[scope.sql], params:Record<string,unknown>={...scope.params,now:nowIso()}
    if(filter.companyId){parts.push('t.company_id=@company');params.company=filter.companyId}
    if(filter.assigneeUserId){parts.push('t.assignee_user_id=@assignee');params.assignee=filter.assigneeUserId}
    if(filter.overdue){parts.push("(t.deadline<@now OR t.planned_week<@currentWeek) AND t.status IN ('assigned','in_progress','review')");params.currentWeek=workforceWeek(vietnamDate())}
    else if(filter.week){parts.push('t.planned_week=@week');params.week=filter.week}
    if(filter.day){parts.push('t.planned_date=@day');params.day=filter.day}
    const where=parts.map(s=>`(${s})`).join(' AND ')
    const groups=this.db.all<{status:WorkforceStatus;n:number}>(`SELECT t.status,COUNT(*) AS n FROM employee_tasks t WHERE ${where} GROUP BY t.status`,params)
    const counts={draft:0,assigned:0,in_progress:0,review:0,done:0,cancelled:0}
    for(const g of groups)counts[g.status]=g.n
    const overdue=this.db.get<{n:number}>(`SELECT COUNT(*) AS n FROM employee_tasks t WHERE ${where} AND t.deadline<@now AND t.status IN ('assigned','in_progress','review')`,params)?.n??0
    if(filter.status){parts.push('t.status=@status');params.status=filter.status}
    const finalWhere=parts.map(s=>`(${s})`).join(' AND ')
    const total=this.db.get<{n:number}>(`SELECT COUNT(*) AS n FROM employee_tasks t WHERE ${finalWhere}`,params)?.n??0
    const tasks=this.db.all<WorkforceTask>(`${taskSelect} WHERE ${finalWhere} ORDER BY t.deadline,t.id LIMIT @limit OFFSET @offset`,{...params,limit:filter.pageSize,offset:(filter.page-1)*filter.pageSize})
    return {tasks,total,page:filter.page,pageSize:filter.pageSize,counts,overdue}
  }
  private validateAssignee(actorId:string,input:WorkforceTaskInput) {
    this.manageCompany(actorId,input.companyId)
    const e=this.employees(actorId).find(e=>e.id===input.assigneeUserId)
    if(!e || !e.active || !e.companyIds.includes(input.companyId))throw forbidden('Nhân viên chưa được cấp công ty này hoặc đã ngừng hoạt động')
  }
  createTask(actorId:string,raw:WorkforceTaskInput,options:{draft:boolean;source?:'manager'|'agent';conversationId?:string;idempotencyKey?:string}) {
    const input=workforceTaskSchema.parse(raw)
    this.validateAssignee(actorId,input)
    if(options.conversationId && !this.db.get('SELECT id FROM conversations WHERE id=? AND company_id=?',[options.conversationId,input.companyId]))throw notFound('Không tìm thấy cuộc trao đổi')
    if(options.idempotencyKey){const old=this.db.get<{id:string}>('SELECT id FROM employee_tasks WHERE idempotency_key=?',[options.idempotencyKey]);if(old)return this.task(actorId,old.id)}
    return this.db.tx(()=>{
      const id=newId(),at=nowIso()
      this.db.run(`INSERT INTO employee_tasks(id,company_id,manager_id,assignee_user_id,title,brief,kind,priority,planned_week,planned_date,deadline,status,source,source_conversation_id,idempotency_key,created_at,updated_at)
        VALUES(@id,@companyId,@actor,@assigneeUserId,@title,@brief,@kind,@priority,@plannedWeek,@plannedDate,@deadline,@status,@source,@conv,@key,@at,@at)`,{...input,id,actor:actorId,deadline:new Date(input.deadline).toISOString(),status:options.draft?'draft':'assigned',source:options.source??'manager',conv:options.conversationId??null,key:options.idempotencyKey??null,at})
      this.event(id,actorId,options.draft?'draft':'assign','')
      return this.task(actorId,id)
    })
  }
  detail(actorId:string,id:string):WorkforceDetail {
    const task=this.task(actorId,id)
    const reports=this.db.all<WorkforceDetail['reports'][number]>(`SELECT r.id,r.author_id AS authorId,u.name AS authorName,r.kind,r.content,r.links_json AS links,r.created_at AS createdAt FROM employee_task_reports r JOIN users u ON u.id=r.author_id WHERE r.task_id=? ORDER BY r.created_at,r.id`,[id]).map(r=>({...r,links:JSON.parse(r.links as unknown as string) as string[]}))
    const events=this.db.all<WorkforceDetail['events'][number]>(`SELECT e.id,u.name AS actorName,e.kind,e.note,e.created_at AS createdAt FROM employee_task_events e JOIN users u ON u.id=e.actor_id WHERE e.task_id=? ORDER BY e.created_at,e.id`,[id])
    return {task,reports,events}
  }
  private event(id:string,actorId:string,kind:string,note:string) {
    this.db.run('INSERT INTO employee_task_events VALUES(?,?,?,?,?,?)',[newId(),id,actorId,kind,note,nowIso()])
  }
  private bump(id:string,version:number,sql:string,params:Record<string,unknown>) {
    const r=this.db.run(`UPDATE employee_tasks SET ${sql},version=version+1,updated_at=@at WHERE id=@id AND version=@version`,{...params,id,version,at:nowIso()})
    if(r.changes!==1)throw conflict('Công việc đã thay đổi. Hãy tải lại trước khi thao tác.')
  }
  updateTask(actorId:string,id:string,version:number,raw:WorkforceTaskInput) {
    this.manager(actorId)
    const old=this.task(actorId,id),input=workforceTaskSchema.parse(raw)
    if(input.companyId!==old.companyId)throw conflict('Không chuyển công ty của việc đã tạo')
    if(['done','cancelled','review'].includes(old.status))throw conflict('Cần mở lại/yêu cầu sửa trước khi chỉnh việc')
    this.validateAssignee(actorId,input)
    return this.db.tx(()=>{
      this.bump(id,version,`assignee_user_id=@assigneeUserId,title=@title,brief=@brief,kind=@kind,priority=@priority,planned_week=@plannedWeek,planned_date=@plannedDate,deadline=@deadline,status=@status`,{...input,deadline:new Date(input.deadline).toISOString(),status:input.assigneeUserId!==old.assigneeUserId&&old.status!=='draft'?'assigned':old.status})
      this.event(id,actorId,'edit','')
      return this.task(actorId,id)
    })
  }
  action(actorId:string,id:string,version:number,action:'assign'|'start'|'approve'|'request_changes'|'reopen'|'cancel',note:string) {
    const u=this.actor(actorId),t=this.task(actorId,id)
    const employee=action==='start'
    if(employee ? u.accountType!=='employee' : u.accountType!=='user')throw forbidden('Không có quyền thực hiện thao tác')
    let status:WorkforceStatus
    if(action==='assign'){if(t.status!=='draft')throw conflict('Chỉ giao nháp');this.validateAssignee(actorId,t);status='assigned'}
    else if(action==='start'){if(t.status!=='assigned')throw conflict('Việc không ở trạng thái được giao');status='in_progress'}
    else if(action==='approve'){if(t.status!=='review')throw conflict('Chỉ duyệt việc chờ duyệt');status='done'}
    else if(action==='request_changes'){if(t.status!=='review'||!note.trim())throw conflict('Yêu cầu sửa cần lý do và việc đang chờ duyệt');status='in_progress'}
    else if(action==='reopen'){if(t.status!=='done'||!note.trim())throw conflict('Mở lại việc hoàn thành cần lý do');status='in_progress'}
    else {if(t.status==='cancelled')throw conflict('Việc đã huỷ');status='cancelled'}
    return this.db.tx(()=>{this.bump(id,version,'status=@status,completed_at=@completed',{status,completed:status==='done'?nowIso():null});this.event(id,actorId,action,note);return this.task(actorId,id)})
  }
  report(actorId:string,id:string,raw:unknown) {
    const u=this.actor(actorId),input=workforceReportSchema.parse(raw),t=this.task(actorId,id)
    if(u.accountType!=='employee')throw forbidden('Chỉ nhân viên nộp báo cáo')
    if(!['assigned','in_progress'].includes(t.status))throw conflict('Việc phải đang được giao/đang làm để báo cáo')
    return this.db.tx(()=>{
      this.bump(id,input.version,'status=@status',{status:input.kind==='submit'?'review':'in_progress'})
      this.db.run('INSERT INTO employee_task_reports VALUES(?,?,?,?,?,?,?)',[newId(),id,actorId,input.kind,input.content,JSON.stringify(input.links),nowIso()])
      this.event(id,actorId,input.kind,'')
      return this.detail(actorId,id)
    })
  }
}
