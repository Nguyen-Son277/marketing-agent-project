/**
 * BriefGate và Planner.
 *
 * BriefGate là hàng rào quan trọng nhất của hệ thống: một brief thiếu trường sẽ
 * được phát hiện ở đây với giá một câu hỏi, thay vì sau khi tám agent đã chạy.
 *
 * Planner kiểm tra kế hoạch trước khi giao việc: vai trò phải tồn tại và đang bật,
 * đồ thị không được có chu trình, mỗi việc phải có đầu ra kiểm chứng được. Việc
 * kiểm tra nằm ở đây chứ không ở prompt vì prompt là gợi ý, không phải hàng rào.
 */
import {
  AppError,
  isAppError,
  validation,
  type AgentRole,
} from '@marketing-agent/shared'
import { hasCycle, topologicalOrder, type PlannedTaskInput } from '@marketing-agent/tools'
import { BRIEF_FIELDS, type Brief, type PlanResult, type PlannedTask } from './types.ts'

/** Kết quả kiểm tra brief, kèm câu hỏi gợi ý cho trường còn thiếu. */
export interface BriefCheck {
  readonly complete: boolean
  readonly missing: readonly (keyof Brief)[]
}

/** Trường được coi là đã điền khi có nội dung thực, không chỉ khoảng trắng. */
export function checkBrief(brief: Partial<Brief> | undefined | null): BriefCheck {
  if (!brief) return { complete: false, missing: [...BRIEF_FIELDS] }
  const missing = BRIEF_FIELDS.filter((field) => {
    const value = brief[field]
    return typeof value !== 'string' || value.trim().length < 3
  })
  return { complete: missing.length === 0, missing }
}

/**
 * Đọc brief từ JSON đã lưu. Dữ liệu cũ hoặc hỏng phải trả về `undefined` thay vì
 * ném lỗi — một bản ghi brief hỏng không được làm sập cả cuộc trao đổi.
 */
export function parseBrief(json: string | null | undefined): Brief | undefined {
  if (!json) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  const collected: Partial<Record<keyof Brief, string>> = {}
  for (const field of BRIEF_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value.trim().length > 0) collected[field] = value.trim()
  }
  return collected as Brief
}

/** Câu hỏi làm rõ cho từng trường còn thiếu, kèm gợi ý để người dùng chỉ cần chọn. */
export function clarifyingQuestions(missing: readonly (keyof Brief)[], maxQuestions = 3): string[] {
  const templates: Record<keyof Brief, string> = {
    objective: 'Mục tiêu cuối cùng là gì? (ví dụ: "tăng đăng ký dùng thử", "giảm CPL")',
    kpi: 'Đo thành công bằng chỉ số nào và mốc nào? (ví dụ: "50 lead/tháng", "CPL ≤ 120.000đ")',
    scope: 'Phạm vi gồm những gì, và điều gì KHÔNG làm lần này?',
    deadline: 'Cần xong trước ngày nào? Có mốc trung gian nào không?',
    budget: 'Ngân sách bao nhiêu? (tiền quảng cáo và/hoặc số giờ người)',
    constraints: 'Có ràng buộc nào bắt buộc? (thương hiệu, pháp lý, kênh bắt buộc, điều cấm)',
  }
  return missing.slice(0, maxQuestions).map((field) => templates[field])
}

/** Kế hoạch thô mà Leader đề xuất, trước khi kiểm tra. */
export interface RawPlan {
  readonly tasks: readonly PlannedTaskInput[]
}

/** Kết quả xác thực, kèm thông tin đã phải cắt bớt việc hay chưa. */
export interface PlanValidation extends PlanResult {
  /** Số việc bị cắt vì vượt trần. */
  readonly dropped: number
}

/**
 * Xác thực kế hoạch và trả về thứ tự thi hành đã sắp xếp.
 *
 * Vượt trần số việc KHÔNG phải lỗi chặn: kế hoạch do model viết là văn bản hợp lệ,
 * và từ chối toàn bộ chỉ vì nó chia 9 việc thay vì 8 là hành vi mong manh — người
 * dùng nhận thông báo lỗi mà không có gì để duyệt. Thay vào đó ta CẮT BỚT theo thứ
 * tự phụ thuộc và báo rõ đã bỏ bao nhiêu việc.
 *
 * Việc bị cắt được chọn sao cho không phá vỡ đồ thị: chỉ cắt những việc không phải
 * tổ tiên của việc nào khác, nên mọi việc giữ lại vẫn còn đủ phụ thuộc.
 */
