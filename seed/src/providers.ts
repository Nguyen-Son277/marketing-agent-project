/**
 * Guardrail mặc định của công ty.
 *
 * Vì sao tệp này KHÔNG còn khai báo provider/model: nhà cung cấp, khoá API và model
 * giờ do người dùng tự nhập trong giao diện Cài đặt. Seed sẵn một provider trỏ tới
 * biến môi trường từng là nguồn lỗi thật — cài xong mà quên điền `.env` thì mọi lượt
 * chạy hỏng, còn giao diện thì không có gì để sửa. Bỏ hẳn để chỉ còn một nguồn sự thật.
 */

/** Default guardrails, overridable per company in `app_settings`. */
export const DEFAULT_BUDGET = {
  /** Max USD a company may spend per calendar day before work is refused. */
  dailyCostUsd: 20,
  /** Max USD a single conversational task may spend before it is paused. */
  taskCostUsd: 2,
  /** Max model steps one agent run may take. */
  maxStepsPerRun: 12,
  /** Max peer agent-to-agent question rounds per task. */
  maxPeerRounds: 3,
  /** Max review/revision loops before the leader must decide. */
  maxRevisionsPerTask: 2,
} as const
