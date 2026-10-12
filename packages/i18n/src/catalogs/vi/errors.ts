/**
 * Namespace `errors` — thông báo lỗi trả về qua API.
 *
 * Vì sao tách khỏi chuỗi giao diện: lỗi được sinh ở tầng backend (nơi không biết gì về
 * React) nhưng hiển thị ở tầng giao diện. Một namespace riêng làm rõ rằng khoá ở đây
 * phải dịch được ở CẢ HAI phía, và là chỗ để đối chiếu khi thêm một lỗi mới.
 *
 * Quy ước: khoá đặt theo `errors.<miền>.<tình huống>`, ví dụ `errors.auth.invalidCredentials`.
 * Tầng sinh lỗi gắn `messageKey` trỏ tới khoá ở đây, còn `message` vẫn là câu tiếng Việt
 * làm mặc định — nhờ vậy chỗ nào chưa kịp chuyển vẫn hiển thị được.
 */
export const vi_errors = {
  'errors.auth.accountPending': 'Tài khoản đang chờ admin duyệt.',
  'errors.auth.adminOnlyApproval': 'Tài khoản admin chỉ sử dụng chức năng duyệt tài khoản.',
  /* --------------------------------------------------------- chung */
  'errors.generic.internal': 'Lỗi hệ thống. Vui lòng thử lại.',
  'errors.generic.validation': 'Dữ liệu gửi lên không hợp lệ.',
  'errors.generic.notFound': 'Không tìm thấy tài nguyên yêu cầu.',
  'errors.generic.forbidden': 'Bạn không có quyền thực hiện thao tác này.',
  'errors.generic.unauthorized': 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  'errors.generic.conflict': 'Thao tác xung đột với trạng thái hiện tại.',
  'errors.generic.rateLimited': 'Quá nhiều yêu cầu. Vui lòng thử lại sau.',
  'errors.generic.badJson': 'Nội dung gửi lên không phải JSON hợp lệ.',
  'errors.generic.bodyTooLarge': 'Nội dung gửi lên quá lớn.',
  'errors.generic.endpointNotFound': 'Điểm cuối không tồn tại.',
  'errors.generic.cannotConnectServer': 'Không kết nối được máy chủ.',
  'errors.generic.methodNotAllowed': 'Phương thức không được hỗ trợ.',
  'errors.generic.methodNotAllowedWith': 'Phương thức không được hỗ trợ. Chỉ chấp nhận: {{allowed}}.',
  'errors.generic.invalidLanguage': 'Ngôn ngữ không được hỗ trợ. Chỉ hỗ trợ: {{supported}}.',
  /* ------------------------------------------------------ xác thực */
  'errors.auth.invalidCredentials': 'Email hoặc mật khẩu không đúng.',
  'errors.auth.sessionExpired': 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  'errors.auth.emailTaken': 'Email này đã được đăng ký.',
  'errors.auth.weakPassword': 'Mật khẩu cần ít nhất 10 ký tự.',
  'errors.auth.emailInvalid': 'Email không hợp lệ.',

  /* -------------------------------------------------------- quyền */
  'errors.access.notMember': 'Bạn không thuộc công ty này.',
  'errors.access.roleRequired': 'Vai trò của bạn không được phép thực hiện thao tác này.',

  /* ----------------------------------------------------- ngân sách */
  'errors.budget.dailyExceeded': 'Đã vượt trần chi phí ngày: đã dùng {{used}} / trần {{limit}} USD.',
  'errors.budget.monthlyExceeded': 'Đã vượt trần chi phí tháng: đã dùng {{used}} / trần {{limit}} USD.',

  /* ------------------------------------------------------ provider */
  'errors.provider.modelMissing': 'Model chưa được cấu hình trong hệ thống.',
  'errors.provider.modelDisabled': 'Model {{label}} đang bị tắt.',
  'errors.provider.noModelForAgent': 'Công ty chưa có model LLM nào khả dụng cho agent {{role}}.',
  'errors.provider.apiKeyMissing': 'Provider {{name}} chưa có API key. Vào Cài đặt để thêm.',
  'errors.provider.baseUrlInvalid': 'Base URL của provider {{name}} không hợp lệ.',
  'errors.provider.noToolSupport': 'Model {{label}} không hỗ trợ gọi công cụ.',

  /* --------------------------------------------------------- tool */
  'errors.tool.notConfigured': 'Công cụ {{tool}} chưa được cấu hình cho công ty này.',
  'errors.tool.notGranted': 'Agent {{role}} không được cấp công cụ {{tool}}.',
  'errors.tool.hostBlocked': 'Địa chỉ {{host}} bị chặn vì nằm trong dải nội bộ.',

  /* ------------------------------------------------- kho kiến thức */
  'errors.kb.readDenied': 'Bạn không có quyền đọc danh mục "{{category}}" của kho kiến thức.',
  'errors.kb.writeDenied': 'Bạn không có quyền ghi vào danh mục "{{category}}". Danh mục được ghi: {{allowed}}.',
} as const
