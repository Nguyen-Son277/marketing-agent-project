/** Hợp đồng việc con người, độc lập với DAG việc agent. */
import { z } from 'zod'
import { EMPLOYEE_TASK_STATUSES, EMPLOYEE_TASK_KINDS, EMPLOYEE_REPORT_KINDS } from './domain.ts'
export type WorkforceStatus = (typeof EMPLOYEE_TASK_STATUSES)[number]
export interface WorkforceCompany { id: string; name: string }
export interface EmployeeView {
  id: string; name: string; email: string; active: boolean; approvalStatus: 'pending' | 'approved'
  companyIds: string[]; mustChangePassword: boolean
}
export interface WorkforceTask {
  id: string; companyId: string; companyName: string; managerId: string; assigneeUserId: string; assigneeName: string
  title: string; brief: string; kind: 'image' | 'video' | 'other'; priority: number
  plannedWeek: string; plannedDate: string | null; deadline: string; status: WorkforceStatus
  source: 'manager' | 'agent'; sourceConversationId: string | null; version: number
  createdAt: string; updatedAt: string; completedAt: string | null
}
export interface WorkforceReport { id: string; authorId: string; authorName: string; kind: 'progress' | 'blocker' | 'submit'; content: string; links: string[]; createdAt: string }
export interface WorkforceEvent { id: string; actorName: string; kind: string; note: string; createdAt: string }
export interface WorkforceDetail { task: WorkforceTask; reports: WorkforceReport[]; events: WorkforceEvent[] }
export interface WorkforceList { tasks: WorkforceTask[]; total: number; page: number; pageSize: number; counts: Record<WorkforceStatus, number>; overdue: number }

export const workforceDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === v
}, 'Ngày không hợp lệ')
/** Ngày Việt Nam không lệ thuộc timezone của máy chạy server/trình duyệt. */
export function vietnamDate(value: Date = new Date()): string { return new Date(value.getTime() + 7 * 3600000).toISOString().slice(0,10) }
export function addWorkDays(day: string, count: number): string { return new Date(new Date(`${day}T00:00:00Z`).getTime() + count * 86400000).toISOString().slice(0,10) }
export function workforceWeek(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  return addWorkDays(day, -(weekday === 0 ? 6 : weekday - 1))
}
export const createEmployeeSchema = z.object({
  name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(200),
  password: z.string().min(10).max(200), companyIds: z.array(z.string().min(1)).min(1).max(100),
})
export const updateEmployeeSchema = z.object({ companyIds: z.array(z.string().min(1)).max(100), active: z.boolean(), confirmRemoval: z.boolean().default(false) })
export const workforceTaskSchema = z.object({
  companyId: z.string().min(1), assigneeUserId: z.string().min(1), title: z.string().trim().min(1).max(200),
  brief: z.string().trim().min(1).max(20000), kind: z.enum(EMPLOYEE_TASK_KINDS), priority: z.number().int().min(1).max(3).default(2),
  plannedWeek: workforceDate, plannedDate: workforceDate.nullable().default(null), deadline: z.string().datetime({offset:true}),
}).superRefine((v,c) => {
  if (workforceWeek(v.plannedWeek) !== v.plannedWeek) c.addIssue({code:'custom',path:['plannedWeek'],message:'Tuần phải bắt đầu thứ Hai'})
  if (v.plannedDate && workforceWeek(v.plannedDate) !== v.plannedWeek) c.addIssue({code:'custom',path:['plannedDate'],message:'Ngày phải nằm trong tuần đã chọn'})
})
export type WorkforceTaskInput = z.infer<typeof workforceTaskSchema>
export const workforceReportSchema = z.object({
  version: z.number().int().positive(), kind: z.enum(EMPLOYEE_REPORT_KINDS), content: z.string().trim().min(1).max(10000),
  links: z.array(z.string().trim().url().max(2000).refine(v => /^https?:\/\//i.test(v), 'Chỉ chấp nhận link HTTP/HTTPS')).max(10).default([]),
}).refine(v => v.kind !== 'submit' || v.links.length > 0, 'Báo xong cần ít nhất một link sản phẩm')
export const workforceActionSchema = z.object({ version: z.number().int().positive(), note: z.string().trim().max(4000).default('') })
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(10).max(200) })
