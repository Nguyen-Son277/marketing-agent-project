# Báo cáo công việc hằng ngày

## Sử dụng
1. Owner/admin công ty mở **Báo cáo hằng ngày**, chọn **Tạo nhóm**.
2. Điền tên nhóm, tiêu đề tiếng Anh, danh sách tên (mỗi dòng một người, không trùng tên). Có thể chọn nhân viên hiện có. Số người được tính tự động. Chọn model thuộc công ty để dịch/tổng hợp tiếng Anh.
3. Bật lịch thứ Hai–thứ Bảy. Chọn **Nhóm**, **Ngày báo cáo** trên lịch (mặc định hôm nay theo giờ Việt Nam), rồi **Tạo link chia sẻ**. Có thể chuẩn bị trước ngày tương lai; bấm lại trả cùng đợt và link. Ngày cũ chỉ dùng đợt đã có, không tạo bù thủ công. Nhóm tạm dừng và Chủ nhật không tạo đợt mới.
4. Nhân viên mở link trên điện thoại/máy tính, không đăng nhập, chọn tên, nhập công việc/kết quả bất cứ lúc nào; khó khăn và kế hoạch tiếp theo là tùy chọn. Có thể nhập Việt/Anh. Chọn lại tên sẽ tải bài đã lưu để chỉnh sửa, kể cả trên thiết bị khác, không cần mã chỉnh sửa. Nếu hôm đó nghỉ, đánh dấu **Hôm nay nghỉ / Day off** rồi lưu, không cần nhập công việc. Có thể bỏ đánh dấu và sửa lại nếu chọn nhầm.
5. Từ 16:50, hệ thống tạo bản chốt và xếp hàng tổng hợp. Người không có bài trước hạn được ghi **Overdue — no report submitted by the deadline.** Điều này không có nghĩa họ không làm việc.
6. Chọn phiên bản **ready** để xem tiếng Anh, tải Word DOCX hoặc PDF và tự gửi lãnh đạo.
7. Sau bài nộp hoặc chỉnh sửa muộn, chọn **Tạo bản cập nhật sau hạn**. Bản gốc không bị ghi đè. Phiên bản cập nhật ghi **Late submission** hoặc **Updated after deadline**. Ngày nghỉ được ghi **Nghỉ / Day off** trong quản lý và **Day off** ở bản tiếng Anh, link xem, Word/PDF; không bị coi là thiếu nội dung công việc.
8. **Link nộp báo cáo** dành cho thành viên; có thể sao chép cả lời nhắc để tự gửi vào nhóm. **Link xem tổng hợp** dành cho người đọc, không đăng nhập, chỉ hiển thị bản tiếng Anh `ready` mới nhất. Hai link dùng token riêng; link xem không cho nộp/chỉnh sửa và không trả bài nộp gốc. Trang xem tự làm mới mỗi 15 giây, giữ bản hoàn tất trước đó khi bản cập nhật chưa sẵn sàng. DOCX/PDF vẫn chỉ tải trong màn quản lý. Chưa có bản hoàn tất thì trang báo đang chờ.
9. Ngày lịch sử được truy vấn trực tiếp, kể cả ngoài danh sách 120 đợt gần nhất. Nếu trình duyệt chặn clipboard, chọn địa chỉ trong ô link để sao chép thủ công.

## Quy tắc thời gian
- Múi giờ cố định `Asia/Ho_Chi_Minh`, thứ Hai–thứ Bảy (chưa loại ngày lễ).
- Link của đợt đã tạo cho phép nhập/sửa mọi lúc, trước giờ chốt, trước ngày báo cáo hoặc sau nửa đêm/ngày báo cáo. Không còn giờ mở/khóa nhận bài.
- Máy chủ lưu thành công trước `16:50:00` của ngày báo cáo: đúng hạn. Từ mốc này trở đi: nộp/cập nhật muộn, đưa vào bản tổng hợp cập nhật khi quản lý tạo. Ngày của báo cáo vẫn là ngày trên link.
- Sửa nhóm không đổi danh sách thành viên của đợt đã tạo. Tắt lịch dừng tạo đợt mới; đợt đã tạo vẫn cho nhập/sửa và chốt theo lịch.
- Đợt tương lai giữ danh sách thành viên tại thời điểm tạo và cho nhập ngay khi đã có link; tổng hợp vẫn chốt lúc 16:50 của ngày báo cáo.
- Worker kiểm tra mỗi 15 giây. Dù timer trễ, snapshot vẫn lọc chính xác nội dung lưu trước 16:50. Không có người truy cập vẫn chạy.

