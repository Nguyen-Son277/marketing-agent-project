# Trình duyệt xã hội

Ứng dụng tạo tác vụ đăng bài/lấy thông tin trên website bằng phiên Chrome do người dùng đăng nhập sẵn. Có lựa chọn Facebook, TikTok, LinkedIn, YouTube, X, Reddit, Threads và website khác; mỗi kênh có URL, tên tài khoản/Page và playbook riêng. Agent đọc giao diện thực tế qua Playwright rồi chọn bước tiếp theo, không phụ thuộc API đăng bài của nền tảng.

Đây là cơ chế điều khiển chung, không phải cam kết mọi website hoặc mọi luồng đăng đều hoạt động. Giao diện canvas, trình soạn thảo không có nhãn truy cập, xác minh, chọn nhạc/video hoặc thay đổi giao diện có thể cần người dùng tiếp quản. Bản này chưa được nghiệm thu bằng tài khoản mạng xã hội thật. Agent không có công cụ điều khiển toàn bộ hệ điều hành bằng hình ảnh.

## Thành phần và quyền điều khiển

- Server hiện tại giữ SQLite, nội dung, tệp và nhật ký. Worker không truy cập cơ sở dữ liệu của ứng dụng.
- Worker chạy Chromium có cửa sổ trên Xvfb/Openbox, lưu profile trên volume riêng. Container desktop này không phải máy ảo. Có thể chạy nó bên trong VPS/VM Linux ở quốc gia được chọn.
- Mỗi worker chỉ gắn với một môi trường/công ty. Một môi trường có nhiều kênh nhưng chỉ chạy một tác vụ tại một thời điểm. Dùng worker và volume khác khi cần tách tài khoản/profile hoặc chạy song song.
- Owner/admin công ty tự tiếp quản màn hình, mở URL, click, nhập/dán văn bản, cuộn và gửi phím để đăng nhập/đăng xuất/2FA. Nội dung nhập trực tiếp được chuyển tới worker, không ghi vào hội thoại hoặc nhật ký tác vụ.
- Agent chỉ có công cụ đọc trang, điều hướng trong tên miền cho phép, chọn phần tử qua role/name, điền nội dung và tải tệp của tác vụ. Không có công cụ lấy cookie, đọc profile, chạy JavaScript tùy ý, shell hay nhập thông tin đăng nhập.
- Các URL/điều khiển xác thực nhận diện được và màn hình mật khẩu/OTP sẽ chuyển về người dùng. Đây là kiểm soát ở mức trình duyệt với nhận diện giao diện, không phải hệ thống phân quyền do từng nền tảng cung cấp. Chỉ giao phiên có quyền phù hợp; dùng playbook rõ tài khoản/Page cần kiểm tra.
- `human`, `agent`, `paused` là ba chế độ loại trừ nhau. Tiếp quản chờ thao tác đang chạy kết thúc rồi ngăn thao tác mới. Đóng cửa sổ tiếp quản vẫn giữ chế độ human; chỉ nút “Giao lại cho agent” mới đổi chế độ.

Vị trí IP do nơi đặt VPS/đường mạng quyết định. Đăng qua trình duyệt hoặc IP nước ngoài không bảo đảm phân phối nội dung sang thị trường đó. Ngôn ngữ, tài khoản, nội dung và khán giả hiện có vẫn có ảnh hưởng; cần kiểm chứng bằng dữ liệu thực tế.

## Chuẩn bị worker trên VPS

Chuẩn bị Linux có Docker Compose, khoảng 2 vCPU/4 GiB RAM cho một môi trường khởi đầu; tăng theo kích thước video và số tác vụ. Chưa cần mua VPS để cấu hình kênh và lưu nội dung, nhưng điều khiển/đăng bài chỉ hoạt động khi worker đã chạy.

Tại bản checkout của dự án trên VPS:

```bash
cp .env.browser.example .env.browser
openssl rand -hex 32
```

Điền khóa ngẫu nhiên vừa tạo vào `BROWSER_WORKER_TOKEN` trong `.env.browser`, rồi chạy:

```bash
docker compose -f docker-compose.browser.yml up -d --build
```

