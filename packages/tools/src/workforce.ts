/** Agent chỉ được tạo nháp cho người; không có tool giao thật/duyệt hoàn thành. */
import type { Repos } from '@marketing-agent/db'
import { forbidden, workforceTaskSchema, type ToolDefinition } from '@marketing-agent/shared'
export function createWorkforceTools(repos:Repos):ToolDefinition[] {
 return [{name:'employee_list',description:'Danh sách designer được quản lý cấp quyền nhận việc ở công ty hiện tại.',roles:['marketing-leader','design-video'],parameters:{type:'object',properties:{},additionalProperties:false},async handler(_args,ctx){
  if(!ctx.actorUserId)throw forbidden('Thiếu danh tính quản lý đáng tin cậy')
  repos.workforce.manageCompany(ctx.actorUserId,ctx.companyId)
  const employees=repos.workforce.employees(ctx.actorUserId).filter(e=>e.active&&e.companyIds.includes(ctx.companyId)).map(e=>({id:e.id,name:e.name}))
  return {content:JSON.stringify(employees)}
 }},{name:'employee_task_draft',description:'Tạo NHÁP việc designer. Nhân viên chỉ nhận việc khi quản lý xác nhận trên giao diện. Không giao xuyên công ty.',roles:['marketing-leader','design-video'],parameters:{type:'object',properties:{assigneeUserId:{type:'string'},title:{type:'string'},brief:{type:'string'},kind:{type:'string',enum:['image','video','other']},priority:{type:'number'},plannedWeek:{type:'string',description:'Thứ Hai YYYY-MM-DD'},plannedDate:{type:'string',description:'Ngày YYYY-MM-DD, bỏ trống nếu chưa xếp ngày'},deadline:{type:'string',description:'ISO datetime có timezone, không tự bịa deadline'}},required:['assigneeUserId','title','brief','kind','plannedWeek','deadline'],additionalProperties:false},async handler(args,ctx){
  if(!ctx.actorUserId||!ctx.requestId||!ctx.toolCallId||!ctx.conversationId)throw forbidden('Thiếu ngữ cảnh giao việc đáng tin cậy')
  const input=workforceTaskSchema.parse({...args,companyId:ctx.companyId,plannedDate:args.plannedDate||null})
  const task=repos.workforce.createTask(ctx.actorUserId,input,{draft:true,source:'agent',conversationId:ctx.conversationId,idempotencyKey:`${ctx.actorUserId}:${ctx.requestId}:${ctx.toolCallId}`})
  return {content:JSON.stringify({id:task.id,title:task.title,status:'draft',message:'Nháp đã tạo, quản lý cần xác nhận giao trên giao diện.'}),data:{draftId:task.id}}
 }}]
}
