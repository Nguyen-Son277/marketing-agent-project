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
  truncate,
  validation,
  type AgentRole,
  type ClarificationAnswer,
  type ClarificationInputMode,
  type ClarificationQuestion,
  type ClarificationRequest,
} from '@marketing-agent/shared'
import { translator, vi, type Locale, type MessageKey } from '@marketing-agent/i18n'
import { hasCycle, topologicalOrder, type PlannedTaskInput } from '@marketing-agent/tools'
import { mergeBriefFields } from './brief.ts'
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

/* ------------------------------------------- hỏi lại có cấu trúc */

/** Số câu hỏi tối đa mỗi lượt; giữ hành vi cũ để không hỏi dồn dập. */
export const MAX_CLARIFICATION_QUESTIONS = 3

interface ClarifyFieldSpec {
  readonly questionKey: MessageKey
  readonly helperKey: MessageKey
  readonly inputMode: ClarificationInputMode
  readonly optionIds: readonly string[]
  /**
   * Phương án nói về việc KHÔNG làm, chỉ có nghĩa với chọn-nhiều.
   *
   * Khai báo tường minh thay vì suy từ tiền tố: `constraints-no-*` cũng bắt đầu bằng
   * `no-` nhưng đó là RÀNG BUỘC bắt buộc, không phải mục bị loại khỏi phạm vi. Suy từ
   * tiền tố sẽ biến "không dùng ảnh khách hàng" thành một mục "ngoài phạm vi".
   */
  readonly exclusiveIds?: readonly string[]
}

/**
 * Bảng ánh xạ trường brief → câu hỏi có cấu trúc.
 *
 * Vì sao cấu trúc nằm ở mã còn câu chữ nằm ở catalog i18n: `packages/i18n` giữ phần
 * người dùng đọc, còn trường nào hỏi bằng chọn-một/chọn-nhiều và mã phương án nào hợp
 * lệ là logic nghiệp vụ — server dùng chính mã đó để áp câu trả lời vào brief. Trộn hai
 * thứ vào catalog sẽ khiến một lần sửa chữ có thể vô tình đổi cách server hiểu câu trả lời.
 */
const CLARIFY_SPEC: Readonly<Record<keyof Brief, ClarifyFieldSpec>> = {
  objective: {
    questionKey: 'clarify.objective.question',
    helperKey: 'clarify.objective.helper',
    inputMode: 'single',
    optionIds: ['objective-trial', 'objective-lead', 'objective-cpl', 'objective-revenue', 'objective-brand', 'objective-other'],
  },
  kpi: {
    questionKey: 'clarify.kpi.question',
    helperKey: 'clarify.kpi.helper',
    inputMode: 'single',
    optionIds: ['kpi-leads', 'kpi-cpl', 'kpi-signups', 'kpi-traffic', 'kpi-engagement', 'kpi-other'],
  },
  scope: {
    questionKey: 'clarify.scope.question',
    helperKey: 'clarify.scope.helper',
    inputMode: 'multi',
    optionIds: [
      'scope-facebook',
      'scope-seo',
      'scope-social-organic',
      'scope-email',
      'scope-no-tiktok',
      'scope-no-influencer',
      'scope-no-ads',
      'scope-no-redesign',
      'scope-no-video',
      'scope-other',
    ],
    exclusiveIds: ['scope-no-tiktok', 'scope-no-influencer', 'scope-no-ads', 'scope-no-redesign', 'scope-no-video'],
  },
  deadline: {
    questionKey: 'clarify.deadline.question',
    helperKey: 'clarify.deadline.helper',
    inputMode: 'single',
    optionIds: ['deadline-30', 'deadline-60', 'deadline-90', 'deadline-quarter-end', 'deadline-year-end', 'deadline-unknown', 'deadline-other'],
  },
  budget: {
    questionKey: 'clarify.budget.question',
    helperKey: 'clarify.budget.helper',
    inputMode: 'single',
    optionIds: ['budget-under-20m', 'budget-20-50m', 'budget-50-100m', 'budget-over-100m', 'budget-hours-only', 'budget-unknown', 'budget-other'],
  },
  constraints: {
    questionKey: 'clarify.constraints.question',
    helperKey: 'clarify.constraints.helper',
    inputMode: 'multi',
    optionIds: [
      'constraints-no-customer-photos',
      'constraints-no-unverified-claims',
      'constraints-brand-guidelines',
      'constraints-legal-review',
      'constraints-tone',
      'constraints-none',
      'constraints-other',
    ],
  },
}

/** Khoá catalog của nhãn/gợi ý một phương án; mã phương án giữ nguyên giữa hai ngôn ngữ. */
function optionLabelKey(id: string): MessageKey {
  return `clarify.${id}.label` as MessageKey
}

/** Gợi ý chỉ có ở một số phương án; thiếu bản dịch thì bỏ hẳn thay vì trả về chuỗi khoá. */
function optionHint(locale: Locale, id: string): string | undefined {
  const key = `clarify.${id}.hint`
  if (!(key in vi)) return undefined
  return translator(locale)(key as MessageKey)
}

