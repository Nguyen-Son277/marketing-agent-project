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
export const dailySubmissionSchema = z.object({
  memberId: z.string().min(1).max(100),
  work: z.string().trim().min(1).max(8000),
  blockers: z.string().trim().max(3000).default(''),
  nextSteps: z.string().trim().max(3000).default(''),
  editKey: z.string().max(100).optional(),
  version: z.number().int().positive().optional(),
})
export type DailySubmissionInput = z.infer<typeof dailySubmissionSchema>
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
  submittedAt: string | null; revision: number | null
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
