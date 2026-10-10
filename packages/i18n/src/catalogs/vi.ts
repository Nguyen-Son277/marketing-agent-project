import { vi_clarify } from './vi/clarify.ts'
import { vi_errors } from './vi/errors.ts'
import { vi_chat } from './vi/chat.ts'
import { vi_tasks } from './vi/tasks.ts'
import { vi_team } from './vi/team.ts'
import { vi_knowledge } from './vi/knowledge.ts'
import { vi_settings } from './vi/settings.ts'
import { vi_costs } from './vi/costs.ts'
import { vi_diagram } from './vi/diagram.ts'

/**
 * Catalog tiếng Việt — NGUỒN SỰ THẬT của mọi chuỗi giao diện.
 *
 * Vì sao tiếng Việt là nguồn: đây là ngôn ngữ gốc của dự án, nên khoá sinh ra từ câu
 * tiếng Việt thật đang chạy chứ không phải từ bản dịch ngược. Thêm chuỗi mới thì thêm
 * ở đây trước; `en.ts` báo lỗi biên dịch nếu thiếu.
 *
 * Vì sao khoá PHẲNG có dấu chấm thay vì object lồng nhau: kiểu khoá chỉ là
 * `keyof typeof vi`, đơn giản và không thể sai. Với object lồng nhau, muốn suy ra
 * union của mọi đường dẫn phải viết một kiểu đệ quy — phức tạp hơn, chậm hơn, và
 * chính chỗ đó là nơi lỗi kiểu hay trú ngụ.
 *
 * Quy ước đặt khoá:
 *  - nhóm theo màn hình hoặc miền nghiệp vụ (`common.*`, `nav.*`, `auth.*`, …)
 *  - tên khoá mô tả VAI TRÒ của chuỗi, không mô tả nội dung, để đổi câu chữ không phải
 *    đổi khoá (`common.save` chứ không phải `common.luuLai`)
 *  - tham số nội suy viết `{{ten}}`; không ghép chuỗi bằng tay ở nơi gọi
 */