## Cấu hình và vận hành
Thêm vào `.env`:

```dotenv
PUBLIC_BASE_URL=https://marketing.nguyenminhson.me
```

Dùng địa chỉ truy cập được từ thiết bị thành viên (tên miền HTTPS, LAN hoặc VPN). Khi phát triển qua Vite, dùng địa chỉ Vite mà nhân viên truy cập được. `localhost` chỉ trỏ đến thiết bị đang mở link. Không tự mở cổng Internet hoặc tạo tunnel. Nếu chưa cấu hình, giao diện cảnh báo và không cấp URL chia sẻ.

Địa chỉ trên được dùng để sinh cả hai link. DNS và HTTPS cần được kết nối tới instance chạy ứng dụng ở bước triển khai riêng; đặt `PUBLIC_BASE_URL` không tự xuất bản ứng dụng. Giao diện và `/api` cần đi qua cùng tên miền. Trình duyệt gửi bài phải có Origin khớp địa chỉ này.

Chạy `pnpm --store-dir .pnpm-store install`, `pnpm typecheck`, `pnpm test`, `pnpm build:web`, sau đó khởi động lại tiến trình máy chủ hiện có và refresh trang. Migration `0013_daily_reports`, `0019_daily_report_view_links` và `0021_daily_report_day_off` tự chạy khi mở DB. Migration ngày nghỉ thêm `is_day_off` với mặc định `0` vào từng revision, giữ dữ liệu, lịch sử và link đã có. Sao lưu DB và APP_SECRET trước khi nâng cấp. Không cần Redis, cron, LibreOffice hay Chromium.

Máy chủ phải chạy liên tục để nhận bài và xử lý đúng giờ. Khởi động lại sẽ tạo bù các ngày còn thiếu từ ngày bật nhóm, bỏ Chủ nhật, chốt dữ liệu thực sự đã lưu và khôi phục job đang chạy. Ngày máy chủ ngừng không được tự bịa dữ liệu. Bản chốt ghi thời điểm chụp thực tế. Triển khai một instance Node/SQLite; không dùng nhiều worker/process cùng DB.

Model dùng adapter và key đã cấu hình của công ty, không có tool. Chi phí được ghi vào runs/usage dưới agent marketing-leader, cùng giới hạn công ty. Chưa chọn model, model bị tắt, vượt giới hạn ngữ cảnh/ngân sách, lỗi provider hoặc JSON không hợp lệ: phiên bản **failed**, dữ liệu gốc vẫn được giữ, quản lý sửa cấu hình rồi bấm **Thử lại**. Nếu không ai nộp hoặc tất cả bài đã nộp đều đánh dấu nghỉ, tạo thông báo tiếng Anh cố định không cần AI. Không có fallback giả làm bản dịch thành công.

Font Unicode DejaVu Sans và giấy phép được đóng gói trong assets máy chủ. File tải được sinh từ dữ liệu phiên bản bất biến, không public qua thư mục static. Đánh giá bản dịch AI trước khi gửi lãnh đạo.

## Riêng tư và giới hạn
- Quản lý: owner/admin đúng công ty. Thành viên thường/viewer không được đọc qua API quản lý.
- Metadata biểu mẫu công khai trả tên nhóm/ngày/danh sách tên. Khi chọn một tên, API trả báo cáo mới nhất của tên đó để sửa, không trả email, receipt cũ hay cấu hình nội bộ.
- Người có link xem được bản tổng hợp tiếng Anh của cả nhóm/ngày. Chỉ cấp link cho người được phép đọc. URL xem được tạo khi quản lý bấm **Tạo link chia sẻ**; các đợt cũ chưa thao tác này chưa có token xem.
- Link là bearer capability ngẫu nhiên; chỉ chia sẻ trong nhóm tin cậy. Token được hash để tra cứu, mã hóa để quản lý sao chép lại. APP_SECRET phải được sao lưu.
- **Không xác minh danh tính:** người có link nộp có thể chọn bất kỳ tên nào trong đợt để đọc, nhập hoặc chỉnh sửa báo cáo, bao gồm đánh dấu ngày nghỉ. Chỉ chia sẻ link trong nhóm được phép đọc/sửa; không nên dùng như bằng chứng chấm công.
- Không cần edit code hay dữ liệu localStorage để sửa. Mỗi lần chọn tên đều tải nội dung và version mới nhất từ máy chủ. Lịch sử các lần sửa vẫn được giữ; đánh dấu nghỉ lưu nội dung công việc/khó khăn/kế hoạch trống ở revision đó.
- Sửa đồng thời hoặc gửi lại sau lỗi mạng có thể trả xung đột version. Biểu mẫu giữ nội dung đang nhập và cho tải lại bản mới nhất trước khi sửa tiếp; thao tác tải lại sẽ thay nội dung trong biểu mẫu.
- Rate limit theo IP thật của socket, không tin X-Forwarded-For. Sau reverse proxy nhiều người cùng IP chia sẻ giới hạn (90 GET/phút, 15 POST/phút); cần cấu hình rate limit lớp proxy phù hợp nếu nhóm lớn.
- Chưa có file đính kèm, bot gửi nhóm, gửi lãnh đạo tự động, lịch nghỉ lễ, chỉnh sửa/xóa hồi tố dữ liệu chốt hay xác thực người nộp.

