/**
 * Namespace `costs` cho catalog tiếng Việt.
 *
 * Tách riêng một file cho mỗi màn hình vì lý do phối hợp: nhiều người cùng bổ sung
 * chuỗi dịch, và nếu tất cả sửa chung một file thì mỗi lần gộp là một lần xung đột.
 * Một file một màn hình làm cho phạm vi sửa của mỗi người là rời nhau.
 *
 * Khoá trong file này PHẢI có tiền tố `costs.` để không đụng namespace khác.
 *
 * Vì sao trạng thái lượt chạy dùng lại `taskStatus.*`: đó cũng là bốn trạng thái vòng
 * đời giống công việc, tạo bản sao ở đây sẽ khiến hai màn hình lệch chữ khi sửa một bên.
 * Riêng `budget_exceeded` không có trong `taskStatus` nên mới có khoá riêng.
 *
 * Vì sao tham số đếm đặt tên `n` chứ không phải `count`: i18next coi `count` là tín
 * hiệu số ít/số nhiều nên sẽ đi tìm khoá `_one`/`_other`; catalog phẳng của dự án
 * không có các biến thể đó nên chuỗi sẽ rơi về khoá gốc.
 */
export const vi_costs = {
  'costs.budgetExceeded': 'Vượt ngân sách',
  'costs.loading': 'Đang tổng hợp chi phí…',
  'costs.subtitle':
    'Tổng hợp chi phí theo ngày, theo agent và từng lượt chạy. Chọn khoảng ngày để thu hẹp.',
  'costs.finishSetup': 'Vào mục “Cài đặt” để khai báo nhà cung cấp và model trước.',

  'costs.range': 'Khoảng thời gian',
  'costs.rangeHint': 'Để trống nghĩa là lấy toàn bộ dữ liệu còn lưu.',
  'costs.from': 'Từ ngày',
  'costs.to': 'Đến ngày',
  'costs.view': 'Xem',
  'costs.clearFilter': 'Xoá lọc',
  'costs.filtering': 'Đang lọc: {{from}} → {{to}}',
  'costs.rangeStart': 'đầu kỳ',
  'costs.rangeEnd': 'nay',

  // Dấu gạch dài cho giá trị trống nằm trong catalog để màn hình sạch ký tự ngoài ASCII.
  'costs.noValue': '—',
  'costs.totalCost': 'Tổng chi phí',
  'costs.runs': 'Lượt chạy',
  'costs.runsHint': 'Số lần agent thực sự gọi model',
  'costs.tokensIn': 'Token vào',
  'costs.tokensOut': 'Token ra',
  'costs.totalTokens': 'Tổng {{n}} token',

  'costs.byDay': 'Theo ngày',
  'costs.byDayHint':
    'Cộng dồn mọi agent và model trong cùng một ngày. Thanh dài nhất là ngày tốn nhất.',
  'costs.day': 'Ngày',
  'costs.cost': 'Chi phí',
  'costs.share': 'Tỷ lệ',
  'costs.noData': 'Chưa có dữ liệu chi phí trong khoảng đã chọn.',

  'costs.byAgent': 'Theo agent',
  'costs.byAgentHint':
    'Sắp xếp giảm dần theo chi phí — agent đứng đầu là chỗ nên xem lại model trước.',
  'costs.noAgentData': 'Chưa có agent nào tiêu tốn trong khoảng đã chọn.',

  'costs.runsCardHint': 'Chi tiết từng lần gọi model, mới nhất ở trên.',
  'costs.time': 'Thời điểm',
  'costs.latency': 'Độ trễ',
  'costs.steps': 'Bước',
  'costs.error': 'Lỗi',
  'costs.empty': 'Chưa có dữ liệu chi phí.',
} as const
