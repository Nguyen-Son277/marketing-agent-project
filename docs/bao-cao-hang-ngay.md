# Báo cáo công việc hằng ngày

## Sử dụng
1. Owner/admin công ty mở **Báo cáo hằng ngày**, chọn **Tạo nhóm**.
2. Điền tên nhóm, tiêu đề tiếng Anh, danh sách tên (mỗi dòng một người, không trùng tên). Có thể chọn nhân viên hiện có. Số người được tính tự động. Chọn model thuộc công ty để dịch/tổng hợp tiếng Anh.
3. Bật lịch thứ Hai–thứ Bảy. Chọn nhóm, ngày báo cáo và sao chép link hoặc lời nhắc; tự gửi vào nhóm lúc 16:20. Không có bot gửi tin tự động.
4. Nhân viên mở link trên điện thoại/máy tính, không đăng nhập, chọn tên, nhập công việc/kết quả; khó khăn và kế hoạch tiếp theo là tùy chọn. Có thể nhập Việt/Anh.
5. Từ 16:50, hệ thống tạo bản chốt và xếp hàng tổng hợp. Người không có bài trước hạn được ghi **Overdue — no report submitted by the deadline.** Điều này không có nghĩa họ không làm việc.
6. Chọn phiên bản **ready** để xem tiếng Anh, tải Word DOCX hoặc PDF và tự gửi lãnh đạo.
7. Sau bài nộp muộn, chọn **Tạo bản cập nhật sau hạn**. Bản gốc không bị ghi đè. Phiên bản cập nhật ghi **Late submission** hoặc **Updated after deadline**.

## Quy tắc thời gian
- Múi giờ cố định `Asia/Ho_Chi_Minh`, thứ Hai–thứ Bảy (chưa loại ngày lễ).
- Máy chủ lưu thành công lúc `16:20:00 <= t < 16:50:00`: đúng hạn.
- `16:50:00 <= t < 00:00:00 ngày kế tiếp`: nộp/cập nhật muộn. Hết ngày khóa nhận bài.
- Trước 16:20 chỉ xem được thông tin biểu mẫu. Đồng hồ trình duyệt chỉ hỗ trợ hiển thị; quyết định là giờ máy chủ.
- Sửa nhóm không đổi danh sách thành viên của đợt đã tạo. Tắt lịch dừng tạo đợt mới; đợt đã tạo vẫn giữ lịch nhận/chốt.
- Worker kiểm tra mỗi 15 giây. Dù timer trễ, snapshot vẫn lọc chính xác nội dung lưu trước 16:50. Không có người truy cập vẫn chạy.

## Cấu hình và vận hành
Thêm vào `.env`:

```dotenv
PUBLIC_BASE_URL=https://reports.example.com
```

Dùng địa chỉ truy cập được từ thiết bị thành viên (tên miền HTTPS, LAN hoặc VPN). Khi phát triển qua Vite, dùng địa chỉ Vite mà nhân viên truy cập được. `localhost` chỉ trỏ đến thiết bị đang mở link. Không tự mở cổng Internet hoặc tạo tunnel. Nếu chưa cấu hình, giao diện cảnh báo và không cấp URL chia sẻ.

Chạy `pnpm --store-dir .pnpm-store install`, `pnpm typecheck`, `pnpm test`, `pnpm build:web`, sau đó khởi động lại tiến trình máy chủ hiện có và refresh trang. Migration `0013_daily_reports` tự chạy khi mở DB. Sao lưu DB và APP_SECRET trước khi nâng cấp. Không cần Redis, cron, LibreOffice hay Chromium.

Máy chủ phải chạy liên tục để nhận bài và xử lý đúng giờ. Khởi động lại sẽ tạo bù các ngày còn thiếu từ ngày bật nhóm, bỏ Chủ nhật, chốt dữ liệu thực sự đã lưu và khôi phục job đang chạy. Ngày máy chủ ngừng không được tự bịa dữ liệu. Bản chốt ghi thời điểm chụp thực tế. Triển khai một instance Node/SQLite; không dùng nhiều worker/process cùng DB.