export const vi = {
  /* ------------------------------------------------------------- chung */
  'common.loading': 'Đang tải…',
  'common.loadingData': 'Đang tải số liệu…',
  'common.retry': 'Thử lại',
  'common.save': 'Lưu',
  'common.saved': 'Đã lưu',
  'common.cancel': 'Huỷ',
  'common.close': 'Đóng',
  'common.edit': 'Sửa',
  'common.create': 'Tạo mới',
  'common.delete': 'Xoá',
  'common.refresh': 'Tải lại',
  'common.confirm': 'Xác nhận',
  'common.search': 'Tìm kiếm',
  'common.none': 'Không có',
  'common.unknown': 'Không rõ',
  'common.yes': 'Có',
  'common.no': 'Không',
  'common.all': 'Tất cả',
  'common.actions': 'Thao tác',
  'common.status': 'Trạng thái',
  'common.createdAt': 'Tạo lúc',
  'common.updatedAt': 'Cập nhật',
  'common.name': 'Tên',
  'common.description': 'Mô tả',
  'common.optional': 'không bắt buộc',
  'common.required': 'bắt buộc',
  'common.copied': 'Đã sao chép',
  'common.cannotConnectServer': 'Không kết nối được máy chủ.',
  'common.serverReturnedError': 'Máy chủ trả lỗi: {{message}}',
  'common.emptySection': 'Chưa có dữ liệu.',
  'common.unexpectedError': 'Đã xảy ra lỗi không mong đợi.',
  'common.sessionChecking': 'Đang kiểm tra phiên đăng nhập…',

  /* -------------------------------------------------------- điều hướng */
  'nav.brand': 'Đội Agent Marketing',
  'nav.group.work': 'Làm việc',
  'nav.group.config': 'Cấu hình',
  'nav.group.monitor': 'Theo dõi',
  'nav.dashboard': 'Bảng điều khiển',
  'nav.chat': 'Trao đổi với Leader',
  'nav.tasks': 'Công việc',
  'nav.team': 'Đội agent',
  'nav.knowledge': 'Kho kiến thức',
  'nav.settings': 'Cài đặt',
  'nav.costs': 'Chi phí',
  'nav.diagram': 'Sơ đồ đội agent',
  'nav.signOut': 'Đăng xuất',
  'nav.switchCompany': 'Chọn công ty',

  /* ------------------------------------------------------ ngôn ngữ */
  'locale.label': 'Ngôn ngữ',
  'locale.switchTo': 'Chuyển sang {{name}}',
  'locale.current': 'Đang dùng {{name}}',

  /* ------------------------------------------------- trạng thái việc */
  'taskStatus.draft': 'Nháp',
  'taskStatus.assigned': 'Đã giao',
  'taskStatus.in_progress': 'Đang chạy',
  'taskStatus.blocked': 'Bị chặn',
  'taskStatus.review': 'Chờ duyệt',
  'taskStatus.done': 'Hoàn tất',
  'taskStatus.failed': 'Thất bại',
  'taskStatus.cancelled': 'Đã huỷ',

  /* ------------------------------------------------ giai đoạn phiên */
  'phase.intake': 'Tiếp nhận',
  'phase.clarify': 'Làm rõ',
  'phase.brief': 'Đã chốt brief',
  'phase.plan': 'Lập kế hoạch',
  'phase.assign': 'Giao việc',
  'phase.execute': 'Đang thực hiện',
  'phase.review': 'Kiểm tra',
  'phase.report': 'Đã có báo cáo',
  'phase.closed': 'Đã đóng',

  /* -------------------------------------------------- danh mục tri thức */
  'kbCategory.00-cong-ty': 'Công ty & sản phẩm',
  'kbCategory.10-brand': 'Thương hiệu & giọng nói',
  'kbCategory.20-thi-truong': 'Thị trường & đối thủ',
  'kbCategory.30-kenh': 'Kênh & playbook',
  'kbCategory.40-du-lieu': 'Dữ liệu & hiệu suất',
  'kbCategory.90-ket-qua': 'Kết quả & tài sản',

  /* ---------------------------------------------------------- model */
  'modelTier.light': 'Nhẹ',
  'modelTier.standard': 'Tiêu chuẩn',
  'modelTier.deep': 'Suy luận sâu',

  /* ------------------------------------------------------- đăng nhập */
  'auth.title': 'Đội Agent Marketing',
  'auth.subtitle':
    'Mỗi công ty có một vùng làm việc riêng, một kho kiến thức và một đội agent do Leader điều phối.',
  'auth.email': 'Email',
  'auth.password': 'Mật khẩu',
  'auth.displayName': 'Tên hiển thị',
  'auth.passwordHint': 'Tối thiểu 10 ký tự.',
  'auth.login': 'Đăng nhập',
  'auth.register': 'Tạo tài khoản',
  'auth.toRegister': 'Chưa có tài khoản?',
  'auth.toLogin': 'Đã có tài khoản?',
  'auth.needCredentials': 'Cần nhập email và mật khẩu.',
  'auth.passwordTooShort': 'Mật khẩu cần ít nhất 10 ký tự.',
  'auth.emailPlaceholder': 'ban@congty.vn',
  'auth.namePlaceholder': 'Nguyễn Văn A',
  'auth.defaultUserName': 'Người dùng',

  /* --------------------------------------------------- chọn công ty */
  'company.chooseTitle': 'Chọn công ty',
  'company.chooseSubtitle':
    'Mỗi công ty là một vùng làm việc riêng: kho kiến thức, đội agent và lịch sử công việc độc lập.',
  'company.yours': 'Công ty của bạn',
  'company.role': 'vai trò {{role}}',
  'company.createTitle': 'Tạo công ty mới',
  'company.createHint': 'Đội 10 agent và kho kiến thức 6 danh mục sẽ được tạo kèm.',
  'company.name': 'Tên công ty',
  'company.namePlaceholder': 'Công ty TNHH An Phát',
  'company.createAndStart': 'Tạo công ty và bắt đầu',
  'company.needName': 'Cần nhập tên công ty.',
  'company.systemNotReady':
    'Hệ thống chưa sẵn sàng: {{problem}}. Quản trị viên cần chạy pnpm db:seed trên máy chủ.',

  /* ------------------------------------------------- bảng điều khiển */
  'dashboard.title': 'Bảng điều khiển',
  'dashboard.subtitle': 'Tình hình đội agent và công việc của {{company}}.',
  'dashboard.tasksByStatus': 'Công việc theo trạng thái',
  'dashboard.tasksHint': 'Nháp, đã giao, đang chạy, bị chặn, chờ duyệt',
  'dashboard.openTasks': 'Việc đang mở',
  'dashboard.doneTasks': 'Việc hoàn tất',
  'dashboard.needAttention': 'còn việc phải theo',
  'dashboard.throughReview': 'Đã qua bước duyệt',
  'dashboard.agentsEnabled': 'Agent đang bật',
  'dashboard.agentsReady': 'Sẵn sàng nhận việc',
  'dashboard.noAgents': 'Không agent nào chạy được',
  'dashboard.documents': 'Tài liệu',
  'dashboard.inKnowledgeBase': 'Trong kho kiến thức',
  'dashboard.conversations': 'Cuộc trao đổi',
  'dashboard.withLeader': 'Với Leader',
  'dashboard.costToday': 'Chi phí hôm nay',
  'dashboard.noDailyLimit': 'Chưa đặt trần chi phí ngày',
  'dashboard.recentActivity': 'Hoạt động gần đây',
  'dashboard.recentHint': 'Sự kiện mới nhất trong công ty, mới nhất ở trên.',
  'dashboard.quickActions': 'Hành động nhanh',
  'dashboard.quickHint': 'Đường tắt tới hai việc hay làm nhất.',
  'dashboard.openChat': 'Trao đổi với Leader',
  'dashboard.viewTasks': 'Xem công việc',
  'dashboard.viewTasksHint': 'Bấm “Xem công việc” để mở bảng kanban đầy đủ.',
  'dashboard.finishSetup': 'Vào mục “Cài đặt” để hoàn tất cấu hình trước khi dùng màn hình này.',
  'dashboard.costLimits': 'Trần chi phí mỗi ngày: {{limit}} · 30 ngày qua: {{last30}}',
  'dashboard.costUsedPercent': 'Đã dùng {{percent}}% trần ngày',
  'dashboard.costCapReached': 'Đã chạm trần chi phí ngày. Các lượt chạy mới sẽ bị dừng cho tới khi trần được nâng ở mục “Cài đặt”.',
  'dashboard.noActivity': 'Chưa có hoạt động nào. Hãy bắt đầu bằng một cuộc trao đổi với Leader.',
  'dashboard.systemNotReadyTitle': 'Hệ thống chưa sẵn sàng:',

  /* ------------------------------------- chuỗi riêng từng màn hình */
  // Mỗi màn hình một file để nhiều người bổ sung song song mà không xung đột.
  ...vi_errors,
  ...vi_clarify,
  ...vi_chat,
  ...vi_tasks,
  ...vi_team,
  ...vi_knowledge,
  ...vi_settings,
  ...vi_costs,
  ...vi_diagram,
} as const

/** Kiểu của catalog; dùng để bắt catalog tiếng Anh phải phủ đủ khoá. */
export type Catalog = Record<keyof typeof vi, string>
