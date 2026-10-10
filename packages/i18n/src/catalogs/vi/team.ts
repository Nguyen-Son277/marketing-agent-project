/**
 * Namespace `team` cho catalog tiếng Việt.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `team.` để không đụng namespace khác.
 *
 * Vì sao tên agent, tên vai trò và mô tả agent KHÔNG có khoá ở đây: chúng đến từ
 * backend và là dữ liệu riêng của từng công ty, dịch ở client sẽ làm sai lệch dữ liệu
 * đã lưu. Chỉ nhãn, nút và thông báo do giao diện tự viết mới nằm trong catalog.
 *
 * Vì sao tham số đếm đặt tên `n` chứ không phải `count`: i18next coi `count` là tín
 * hiệu số ít/số nhiều nên sẽ đi tìm khoá `_one`/`_other`; catalog phẳng của dự án
 * không có các biến thể đó nên chuỗi sẽ rơi về khoá gốc.
 */
export const vi_team = {
  'team.loading': 'Đang tải cấu hình đội…',
  'team.subtitle':
    'Bật/tắt agent, chọn model, gán kỹ năng, tool và quyền đọc/ghi kho kiến thức. Mỗi agent lưu riêng.',
  'team.finishSetup': 'Vào mục “Cài đặt” để hoàn tất cấu hình trước khi dùng màn hình này.',

  'team.enabledAgents': 'Agent đang bật',
  'team.availableSkills': 'Kỹ năng khả dụng',
  'team.availableSkillsHint': 'Hệ thống biết',
  'team.availableTools': 'Tool khả dụng',
  'team.availableToolsHint': 'Trong bản triển khai này',
  'team.needsApproval': 'Cần phê duyệt',
  'team.needsApprovalHint': 'Tool không tự chạy khi chưa được duyệt',
  // Phần hậu tố trên nút tool: dấu phân cách đứng trước cũng là chuỗi giao diện nên
  // nằm trong catalog để mã màn hình không lẫn ký tự ngoài ASCII.
  'team.toolApprovalMark': ' · cần duyệt',

  'team.noSkillsTitle': 'Agent không có kỹ năng nào:',
  'team.noSkillsBody':
    '{{members}}. Agent không có kỹ năng sẽ không nhận được phương pháp làm việc nào; hãy gán ít nhất một kỹ năng.',
  'team.noCategoriesTitle': 'Agent không đọc được danh mục kiến thức nào:',
  'team.noCategoriesBody':
    '{{members}}. Các agent này sẽ bị lọc sạch kết quả tìm kiếm kho kiến thức; hãy cấp quyền đọc tối thiểu một danh mục.',
  'team.empty': 'Chưa có agent nào trong công ty này. Hãy kiểm tra lại bước khởi tạo công ty.',

  'team.enabled': 'Đang bật',
  'team.collapse': 'Thu gọn',
  'team.configure': 'Cấu hình',
  'team.currentTier': 'Tier hiện tại: {{tier}}',
  'team.modelLabel': 'Model: {{model}}',
  // Ghép tên model với nhà cung cấp trong catalog: dấu phân cách cũng phải dịch được,
  // viết thẳng trong JSX sẽ khiến mã nguồn màn hình lẫn ký tự ngoài ASCII.
  'team.modelOption': '{{model}} · {{provider}}',
  'team.defaultByTier': 'mặc định theo tier',
  'team.providerLabel': 'Nhà cung cấp: {{provider}}',
  // Dấu gạch dài cho giá trị trống nằm trong catalog chứ không viết thẳng trong mã:
  // màn hình phải sạch ký tự ngoài ASCII, và một số ngôn ngữ cần dấu khác.
  'team.noValue': '—',
  'team.skillCount': '{{n}} kỹ năng',
  'team.toolCount': '{{n}} tool',
  'team.readableCategories': '{{n}} danh mục đọc được',
  'team.contextBudget': 'Ngân sách ngữ cảnh: {{n}} token',

  'team.saveSuccess': 'Đã lưu cấu hình cho {{name}}.',
  'team.saveError': 'Không lưu được cấu hình.',
  'team.memberNoSkills': 'Agent này chưa được gán kỹ năng nào.',
  'team.memberNoCategories': 'Agent này không đọc được danh mục kiến thức nào.',

  'team.skillsHeading': 'Kỹ năng ({{n}})',
  'team.toolsHeading': 'Tool ({{n}})',
  'team.useTierDefault': '— Dùng model mặc định của tier —',
  'team.modelHint':
    'Model không hỗ trợ tool-call sẽ bị router tự động đổi sang model khác cùng tier.',
  'team.tierHint': 'Tier quyết định model dự phòng khi agent không gán model cứng.',
  'team.toolNote':
    'Các tool ghi ra kênh ngoài (đăng bài, gửi email, chạy quảng cáo) đều đánh dấu “cần duyệt”: agent chỉ tạo bản nháp, con người duyệt ở màn “Công việc” rồi mới thực thi.',

  'team.permissionMatrix': 'Ma trận phân quyền kiến thức',
  'team.category': 'Danh mục',
  'team.read': 'Đọc',
  'team.write': 'Ghi',
  'team.matrixHint':
    'Quyền đọc được lọc TRƯỚC khi xếp hạng tìm kiếm: agent thiếu quyền sẽ không nhận được mẩu kiến thức nào từ danh mục đó.',
} as const
