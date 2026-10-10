/**
 * Namespace `knowledge` cho catalog tiếng Việt.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `knowledge.` để không đụng namespace khác.
 *
 * Vì sao không có khoá cho đường dẫn và tiêu đề tài liệu: đó là dữ liệu người dùng
 * nhập và dữ liệu backend trả về, dịch ở client sẽ làm sai lệch khoá nhận diện tài liệu.
 *
 * Vì sao tham số đếm đặt tên `n` chứ không phải `count`: i18next coi `count` là tín
 * hiệu số ít/số nhiều nên sẽ đi tìm khoá `_one`/`_other`; catalog phẳng của dự án
 * không có các biến thể đó nên chuỗi sẽ rơi về khoá gốc.
 */
export const vi_knowledge = {
  'knowledge.loading': 'Đang tải kho kiến thức…',
  'knowledge.subtitle':
    'Soạn và tìm tài liệu nguồn cho agent. Tài liệu có vector mới được tìm bằng ngữ nghĩa.',
  'knowledge.finishSetup': 'Vào mục “Cài đặt” để hoàn tất cấu hình trước khi dùng màn hình này.',

  'knowledge.documents': 'Tài liệu',
  'knowledge.chunks': 'Đoạn (chunk)',
  'knowledge.chunksHint': 'Đơn vị nhỏ nhất được truy hồi',
  'knowledge.embedded': 'Đã có vector',
  'knowledge.keywordOnly': 'Chỉ từ khoá',
  // Ghép phiên bản và thời điểm thành một khoá: dấu phân cách giữa hai phần cũng là
  // thứ phải dịch, viết thẳng trong JSX sẽ khiến bản tiếng Anh thừa ký tự tiếng Việt.
  'knowledge.versionLine': 'v{{version}} · {{time}}',
  'knowledge.embeddedHint': '{{percent}}% tài liệu tìm được theo ngữ nghĩa',
  'knowledge.missingEmbeddings':
    'Có {{n}} tài liệu CHƯA có vector. Những tài liệu này chỉ tìm được theo từ khoá, không được xếp hạng theo ngữ nghĩa — agent có thể bỏ sót nội dung. Bấm “Đánh index lại” để xử lý.',

  'knowledge.indexStatus': 'Trạng thái index',
  'knowledge.indexStatusHint':
    'Index lại chỉ đọc tài liệu thay đổi. Chọn “bắt buộc” khi nghi ngờ vector cũ đã lệch.',
  'knowledge.reindex': 'Đánh index lại',
  'knowledge.reindexForce': 'Bắt buộc index lại',
  'knowledge.reindexResult': 'Đã index {{indexed}} tài liệu, bỏ qua {{skipped}}, tạo {{chunks}} đoạn.',
  'knowledge.reindexErrors': 'Lỗi: {{errors}}',
  'knowledge.vectorNote':
    'Tài liệu chưa có vector vẫn đọc được nội dung, nhưng tìm kiếm chỉ khớp từ khoá trong tiêu đề, đường dẫn và nội dung.',

  'knowledge.documentsByCategory': 'Danh mục tài liệu',
  'knowledge.matchCount': '{{n}} tài liệu khớp bộ lọc',
  'knowledge.newDocument': 'Tài liệu mới',
  'knowledge.searchPlaceholder': 'Tìm theo tiêu đề, đường dẫn, tag…',
  'knowledge.allCategories': 'Tất cả danh mục',
  'knowledge.empty': 'Kho kiến thức đang trống. Bấm “Tài liệu mới” để nạp tài liệu đầu tiên.',
  'knowledge.noMatch':
    'Không có tài liệu nào khớp bộ lọc hiện tại. Thử xoá từ khoá hoặc chọn “Tất cả danh mục”.',

  'knowledge.editDocument': 'Sửa tài liệu',
  'knowledge.composeDocument': 'Soạn tài liệu',
  'knowledge.pathHint':
    'Đường dẫn là khoá nhận diện tài liệu; đổi đường dẫn sẽ tạo tài liệu mới thay vì đổi tên.',
  'knowledge.selectOrCreate':
    'Chọn một tài liệu bên trái để sửa, hoặc bấm “Tài liệu mới” để soạn tài liệu mới.',
  'knowledge.titlePlaceholder': 'Tiêu đề tài liệu',
  'knowledge.markdownContent': 'Nội dung Markdown',
  'knowledge.preview': 'Xem trước',
  'knowledge.createDocument': 'Tạo tài liệu',
  'knowledge.saveChanges': 'Lưu thay đổi',
  'knowledge.discardDraft': 'Bỏ nháp',
  'knowledge.sampleContent': '# Tiêu đề\n\nNội dung…\n',

  'knowledge.needPathAndTitle': 'Cần nhập đường dẫn và tiêu đề tài liệu.',
  'knowledge.saveSuccess':
    'Đã lưu tài liệu. Tài liệu mới chưa có vector cho tới khi bấm “Đánh index lại” — trong lúc đó chỉ tìm được theo từ khoá.',
  'knowledge.saveError': 'Không lưu được tài liệu.',
  'knowledge.deleteConfirm': 'Xoá tài liệu “{{title}}”? Thao tác này không hoàn tác được.',
  'knowledge.deleteSuccess': 'Đã xoá tài liệu “{{title}}”.',
  'knowledge.deleteError': 'Không xoá được tài liệu.',
  'knowledge.reindexError': 'Không chạy được index.',
} as const