/**
 * Tầng 1 — dựng câu hỏi có cấu trúc, tất định, không gọi model.
 *
 * Vì sao luôn có tầng này: thẻ chọn rỗng vì model lỗi là kiểu hỏng im lặng khiến người
 * dùng không biết phải làm gì. Bảng catalog cho ra câu hỏi dùng được ngay cả khi mọi
 * lượt gọi model đều thất bại.
 */
export function buildClarification(
  missing: readonly (keyof Brief)[],
  locale: Locale,
): ClarificationRequest {
  const t = translator(locale)
  const fields = [...new Set(missing)].slice(0, MAX_CLARIFICATION_QUESTIONS)
  const questions: ClarificationQuestion[] = fields.map((field) => {
    const spec = CLARIFY_SPEC[field]
    const exclusive = new Set(spec.exclusiveIds ?? [])
    return {
      field,
      question: t(spec.questionKey),
      helper: t(spec.helperKey),
      inputMode: spec.inputMode,
      options: spec.optionIds.map((id) => {
        const hint = optionHint(locale, id)
        return {
          id,
          label: t(optionLabelKey(id)),
          ...(hint === undefined ? {} : { hint }),
          ...(exclusive.has(id) ? { exclusive: true } : {}),
        }
      }),
      allowCustom: true,
    }
  })
  return { intro: t('clarify.intro'), questions }
}

/* --------------------------------------- áp câu trả lời tất định */

/** Câu chữ nối cho phần "trong/ngoài phạm vi" và phần bổ sung; chỉ hai ngôn ngữ đang hỗ trợ. */
const CLARIFY_APPLY_TEXT: Readonly<Record<Locale, { inScope: string; outOfScope: string; addition: string }>> = {
  vi: { inScope: 'TRONG phạm vi', outOfScope: 'NGOÀI phạm vi', addition: 'Bổ sung từ người dùng' },
  en: { inScope: 'IN SCOPE', outOfScope: 'OUT OF SCOPE', addition: 'User addition' },
}

function isBriefField(value: string): value is keyof Brief {
  return (BRIEF_FIELDS as readonly string[]).includes(value)
}

/**
 * Áp câu trả lời của thẻ chọn vào brief một cách tất định.
 *
 * Vì sao KHÔNG đoán từ câu chữ: người dùng chọn "Không chạy TikTok" mà brief ghi "chạy
 * TikTok" là lỗi nguy hiểm — nội dung sẽ đi sai hướng. Mã phương án do catalog định nghĩa
 * nên ánh xạ là tất định, và trường nào đã có giá trị từ lượt trước thì giữ nguyên (chỉ
 * điền chỗ trống qua `mergeBriefFields`).
 */
export function applyClarificationAnswers(
  brief: Partial<Brief> | undefined,
  answers: readonly ClarificationAnswer[],
  locale: Locale,
): Brief {
  const t = translator(locale)
  const phrases = CLARIFY_APPLY_TEXT[locale]!
  const found: Partial<Record<keyof Brief, string>> = {}

  for (const answer of answers) {
    if (!answer || typeof answer.field !== 'string' || !isBriefField(answer.field)) continue
    const field = answer.field
    const spec = CLARIFY_SPEC[field]
    const exclusive = new Set(spec.exclusiveIds ?? [])
    // Mã lạ bị bỏ qua riêng lẻ: một lựa chọn sai không được làm hỏng cả câu trả lời.
    const chosen = (Array.isArray(answer.optionIds) ? answer.optionIds : []).filter((id) =>
      spec.optionIds.includes(id),
    )

    let main = ''
    if (exclusive.size > 0) {
      const inScope = chosen.filter((id) => !exclusive.has(id)).map((id) => t(optionLabelKey(id)))
      const outOfScope = chosen.filter((id) => exclusive.has(id)).map((id) => t(optionLabelKey(id)))
      const clauses: string[] = []
      if (inScope.length > 0) clauses.push(`${phrases.inScope}: ${inScope.join(', ')}.`)
      if (outOfScope.length > 0) clauses.push(`${phrases.outOfScope}: ${outOfScope.join(', ')}.`)
      main = clauses.join(' ')
    } else {
      main = chosen.map((id) => t(optionLabelKey(id))).join(' · ')
    }

    const custom = typeof answer.custom === 'string' ? answer.custom.trim() : ''
    const segments: string[] = []
    if (main.length > 0) segments.push(main.endsWith('.') ? main : `${main}.`)
    if (custom.length > 0) segments.push(`${phrases.addition}: ${custom}`)
    const value = segments.join(' ').trim()
    if (value.length >= 3) found[field] = truncate(value, 600)
  }

  return mergeBriefFields(brief, found)
}

/* ------------------------------- tầng 2: nhờ model viết lại phương án */

