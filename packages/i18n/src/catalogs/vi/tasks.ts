/**
 * Namespace `tasks` cho catalog tiếng Việt.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `tasks.` để không đụng namespace khác.
 */
export const vi_tasks = {
  /* ---------------------------------------------------------- khung màn hình */
  'tasks.subtitle': 'Mỗi cột là một trạng thái. Bấm một thẻ để xem chi tiết và phê duyệt ngay tại đây.',
  'tasks.loadingList': 'Đang tải danh sách công việc…',
  'tasks.loadingDetail': 'Đang tải chi tiết…',
  'tasks.empty':
    'Chưa có công việc nào. Vào mục “Trao đổi với Leader”, mô tả mục tiêu rồi để Leader lập kế hoạch và giao việc.',
  'tasks.unassigned': 'Chưa giao',
  'tasks.revisionCount': 'Đã sửa {{count}} lần',

  /* ------------------------------------------------------------ mức ưu tiên */
  // Số ưu tiên do dữ liệu quyết định; chỉ mức độ mới là câu chữ nên mới cần dịch.
  'tasks.priorityHighest': 'Ưu tiên {{priority}} · cao nhất',
  'tasks.priorityHigh': 'Ưu tiên {{priority}} · cao',
  'tasks.priorityMedium': 'Ưu tiên {{priority}} · trung bình',
  'tasks.priorityLow': 'Ưu tiên {{priority}} · thấp',

  /* ----------------------------------------------------------- chi tiết việc */
  'tasks.detailTitle': 'Chi tiết công việc: {{title}}',
  'tasks.detailTitlePlain': 'Chi tiết công việc',
  'tasks.metaCreatedUpdated': 'Tạo {{created}} · Cập nhật {{updated}}',
  // Tách dấu phân cách vào chính khoá: ghép `' · '` trong JSX sẽ là ký tự ngoài ASCII
  // nằm ngoài catalog, đúng chỗ mà tiêu chí nghiệm thu cấm.
  'tasks.metaDeadlineSuffix': ' · Hạn {{deadline}}',
  'tasks.result': 'Kết quả',
  'tasks.dependsOn': 'Phụ thuộc',
  'tasks.blocks': 'Việc đang chờ công việc này',
  'tasks.artifacts': 'Artifact ({{count}})',
  'tasks.agentMessages': 'Trao đổi giữa các agent ({{count}})',
  'tasks.timeline': 'Dòng thời gian sự kiện',
  'tasks.approval': 'Phê duyệt',

  /* ------------------------------------------------------------- chỗ trống */
  'tasks.noBrief': 'Chưa có brief.',
  'tasks.deliverable': 'Sản phẩm cần giao: {{spec}}',
  'tasks.noResult': 'Agent chưa gửi kết quả cho công việc này.',
  'tasks.noDependencies': 'Không phụ thuộc việc nào.',
  'tasks.noBlocks': 'Không chặn việc nào.',
  'tasks.noArtifacts': 'Chưa có artifact nào được tạo.',
  'tasks.filePath': 'Tệp: {{path}}',
  'tasks.noAttachment': 'Không có nội dung đính kèm.',
  'tasks.noAgentMessages': 'Hai agent chưa trao đổi gì về công việc này.',
  'tasks.noEvents': 'Chưa ghi nhận sự kiện nào.',

  /* --------------------------------------------------------------- phê duyệt */
  'tasks.noteHint':
    'Ghi chú là tuỳ chọn, nhưng bắt buộc nên có khi yêu cầu sửa để agent biết cần đổi gì.',
  'tasks.notePlaceholder': 'Ví dụ: phần ngân sách chưa khớp với KPI đã chốt.',
  'tasks.approve': 'Duyệt',
  'tasks.requestChanges': 'Yêu cầu sửa',
  'tasks.cancelTask': 'Huỷ công việc',
  // Mỗi quyết định một câu trọn vẹn: ghép “Đã duyệt” + tên việc ở nơi gọi sẽ khoá cứng
  // trật tự từ, mà tiếng Anh cần trật tự khác.
  'tasks.decisionApproved': 'Đã duyệt công việc “{{title}}”.',
  'tasks.decisionChangesRequested': 'Đã yêu cầu sửa công việc “{{title}}”.',
  'tasks.decisionCancelled': 'Đã huỷ công việc “{{title}}”.',
  'tasks.terminalNotice': 'Công việc ở trạng thái “{{status}}” nên không còn hành động duyệt.',
  'tasks.errorReview': 'Không gửi được quyết định duyệt.',
} as const
