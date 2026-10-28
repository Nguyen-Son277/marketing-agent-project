# Quản trị WordPress

Màn hình **WordPress** quản lý nhiều website theo công ty. Owner/admin thêm kết nối và giao tác vụ; thành viên khác xem báo cáo. Kết nối mặc định là production. Module dành cho WordPress tự host, chưa hỗ trợ Multisite.

## Cài đặt

1. Sao chép thư mục `plugins/marketing-agent-wordpress` vào `wp-content/plugins/` rồi kích hoạt **Marketing Agent WordPress Bridge**. Yêu cầu WordPress >= 6.5, PHP >= 8 và HTTPS public.
2. Tạo tài khoản quản trị dành riêng cho kết nối. Trong Hồ sơ WordPress, tạo **Application Password**; không dùng mật khẩu đăng nhập wp-admin.
3. Trong màn hình WordPress, thêm URL website, username và Application Password. Khóa được mã hóa bằng SecretBox của dự án, không trả lại qua API. Có thể đổi khóa ở **Sửa kết nối**. Thu hồi khóa cả trong WordPress khi ngừng sử dụng.
4. Chọn **Kiểm tra** để đọc danh tính tài khoản, phiên bản WordPress, plugin/theme và khả năng bridge. Nếu Yoast và Rank Math cùng hoạt động, phải chọn một plugin SEO trong cấu hình kết nối.
5. Với Elementor/backup, cấu hình Browser Worker theo [hướng dẫn browser](trinh-duyet-xa-hoi.md), gắn kênh cùng website. Người dùng tự đăng nhập ở chế độ người dùng rồi chuyển worker sang agent. Kết quả kiểm tra kết nối chỉ xác nhận cấu hình browser, chưa chứng minh phiên đăng nhập còn hiệu lực; adapter kiểm tra lại khi chạy.
6. Cài UpdraftPlus để thay đổi plugin/theme/settings/menu/widget hoặc Elementor. Tạo backup có database, plugins, themes, uploads và others. Giữ bản backup cục bộ đọc được; bản chỉ lưu remote chưa đủ điều kiện. Bridge yêu cầu backup không quá 30 phút.
7. Cài Chrome/Chromium trên máy chủ để chạy Lighthouse. Đặt `WORDPRESS_CHROME_PATH` khi Chrome không nằm trong vị trí tự phát hiện. Chạy máy chủ bằng tài khoản thường, có sandbox Chrome.

Server tự migrate database khi khởi động và chạy worker WordPress. Worker dừng nhận job khi shutdown. Sau restart, job đang chạy chuyển `uncertain`; người vận hành phải kiểm tra website trước khi giao lại.

## Các thao tác đã triển khai

- REST: tìm/đọc/tạo/sửa bài, trang, taxonomy, media; đặt ảnh đại diện, alt text; xuất bản và lên lịch qua `status: future` cùng `date` hoặc `date_gmt`. Giao diện có form phổ biến; các trường chuyên sâu dùng agent/API.
- Gutenberg: chỉnh nội dung block, templates, template-parts, global-styles qua REST. Không chỉnh dữ liệu serialize của builder.
- SEO: title, description, canonical, robots, Open Graph qua một adapter Yoast hoặc Rank Math. Metadata được đọc lại sau ghi. Thiếu plugin sẽ trả lỗi capability; vẫn có thể sửa nội dung thông thường.
- Elementor: adapter cố định cho **heading widget** trên trang: `postId`, `widgetId`, `text`. Đợi phản hồi lưu thành công rồi tải lại editor và kiểm tra heading. Đây chưa phải trình chỉnh sửa mọi widget/layout Elementor; UI khác adapter sẽ dừng.
- Quản trị: cài plugin/theme từ wordpress.org, kích hoạt, cập nhật, vô hiệu hóa/xóa plugin, đổi/xóa theme; settings allowlist (`blogname`, `blogdescription`, `posts_per_page`, `show_on_front`, `page_on_front`, `page_for_posts`), thêm/sửa item menu có sẵn, đổi vị trí widget có sẵn. Không thực thi PHP hoặc endpoint/shell tùy ý.
- Backup: browser khởi tạo UpdraftPlus; worker chỉ báo hoàn tất khi bridge thấy đủ file. Đây là kiểm chứng file cục bộ đọc được, **chưa phải kiểm thử phục hồi hoặc kiểm tra toàn vẹn mọi archive**. Restore toàn site trả `waiting_human`; owner/admin tự thực hiện trong UpdraftPlus vì có thể ghi đè dữ liệu mới.
- Tối ưu ảnh: chỉ media được job của hệ thống tạo; sửa alt text hoặc sinh biến thể WebP giới hạn kích thước/chất lượng. Biến thể giữ riêng, không tự thay URL ảnh gốc. WordPress core xử lý kích thước/lazy-load theo cấu hình của website; module chưa tự viết lại toàn bộ HTML để áp dụng lazy-load.
- Purge cache: WP Super Cache, W3 Total Cache hoặc LiteSpeed khi phát hiện API tương ứng. Minify, gộp script, dọn database hoặc đổi cache engine cần người vận hành đánh giá.
- Audit: Lighthouse mobile và desktop, tối đa 5 URL cùng origin. Lưu LCP, CLS, **TBT**, phát hiện và screenshot cuối trang. TBT không phải INP; chưa tích hợp CrUX/field data. Khi job `optimize` có `urls`, worker đo trước và sau thay đổi, lưu kết quả kiểm chứng riêng; cũng có thể tạo các job audit độc lập để so sánh. Với browser đã liên kết, tác vụ nội dung thử chụp trang trước/sau và báo rõ khi không chụp được. Lệnh ghi có phản hồi thành công được đọc lại qua REST; lỗi bước kiểm chứng không gây gửi lại lệnh ghi. không cam kết thứ hạng Google.

