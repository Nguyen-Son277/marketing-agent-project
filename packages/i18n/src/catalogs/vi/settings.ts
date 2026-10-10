/**
 * Namespace `settings` cho catalog tiếng Việt.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `settings.` để không đụng namespace khác.
 *
 * Vài câu dùng chung với màn Bảng điều khiển (`dashboard.*`) nằm ở `vi.ts` vì đó là
 * nguồn sự thật của catalog; file này chỉ chứa khoá riêng của màn Cài đặt.
 */
export const vi_settings = {
  /* ---------------------------------------------------------- trang */
  'settings.title': 'Cài đặt',
  'settings.subtitle':
    'Khai báo nhà cung cấp (URL + nhiều API key), lấy danh sách model, chọn model và model dự phòng cho từng agent, cùng kết nối ngoài và giới hạn chi phí.',
  'settings.needsConfigurationHint': 'Kiểm tra lại nhà cung cấp và API key ngay tại màn hình này.',

  /* ------------------------------------------------- nhà cung cấp */
  'settings.providers.title': 'Nhà cung cấp model',
  'settings.providers.subtitle':
    'Mỗi URL là một nhà cung cấp và có thể có nhiều API key: khoá lỗi thì hệ thống tự dùng khoá kế tiếp. API key là chỉ-ghi, server mã hoá và không bao giờ trả lại giá trị gốc.',
  'settings.providers.empty':
    'Chưa có nhà cung cấp nào. Thêm một nhà cung cấp OpenAI-compatible để agent gọi được model.',
  'settings.providers.table.name': 'Tên',
  'settings.providers.table.kind': 'Loại',
  'settings.providers.table.baseUrl': 'Base URL',
  'settings.providers.table.apiKey': 'API key',
  'settings.providers.table.models': 'Model',
  'settings.providers.table.status': 'Trạng thái',
  'settings.providers.global': 'Dùng chung toàn hệ thống',
  'settings.providers.keyConfigured': 'Đã cấu hình',
  'settings.providers.keyHint': 'Gợi ý: {{hint}}',
  'settings.providers.keyMissing': 'Chưa có khoá',
  'settings.providers.enabled': 'Đang bật',
  'settings.providers.disabled': 'Đã tắt',
  'settings.providers.test': 'Kiểm tra',
  'settings.providers.testResult': '{{message}} · {{ms}} ms',
  'settings.providers.testModelsSeen': '· thấy {{count}} model',
  'settings.providers.form.editTitle': 'Sửa nhà cung cấp',
  'settings.providers.form.createTitle': 'Thêm nhà cung cấp',
  'settings.providers.form.namePlaceholder': 'Tên, ví dụ: Gateway nội bộ',
  'settings.providers.form.baseUrlPlaceholder': 'http://localhost:20128/v1',
  'settings.providers.form.apiKeyPlaceholderKeep': 'Để trống nếu giữ khoá cũ',
  'settings.providers.form.apiKeyPlaceholder': 'Dán API key',
  'settings.providers.form.enable': 'Bật nhà cung cấp này',
  'settings.providers.form.keyNote':
    'Khoá đã lưu không hiển thị lại dưới bất kỳ hình thức nào. Muốn đổi khoá thì dán khoá mới; để trống nghĩa là giữ nguyên khoá cũ.',
  'settings.providers.form.submitEdit': 'Lưu thay đổi',
  'settings.providers.form.submitCreate': 'Thêm nhà cung cấp',
  'settings.providers.form.cancelEdit': 'Huỷ sửa',
  'settings.providers.needNameAndBaseUrl': 'Cần nhập tên nhà cung cấp và base URL.',
  'settings.providers.updated': 'Đã cập nhật nhà cung cấp.',
  'settings.providers.created': 'Đã thêm nhà cung cấp.',
  'settings.providers.saveFailed': 'Không lưu được nhà cung cấp.',
  'settings.providers.testFailed': 'Không kiểm tra được kết nối.',
  'settings.providers.delete': 'Xoá',
  'settings.providers.deleteConfirm':
    'Xoá nhà cung cấp "{{name}}"? Mọi khoá và model của nó sẽ bị xoá; route/preset trỏ tới model đó cũng mất.',
  'settings.providers.deleted': 'Đã xoá nhà cung cấp.',
  'settings.providers.deleteFailed': 'Không xoá được nhà cung cấp.',

  /* --------------------------------------------------------- api key */
  'settings.providers.keys.title': 'Khoá API ({{count}})',
  'settings.providers.keys.hint':
    'Một URL có thể có nhiều khoá. Hệ thống thử lần lượt theo thứ tự; khoá lỗi thì tự dùng khoá kế tiếp.',
  'settings.providers.keys.empty': 'Chưa có khoá nào. Gateway nội bộ có thể không cần khoá.',
  'settings.providers.keys.label': 'Nhãn',
  'settings.providers.keys.priority': 'Thứ tự',
  'settings.providers.keys.status': 'Trạng thái',
  'settings.providers.keys.enabled': 'Đang bật',
  'settings.providers.keys.disabled': 'Đã tắt',
  'settings.providers.keys.addTitle': 'Thêm khoá API',
  'settings.providers.keys.labelPlaceholder': 'Nhãn, ví dụ: Key chính',
  'settings.providers.keys.keyPlaceholder': 'Dán API key',
  'settings.providers.keys.editPlaceholder': 'Khoá mới (để trống nếu giữ nguyên)',
  'settings.providers.keys.priorityPlaceholder': 'Thứ tự dùng (nhỏ trước)',
  'settings.providers.keys.submit': 'Thêm khoá',
  'settings.providers.keys.needLabelAndKey': 'Cần nhập nhãn và giá trị khoá.',
  'settings.providers.keys.created': 'Đã thêm khoá.',
  'settings.providers.keys.updated': 'Đã cập nhật khoá.',
  'settings.providers.keys.deleted': 'Đã xoá khoá.',
  'settings.providers.keys.saveFailed': 'Không lưu được khoá.',
  'settings.providers.keys.deleteFailed': 'Không xoá được khoá.',
  'settings.providers.keys.test': 'Thử khoá',
  'settings.providers.keys.cancelEdit': 'Huỷ sửa khoá',

  /* ------------------------------------------------------- fetch model */
  'settings.providers.fetch.title': 'Lấy danh sách model từ nhà cung cấp',
  'settings.providers.fetch.hint':
    'Gọi /models bằng khoá đã chọn để xem nhà cung cấp có những model nào. Chưa lưu gì cho tới khi bạn chọn.',
  'settings.providers.fetch.action': 'Fetch model',
  'settings.providers.fetch.keyLabel': 'Dùng khoá',
  'settings.providers.fetch.selectAll': 'Chọn tất cả',
  'settings.providers.fetch.clear': 'Bỏ chọn',
  'settings.providers.fetch.import': 'Thêm model đã chọn ({{count}})',
  'settings.providers.fetch.imported': 'Đã thêm {{created}} model, bỏ qua {{skipped}} model đã có.',
  'settings.providers.fetch.noModels': 'Nhà cung cấp không trả về model nào.',
  'settings.providers.fetch.alreadyAdded': 'Đã có',
  'settings.providers.fetch.failed': 'Không lấy được danh sách model.',
  'settings.providers.fetch.importFailed': 'Không thêm được model đã chọn.',
  'settings.providers.fetch.pickKeyHint':
    'Nếu gateway không cần khoá, hãy để nguyên và bấm Fetch model.',

  /* ------------------------------------------------------- model */
  'settings.models.title': 'Model',
  'settings.models.subtitle':
    'Khai báo model kèm giá vào/ra mỗi triệu token. Giá này là cơ sở để tính chi phí và so với trần ngày.',
  'settings.models.emptyNoProvider':
    'Chưa có nhà cung cấp nào. Thêm nhà cung cấp ở mục trên trước khi khai báo model.',
  'settings.models.empty': 'Chưa có model nào. Dùng "Fetch model" ở mục Nhà cung cấp để lấy danh sách, hoặc khai báo thủ công bên dưới.',
  'settings.models.table.label': 'Nhãn',
  'settings.models.table.modelId': 'Mã model',
  'settings.models.table.provider': 'Nhà cung cấp',
  'settings.models.table.context': 'Ngữ cảnh',
  'settings.models.table.tools': 'Tool',
  'settings.models.table.usage': 'Đang dùng',
  'settings.models.table.costIn': 'Giá vào / 1M',
  'settings.models.table.costOut': 'Giá ra / 1M',
  'settings.models.usageCount': '{{count}} agent',
  'settings.models.delete': 'Xoá',
  'settings.models.deleteConfirm': 'Xoá model "{{label}}"?',
  'settings.models.deleted': 'Đã xoá model.',
  'settings.models.deleteFailed': 'Không xoá được model. Hãy gỡ model khỏi agent/route trước.',
  'settings.models.purge': 'Xoá model không dùng',
  'settings.models.purgeConfirm': 'Xoá mọi model không được agent nào dùng của "{{name}}"?',
  'settings.models.purged': 'Đã xoá {{count}} model không dùng.',
  'settings.models.purgeFailed': 'Không xoá được model không dùng.',
  'settings.models.form.title': 'Thêm model',
  'settings.models.form.modelIdPlaceholder': 'Mã model, ví dụ: deepseek-v4-flash',
  'settings.models.form.labelPlaceholder': 'Nhãn hiển thị',
  'settings.models.form.contextPlaceholder': 'Cửa sổ ngữ cảnh (token)',
  'settings.models.form.costInPlaceholder': 'Giá vào mỗi triệu token (USD)',
  'settings.models.form.costOutPlaceholder': 'Giá ra mỗi triệu token (USD)',
  'settings.models.form.supportsTools': 'Model hỗ trợ gọi tool',
  'settings.models.form.toolsNote':
    'Model không hỗ trợ tool sẽ bị router đổi sang model khác cùng mức năng lực, nên hãy đánh dấu chính xác.',
  'settings.models.form.submit': 'Thêm model',
  'settings.models.needFields': 'Cần chọn nhà cung cấp và nhập mã model cùng nhãn hiển thị.',
  'settings.models.created': 'Đã thêm model.',
  'settings.models.saveFailed': 'Không lưu được model.',

  /* --------------------------------------------- route theo tier */
  'settings.routes.title': 'Route theo mức năng lực',
  'settings.routes.subtitle':
    'Khi agent không gán model cứng, router chọn model theo cặp (agent, tier). Đây là cơ chế dự phòng khi model đã chọn thiếu năng lực.',
  'settings.routes.empty':
    'Chưa có route nào. Agent chỉ chạy khi bạn chọn model trực tiếp trong màn Đội agent; route theo tier chỉ là phương án bổ sung.',
  'settings.routes.table.agent': 'Agent',
  'settings.routes.table.role': 'Vai trò',
  'settings.routes.table.tier': 'Mức',
  'settings.routes.table.model': 'Model',
  'settings.routes.table.priority': 'Ưu tiên',
  'settings.routes.modelOption': '{{label}} · {{provider}}',
  'settings.routes.form.title': 'Gán route',
  'settings.routes.form.submit': 'Lưu route',
  'settings.routes.needAgentAndModel': 'Cần chọn agent và model.',
  'settings.routes.assigned': 'Đã gán model cho mức {{tier}}.',
  'settings.routes.saveFailed': 'Không lưu được route.',

  /* ------------------------------------------------ kết nối ngoài */
  'settings.integrations.title': 'Kết nối ngoài',
  'settings.integrations.subtitle':
    'Cấu hình để agent đọc dữ liệu kênh và tạo bản nháp. Cấu hình là chỉ-ghi, không hiển thị lại sau khi lưu.',
  'settings.integrations.empty':
    'Chưa có kết nối nào. Thêm kết nối bằng biểu mẫu bên dưới khi cần agent chạm ra bên ngoài.',
  'settings.integrations.table.kind': 'Loại',
  'settings.integrations.table.name': 'Tên',
  'settings.integrations.table.status': 'Trạng thái',
  'settings.integrations.table.config': 'Cấu hình',
  'settings.integrations.table.lastCheck': 'Kiểm tra gần nhất',
  'settings.integrations.configured': 'Đã cấu hình',
  'settings.integrations.missingConfig': 'Thiếu cấu hình',
  'settings.integrations.test': 'Kiểm tra',
  'settings.integrations.testResult': '{{message}} · {{status}} · {{ms}} ms',
  'settings.integrations.form.title': 'Thêm / cập nhật kết nối',
  'settings.integrations.form.namePlaceholder': 'Tên gợi nhớ, ví dụ: Firecrawl chính',
  'settings.integrations.form.configLabel': 'Cấu hình (JSON)',
  'settings.integrations.form.configPlaceholder': '{\n  "apiKey": "…"\n}',
  'settings.integrations.form.configNote':
    'Giá trị bí mật nằm trong JSON này sẽ được mã hoá trước khi lưu và không bao giờ trả về giao diện.',
  'settings.integrations.form.submit': 'Lưu kết nối',
  'settings.integrations.needName': 'Cần nhập tên kết nối.',
  'settings.integrations.configMustBeObject':
    'Phần cấu hình phải là một đối tượng JSON, ví dụ {"apiKey": "..."}.',
  'settings.integrations.configInvalidJson': 'Cấu hình không phải JSON hợp lệ.',
  'settings.integrations.saved':
    'Đã lưu kết nối. Bí mật trong cấu hình được mã hoá và không hiển thị lại.',
  'settings.integrations.saveFailed': 'Không lưu được kết nối.',
  'settings.integrations.testFailed': 'Không kiểm tra được kết nối.',

  // Tên kênh là danh từ riêng nên bản tiếng Anh giữ nguyên; riêng Firecrawl kèm mô tả
  // nên vẫn phải dịch. Khoá vẫn đặt cho MỌI loại để bảng ánh xạ có một kiểu duy nhất.
  'settings.integrationKind.firecrawl': 'Firecrawl (cào nội dung web)',
  'settings.integrationKind.googleSearchConsole': 'Google Search Console',
  'settings.integrationKind.googleAnalytics': 'Google Analytics',
  'settings.integrationKind.googleSheets': 'Google Sheets',
  'settings.integrationKind.meta': 'Meta (Facebook / Instagram)',
  'settings.integrationKind.linkedin': 'LinkedIn',
  'settings.integrationKind.googleAds': 'Google Ads',
  'settings.integrationKind.emailSmtp': 'Email SMTP',

  /* ----------------------------------------------------- giới hạn */
  'settings.limits.title': 'Giới hạn',
  'settings.limits.subtitle':
    'Trần chi phí và số vòng lặp. Vượt trần thì lượt chạy bị dừng thay vì chạy tiếp và tiêu thêm tiền.',
  // Tách làm hai khoá vì số tiền ở giữa được bọc <strong> để mắt bắt nhanh con số.
  'settings.limits.used24hPrefix': 'Đã dùng 24 giờ qua:',
  'settings.limits.limitPrefix': '/ trần',
  'settings.limits.noCap': 'Chưa đặt trần',
  'settings.limits.dailyCost': 'Trần chi phí ngày (USD)',
  'settings.limits.taskCost': 'Trần chi phí mỗi việc (USD)',
  'settings.limits.maxSteps': 'Số bước tối đa mỗi lượt chạy',
  'settings.limits.maxPeerRounds': 'Số vòng trao đổi giữa agent',
  'settings.limits.maxRevisions': 'Số lần sửa tối đa mỗi việc',
  'settings.limits.maxParallel': 'Số việc chạy song song',
  'settings.limits.submit': 'Lưu giới hạn',
  'settings.limits.saved': 'Đã lưu giới hạn.',
  'settings.limits.saveFailed': 'Không lưu được giới hạn.',
} as const
