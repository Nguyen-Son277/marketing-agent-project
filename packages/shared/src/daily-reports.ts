import { z } from 'zod'

export const dailyGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200).default('Daily Team Work Report'),
  enabled: z.boolean().default(true),
  modelId: z.string().max(100).nullable().default(null),
  members: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
}).superRefine((v, ctx) => {
  if (new Set(v.members.map(n => n.toLocaleLowerCase())).size !== v.members.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['members'], message: 'Tên thành viên phải phân biệt được.' })
})
export type DailyGroupInput = z.infer<typeof dailyGroupSchema>
export const dailyReportDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD').refine(value => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, 'Ngày báo cáo không hợp lệ')
export const dailyRoundCreateSchema = z.object({ date: dailyReportDateSchema })
export const dailySubmissionSchema = z.object({
  memberId: z.string().min(1).max(100),
  work: z.string().trim().max(8000).default(''),
  blockers: z.string().trim().max(3000).default(''),
  nextSteps: z.string().trim().max(3000).default(''),
  isDayOff: z.boolean().default(false),
  version: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (!value.isDayOff && !value.work)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['work'], message: 'Nhập công việc hoặc đánh dấu hôm nay nghỉ.' })
})
export type DailySubmissionInput = z.input<typeof dailySubmissionSchema>
export interface DailyPublicSubmission {
  memberId: string; work: string; blockers: string; nextSteps: string; isDayOff: boolean;
  version: number; submittedAt: string
}
export interface DailyMemberSubmissionResponse { submission: DailyPublicSubmission | null }
export interface DailySubmissionReceipt { version: number; submittedAt: string; late: boolean }
export const dailyEnglishSchema = z.object({
  executiveSummary: z.string().min(1).max(12000),
  individuals: z.array(z.object({ memberId: z.string(), work: z.string().max(16000), blockers: z.string().max(6000), nextSteps: z.string().max(6000) })).max(100),
})
export type DailyEnglish = z.infer<typeof dailyEnglishSchema>
export interface DailyGroup {
  id: string; companyId: string; name: string; title: string; enabled: boolean; modelId: string | null;
  members: {id: string; name: string}[]; startDate: string; version: number
}
export type DailyStatus = 'on_time' | 'overdue' | 'late_submission' | 'updated_after_deadline'
export interface DailySnapshotMember {
  memberId: string; name: string; status: DailyStatus; work: string; blockers: string; nextSteps: string;
  submittedAt: string | null; revision: number | null;
  /** Absent in snapshots created before day-off reporting was added. */
  isDayOff?: boolean
}
export interface DailySnapshot {
  title: string; groupName: string; companyName: string; date: string; deadline: string;
  capturedAt: string; members: DailySnapshotMember[]
}
export interface DailyReportVersion {
  id: string; number: number; snapshot: DailySnapshot; status: 'pending' | 'running' | 'ready' | 'failed';
  english: DailyEnglish | null; error: string | null; createdAt: string
}
export interface DailyRound {
  id: string; groupId: string; date: string; opensAt: string; deadline: string; closesAt: string;
  sealedAt: string | null; members: {id: string; name: string}[]; token?: string;
}
export interface DailyRoundDetail { round: DailyRound; current: DailySnapshot; versions: DailyReportVersion[] }
export interface DailyReportShare {
  /** Existing submission URL, retained for backwards compatibility. */
  url: string | null
  viewUrl: string | null
  warning: string | null
}
export interface DailyRoundDetailResponse extends DailyRoundDetail { share: DailyReportShare }
export interface DailyRoundCreateResponse { round: DailyRound; share: DailyReportShare }
/** Public projection: never includes original submissions, IDs, receipts or configuration. */
export interface DailyPublicReport {
  groupName: string
  title: string
  date: string
  status: 'pending' | 'ready'
  number: number | null
  publishedAt: string | null
  executiveSummary: string | null
  members: { name: string; status: DailyStatus; work: string; blockers: string; nextSteps: string; isDayOff: boolean }[]
}
export interface DailyPublicInfo {
  groupName: string; date: string; opensAt: string; deadline: string; closesAt: string; serverNow: string;
  members: {id: string; name: string}[]
}
/** All schedule boundaries are derived from the Vietnam calendar, never the host timezone. */
export function dailyVietnamDate(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10)
}
export function dailyBounds(date: string) {
  return { opensAt: new Date(`${date}T16:20:00+07:00`).toISOString(), deadline: new Date(`${date}T16:50:00+07:00`).toISOString(), closesAt: new Date(new Date(`${date}T00:00:00+07:00`).getTime() + 86400000).toISOString() }
}
export function dailyWorkingDay(date: string): boolean { return new Date(`${date}T12:00:00+07:00`).getUTCDay() !== 0 }
export function dailyNextDate(date: string): string { return new Date(new Date(`${date}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10) }
