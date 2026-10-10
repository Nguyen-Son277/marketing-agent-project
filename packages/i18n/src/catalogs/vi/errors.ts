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
} as const
