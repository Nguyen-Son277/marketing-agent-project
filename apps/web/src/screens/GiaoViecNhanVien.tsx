/** Bảng chung nhiều công ty, không phụ thuộc company đang chọn của Shell. */
import { useEffect, useState } from 'react'
import { EMPLOYEE_TASK_STATUSES, workforceWeek, vietnamDate, addWorkDays, workforceTaskSchema, type WorkforceTaskInput, type WorkforceList, type WorkforceDetail, type WorkforceCompany, type EmployeeView, type WorkforceTask } from '@marketing-agent/shared'
import { ApiError } from '../lib/api.ts'
import { workforceApi as api } from '../lib/workforce-api.ts'
import { useI18n } from '../lib/i18n.tsx'
import { useSession } from '../lib/session.tsx'
import { LocaleSwitcher } from '../components/LocaleSwitcher.tsx'
import { ThemeSwitcher } from '../components/ThemeSwitcher.tsx'
import { HopThoai, HopThoaiXacNhan } from '../components/HopThoai.tsx'
import { Markdown } from '../components/Markdown.tsx'
import { Card, Nut, ONhap, OChon, OVanBan, Truong, ThongBao, DangTai, Trang } from '../components/ui.tsx'
const initialTask=():WorkforceTaskInput=>({companyId:'',assigneeUserId:'',title:'',brief:'',kind:'image',priority:2,plannedWeek:workforceWeek(vietnamDate()),plannedDate:null,deadline:''})
const localDeadline=(iso:string)=>iso&&Number.isFinite(new Date(iso).getTime())?new Date(new Date(iso).getTime()+7*3600000).toISOString().slice(0,16):''
export function GiaoViecNhanVien({employee=false}:{employee?:boolean}) {
 const {t,translateError,formatNumber,locale}=useI18n(),{signOut}=useSession()
 const formatDateTime=(value:string)=>new Intl.DateTimeFormat(locale==='en'?'en-GB':'vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(new Date(value))
 const [tab,setTab]=useState<'tasks'|'employees'>('tasks'),[companies,setCompanies]=useState<WorkforceCompany[]>([]),[employees,setEmployees]=useState<EmployeeView[]>([])
 const [week,setWeek]=useState(workforceWeek(vietnamDate())),[day,setDay]=useState(vietnamDate()),[mode,setMode]=useState<'week'|'day'>('week'),[overdue,setOverdue]=useState(false)
 const [company,setCompany]=useState(''),[assignee,setAssignee]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0)
 const [data,setData]=useState<WorkforceList|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 const [detail,setDetail]=useState<WorkforceDetail|null>(null),[detailLoading,setDetailLoading]=useState(false),[selectedId,setSelectedId]=useState<string|null>(new URLSearchParams(window.location.hash.split('?')[1]??'').get('taskId'))
 const [taskForm,setTaskForm]=useState<WorkforceTaskInput|null>(null),[editId,setEditId]=useState<string|null>(null),[editVersion,setEditVersion]=useState(1),[draft,setDraft]=useState(false)
 const [employeeForm,setEmployeeForm]=useState<{name:string;email:string;password:string;companyIds:string[];active:boolean;id?:string}|null>(null)
 const [reportKind,setReportKind]=useState<'progress'|'blocker'|'submit'>('progress'),[content,setContent]=useState(''),[links,setLinks]=useState('')
 const [confirm,setConfirm]=useState<{action:string;decision?:string}|null>(null)
 const reload=()=>setRevision(r=>r+1)
 useEffect(()=>{let cancelled=false;void api.companies().then(r=>{if(!cancelled)setCompanies(r.companies)}).catch(e=>{if(!cancelled)setError(translateError(e))});if(!employee)void api.employees().then(r=>{if(!cancelled)setEmployees(r.employees)}).catch(e=>{if(!cancelled)setError(translateError(e))});return()=>{cancelled=true}},[employee,revision])
 useEffect(()=>{let cancelled=false;setLoading(true);setData(null);setError(null)
  const params:Record<string,string>={page:String(page)}
  if(company)params.companyId=company;if(assignee&&!employee)params.assigneeUserId=assignee;if(status)params.status=status
  if(overdue)params.overdue='true';else{params.week=week;if(mode==='day')params.day=day}
  void api.tasks(params).then(r=>{if(!cancelled)setData(r)}).catch(e=>{if(!cancelled)setError(translateError(e))}).finally(()=>{if(!cancelled)setLoading(false)})
  return()=>{cancelled=true}
 },[employee,company,assignee,status,page,week,day,mode,overdue,revision])
 useEffect(()=>{if(!selectedId){setDetail(null);return}let cancelled=false;setDetail(null);setDetailLoading(true);setContent('');setLinks('')
  void api.detail(selectedId).then(r=>{if(!cancelled)setDetail(r)}).catch(e=>{if(!cancelled)setError(translateError(e))}).finally(()=>{if(!cancelled)setDetailLoading(false)})
  return()=>{cancelled=true}
 },[selectedId,revision])
 useEffect(()=>{const listener=()=>{if(document.visibilityState==='visible')reload()};document.addEventListener('visibilitychange',listener);return()=>document.removeEventListener('visibilitychange',listener)},[])
 function chooseFilter(setter:(v:string)=>void,value:string){setter(value);setPage(1)}
 async function run(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);setError(null);setNotice('');try{await fn();setNotice(t('wf.saved'));reload()}catch(e){setError(translateError(e));if(e instanceof ApiError&&e.status===409&&selectedId){setConfirm(null);try{setDetail(await api.detail(selectedId))}catch{ /* Giữ lỗi gốc khi quyền đã bị thu hồi. */ }}}finally{setBusy(false)}}
 function editTask(task?:WorkforceTask){setEditId(task?.id??null);setEditVersion(task?.version??1);setDraft(task?.status==='draft');setError(null);setTaskForm(task?{...task}:initialTask())}
 async function saveTask(){if(!taskForm)return;const parsed=workforceTaskSchema.safeParse(taskForm);if(!parsed.success){setError(t('wf.invalid'));return}
  await run(async()=>{if(editId)await api.updateTask(editId,editVersion,parsed.data);else await api.createTask(parsed.data,draft);setTaskForm(null);setEditId(null)})}
 async function saveEmployee(confirmRemoval=false){if(!employeeForm)return;await run(async()=>{
  if(employeeForm.id)await api.updateEmployee(employeeForm.id,{companyIds:employeeForm.companyIds,active:employeeForm.active,confirmRemoval})
  else await api.createEmployee(employeeForm)
  setEmployeeForm(null)
 })}
 async function act(){if(!detail||!confirm)return;await run(async()=>{await api.action(detail.task.id,confirm.action,detail.task.version,content,confirm.decision);setConfirm(null);setContent('')})}
 async function report(){if(!detail)return;await run(async()=>{await api.report(detail.task.id,{version:detail.task.version,kind:reportKind,content,links:links.split('\n').map(l=>l.trim()).filter(Boolean)});setContent('');setLinks('')})}
 const availableEmployees=employees.filter(e=>e.active&&(!taskForm?.companyId||e.companyIds.includes(taskForm.companyId)))
 const statusLabel=(s:WorkforceTask['status'])=>t(`wf.status.${s}`)
 function taskCard(task:WorkforceTask){return <button key={task.id} className="wf__task" onClick={()=>{setError(null);setSelectedId(task.id)}}><span className="badge badge--mo">{task.companyName}</span><strong>{task.title}</strong><small>{task.assigneeName} · {t(`wf.${task.kind}`)}</small><span>{statusLabel(task.status)}</span><small>{t('wf.deadline')}: {formatDateTime(task.deadline)}</small>{!['done','cancelled','draft'].includes(task.status)&&new Date(task.deadline).getTime()<Date.now()?<span className="wf__late">{t('wf.overdue')}</span>:null}</button>}
 const days=Array.from({length:7},(_,i)=>addWorkDays(week,i))
 const dayLabel=(d:string)=>new Intl.DateTimeFormat(locale==='en'?'en-GB':'vi-VN',{timeZone:'Asia/Ho_Chi_Minh',weekday:'short',day:'2-digit',month:'2-digit'}).format(new Date(`${d}T12:00:00+07:00`))
 return <div className={employee?'wf-employee':''}>
  {employee?<header className="admin-app__header"><strong>{t('wf.mine')}</strong><LocaleSwitcher compact/><ThemeSwitcher compact/><Nut bien="phu" onClick={()=>void signOut()}>{t('nav.signOut')}</Nut></header>:null}
  <Trang rong><div className="wf"><header className="hang"><div style={{flex:1}}><h1 className="the__tieu-de">{t(employee?'wf.mine':'wf.title')}</h1><p>{t('wf.subtitle')}</p></div><Nut bien="phu" onClick={reload}>{t('common.refresh')}</Nut>{!employee?<Nut onClick={()=>{setError(null);editTask()}}>{t('wf.create')}</Nut>:null}</header>
   {!employee?<div className="hang"><Nut bien={tab==='tasks'?'chinh':'phu'} onClick={()=>setTab('tasks')}>{t('wf.tasks')}</Nut><Nut bien={tab==='employees'?'chinh':'phu'} onClick={()=>setTab('employees')}>{t('wf.employees')}</Nut></div>:null}
   {error&&!taskForm&&!employeeForm?<ThongBao loai="loi">{error}</ThongBao>:null}{notice?<ThongBao loai="thanh-cong">{notice}</ThongBao>:null}
   {tab==='employees'&&!employee?<Card hanhDong={<Nut onClick={()=>{setError(null);setEmployeeForm({name:'',email:'',password:'',companyIds:[],active:true})}}>{t('wf.addEmployee')}</Nut>} tieuDe={t('wf.employees')}><p>{t('wf.createNote')}</p><div className="wf__employee-list">{employees.map(e=><article className="wf__employee" key={e.id}><strong>{e.name}</strong><span>{e.email}</span><span>{e.approvalStatus==='pending'?t('wf.pending'):t(e.active?'wf.active':'wf.inactive')}</span><small>{e.companyIds.map(id=>companies.find(c=>c.id===id)?.name??id).join(' · ')}</small><Nut bien="phu" onClick={()=>setEmployeeForm({...e,password:''})}>{t('wf.editAccess')}</Nut></article>)}</div></Card>:<>
    <div className="wf__filters"><OChon value={company} onChange={v=>chooseFilter(setCompany,v)} options={[{value:'',label:t('wf.allCompanies')},...companies.map(c=>({value:c.id,label:c.name}))]}/>
     {!employee?<OChon value={assignee} onChange={v=>chooseFilter(setAssignee,v)} options={[{value:'',label:t('wf.allEmployees')},...employees.map(e=>({value:e.id,label:e.name}))]}/>:null}
     <OChon value={status} onChange={v=>chooseFilter(setStatus,v)} options={[{value:'',label:t('wf.allStatuses')},...EMPLOYEE_TASK_STATUSES.filter(s=>!employee||s!=='draft').map(s=>({value:s,label:statusLabel(s)}))]}/>
     <OChon value={mode} onChange={v=>{setMode(v as 'week'|'day');setPage(1)}} options={[{value:'week',label:t('wf.week')},{value:'day',label:t('wf.day')}]}/>
     <input type="date" className="o-nhap" aria-label={t(mode==='week'?'wf.week':'wf.day')} value={mode==='week'?week:day} onChange={e=>{if(e.target.value){setWeek(workforceWeek(e.target.value));setDay(e.target.value);setPage(1)}}}/>
     <label><input type="checkbox" checked={overdue} onChange={e=>{setOverdue(e.target.checked);setPage(1)}}/> {t('wf.overdue')}</label>
    </div>
    {data?<div className="hang"><span>{t('wf.count',{n:formatNumber(data.total)})}</span>{(['assigned','in_progress','review','done'] as const).map(s=><span className="badge badge--mo" key={s}>{statusLabel(s)}: {data.counts[s]}</span>)}</div>:null}
    {loading?<DangTai/>:null}
    {data&&!data.tasks.length?<Card>{t('wf.empty')}</Card>:null}
    {data?<div className={mode==='week'&&!overdue?'wf__week':'wf__list'}>{mode==='week'&&!overdue?[...days,null].map(d=><section className="wf__day" key={d??'none'}><h3>{d?dayLabel(d):t('wf.unscheduled')}</h3>{data.tasks.filter(task=>task.plannedDate===d).map(taskCard)}</section>):data.tasks.map(taskCard)}</div>:null}
    {data?<div className="hang"><Nut bien="phu" disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>{t('wf.previous')}</Nut><span>{page}</span><Nut bien="phu" disabled={page*data.pageSize>=data.total||loading} onClick={()=>setPage(p=>p+1)}>{t('wf.next')}</Nut></div>:null}
   </>}
  </div></Trang>
  <HopThoai mo={taskForm!==null} tieuDe={t(editId?'common.edit':'wf.create')} onDong={()=>{if(!busy){setTaskForm(null);setEditId(null);setError(null)}}} chanDung={<><Nut bien="phu" disabled={busy} onClick={()=>{setTaskForm(null);setError(null)}}>{t('common.cancel')}</Nut><Nut dangTai={busy} onClick={()=>void saveTask()}>{t('common.save')}</Nut></>}>
   {taskForm?<div className="cot"><Truong nhan={t('wf.company')}><OChon disabled={!!editId} value={taskForm.companyId} onChange={v=>setTaskForm({...taskForm,companyId:v,assigneeUserId:''})} options={[{value:'',label:t('wf.company')},...companies.map(c=>({value:c.id,label:c.name}))]}/></Truong><Truong nhan={t('wf.assignee')}><OChon value={taskForm.assigneeUserId} onChange={v=>setTaskForm({...taskForm,assigneeUserId:v})} options={[{value:'',label:t('wf.assignee')},...availableEmployees.map(e=>({value:e.id,label:e.name}))]}/></Truong>
    <Truong nhan={t('wf.titleField')}><ONhap value={taskForm.title} onChange={v=>setTaskForm({...taskForm,title:v})}/></Truong><Truong nhan={t('wf.brief')}><OVanBan value={taskForm.brief} onChange={v=>setTaskForm({...taskForm,brief:v})} rows={5}/></Truong>
    <OChon value={taskForm.kind} onChange={v=>setTaskForm({...taskForm,kind:v as 'image'|'video'|'other'})} options={['image','video','other'].map(v=>({value:v,label:t(`wf.${v as 'image'|'video'|'other'}`)}))}/>
    <Truong nhan={t('wf.priority')}><input className="o-nhap" type="number" min={1} max={3} value={taskForm.priority} onChange={e=>setTaskForm({...taskForm,priority:Number(e.target.value)})}/></Truong>
    <Truong nhan={t('wf.weekStart')}><input className="o-nhap" type="date" value={taskForm.plannedWeek} onChange={e=>setTaskForm({...taskForm,plannedWeek:e.target.value?workforceWeek(e.target.value):'',plannedDate:null})}/></Truong>
    <Truong nhan={t('wf.plannedDate')}><input className="o-nhap" type="date" value={taskForm.plannedDate??''} onChange={e=>setTaskForm({...taskForm,plannedDate:e.target.value||null})}/></Truong>
    <Truong nhan={t('wf.deadline')}><input className="o-nhap" type="datetime-local" value={localDeadline(taskForm.deadline)} onChange={e=>setTaskForm({...taskForm,deadline:e.target.value?`${e.target.value}:00+07:00`:''})}/></Truong>
    {!editId?<label><input type="checkbox" checked={draft} onChange={e=>setDraft(e.target.checked)}/> {t('wf.draft')}</label>:null}
   </div>:null}{error?<ThongBao loai="loi">{error}</ThongBao>:null}
  </HopThoai>
  <HopThoai mo={employeeForm!==null} tieuDe={t(employeeForm?.id?'wf.editAccess':'wf.addEmployee')} onDong={()=>{if(!busy){setEmployeeForm(null);setError(null)}}} chanDung={<><Nut bien="phu" disabled={busy} onClick={()=>setEmployeeForm(null)}>{t('common.cancel')}</Nut><Nut dangTai={busy} onClick={()=>void saveEmployee()}>{t('common.save')}</Nut></>}>
   {employeeForm?<div className="cot">{!employeeForm.id?<><Truong nhan={t('wf.name')}><ONhap value={employeeForm.name} onChange={v=>setEmployeeForm({...employeeForm,name:v})}/></Truong><Truong nhan={t('wf.email')}><ONhap type="email" value={employeeForm.email} onChange={v=>setEmployeeForm({...employeeForm,email:v})}/></Truong><Truong nhan={t('wf.password')}><ONhap type="password" visibilityResetKey={employeeForm?.id??'new'} value={employeeForm.password} onChange={v=>setEmployeeForm({...employeeForm,password:v})}/></Truong><p>{t('wf.createNote')}</p></>:<><strong>{employeeForm.name} · {employeeForm.email}</strong><label><input type="checkbox" checked={employeeForm.active} onChange={e=>setEmployeeForm({...employeeForm,active:e.target.checked})}/>{t('wf.active')}</label></>}
    <strong>{t('wf.companies')}</strong>{companies.map(c=><label key={c.id}><input type="checkbox" checked={employeeForm.companyIds.includes(c.id)} onChange={e=>setEmployeeForm({...employeeForm,companyIds:e.target.checked?[...employeeForm.companyIds,c.id]:employeeForm.companyIds.filter(id=>id!==c.id)})}/>{c.name}</label>)}
   </div>:null}{error?<><ThongBao loai="loi">{error}</ThongBao>{employeeForm?.id?<Nut bien="nguy-hiem" onClick={()=>void saveEmployee(true)}>{t('wf.removeWarning')}</Nut>:null}</>:null}
  </HopThoai>
  <HopThoai mo={selectedId!==null&&taskForm===null} tieuDe={detail?.task.title??t('wf.tasks')} onDong={()=>{if(!busy){setSelectedId(null);setError(null)}}} rong>
   {detailLoading?<DangTai/>:null}{detail?<div className="cot"><div className="hang"><span className="badge badge--mo">{detail.task.companyName}</span><span>{detail.task.assigneeName}</span><strong>{statusLabel(detail.task.status)}</strong></div><p>{t('wf.deadline')}: {formatDateTime(detail.task.deadline)}</p><Markdown>{detail.task.brief}</Markdown>
    <div className="hang">{employee&&detail.task.status==='assigned'?<Nut disabled={busy} onClick={()=>void run(()=>api.action(detail.task.id,'start',detail.task.version))}>{t('wf.start')}</Nut>:null}
    {!employee&&!['done','review','cancelled'].includes(detail.task.status)?<Nut bien="phu" onClick={()=>editTask(detail.task)}>{t('common.edit')}</Nut>:null}
    {!employee&&detail.task.status==='draft'?<Nut onClick={()=>setConfirm({action:'assign'})}>{t('wf.assign')}</Nut>:null}
    {!employee&&detail.task.status==='review'?<><Nut onClick={()=>setConfirm({action:'review',decision:'approve'})}>{t('wf.approve')}</Nut><Nut bien="phu" onClick={()=>setConfirm({action:'review',decision:'request_changes'})}>{t('wf.changes')}</Nut></>:null}
    {!employee&&detail.task.status==='done'?<Nut bien="phu" onClick={()=>setConfirm({action:'reopen'})}>{t('wf.reopen')}</Nut>:null}
    {!employee&&detail.task.status!=='cancelled'?<Nut bien="nguy-hiem" onClick={()=>setConfirm({action:'cancel'})}>{t('wf.cancel')}</Nut>:null}</div>
    {(employee&&['assigned','in_progress'].includes(detail.task.status))||!employee?<Truong nhan={t('wf.content')}><OVanBan value={content} onChange={setContent} rows={3}/></Truong>:null}
    {employee&&['assigned','in_progress'].includes(detail.task.status)?<><OChon value={reportKind} onChange={v=>setReportKind(v as typeof reportKind)} options={(['progress','blocker','submit'] as const).map(k=>({value:k,label:t(`wf.${k}`)}))}/><Truong nhan={t('wf.links')}><OVanBan value={links} onChange={setLinks} rows={3}/></Truong><Nut dangTai={busy} onClick={()=>void report()}>{t('wf.report')}</Nut></>:null}
    <h3>{t('wf.reports')}</h3>{detail.reports.map(r=><Card key={r.id}><strong>{r.authorName} · {formatDateTime(r.createdAt)}</strong><Markdown>{r.content}</Markdown>{r.links.map(l=><div key={l}><a href={l} target="_blank" rel="noopener noreferrer">{l}</a></div>)}</Card>)}
    <h3>{t('wf.history')}</h3>{detail.events.map(e=><div key={e.id}><small>{formatDateTime(e.createdAt)} · {e.actorName} · {e.kind}</small>{e.note?<Markdown>{e.note}</Markdown>:null}</div>)}
   </div>:null}{error?<ThongBao loai="loi">{error}</ThongBao>:null}
  </HopThoai>
  <HopThoaiXacNhan mo={confirm!==null} tieuDe={t('wf.tasks')} moTa={t('wf.confirm',{title:detail?.task.title??''})} nhanXacNhan={t('common.save')} nguyHiem={confirm?.action==='cancel'} dangXuLy={busy} onHuy={()=>{if(!busy)setConfirm(null)}} onXacNhan={()=>void act()}/>
 </div>
}
