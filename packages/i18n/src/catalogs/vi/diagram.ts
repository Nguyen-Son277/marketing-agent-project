/**
 * Namespace `diagram` cho catalog tiếng Việt.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `diagram.` để không đụng namespace khác.
 */
export const vi_diagram = {
  /* ---------------------------------------------------------- trang */
  'diagram.title': 'Sơ đồ đội agent',
  'diagram.subtitle':
    '{{enabled}}/{{total}} agent đang bật. Sơ đồ lấy dữ liệu sống từ cấu hình công ty — đổi trong màn Đội agent thì sơ đồ đổi theo.',
  'diagram.loading': 'Đang tải sơ đồ đội agent…',
  'diagram.loadFailed': 'Không tải được sơ đồ đội agent.',
  'diagram.tab.team': 'Đội agent',
  'diagram.tab.flow': 'Luồng hoạt động',

  /* ------------------------------------------------------- cấu trúc */
  'diagram.structure.title': 'Cấu trúc đội',
  'diagram.structure.subtitle': 'Mỗi agent chỉ đọc được những danh mục tri thức được cấp dưới đây.',

  /* --------------------------------------------------- phân quyền */
  'diagram.permissions.title': 'Phân quyền tri thức',
  'diagram.permissions.subtitle':
    'Ô trống nghĩa là agent KHÔNG truy xuất được nội dung trong danh mục đó. Bộ truy xuất lọc theo quyền trước khi xếp hạng, nên không có cách nào lọt qua.',
  'diagram.permissions.write': 'ghi',
  'diagram.permissions.read': 'đọc',
  'diagram.permissions.none': '–',

  /* --------------------------------------------------------- luồng */
  'diagram.flow.title': 'Một yêu cầu chạy qua những bước nào',
  'diagram.flow.subtitle': 'Đây là đường đi thật của hệ thống, không phải mô tả lý thuyết.',

  /* ------------------------------------------------------- quan hệ */
  'diagram.edges.title': 'Quan hệ trong đội',
  'diagram.edges.subtitle':
    'Leader giao việc xuống chuyên môn; chuyên môn bàn giao ngược lại; hỏi ngang hàng giới hạn 3 vòng.',
  'diagram.edges.from': 'Từ',
  'diagram.edges.to': 'Đến',
  'diagram.edges.kind': 'Loại quan hệ',
  'diagram.edges.delegates': 'Giao việc',
  'diagram.edges.handsOff': 'Bàn giao kết quả',
  'diagram.edges.peer': 'Hỏi ngang hàng',

  /* ---------------------------------------------------- nút agent */
  'diagram.agent.disabled': 'tắt',
  'diagram.agent.leaderMark': '🎯',
  'diagram.agent.model': 'Model: {{model}} · tier {{tier}}',
  'diagram.agent.modelUnassigned': 'chưa gán',
  'diagram.agent.skills': 'Kỹ năng: {{count}}',
  'diagram.agent.noSkills': '⚠️ Chưa có kỹ năng nào',
  'diagram.agent.tools': 'Công cụ: {{count}}',
  'diagram.agent.noKnowledge': '⚠️ Không đọc được danh mục tri thức nào',

  /* --------------------------------------------------------- lớp */
  'diagram.layer.leader.label': 'Lớp điều hành',
  'diagram.layer.leader.description': 'Điểm chạm duy nhất với bạn; chia việc, kiểm tra, báo cáo.',
  'diagram.layer.research.label': 'Lớp nghiên cứu & chiến lược',
  'diagram.layer.research.description': 'Tạo dữ liệu nền trước khi làm nội dung.',
  'diagram.layer.content.label': 'Lớp nội dung & sáng tạo',
  'diagram.layer.content.description': 'Biến chiến lược thành nội dung và đặc tả hình ảnh.',
  'diagram.layer.channel.label': 'Lớp kênh & thực thi',
  'diagram.layer.channel.description': 'Đưa nội dung ra kênh và vận hành quảng cáo.',
  'diagram.layer.measure.label': 'Lớp đo lường & chăm sóc',
  'diagram.layer.measure.description': 'Đo kết quả và giữ quan hệ với khách hàng.',

  // Khoá vai trò chỉ là bản dịch cho MÃ vai trò do backend trả về; `node.label` vẫn
  // được ưu tiên khi có, vì đó là tên người dùng đặt trong màn Đội agent.
  'diagram.role.marketingLeader': 'Trưởng phòng Marketing',
  'diagram.role.marketResearch': 'Nghiên cứu thị trường',
  'diagram.role.contentWriter': 'Viết nội dung',
  'diagram.role.seoTechnical': 'SEO kỹ thuật',
  'diagram.role.socialMedia': 'Social Media',
  'diagram.role.paidMedia': 'Quảng cáo trả phí',
  'diagram.role.emailCrm': 'Email & CRM',
  'diagram.role.designVideo': 'Thiết kế & Video',
  'diagram.role.analytics': 'Phân tích & Báo cáo',
  'diagram.role.communityCare': 'Chăm sóc cộng đồng',
} as const
