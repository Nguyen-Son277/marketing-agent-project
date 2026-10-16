# Thông báo trong ứng dụng

## Sử dụng

- Bấm biểu tượng chuông ở thanh đầu trang để xem hộp thư và số thông báo chưa đọc.
- Có thể đánh dấu từng thông báo hoặc đánh dấu tất cả đến mốc mới nhất đã tải. Trạng thái đọc được lưu riêng cho mỗi người dùng và công ty.
- Trong hộp thư, bật/tắt ba nhóm: kết quả agent, trường hợp cần xử lý và ngân sách. Tắt nhóm chỉ ngừng nhận sự kiện mới, không xóa lịch sử.
- Thông báo trình duyệt mặc định tắt. Bấm bật để cấp quyền; nếu đã từ chối, thay đổi quyền trong cài đặt trình duyệt. Tùy chọn bật được lưu riêng theo người dùng/công ty trên thiết bị.

## Kết quả thao tác Cài đặt

- Lưu/xóa/kiểm tra cấu hình hiện kết quả qua toast ngắn và lưu vào hộp thư cá nhân, không tích tụ banner dưới từng mục.
- Bấm **Xem thông báo** trên toast để mở hộp thư; ứng dụng không tự chuyển trang khi đang nhập liệu.
- Lỗi nhập liệu cần sửa và cảnh báo cấu hình thường trực vẫn được trình bày gọn tại vị trí liên quan. Nếu lưu thất bại, biểu mẫu được giữ lại.
- Lịch sử chỉ dành cho người thực hiện trong công ty hiện tại; không phát cho toàn bộ công ty và không tự tạo thông báo desktop.
- Nội dung lịch sử là tóm tắt an toàn theo loại thao tác, không lưu khóa API, nội dung form hay phản hồi provider thô. Đây là lịch sử trải nghiệm do client báo, không thay thế nhật ký kiểm toán phía server.
- Ghi lịch sử thất bại không chạy lại hoặc đảo ngược thao tác cấu hình đã hoàn tất.

## Giới hạn vận hành

- Hộp thư lưu trong SQLite, không phụ thuộc bộ đệm SSE trong RAM. Chỉ những người nhận đủ điều kiện tại thời điểm phát sinh được nhận sự kiện; người mới gia nhập không nhận lại sự kiện cũ.
- Giao diện đồng bộ mỗi 5 giây khi tab đang hiển thị, mỗi 30 giây khi tab nền, và ngay khi quay lại ứng dụng hoặc có mạng. Request được xếp tuần tự, không chồng nhau. Đây không phải Web Push: đóng trang/trình duyệt thì không có thông báo desktop mới.
- Thông báo mới chưa đọc hiện toast trong web, độc lập với quyền desktop. Không phát lại lịch sử khi tải lần đầu hoặc polling lại. Khi có nhiều thông báo, hàng đợi có giới hạn và dùng toast tổng hợp; toàn bộ nội dung vẫn ở hộp thư. Khi tab nền, toast được giữ lại để hiện khi quay lại thay vì hết hạn lúc người dùng không nhìn thấy.
- Bật/tắt thông báo desktop không làm thay đổi mốc nhận toast trong web. Đóng toast không đánh dấu thông báo đã đọc; dùng thao tác đọc trong hộp thư.
- Ngưỡng cảnh báo là 80% và 100% hạn mức hiện có (ngày UTC và mỗi lượt chạy). Không bổ sung hạn mức tháng. Một sự kiện chỉ phát một lần theo kỳ/ngưỡng/hạn mức hoặc lượt chạy; thay đổi hạn mức có thể tạo cảnh báo mới.
- Giữ nguyên cơ chế chặn chi phí hiện tại. Dự án hiện có khác biệt giữa ngày UTC của CostMeter và cửa sổ 24 giờ của phần tổng quan/preflight; cảnh báo theo CostMeter, không thay đổi cách tổng quan hiện số liệu.
- Không tạo thông báo hồi tố cho các lượt chạy trước khi tính năng được cài. Không gửi email, Telegram hoặc SMS.
- Nội dung thông báo không chứa prompt, đầu ra model hoặc lỗi provider thô. Mở màn hình liên quan để xem chi tiết theo quyền hiện tại. Nội dung sự kiện hiện hiển thị song ngữ; các nút và nhãn theo ngôn ngữ giao diện.
- Nhóm “cần xử lý” hiện gồm lượt chạy agent thất bại. Chưa phát sự kiện riêng cho bước duyệt công việc hoặc tác vụ bị chặn trước khi có lượt chạy.
- Nếu ghi thông báo gặp lỗi DB, chi phí đã phát sinh vẫn được ghi nhận; chưa có outbox để tự gửi lại thông báo bị lỗi.

## API

Tất cả API yêu cầu phiên hợp lệ và membership hiện tại của công ty:

- `GET /api/companies/:companyId/notifications?limit=20&cursor=...` → `{items,nextCursor}`.
- `GET /api/companies/:companyId/notifications/unread-count` → `{count}`.
- `POST /api/companies/:companyId/notifications/:id/read`.
- `POST /api/companies/:companyId/notifications/settings`, body `{operationId, operation, status}`; chỉ owner/admin, mã thao tác được cho phép sẵn và `status` là `success`, `warning` hoặc `error`. Trả `{item}`; gửi lại cùng ID thao tác giữ bản ghi đầu tiên của chính người dùng.
- `POST /api/companies/:companyId/notifications/read-all`, body `{through: "ISO timestamp", throughIds?: ["id"]}`. Giao diện gửi các ID đã tải ở đúng mốc `through` để không đánh dấu nhầm thông báo mới có cùng mili-giây.
- `GET /api/companies/:companyId/notification-preferences`.
- `PUT /api/companies/:companyId/notification-preferences`, body gồm các boolean `agent`, `actionRequired`, `budget`.

Danh sách chỉ trả thông báo của người đang đăng nhập trong công ty được chọn. ID thông báo không cấp quyền đọc hoặc sửa trạng thái của người khác.