export function validatePlan(input: {
  plan: RawPlan
  /** Vai trò đang bật cho công ty, lấy từ cơ sở dữ liệu. */
  availableRoles: readonly AgentRole[]
  maxTasks?: number
}): PlanValidation {
  const { plan, availableRoles } = input
  const maxTasks = input.maxTasks ?? 10

  if (plan.tasks.length === 0) {
    throw validation('Kế hoạch không có công việc nào')
  }

  const kept = plan.tasks.length > maxTasks ? chonViecGiuLai(plan.tasks, maxTasks) : plan.tasks
  const dropped = plan.tasks.length - kept.length

  const available = new Set<string>(availableRoles)
  const titles = new Set<string>()
  for (const task of kept) {
    const title = task.title.trim()
    if (title.length === 0) throw validation('Có công việc không có tiêu đề')
    if (titles.has(title)) throw validation(`Tiêu đề công việc bị trùng: "${title}"`)
    titles.add(title)
    if (!available.has(task.assigneeRole)) {
      throw validation(
        `Không có chuyên môn "${task.assigneeRole}" đang bật cho công ty này. ` +
          `Các vai trò hợp lệ: ${[...available].sort().join(', ')}`,
      )
    }
    if (task.briefMd.trim().length < 10) {
      throw validation(`Công việc "${title}" cần mô tả rõ hơn (tối thiểu 10 ký tự)`)
    }
  }

  for (const task of kept) {
    for (const dependency of task.dependsOnTitles ?? []) {
      if (!titles.has(dependency)) {
        throw validation(
          `Công việc "${task.title}" phụ thuộc "${dependency}" nhưng không có việc nào tên đó`,
        )
      }
      if (dependency === task.title) {
        throw validation(`Công việc "${task.title}" phụ thuộc chính nó`)
      }
    }
  }

  if (hasCycle(kept)) {
    throw validation(
      'Kế hoạch có vòng phụ thuộc. Hãy sắp xếp lại để không việc nào phụ thuộc vòng tròn.',
    )
  }

  const ordered = topologicalOrder(kept)
  if (!ordered) throw validation('Không sắp xếp được thứ tự thi hành cho kế hoạch này')

  return {
    tasks: kept.map((task) => ({
      id: task.title,
      title: task.title,
      assigneeRole: task.assigneeRole,
      dependsOn: task.dependsOnTitles ?? [],
    })),
    order: ordered.map((task) => task.title),
    dropped,
  }
}

/**
 * Chọn `maxTasks` việc để giữ lại, ưu tiên những việc mà việc khác phụ thuộc vào.
 *
 * Vì sao theo thứ tự phụ thuộc ngược: nếu cắt mất một việc mà việc khác đang phụ
 * thuộc nó, việc còn lại sẽ trỏ tới một phụ thuộc không tồn tại và kế hoạch hỏng.
 * Duyệt từ lá lên gốc và giữ lại tổ tiên của mọi việc được giữ, nên đồ thị giữ lại
 * luôn khép kín.
 */
function chonViecGiuLai(
  tasks: readonly PlannedTaskInput[],
  maxTasks: number,
): PlannedTaskInput[] {
  const byTitle = new Map(tasks.map((task) => [task.title, task]))
  const canGiu = new Set<string>()

  // Đếm số việc phụ thuộc trực tiếp vào mỗi việc, để biết việc nào là "gốc".
  const soPhuThuoc = new Map<string, number>()
  for (const task of tasks) {
    for (const dependency of task.dependsOnTitles ?? []) {
      soPhuThuoc.set(dependency, (soPhuThuoc.get(dependency) ?? 0) + 1)
    }
  }

  // Giữ theo thứ tự tô-pô (việc không phụ thuộc trước), bỏ qua việc mà việc khác
  // đang cần nếu ngân sách đã hết.
  const ordered = topologicalOrder(tasks) ?? [...tasks]
  for (const task of ordered) {
    if (canGiu.size >= maxTasks) break
    // Việc bị cắt không được là phụ thuộc của việc đã giữ.
    const laPhuThuocCuaViecDaGiu = [...canGiu].some((title) =>
      (byTitle.get(title)?.dependsOnTitles ?? []).includes(task.title),
    )
    if (laPhuThuocCuaViecDaGiu) continue
    canGiu.add(task.title)
  }

  return tasks.filter((task) => canGiu.has(task.title))
}

/**
 * Nhóm các việc theo mức phụ thuộc: việc trong cùng một mức không phụ thuộc nhau
 * nên chạy song song được. Dùng để giới hạn số việc chạy đồng thời.
 */
export function planLevels(tasks: readonly PlannedTask[]): PlannedTask[][] {
  const byTitle = new Map(tasks.map((task) => [task.title, task]))
  const depth = new Map<string, number>()

  const depthOf = (title: string): number => {
    const cached = depth.get(title)
    if (cached !== undefined) return cached
    const task = byTitle.get(title)
    if (!task || task.dependsOn.length === 0) {
      depth.set(title, 0)
      return 0
    }
    const value = 1 + Math.max(...task.dependsOn.map((dependency) => depthOf(dependency)))
    depth.set(title, value)
    return value
  }

  const levels = new Map<number, PlannedTask[]>()
  for (const task of tasks) {
    const level = depthOf(task.title)
    const bucket = levels.get(level)
    if (bucket) bucket.push(task)
    else levels.set(level, [task])
  }
  return [...levels.entries()].sort((a, b) => a[0] - b[0]).map(([, bucket]) => bucket)
}

/** Lỗi kế hoạch đã được diễn giải thành thông điệp cho Leader, không phải cho lập trình viên. */
export function describePlanError(error: unknown): string {
  if (isAppError(error)) return error.message
  if (error instanceof Error) return error.message
  return String(error)
}

/** Xác nhận một giá trị là `AppError` hợp lệ thuộc nhóm validation. */
export function isPlanValidationError(error: unknown): boolean {
  return isAppError(error) && error.code === 'validation'
}

export function assertNever(value: never): never {
  throw new AppError('internal', `Trạng thái không xử lý được: ${String(value)}`)
}