Cổng worker mặc định chỉ bind `127.0.0.1:4090` trên VPS. Không mở cổng này hoặc cổng debugging của Chrome ra Internet. Nếu server ứng dụng chạy trên máy khác, tạo đường hầm từ máy server ứng dụng:

```bash
ssh -NT -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:4090:127.0.0.1:4090 user@VPS_IP
```

Worker chỉ cần kết nối mạng từ nơi đặt nó; không cần đưa mật khẩu mạng xã hội vào `.env`. Nhập khóa kết nối worker và địa chỉ `http://127.0.0.1:4090` tại **Trình duyệt xã hội → Môi trường**. `region` là nhãn do người vận hành nhập, không phải kết quả kiểm tra địa lý IP.

Server chỉ gọi worker có origin trong `BROWSER_WORKER_ALLOWED_ORIGINS`. Mặc định là `http://127.0.0.1:4090`. Khi dùng nhiều worker/đường hầm:

```dotenv
BROWSER_WORKER_ALLOWED_ORIGINS=http://127.0.0.1:4090,http://127.0.0.1:4091
```

Nếu ứng dụng cũng chạy Docker, loopback trong container khác loopback của máy host. Cách cùng mạng Compose: ghép service worker vào cùng mạng riêng, đặt origin `http://browser-worker:4090` trong allowlist và giao diện. Cách tách VPS/mạng: đặt đường hầm hoặc proxy HTTPS sao cho container ứng dụng truy cập được; không dùng `127.0.0.1` của host như thể đó là loopback của container. Endpoint HTTPS từ xa cũng phải có trong allowlist.

Chạy môi trường thứ hai bằng project Compose và cổng riêng, để volume profile không bị dùng chung:

```bash
BROWSER_LOCAL_PORT=4091 docker compose -p marketing-browser-two -f docker-compose.browser.yml up -d
```

Sử dụng khóa khác cho mỗi worker; tạo file cấu hình/project riêng nếu chạy đồng thời. Giữ `.env.browser` ngoài Git. Bản sao lưu volume profile chứa phiên đăng nhập còn hiệu lực, vì vậy lưu bản sao ở nơi được bảo vệ. Xóa volume sẽ mất phiên; `docker compose down` thông thường giữ volume, `down -v` xóa volume.

## Sử dụng

1. **Môi trường:** thêm tên, địa chỉ worker, khóa và vị trí. Có thể sửa kết nối/đổi khóa sau; để trống khóa khi sửa sẽ giữ khóa cũ và đưa môi trường về tạm dừng. Kiểm tra kết nối, bấm **Tiếp quản / đăng nhập**, mở trang và tự đăng nhập. Có thể đăng nhập nhiều nền tảng trong cùng profile. Kiểm tra đúng tài khoản trước khi giao lại cho agent.
2. **Kênh:** chọn môi trường/nền tảng, nhập URL tài khoản/Page hoặc trình soạn bài, tên miền cho phép và playbook. Ví dụ: “Kiểm tra tên Page là Acme US; mở Create post, điền caption, thêm ảnh, kiểm tra preview, Publish; mở bài vừa tạo và lấy permalink”. Không lưu mật khẩu/OTP trong playbook.
3. **Kho nội dung:** lưu tiêu đề và nội dung. Sau đó tải ảnh/video, đợi tải xong. Hỗ trợ PNG/JPG/WebP/GIF/MP4/MOV/WebM, 256 MiB mỗi tệp, tối đa 20 tệp. Quy định thực tế của nền tảng vẫn áp dụng. Tệp lớn được stream ra đĩa, SQLite chỉ giữ metadata.
4. **Tác vụ:** chọn kênh, đăng bài hoặc lấy thông tin, nội dung và yêu cầu cụ thể; chọn **Tạo và chạy**. Agent Social Media cần được bật, gán model hỗ trợ tools và cấp `browser_step`. Khi thêm môi trường, hệ thống bổ sung bốn công cụ browser cho Leader và Social Media; có thể chỉnh grant tại Đội agent.
5. Có thể giao trong **Trao đổi với Leader**, ví dụ: “Đăng nội dung có mã … lên kênh … bằng trình duyệt; dùng đúng văn bản và các ảnh đã lưu”. Leader đọc kênh/kho nội dung qua công cụ rồi thực thi theo nhiệm vụ.

