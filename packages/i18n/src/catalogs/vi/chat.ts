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
  'chat.composerLabel': 'Tin nhắn gửi Leader',
  'chat.composerHint': 'Enter để gửi · Shift+Enter để xuống dòng',
  'chat.sending': 'Đang gửi tin nhắn',
  'chat.addFiles': 'Đính kèm',
  'chat.attachments': 'Tệp đính kèm',
  'chat.attachmentFormats': 'Định dạng và giới hạn tệp',
  'chat.attachmentHint': 'Dán ảnh bằng Ctrl+V hoặc kéo thả file · PDF, DOCX, TXT, MD, CSV, JSON, PNG, JPG, WebP · Tối đa 5 tệp, 10 MiB/tệp (ảnh 5 MiB), tổng 20 MiB.',
  'chat.attachmentUploading': 'Đang tải và đọc tệp…',
  'chat.removeAttachment': 'Xoá tệp {{name}}',
  'chat.openAttachment': 'Mở / tải tệp gốc',
  'chat.attachmentsAnalyzed': 'Leader đã phân tích nội dung đính kèm.',
  'chat.attachmentsCount': 'Mỗi tin nhắn tối đa 5 tệp đính kèm.',
  'chat.attachmentsType': 'Hỗ trợ PDF, DOCX, TXT, MD, CSV, JSON và ảnh PNG, JPG, WebP.',
  'chat.attachmentsSize': 'Tệp phải có nội dung và không quá 10 MiB; ảnh không quá 5 MiB.',
  'chat.attachmentsTotal': 'Tổng dung lượng đính kèm không được quá 20 MiB.',
  /* ------------------------------------------------- khung màn hình */
  'chat.loadingList': 'Đang tải cuộc trao đổi…',
  'chat.conversations': 'Cuộc trao đổi',
  'chat.newConversation': 'Tạo cuộc trao đổi mới',
  // Tiêu đề mặc định của cuộc mới nằm trong catalog vì nó được lưu xuống máy chủ:
  // nếu hard-code tiếng Việt thì cuộc tạo lúc dùng tiếng Anh vẫn mang tên tiếng Việt.
  'chat.newConversationTitle': 'Cuộc trao đổi mới',
  // Danh sách cuộc trao đổi giờ mở ra khi cần, nên có nút riêng để mở và nút để đóng.
  'chat.listConversations': 'Danh sách cuộc trao đổi',
  'chat.closeList': 'Đóng danh sách',
  // Câu này phải nhắc ĐÚNG tên nút đang có trên màn hình. Trước đây nó nói "Bấm +" nhưng nút
  // "+" đã bị thay bằng nút "Tạo cuộc trao đổi mới" — hướng dẫn sai chỗ thì người dùng đi tìm
  // một thứ không tồn tại.
  'chat.emptyList': 'Chưa có cuộc trao đổi nào. Bấm "Tạo cuộc trao đổi mới" để bắt đầu.',
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
  'chat.viewPlan': 'Xem kế hoạch ({{count}})',
  'chat.viewPlanHint': 'Mở danh sách công việc trong hộp thoại',
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
  'chat.rename': 'Đổi tên',
  'chat.renameTitle': 'Đổi tên cuộc trao đổi',
  'chat.renameLabel': 'Tên cuộc trao đổi',
  'chat.renameSuccess': 'Đã đổi tên cuộc trao đổi.',
  'chat.delete': 'Xoá cuộc trao đổi',
  'chat.deleteTitle': 'Xoá cuộc trao đổi',
  'chat.deleteConfirm': 'Bạn có chắc chắn muốn xoá cuộc trao đổi “{{title}}”? Toàn bộ tin nhắn và tệp đính kèm trong cuộc trao đổi này sẽ bị xoá vĩnh viễn.',
  'chat.deleteTasksOption': 'Xoá các công việc liên quan đến cuộc trao đổi này',
  'chat.deleteTasksOptionHint': 'Nếu không chọn, các công việc đã lập vẫn được giữ lại trong danh sách công việc.',
  'chat.deleteSuccess': 'Đã xoá cuộc trao đổi.',
  'chat.errorDeleteConversation': 'Không xoá được cuộc trao đổi.',
  'chat.errorUpdateConversation': 'Không đổi được tên cuộc trao đổi.',

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

  /* -------------------------------------------- thẻ chọn phương án */
  // Câu hỏi và nhãn phương án đến từ server (đã dịch theo ngôn ngữ cuộc trao đổi) nên
  // không nằm ở đây; các khoá dưới chỉ là câu chữ cố định của khung thẻ.
  'chat.scrollToLatest': 'Xuống tin mới nhất',
  'chat.exclusiveTag': 'không làm',
  // Đếm dạng nhãn thay vì câu đầy đủ: catalog phẳng không có dạng số nhiều, nên viết
  // "Câu hỏi: 3" để tiếng Anh không bao giờ ra "1 questions".
  'chat.questionCount': 'Câu hỏi: {{count}}',
  'chat.sendAnswers': 'Gửi câu trả lời',
  'chat.skipAnswers': 'Bỏ qua, tôi trả lời tự do',
  // Nội dung gửi thay khi người dùng bấm bỏ qua mà chưa gõ gì vào ô nhập chính.
  'chat.skipAnswersMessage': 'Tôi sẽ trả lời tự do.',
  'chat.answersSent': 'Bạn đã trả lời câu hỏi này.',
  // Nói rõ vì sao nút gửi đang khoá: nút chết không lời giải thích là trải nghiệm tệ.
  'chat.answersRequired': 'Chọn ít nhất một phương án hoặc ghi ý kiến riêng để gửi.',
} as const
