/**
 * Namespace `clarify` — câu hỏi làm rõ và phương án gợi ý cho người dùng chọn.
 *
 * Vì sao để trong catalog thay vì trong mã: đây là câu chữ người dùng đọc, ở cả hai
 * ngôn ngữ, và phải sửa được mà không đụng vào logic sinh câu hỏi. Bảng phương án dưới
 * đây là TẦNG DỰ PHÒNG tất định: nó luôn cho ra câu hỏi dùng được ngay cả khi không gọi
 * được model, nên thẻ chọn không bao giờ rỗng.
 *
 * Quy ước mã phương án: `<trường>-<mã ngắn>`, ví dụ `objective-trial`. Mã là thứ server
 * dùng để ánh xạ câu trả lời vào trường brief, nên mã KHÔNG được đổi khi chỉ sửa câu chữ
 * — đổi mã sẽ làm hỏng mọi câu trả lời đang chờ người dùng gửi.
 */
export const vi_clarify = {
  /* ------------------------------------------------------ lời dẫn */
  'clarify.intro': 'Trước khi lập kế hoạch, tôi cần chốt vài điểm để đội làm đúng việc:',
  'clarify.remaining': 'Còn thiếu: {{fields}}',
  'clarify.improved': 'Gợi ý dưới đây được soạn theo ngữ cảnh công ty.',

  /* ------------------------------------------------- mục tiêu */
  'clarify.objective.question': 'Kết quả kinh doanh cuối cùng bạn muốn đạt là gì?',
  'clarify.objective.helper': 'Chọn kết quả gần nhất; có thể bổ sung ở ô ý kiến khác.',
  'clarify.objective-trial.label': 'Tăng số đăng ký dùng thử',
  'clarify.objective-trial.hint': 'Ưu tiên số lượng người dùng mới.',
  'clarify.objective-lead.label': 'Tăng số lead chất lượng',
  'clarify.objective-lead.hint': 'Ưu tiên lead đã đủ điều kiện cho đội bán.',
  'clarify.objective-cpl.label': 'Giảm chi phí trên mỗi lead (CPL)',
  'clarify.objective-cpl.hint': 'Giữ nguyên sản lượng, giảm chi phí.',
  'clarify.objective-revenue.label': 'Tăng doanh thu',
  'clarify.objective-revenue.hint': 'Gắn với đơn hàng hoặc hợp đồng đã ký.',
  'clarify.objective-brand.label': 'Tăng nhận diện thương hiệu',
  'clarify.objective-brand.hint': 'Ưu tiên độ phủ và mức nhớ thương hiệu.',
  'clarify.objective-other.label': 'Mục tiêu khác (tôi sẽ ghi rõ)',

  /* ------------------------------------------------------ KPI */
  'clarify.kpi.question': 'Đo thành công bằng chỉ số nào, mốc bao nhiêu?',
  'clarify.kpi.helper': 'Nêu con số và khoảng thời gian nếu có.',
  'clarify.kpi-leads.label': 'Số lead mỗi tháng',
  'clarify.kpi-cpl.label': 'CPL tối đa cho phép',
  'clarify.kpi-signups.label': 'Số đăng ký dùng thử',
  'clarify.kpi-traffic.label': 'Lưu lượng truy cập hoặc thứ hạng tìm kiếm',
  'clarify.kpi-engagement.label': 'Mức tương tác trên mạng xã hội',
  'clarify.kpi-other.label': 'Chỉ số khác (tôi sẽ ghi rõ)',

  /* ---------------------------------------------------- phạm vi */
  'clarify.scope.question': 'Lần này làm gì, và điều gì KHÔNG làm?',
  'clarify.scope.helper': 'Chọn nhiều được. Những mục đánh dấu "không làm" sẽ loại trừ.',
  'clarify.scope-facebook.label': 'Chạy quảng cáo Facebook',
  'clarify.scope-seo.label': 'Làm SEO và nội dung tìm kiếm',
  'clarify.scope-social-organic.label': 'Vận hành mạng xã hội (bài đăng tự nhiên)',
  'clarify.scope-email.label': 'Chuỗi email/CRM nuôi dưỡng',
  'clarify.scope-no-tiktok.label': 'Không chạy TikTok lần này',
  'clarify.scope-no-influencer.label': 'Không thuê influencer/KOL',
  'clarify.scope-no-ads.label': 'Không chạy quảng cáo trả phí',
  'clarify.scope-no-redesign.label': 'Không làm lại website/thương hiệu',
  'clarify.scope-no-video.label': 'Không sản xuất video',
  'clarify.scope-other.label': 'Phạm vi khác (tôi sẽ ghi rõ)',

  /* --------------------------------------------------- thời hạn */
  'clarify.deadline.question': 'Cần xong trước khi nào?',
  'clarify.deadline.helper': 'Chọn mốc gần nhất; ghi mốc trung gian ở ô ý kiến khác nếu có.',
  'clarify.deadline-30.label': 'Trong 30 ngày tới',
  'clarify.deadline-60.label': 'Trong 60 ngày tới',
  'clarify.deadline-90.label': 'Trong 90 ngày tới (một quý)',
  'clarify.deadline-quarter-end.label': 'Trước khi kết thúc quý này',
  'clarify.deadline-year-end.label': 'Trước khi kết thúc năm nay',
  'clarify.deadline-unknown.label': 'Chưa xác định',
  'clarify.deadline-other.label': 'Mốc khác (tôi sẽ ghi rõ)',

  /* --------------------------------------------------- ngân sách */
  'clarify.budget.question': 'Ngân sách cho lần này là bao nhiêu?',
  'clarify.budget.helper': 'Có thể là tiền quảng cáo, số giờ người, hoặc cả hai.',
  'clarify.budget-under-20m.label': 'Dưới 20 triệu VNĐ',
  'clarify.budget-20-50m.label': '20–50 triệu VNĐ',
  'clarify.budget-50-100m.label': '50–100 triệu VNĐ',
  'clarify.budget-over-100m.label': 'Trên 100 triệu VNĐ',
  'clarify.budget-hours-only.label': 'Chỉ có thời gian người, không có tiền quảng cáo',
  'clarify.budget-unknown.label': 'Chưa xác định',
  'clarify.budget-other.label': 'Mức khác (tôi sẽ ghi rõ)',

  /* -------------------------------------------------- ràng buộc */
  'clarify.constraints.question': 'Có ràng buộc bắt buộc nào không?',
  'clarify.constraints.helper': 'Chọn những điều bắt buộc phải tuân; thêm chi tiết ở ô ý kiến khác.',
  'clarify.constraints-no-customer-photos.label': 'Không dùng ảnh khách hàng khi chưa xin phép',
  'clarify.constraints-no-unverified-claims.label': 'Không cam kết/khẳng định chưa kiểm chứng',
  'clarify.constraints-brand-guidelines.label': 'Phải theo đúng hướng dẫn thương hiệu',
  'clarify.constraints-legal-review.label': 'Nội dung phải qua kiểm duyệt pháp lý',
  'clarify.constraints-tone.label': 'Giữ đúng giọng điệu thương hiệu đã định',
  'clarify.constraints-none.label': 'Không có ràng buộc đặc biệt',
  'clarify.constraints-other.label': 'Ràng buộc khác (tôi sẽ ghi rõ)',

  /* ------------------------------------------- nhãn ô ý kiến */
  /* ------------------------------------------- nhãn 6 trường brief */
  'clarify.field.objective': 'Mục tiêu (kết quả kinh doanh mong muốn)',
  'clarify.field.kpi': 'KPI (chỉ số đo được + mốc thời gian)',
  'clarify.field.scope': 'Phạm vi (làm gì, và KHÔNG làm gì)',
  'clarify.field.deadline': 'Thời hạn',
  'clarify.field.budget': 'Ngân sách (tiền và/hoặc số giờ người)',
  'clarify.field.constraints': 'Ràng buộc (thương hiệu, pháp lý, kênh bắt buộc)',
  'clarify.customLabel': 'Ý kiến khác của bạn',
  'clarify.customPlaceholder': 'Ghi rõ ý của bạn cho câu hỏi này…',
  'clarify.customHint': 'Không bắt buộc. Có thể chọn gợi ý ở trên và vẫn thêm ý riêng.',
} as const