/** Dấu nhận dạng prompt tầng 2, để test và log phân biệt được với lượt trích brief. */
export const CLARIFY_REWRITE_MARKER = 'clarify.rewrite'

/** Hướng dẫn cho model khi viết lại phương án theo ngữ cảnh công ty. */
export function buildClarificationRewriteInstruction(base: ClarificationRequest): string {
  return [
    'Bạn đang giúp Leader hỏi lại người dùng cho đủ brief marketing.',
    `(mã tác vụ: ${CLARIFY_REWRITE_MARKER})`,
    'Hãy viết lại câu hỏi và nhãn phương án cho ĐÚNG ngữ cảnh công ty; dùng kb.search nếu cần.',
    '',
    'QUY TẮC BẮT BUỘC:',
    '1. Giữ nguyên `field`, `inputMode`, `allowCustom` và MỌI `id` phương án — id là khoá server dùng để áp câu trả lời.',
    '2. Chỉ được đổi `question`, `helper`, và `label`/`hint` của phương án. Không thêm, không bớt phương án.',
    '3. Trả về DUY NHẤT một object JSON, không thêm chữ nào khác, không dùng markdown fence.',
    '4. Chữ trong JSON phải bằng ngôn ngữ của cuộc trao đổi.',
    '',
    '## Câu hỏi tất định cần viết lại (JSON)',
    truncate(JSON.stringify(base, null, 2), 8_000),
    '',
    'Định dạng trả về:',
    '{"questions":[{"field":"...","question":"...","helper":"...","options":[{"id":"...","label":"...","hint":"..."}]}]}',
  ].join('\n')
}

interface RewriteOptionShape {
  readonly id?: unknown
  readonly label?: unknown
  readonly hint?: unknown
}

/**
 * Đọc JSON viết lại của model và ghép vào bản tất định.
 *
 * Vì sao ghép thay vì dùng thẳng: model không được phép đổi cấu trúc — nếu nó bỏ một
 * phương án hay đổi `inputMode`, câu trả lời sau này sẽ không áp được vào brief. Hàm này
 * chỉ nhận phần chữ, và trả `undefined` khi JSON hỏng để nơi gọi im lặng dùng tầng 1.
 */
export function parseClarificationRewrite(
  output: string,
  base: ClarificationRequest,
  locale: Locale,
): ClarificationRequest | undefined {
  const candidate = extractJsonObject(output)
  if (!candidate) return undefined
  const questions = candidate['questions']
  if (!Array.isArray(questions)) return undefined

  const byField = new Map<string, Record<string, unknown>>()
  for (const entry of questions) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const field = record['field']
    if (typeof field === 'string' && !byField.has(field)) byField.set(field, record)
  }
  if (byField.size === 0) return undefined

  let changed = false
  const rewritten: ClarificationQuestion[] = base.questions.map((question) => {
    const rewrite = byField.get(question.field)
    if (!rewrite) return question

    const newQuestion = readText(rewrite['question'], 500)
    const helperValue = rewrite['helper']
    const newHelper =
      typeof helperValue === 'string' && helperValue.trim().length > 0
        ? helperValue.trim().slice(0, 300)
        : question.helper

    const optionRewrites = new Map<string, RewriteOptionShape>()
    const rawOptions = rewrite['options']
    if (Array.isArray(rawOptions)) {
      for (const raw of rawOptions) {
        if (typeof raw !== 'object' || raw === null) continue
        const record = raw as RewriteOptionShape
        if (typeof record.id === 'string') optionRewrites.set(record.id, record)
      }
    }

    const options = question.options.map((option) => {
      const rewriteOption = optionRewrites.get(option.id)
      if (!rewriteOption) return option
      const label = readText(rewriteOption.label, 200)
      const hintValue = rewriteOption.hint
      const hint =
        typeof hintValue === 'string' && hintValue.trim().length > 0
          ? hintValue.trim().slice(0, 300)
          : option.hint
      if (label === undefined && hint === option.hint) return option
      changed = true
      return {
        ...option,
        ...(label === undefined ? {} : { label }),
        ...(hint === undefined ? {} : { hint }),
      }
    })

    if (
      (newQuestion !== undefined && newQuestion !== question.question) ||
      (typeof helperValue === 'string' && helperValue.trim().length > 0 && newHelper !== question.helper)
    ) {
      changed = true
    }
    return {
      ...question,
      ...(newQuestion === undefined ? {} : { question: newQuestion }),
      ...(newHelper === undefined ? {} : { helper: newHelper }),
      options,
    }
  })

  if (!changed) return undefined
  return { intro: `${base.intro}\n\n${translator(locale)('clarify.improved')}`, questions: rewritten }
}

function readText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed.slice(0, maxLength)
}

/** Trích object JSON đầu tiên trong câu trả lời của model, chấp nhận cả markdown fence. */
function extractJsonObject(output: string): Record<string, unknown> | undefined {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(output)
  const text = (fence?.[1] ?? output).trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
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
