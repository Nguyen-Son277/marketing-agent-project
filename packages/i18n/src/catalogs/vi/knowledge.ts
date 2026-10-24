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
  'knowledge.classificationModel': 'Model phân loại kiến thức',
  'knowledge.modelStatusError': 'Không tải được cấu hình model phân loại.',
  'knowledge.modelCustom': 'Dùng model riêng cho phân loại',
  'knowledge.modelLeader': 'Kế thừa model Marketing Leader',
  'knowledge.modelPrimary': 'Model chính',
  'knowledge.modelFallback': 'Model dự phòng',
  'knowledge.modelLastUsed': 'Lần gần nhất đã gọi',
  'knowledge.modelMissing': 'Chưa chọn model phân loại khả dụng.',
  'knowledge.configureModel': 'Mở Cài đặt model phân loại',
  'knowledge.loading': 'Đang tải kho kiến thức…',
  'knowledge.subtitle':
    'Tải file kiến thức công ty lên để AI tìm nội dung và trích dẫn nguồn. Hỗ trợ cả tài liệu Markdown soạn tay.',
  'knowledge.finishSetup': 'Vào mục “Cài đặt” để hoàn tất cấu hình trước khi dùng màn hình này.',

  'knowledge.documents': 'Tài liệu',
  'knowledge.chunks': 'Đoạn (chunk)',
  'knowledge.chunksHint': 'Đơn vị nhỏ nhất được truy hồi',
  'knowledge.embedded': 'Đã có vector',
  'knowledge.keywordOnly': 'Chỉ từ khoá',
  'knowledge.processingCount': 'Đang phân loại',
  'knowledge.failedCount': 'Phân loại thất bại',
  'knowledge.readyNoVectors': 'Sẵn sàng, chưa có vector',
  'knowledge.noSearchableData': 'Chưa có dữ liệu tìm kiếm',
  'knowledge.noVectorsYet': 'Chưa có vector',
  'knowledge.processingNoSearch': 'Đang phân loại; chưa có dữ liệu để tìm kiếm.',
  'knowledge.retryBackoff': 'Sẽ thử lại sau {{time}}.',
  'knowledge.retryFailed': 'Thử lại các tài liệu lỗi',
  'knowledge.retryResult': 'Đã xếp hàng {{queued}}, đang xử lý {{processing}}, còn lỗi {{failed}}.',
  'knowledge.reindexClassificationResult': 'Phân loại: xếp hàng {{queued}}, đang xử lý {{processing}}, thất bại {{failed}}.',
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
  'knowledge.empty': 'Kho kiến thức đang trống. Tải file kiến thức công ty lên để bắt đầu; không cần tạo thư mục trên máy chủ.',
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
    'Đã lưu và xử lý tài liệu. AI có thể truy xuất theo từ khóa; tìm theo ngữ nghĩa khả dụng khi đã có vector.',
  'knowledge.saveError': 'Không lưu được tài liệu.',
  'knowledge.deleteConfirm': 'Xoá tài liệu “{{title}}”? Thao tác này không hoàn tác được.',
  'knowledge.deleteSuccess': 'Đã xoá tài liệu “{{title}}”.',
  'knowledge.deleteError': 'Không xoá được tài liệu.',
  'knowledge.reindexError': 'Không chạy được index.',
  'knowledge.uploadReadonly': 'AI tìm và đọc nội dung đã trích từ file. Bản gốc chỉ đọc; có thể đổi tiêu đề, danh mục và nhãn.',
  'knowledge.autoClassifyHint': 'AI tự phân loại từng phần kiến thức; không cần chọn loại tài liệu.',
  'knowledge.processing': 'Đang xử lý tài liệu…',
  'knowledge.classificationError': 'Không xử lý được phân loại tài liệu.',
  'knowledge.sectionSaveError': 'Không lưu được phân loại đoạn.',
  'knowledge.retryClassification': 'Thử phân loại lại',
  'knowledge.sections': 'Các đoạn nội dung',
  'knowledge.sectionTags': 'Nhãn đoạn, cách nhau bằng dấu phẩy',
  'knowledge.uploadTags': 'Nhãn cho các file tải lên, cách nhau bằng dấu phẩy',
  'knowledge.uploadTitle': 'Tải tài liệu kiến thức công ty lên',
  'knowledge.uploadHint': 'PDF, DOCX, TXT, Markdown hoặc ảnh sản phẩm (PNG/JPEG/WEBP) · tài liệu tối đa 10 MiB, ảnh tối đa 5 MiB, 10 file/lượt.',
  'knowledge.imageProductPlaceholder': 'Tên sản phẩm (để tự tìm ảnh)',
  'knowledge.imageBrandPlaceholder': 'Thương hiệu (tuỳ chọn)',
  'knowledge.imageDescriptionPlaceholder': 'Mô tả ảnh (tuỳ chọn)',
  'knowledge.imageAnalysisPending': 'Đang phân tích ảnh…',
  'knowledge.imageAnalysisReady': 'Đã phân tích ảnh',
  'knowledge.imageAnalysisFailed': 'Phân tích ảnh thất bại',
  'knowledge.imageAnalysisUnavailable': 'Chưa phân tích ảnh',
  'knowledge.imagesOnly': 'Chỉ ảnh sản phẩm',
  'knowledge.chooseFiles': 'Chọn tệp',
  'knowledge.dropFiles': 'Kéo thả tệp vào đây',
  'knowledge.uploadButton': 'Tải lên',
  'knowledge.clearQueue': 'Xoá hàng đợi',
  'knowledge.queued': 'Đang chờ',
  'knowledge.uploading': 'Đang tải lên…',
  'knowledge.uploaded': 'Đã tải lên',
  'knowledge.uploadFailed': 'Tải lên thất bại',
  'knowledge.uploadError': 'Không tải lên được tệp.',
  'knowledge.invalidFileType': 'Không hỗ trợ định dạng tệp: {{name}}.',
  'knowledge.fileTooLarge': 'Tệp vượt quá 10 MB: {{name}}.',
  'knowledge.queueLimit': 'Hàng đợi chỉ nhận tối đa 10 tệp.',
  'knowledge.loadingContent': 'Đang tải nội dung đã trích xuất…',
  'knowledge.downloadOriginal': 'Tải tệp gốc',
  'knowledge.detailError': 'Không tải được nội dung tài liệu.',
} as const