Giới hạn bước và chi phí dùng cấu hình công ty hiện có. Mặc định 12 bước có thể thiếu cho luồng đăng video; người quản lý có thể tăng tại **Cài đặt → Giới hạn chi phí**. Agent hết bước hoặc dừng khi chưa hoàn tất sẽ chuyển tác vụ sang chờ kiểm tra.

## Kết quả, gián đoạn và chống đăng trùng

Tạo tác vụ có `idempotencyKey`; gửi lại cùng payload/key trả cùng tác vụ. Nội dung/tệp và cấu hình kênh không được sửa khi còn tác vụ chưa kết thúc. Mỗi worker chỉ có một tác vụ đang giữ quyền điều khiển.

Đăng bài chỉ được ghi `succeeded` sau khi worker mở URL kết quả trong phạm vi kênh và thấy phần văn bản đầu của nội dung trên trang. Đây là kiểm chứng có giới hạn: website có thể render chậm, rút gọn mô tả hoặc chưa xử lý xong video. Khi không chứng minh được, hệ thống giữ `waiting_human`, không tự đăng lại. Với bài chỉ có media, tiêu đề được dùng để đối chiếu; nếu nền tảng không hiển thị tiêu đề, cần kiểm tra thủ công.

Mất kết nối, thao tác có kết quả không rõ, tiếp quản hoặc server khởi động lại đều không tự phát lại bước đăng. Người dùng mở màn hình, kiểm tra nền tảng và có thể hoàn tất bằng tay. Bản này không tự tiếp tục tác vụ sau khi con người đã thao tác; dừng tác vụ cũ, kiểm tra có bài hay chưa, rồi chỉ tạo nhiệm vụ mới khi cần. Dừng tác vụ không xóa bài đã xuất bản.

Nhật ký lưu tên thao tác, trạng thái và thời gian; không lưu văn bản đăng nhập hoặc ảnh màn hình đăng nhập. Người có quyền xem công ty xem được nội dung/kết quả, chỉ owner/admin được điều khiển phiên.

## API

Tất cả đường dẫn dưới đây bắt đầu bằng `/api/companies/:companyId/social-browser` và cần phiên của thành viên công ty. Thao tác ghi và điều khiển yêu cầu owner/admin.

| Method | Đường dẫn | Công dụng |
|---|---|---|
| GET | `/` | Môi trường, kênh, nội dung và tác vụ |
| POST | `/desktops` | Đăng ký worker, mã hóa khóa kết nối |
| PATCH | `/desktops/:id` | Sửa kết nối; bỏ `token` để giữ khóa cũ |
| POST | `/desktops/:id/test` | Kiểm tra worker |
| POST | `/desktops/:id/mode` | Chuyển human/agent/paused |
| GET | `/desktops/:id/screen` | PNG màn hình trong human mode, không cache |
| POST | `/desktops/:id/input` | Click, text, key, scroll, navigate dành cho người dùng |
| POST / PATCH | `/channels` / `/channels/:id` | Lưu URL, phạm vi và playbook |
| POST / PATCH | `/contents` / `/contents/:id` | Lưu nội dung |
| POST | `/contents/:id/assets` | Multipart một tệp ảnh/video |
| GET / DELETE | `/assets/:id` | Tải/xóa tệp trong công ty |
| POST | `/jobs` | `{channelId, contentId?, kind, instructions, idempotencyKey}` |
| GET | `/jobs` / `/jobs/:id` | Danh sách hoặc chi tiết cùng nhật ký |
| POST | `/jobs/:id/run` | Chạy agent, trả 202 rồi đọc trạng thái |
| POST | `/jobs/:id/cancel` | Dừng, không tự thử đăng lại |

Migration `0020_social_browser` bổ sung bảng nghiệp vụ. Tệp nằm trong `<COMPANIES_ROOT>/.browser-assets/<companyId>/<assetId>`, ngoài thư mục mà công cụ `files_read/files_write` của từng agent được truy cập. Worker và ứng dụng trao đổi qua bearer key; không có endpoint công khai cho phiên điều khiển.