Model dùng adapter và key đã cấu hình của công ty, không có tool. Chi phí được ghi vào runs/usage dưới agent marketing-leader, cùng giới hạn công ty. Chưa chọn model, model bị tắt, vượt giới hạn ngữ cảnh/ngân sách, lỗi provider hoặc JSON không hợp lệ: phiên bản **failed**, dữ liệu gốc vẫn được giữ, quản lý sửa cấu hình rồi bấm **Thử lại**. Nếu không ai nộp, có thể tạo thông báo tiếng Anh cố định không cần AI. Không có fallback giả làm bản dịch thành công.

Font Unicode DejaVu Sans và giấy phép được đóng gói trong assets máy chủ. File tải được sinh từ dữ liệu phiên bản bất biến, không public qua thư mục static. Đánh giá bản dịch AI trước khi gửi lãnh đạo.

## Riêng tư và giới hạn
- Quản lý: owner/admin đúng công ty. Thành viên thường/viewer không được đọc qua API quản lý.
- Biểu mẫu công khai chỉ trả tên nhóm/ngày/khung giờ/danh sách tên, không trả bài của người khác hoặc email.
- Link là bearer capability ngẫu nhiên; chỉ chia sẻ trong nhóm tin cậy. Token được hash để tra cứu, mã hóa để quản lý sao chép lại. APP_SECRET phải được sao lưu.
- **Không xác minh danh tính:** ai có link có thể nộp thay một tên chưa nộp. Đây là đánh đổi của lựa chọn không đăng nhập, không nên dùng như bằng chứng chấm công.
- Nộp lần đầu trả edit code và version. Trình duyệt lưu cục bộ cả receipt và nội dung đã nộp để sửa. Nếu dùng máy chung, tránh lưu thông tin nhạy cảm và xóa dữ liệu trình duyệt sau khi dùng. Giữ mã riêng tư. Mất mã không thể tự ghi đè bài đã có; quản lý vẫn xem được nội dung gốc.
- Gửi lại sau lỗi mạng có thể trả xung đột nếu lần trước đã lưu nhưng trình duyệt chưa nhận receipt; không tự ghi đè. Chưa có luồng khôi phục mã chỉnh sửa.
- Rate limit theo IP thật của socket, không tin X-Forwarded-For. Sau reverse proxy nhiều người cùng IP chia sẻ giới hạn (90 GET/phút, 15 POST/phút); cần cấu hình rate limit lớp proxy phù hợp nếu nhóm lớn.
- Chưa có file đính kèm, bot gửi nhóm, gửi lãnh đạo tự động, lịch nghỉ lễ, chỉnh sửa/xóa hồi tố dữ liệu chốt hay xác thực người nộp.

## API
Tất cả API quản lý dùng phiên đăng nhập, owner/admin và company membership:

| Method | Đường dẫn dưới `/api/companies/:companyId/daily-report-groups` | Chức năng |
|---|---|---|
| GET / POST | `/` | Danh sách nhóm/model hoặc tạo nhóm |
| PATCH | `/:groupId` | Sửa `{version, group}` với optimistic concurrency |
| GET | `/:groupId/rounds` | 120 đợt gần nhất |
| GET | `/:groupId/rounds/:roundId` | Dữ liệu gốc, phiên bản và URL chia sẻ |
| POST | `/:groupId/rounds/:roundId/update` | Tạo bản cập nhật sau hạn |
| POST | `/:groupId/rounds/:roundId/versions/:versionId/retry` | Xếp lại bản failed |
| GET | `/:groupId/rounds/:roundId/versions/:versionId/export?format=docx\|pdf` | Tải bản ready |

Công khai: `GET /api/public/daily-reports/:token` trả metadata; `POST` nhận `{memberId,work,blockers?,nextSteps?,editKey?,version?}` trả receipt `{editKey,version,submittedAt,late}`. Bài đầu không gửi editKey/version; chỉnh sửa phải có cả mã và version hiện tại. Giới hạn 100 người, công việc 8.000 ký tự/người, khó khăn/kế hoạch 3.000 ký tự/trường.

## Kiểm tra nghiệm thu
Tạo nhóm Alice/Bob/Châu: Alice nộp 16:49:59, Bob nộp 16:50:00, Châu không nộp. Bản gốc: 1 đúng hạn, 2 overdue. Tạo cập nhật: Alice on_time, Bob late_submission, Châu overdue. Bản gốc, giờ nộp và lịch sử sửa giữ nguyên. Bộ test DB/API chạy bằng đồng hồ giả để không cần chờ giờ thật.
