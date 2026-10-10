/**
 * Sự kiện phát ra trong quá trình điều phối.
 *
 * Vì sao định nghĩa ở đây thay vì dùng thẳng kiểu của server: orchestrator không
 * được phụ thuộc vào `apps/server` (tầng trên không bao giờ bị tầng dưới import
 * ngược). Server chuyển tiếp những sự kiện này ra SSE, nên cấu trúc phải khớp —
 * và việc khớp đó được kiểm bằng test thay vì bằng niềm tin.
 */
export interface AppEvent {
  readonly type: OrchestratorEventType
  readonly companyId: string
  readonly payload: unknown
  readonly at: string
}

export const ORCHESTRATOR_EVENT_TYPES = [
  /** Leader bắt đầu/kết thúc một lượt suy nghĩ. */
  'leader.thinking',
  'leader.replied',
  /** Brief đã đủ hoặc còn thiếu trường. */
  'brief.updated',
  /** Kế hoạch được tạo. */
  'plan.created',
  /** Một task đổi trạng thái. */
  'task.updated',
  /** Agent chuyên môn bắt đầu chạy. */
  'agent.started',
  /** Một công cụ đã được gọi. */
  'tool.called',
  /** Tài sản đầu ra mới. */
  'artifact.created',
  /** Trao đổi giữa các agent. */
  'agent.message',
  /** Kết quả kiểm tra chất lượng. */
  'review.completed',
  /** Báo cáo cuối cùng đã sẵn sàng. */
  'report.created',
  /** Lỗi không chặn cả lượt chạy. */
  'warning',
] as const

export type OrchestratorEventType = (typeof ORCHESTRATOR_EVENT_TYPES)[number]

/** Helpers dựng sự kiện, để nơi phát không tự ghép chuỗi và timestamp. */
export function event(
  type: OrchestratorEventType,
  companyId: string,
  payload: unknown,
): AppEvent {
  return { type, companyId, payload, at: new Date().toISOString() }
}
