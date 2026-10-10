/**
 * Namespace `chat` cho catalog tiếng Việt.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `chat.` để không đụng namespace khác.
 */
export const vi_chat = {
  /* ------------------------------------------------- khung màn hình */
  'chat.loadingList': 'Đang tải cuộc trao đổi…',
  'chat.conversations': 'Cuộc trao đổi',
  'chat.newConversation': 'Tạo cuộc trao đổi mới',
  // Tiêu đề mặc định của cuộc mới nằm trong catalog vì nó được lưu xuống máy chủ:
  // nếu hard-code tiếng Việt thì cuộc tạo lúc dùng tiếng Anh vẫn mang tên tiếng Việt.
  'chat.newConversationTitle': 'Cuộc trao đổi mới',
  'chat.emptyList': 'Chưa có cuộc trao đổi nào. Bấm + để bắt đầu.',
  'chat.listMeta': '{{phase}} · {{date}}',
  'chat.chooseConversation': 'Chọn hoặc tạo một cuộc trao đổi để bắt đầu.',
  'chat.emptyChat':
    'Hãy mô tả mục tiêu marketing của bạn. Leader sẽ hỏi thêm cho tới khi đủ thông tin để lập kế hoạch.',
  'chat.metaLine': 'Giai đoạn {{phase}} · chi phí {{cost}} · {{runs}} lượt chạy',
  'chat.authorYou': 'Bạn',
  'chat.authorSystem': 'Hệ thống',
  'chat.placeholder': 'Ví dụ: Lập kế hoạch content tháng 11 cho sản phẩm Sapa POS, mục tiêu 50 lead',
  'chat.send': 'Gửi',

  /* ------------------------------------------- ba hành động không hoàn tác */
  'chat.plan': 'Lập kế hoạch',
  'chat.planHint': 'Leader chia công việc từ brief đã chốt',
  'chat.run': 'Chạy kế hoạch',
  'chat.runNeedsPlan': 'Cần lập kế hoạch trước',
  'chat.runHint': 'Các agent chuyên môn bắt đầu làm việc',
  'chat.report': 'Viết báo cáo',
  'chat.reportHint': 'Tổng hợp báo cáo cuối cùng',

  /* ------------------------------------------------------ tình trạng brief */
  'chat.briefMissingPrefix': 'Leader chưa đủ thông tin để lập kế hoạch. Còn thiếu:',
  'chat.briefMissingSuffix': '. Hãy trả lời các câu hỏi của Leader ở khung bên dưới.',
  'chat.briefMissingUnknown': 'chưa xác định',
  'chat.briefCompleteHint': 'Đã đủ thông tin để lập kế hoạch. Bấm “Lập kế hoạch” ở trên.',
  'chat.leaderNeedsMore': 'Leader cần thêm: {{fields}}',
  // Nhãn trường brief do giao diện quyết định (khác BRIEF_FIELD_LABELS của orchestrator
  // vốn là câu hỏi dài): ở đây chỉ cần một từ để ghép vào danh sách còn thiếu.
  'chat.briefField.objective': 'Mục tiêu',
  'chat.briefField.kpi': 'KPI',
  'chat.briefField.scope': 'Phạm vi',
  'chat.briefField.deadline': 'Thời hạn',
  'chat.briefField.budget': 'Ngân sách',
  'chat.briefField.constraints': 'Ràng buộc',

  /* ----------------------------------------------------------- bảng kế hoạch */
  'chat.planTitle': 'Kế hoạch',
  'chat.planSubtitle': 'Bấm tab Công việc để xem chi tiết từng việc.',
  'chat.tableTask': 'Công việc',
  'chat.tableSpecialist': 'Chuyên môn',
  'chat.tableDependsOn': 'Phụ thuộc',

  /* ------------------------------------------------------- kết quả hành động */
  'chat.planCreated': 'Đã lập kế hoạch {{count}} công việc. Bấm “Chạy kế hoạch” để đội bắt đầu làm.',
  'chat.runFinished': 'Đội đã chạy xong kế hoạch. Xem tab Công việc để biết chi tiết từng việc.',
  'chat.reportCreated': 'Đã tạo báo cáo (tài sản {{artifactId}}).',

  /* ---------------------------------------------------------------- lỗi */
  'chat.errorLoadList': 'Không tải được danh sách trao đổi.',
  'chat.errorLoadConversation': 'Không tải được cuộc trao đổi.',
  'chat.errorCreateConversation': 'Không tạo được cuộc trao đổi.',
  'chat.errorSendMessage': 'Không gửi được tin nhắn.',
  'chat.errorStep': 'Không thực hiện được bước này.',

  /* --------------------------------------------------- nhật ký sự kiện SSE */
  'chat.event.leaderThinking': '🎯 Leader đang phân tích yêu cầu…',
  'chat.event.leaderReplied': '🎯 Leader đã trả lời.',
  'chat.event.planCreated': '🗂️ Đã tạo kế hoạch gồm {{count}} công việc.',
  'chat.event.agentStarted': '▶️ {{role}} bắt đầu: {{title}}',
  'chat.event.toolCalled': '🔧 {{role}} gọi {{tool}}',
  // Tách khỏi `chat.event.toolCalled` thay vì ghép hậu tố tại chỗ: tiếng Anh có thể cần
  // trật tự từ khác, và ghép chuỗi trong mã là chỗ hay quên dịch.
  'chat.event.toolCalledFailed': '🔧 {{role}} gọi {{tool}} (lỗi)',
  'chat.event.taskUpdated': '📌 {{title}} → {{status}}',
  'chat.event.taskUpdatedReason': '📌 {{title}} → {{status}}: {{reason}}',
  'chat.event.artifactCreated': '📄 Có tài sản đầu ra mới.',
  'chat.event.agentMessage': '💬 {{from}} → {{to}} ({{kind}})',
  'chat.event.reviewPassed': '🔍 Kiểm tra chất lượng: đạt',
  'chat.event.reviewNeedsFix': '🔍 Kiểm tra chất lượng: cần sửa',
  'chat.event.reportCreated': '📊 Báo cáo cuối cùng đã sẵn sàng.',
  'chat.event.briefComplete': '✅ Đã chốt đủ thông tin brief.',
  'chat.event.briefIncomplete': '❓ Cần bổ sung thông tin cho brief.',
  'chat.event.warning': '⚠️ {{message}}',
  'chat.event.systemWarning': 'Có cảnh báo từ hệ thống.',
} as const