## Job, duyệt và khôi phục

Agent nhận job ID, dùng `wordpress_read` với `resource: "jobs"`, `siteId` và `resourceId` là job ID để theo dõi. Không xem `queued` là thành công. Namespace gồm `wordpress_sites`, `wordpress_read`, `wordpress_content`, `wordpress_seo`, `wordpress_admin`, `wordpress_audit`, `wordpress_optimize`, `wordpress_restore`.

Mỗi website chỉ có một job chạy. `idempotencyKey` phải được giữ nguyên khi gửi lại cùng yêu cầu. Không tự gửi lại tác vụ ghi nếu phản hồi mạng không rõ. Hủy job đang chạy không đảo ngược thao tác đã gửi; có thể kết thúc `uncertain`.

Trước khi ghi, hệ thống lưu snapshot và kiểm tra phiên bản hiện tại. Xóa bài/trang là chuyển thùng rác; trên production phải duyệt hash đúng phiên bản tài nguyên. Khi tài nguyên đổi, yêu cầu duyệt cũ mất hiệu lực. Xóa theme/plugin cũng yêu cầu duyệt production và backup. Media không có thùng rác thì từ chối xóa vĩnh viễn.

Khôi phục nội dung dùng `action: restore`, `sourceJobId` của job sửa/SEO/trash/optimize và cùng `siteId`. Nếu nội dung đã thay đổi sau job, hệ thống dừng để đối chiếu. Khôi phục snapshot không thay thế backup toàn site.

API và handler kiểm owner/admin từ trusted actor, không nhận company hay actor từ model. MCP key mới gắn người tạo; key cũ không có actor sẽ bị từ chối, cần tạo lại. Khi actor mất quyền, key không còn được phép thực thi WordPress.

## API

Prefix: `/api/companies/:companyId/wordpress`. Tất cả cần phiên đăng nhập và membership; các lệnh ghi cần owner/admin.

| Method | Đường dẫn | Chức năng |
|---|---|---|
| GET / POST | `/sites` | Danh sách / thêm website |
| PATCH / DELETE | `/sites/:siteId` | Đổi cấu hình, khóa / thu hồi kết nối |
| POST | `/sites/:siteId/test` | Kiểm tra kết nối, kiểm kê capability |
| GET | `/sites/:siteId/events` | Nhật ký không chứa credential |
| GET / POST | `/jobs` | Xem / tạo job |
| GET | `/jobs/:jobId` | Trạng thái, snapshot, kết quả |
| POST | `/jobs/:jobId/approve` | `{ "hash": "..." }` duyệt xóa |
| POST | `/jobs/:jobId/cancel` | Yêu cầu hủy |

Ví dụ tạo trang nháp (gửi bằng client API đã đăng nhập):

```json
{"siteId":"<id>","action":"create","resource":"pages","data":{"title":"Trang giới thiệu","content":"<!-- wp:paragraph --><p>Nội dung</p><!-- /wp:paragraph -->","status":"draft"},"idempotencyKey":"draft-about-2026-001"}
```

Sau khi job hoàn tất, dùng ID trang trong kết quả để tạo job SEO, xuất bản và audit. Không ghi credential trong nội dung prompt hay `data` của job.

## Kiểm thử

`pnpm test` chạy unit/API tests và browser fixture nếu có Chrome. Chạy `bash tests/wordpress/run-fixture.sh` để dựng WordPress + MariaDB riêng, cài bridge/Yoast/Rank Math/UpdraftPlus/Elementor và kiểm tra REST thật. Script chỉ mở cổng loopback 8097, dùng credential giả, xóa volume fixture sau khi xong; không kết nối website production. Docker và khả năng tải image/plugin là bắt buộc. Browser fixture là HTML mô phỏng, chưa phải bộ kiểm thử end-to-end cho mọi phiên bản UI của plugin.