## API
Tất cả API quản lý dùng phiên đăng nhập, owner/admin và company membership:

| Method | Đường dẫn dưới `/api/companies/:companyId/daily-report-groups` | Chức năng |
|---|---|---|
| GET / POST | `/` | Danh sách nhóm/model hoặc tạo nhóm |
| PATCH | `/:groupId` | Sửa `{version, group}` với optimistic concurrency |
| GET | `/:groupId/rounds` | 120 đợt gần nhất; thêm `?date=YYYY-MM-DD` để lấy đúng ngày không giới hạn lịch sử |
| POST | `/:groupId/rounds` | `{date}` tạo/lấy lại đợt, chuẩn bị hai link; trả `DailyRoundCreateResponse`, 201 nếu mới, 200 nếu đã có |
| GET | `/:groupId/rounds/:roundId` | Dữ liệu gốc, phiên bản và URL chia sẻ |
| POST | `/:groupId/rounds/:roundId/update` | Tạo bản cập nhật sau hạn |
| POST | `/:groupId/rounds/:roundId/versions/:versionId/retry` | Xếp lại bản failed |
| GET | `/:groupId/rounds/:roundId/versions/:versionId/export?format=docx\|pdf` | Tải bản ready |

Công khai: `GET /api/public/daily-reports/:token` trả metadata; `GET /api/public/daily-reports/:token/members/:memberId` trả `{submission:null}` nếu chưa nộp, hoặc `{submission:{memberId,work,blockers,nextSteps,isDayOff,version,submittedAt}}` của lần lưu mới nhất. Thành viên phải thuộc đúng đợt của token.

`POST /api/public/daily-reports/:token` nhận `{memberId,work?,blockers?,nextSteps?,isDayOff?,version?}` và trả `{version,submittedAt,late}`. `isDayOff` mặc định `false`; phải có công việc khác rỗng trừ khi `isDayOff:true`. Bài đầu không cần version; chỉnh sửa phải gửi version mới nhất, không cần mã chỉnh sửa. Giới hạn 100 người, công việc 8.000 ký tự/người, khó khăn/kế hoạch 3.000 ký tự/trường. Mọi API công khai vẫn kiểm token, Origin, rate limit và dùng `Cache-Control: no-store`. `opensAt`/`closesAt` trong metadata cũ chỉ là mốc lịch, không còn chặn nộp/sửa.

`GET /api/public/daily-report-views/:token` trả `DailyPublicReport`: tên nhóm, tiêu đề/ngày, `status: pending|ready`, số phiên bản/thời điểm tạo, tóm tắt và các mục tiếng Anh với tên/trạng thái thành viên. Chỉ đọc, dùng token xem riêng và `Cache-Control: no-store`. Quản lý nhận `{share:{url,viewUrl,warning}}`; `url` giữ ý nghĩa link nộp cũ, `viewUrl` có thể null khi chưa chuẩn bị link hoặc chưa cấu hình địa chỉ chia sẻ.

## Kiểm tra nghiệm thu
Tạo nhóm Alice/Bob/Châu: Alice nộp 08:00, Bob nộp 16:50:00, Châu không nộp. Bản gốc: 1 đúng hạn, 2 overdue. Tạo cập nhật: Alice on_time, Bob late_submission, Châu overdue. Chọn Alice trên thiết bị khác để sửa sau nửa đêm; bản gốc giữ nguyên, bản cập nhật dùng nội dung sửa. Đánh dấu nghỉ được tải lại khi chọn tên và hiện trong bản tổng hợp/Word/PDF; có thể bỏ đánh dấu để nhập công việc. Bộ test DB/API chạy bằng đồng hồ giả để không cần chờ giờ thật.
