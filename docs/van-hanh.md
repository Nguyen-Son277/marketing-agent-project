# Vận hành & triển khai

Tài liệu này dành cho người **cài và giữ cho hệ thống chạy**. Đọc kèm
[kien-truc.md](./kien-truc.md) để hiểu vì sao thiết kế lại như vậy.

Nguyên tắc xuyên suốt: **một tiến trình Node, một file SQLite.** Mọi thao tác vận
hành dưới đây giả định điều đó. Khi bạn thấy mình đang tìm cách chạy hai tiến
trình ghi cùng lúc — dừng lại, đó là dấu hiệu đã chạm ngưỡng cần nâng cấp (§13).

---

## 0. Lệnh nhanh (TL;DR)

```bash
# Cài đặt
cp .env.example .env            # rồi điền APP_SECRET (bắt buộc) và DEEPSEEK_API_KEY
pnpm install --store-dir .pnpm-store
pnpm db:seed --company "Công ty Demo" --email owner@congty.vn --password 'doi-mat-khau-2026' --demo
pnpm kb:index --company cong-ty-demo   # chỉ chạy được khi có file .md trong data/companies/cong-ty-demo/kb (xem §3.4)

# Chạy dev (2 terminal)
pnpm dev:server                 # http://127.0.0.1:3000
pnpm dev:web                    # http://127.0.0.1:5173

# Chạy production
pnpm build:web && NODE_ENV=production pnpm start

# Kiểm tra sức khoẻ
curl -s localhost:3000/healthz
curl -s localhost:3000/readyz
curl -s localhost:3000/api/system/status
```

---

## 1. Yêu cầu hệ thống

| Thành phần | Yêu cầu | Vì sao |
|---|---|---|
| Node.js | **>= 22** (`engines` trong `package.json`) | Server dùng ESM + `import()` động cho route tuỳ chọn; CLI KB dùng `process.loadEnvFile()` của Node 22 |
| pnpm | 11.x (`packageManager: pnpm@11.28.5`) | Workspace nhiều package; bật build script cho native module qua `allowBuilds` |
| SQLite | **không cần cài riêng** | `better-sqlite3` nhúng SQLite kèm FTS5. Máy này **không có** `sqlite3` CLI — các lệnh trong tài liệu vì thế dùng Node |
| Trình biên dịch C (nếu máy không có prebuilt) | `python3`, `make`, `g++` | `better-sqlite3` là native module. Nếu `pnpm install` báo lỗi build → xem §11 |
| Hệ điều hành | Linux/macOS; Windows nên dùng WSL2 | `--watch` của CLI KB dùng `fs.watch({ recursive: true })`; đường dẫn KB dùng dấu `/` |
| Mạng ra ngoài | Chỉ cần ở lần đầu | Tải model ONNX cho embedding (nếu cài), gọi gateway LLM, và các API ngoài (Google/Meta/LinkedIn/Firecrawl) |
| Đĩa | DB + thư mục kiến thức + `node_modules` | `data/` là thứ duy nhất **phải** nằm trên volume bền vững |
| RAM | Không có yêu cầu đặc biệt | Toàn bộ vector tìm kiếm chạy brute-force trong tiến trình (xem [kien-truc.md](./kien-truc.md) §7) |

**Một lưu ý về `node_modules`:** repo dùng pnpm với `node-linker` mặc định, nên
`better-sqlite3` nằm ở `packages/db/node_modules/better-sqlite3`, **không** nằm ở
`node_modules/` gốc. Đây là lý do các lệnh `node -e` trong tài liệu này require
theo đường dẫn tương đối đó. Đừng "sửa" nó thành `require('better-sqlite3')`.

---

## 2. Biến môi trường

Server đọc `.env` ở thư mục làm việc (`loadDotEnv` trong
`apps/server/src/config.ts`). **Biến môi trường thật luôn thắng `.env`** — hữu ích
khi chạy Docker hoặc systemd, nơi bạn không muốn ghi file.

CLI KB đọc `.env` bằng API của Node 22 (`process.loadEnvFile()`), và **không** có
cơ chế ưu tiên y hệt server, nhưng biến môi trường thật vẫn được ưu tiên.

### 2.1 Bảng biến — lấy từ `.env.example` và `config.ts`

| Biến | Bắt buộc | Mặc định | Hệ quả khi đặt / khi thiếu |
|---|---|---|---|
| `APP_SECRET` | **Có** | — | Khoá dẫn xuất để mã hoá API key & credential (AES-256-GCM). Thiếu hoặc < 16 ký tự → server **dừng ngay lúc khởi động** với lỗi `needs_configuration`. Đổi khoá về sau = mọi bí mật đã lưu không giải mã được (§9) |
| `PORT` | Không | `3000` | Cổng HTTP. Chỉ nhận số 0–65535; giá trị ngoài khoảng làm server dừng lúc khởi động |
| `HOST` | Không | `127.0.0.1` | Địa chỉ bind. Mặc định chỉ nghe localhost — **cố ý**, để phải đi qua reverse proxy. Đặt `0.0.0.0` chỉ khi bạn đã có firewall/TLS ở trước |
| `DATABASE_PATH` | Không | `data/marketing.db` | Đường dẫn file SQLite. Thư mục cha được tạo tự động nếu thiếu. Trên production **phải** trỏ vào volume bền vững |
| `COMPANIES_ROOT` | Không | `data/companies` | Gốc **vùng làm việc file** của công ty: tool `files.*` giải đường dẫn tương đối theo `data/companies/<companyId>/`. Đây **không** phải thư mục KB — KB CLI mặc định đọc `data/companies/<slug>/kb` (dùng `--root` nếu muốn đổi) |
| `NODE_ENV` | Không | `development` | `production` bật **cookie `Secure`** và **ẩn chi tiết lỗi 4xx/5xx** khỏi phản hồi. Chỉ đặt `production` khi thật sự chạy sau HTTPS |
| `SESSION_TTL_DAYS` | Không | `30` | Số ngày một phiên đăng nhập còn hiệu lực (1–365). Phiên hết hạn bị dọn mỗi giờ |
| `MAX_BODY_BYTES` | Không | `2000000` (2 MB) | Trần kích thước JSON body (1 024–50 000 000). Tăng khi nhập tài liệu KB lớn qua UI |
| `WEB_DIST` | Không | `apps/web/dist` nếu tồn tại | Thư mục SPA đã build để server phục vụ tĩnh. Không tồn tại → server chạy API-only, `GET /` trả "Chưa có bản dựng giao diện" |
| `DEFAULT_LLM_BASE_URL` | Không | `http://localhost:20128/v1` | Chỉ dùng **lúc `pnpm db:seed`** để tạo provider mặc định. Đổi sau đó phải sửa trong giao diện Cài đặt → Nhà cung cấp |
| `DEFAULT_LLM_API_KEY_REF` | Không | `DEEPSEEK_API_KEY` | **Tên** biến môi trường giữ khoá, không phải khoá. Nhờ vậy khoá không bao giờ được ghi vào DB |
| `DEEPSEEK_API_KEY` | Thực tế **có** | rỗng | Giá trị thật cho tham chiếu trên. Gateway yêu cầu key (gọi không key → `Missing API key`), nên để rỗng thì mọi lượt chat đều lỗi provider |
| `EMBEDDING_PROVIDER` | Không | `local` | `local` \| `remote` \| `hash`. Giá trị khác → server dừng lúc khởi động. Xem §11 về fallback |
| `EMBEDDING_MODEL` | Không | `Xenova/multilingual-e5-small` | Model ONNX (local) hoặc model id của API `/embeddings` (remote) |
| `EMBEDDING_BASE_URL` | Chỉ khi `remote` | rỗng | Gốc API OpenAI-compatible; code tự thêm `/embeddings`. **Đừng trỏ vào gateway `:20128`** — nó trả 400 cho `/v1/embeddings` |
| `EMBEDDING_API_KEY` | Không | rỗng | Bearer token cho dịch vụ nhúng remote |
| `EMBEDDING_DIM` | Không | `256` với hash, tự dò với local/remote | Số chiều vector. Chỉ nên đặt khi dùng `hash` và cần cố định kích thước giữa các môi trường |

`EMBEDDING_DIM` nằm trong `packages/kb/src/embeddings.ts` chứ không nằm trong
`config.ts`, nên nó **không** làm server dừng nếu bạn gõ sai — nó chỉ bị bỏ qua.

### 2.2 Biến có trong `config.ts` nhưng chưa có trong `.env.example`

`COMPANIES_ROOT`, `SESSION_TTL_DAYS`, `MAX_BODY_BYTES`, `WEB_DIST`, `NODE_ENV`.
Tất cả đều có mặc định an toàn, bạn chỉ cần đặt khi muốn đổi. Khi thêm vào
`.env`, ghi đúng tên như bảng trên.

### 2.3 `.env` không bao giờ được commit

`.gitignore` đã chặn `.env`, `.env.local`, `data/` và `*.log`. Giữ nguyên như vậy.
Bí mật duy nhất bắt buộc là `APP_SECRET`; mọi bí mật khác nên đến từ trình quản
lý bí mật của hạ tầng (Docker secret, systemd `EnvironmentFile` quyền 600, vault).

---

## 3. Cài đặt lần đầu

### 3.1 Chuẩn bị `.env`

```bash
cp .env.example .env
# Sinh APP_SECRET đủ mạnh (>= 32 ký tự là khuyến nghị; tối thiểu kỹ thuật là 16)
openssl rand -base64 48
```

Dán kết quả vào `APP_SECRET=`. Điền `DEEPSEEK_API_KEY=` bằng khoá thật của
gateway. Các biến còn lại có thể để mặc định.

### 3.2 Cài phụ thuộc

```bash
pnpm install --store-dir .pnpm-store
```

**Vì sao có `--store-dir`:** store mặc định của pnpm nằm ở `~/.local/share/pnpm/store`
(hoặc một thư mục dùng chung), và trên nhiều máy thư mục đó bị chặn quyền hoặc do
người khác sở hữu → cài đặt thất bại giữa đường. Trỏ store vào trong repo loại bỏ
hẳn lớp lỗi đó. Repo đã có sẵn `.pnpm-store/`, nên dùng lại đúng thư mục này.

**Cạm bẫy:** pnpm 10+ **chặn postinstall mặc định**. `pnpm-workspace.yaml` đã
whitelist `better-sqlite3` và `esbuild` qua `allowBuilds`. Nếu bạn vô tình xoá
khối đó, `better-sqlite3` sẽ không có binary native và server chết ngay dòng
`import` đầu tiên — thông báo lỗi khi đó rất khó đoán (§11).

### 3.3 Cài catalog và công ty đầu tiên

```bash
# Chỉ catalog toàn cục (10 định nghĩa agent, kỹ năng, provider + model)
pnpm db:seed

# Catalog + một công ty dùng được ngay, kèm tài khoản chủ sở hữu và kho mẫu
pnpm db:seed --company "Công ty Demo" --email owner@congty.vn --password 'doi-mat-khau-2026' --demo
```

Tham số của `db:seed` (đọc từ `seed/cli/seed.ts`):

| Tham số | Ý nghĩa |
|---|---|
| `--company "<tên>"` | Tạo (hoặc tái dùng) công ty theo slug suy ra từ tên. Không có tham số này thì chỉ cài catalog |
| `--email`, `--password` | Tạo chủ sở hữu và gán membership `owner`. Phải có **cả hai**, thiếu một cái thì không tạo tài khoản |
| `--owner-name "<tên>"` | Tên hiển thị của chủ sở hữu; mặc định "Chủ sở hữu" |
| `--demo` | Cài 11 tài liệu kiến thức mẫu vào DB |

Seed là **idempotent**: chạy lại không nhân bản dữ liệu, chỉ vá dòng thiếu. Chạy
lại được yên tâm sau mỗi lần cập nhật phiên bản.

Server kiểm tra catalog lúc khởi động (`preflight`):
- 0 định nghĩa agent → `pnpm db:seed`
- 0 model đang bật → `pnpm db:seed` hoặc thêm provider trong giao diện

Khi chưa đủ, server **vẫn chạy** nhưng tạo công ty sẽ trả lỗi `needs_configuration`
(HTTP 424). Đó là hành vi có chủ đích: một deployment quên seed sẽ báo rõ ngay ở
màn hình đầu tiên, thay vì vỡ khó hiểu ở tin nhắn đầu tiên.

### 3.4 Đưa nội dung vào kho kiến thức

Hai đường, chọn theo nguồn nội dung:

**A. Người dùng nhập qua giao diện** — lưu vào DB và index ngay. Không cần lệnh.

**B. Đội marketing sửa Markdown trên đĩa** — dùng CLI:

```bash
pnpm kb:index --company cong-ty-demo
```

Tham số (`packages/kb/src/cli/index-company.ts`):

| Tham số | Ý nghĩa |
|---|---|
| `--company <slug>` | **Bắt buộc.** Tìm công ty theo slug (có chuẩn hoá qua `slugify`, nên gõ "Công ty Demo" cũng khớp) |
| `--force` | Index lại cả file không đổi |
| `--watch` | Giữ tiến trình sống, index lại sau mỗi lần lưu file (gộp trong 400 ms) |
| `--root <thư-mục>` | Ghi đè thư mục KB |
| `--database/--db <file>` | Ghi đè `DATABASE_PATH` |
| `--help` / `-h` | In hướng dẫn |

Thư mục mặc định là **`data/companies/<slug>/kb`** (`companyKbDir` trong
`packages/kb/src/indexer.ts`). Đây là đường dẫn **cố định** theo slug, không phụ
thuộc `COMPANIES_ROOT` (biến đó dùng cho vùng làm việc file của tool `files.*`).
Muốn trỏ CLI sang nơi khác thì dùng `--root`. File phải có đuôi `.md`, bỏ qua
file/thư mục ẩn.
Indexer đọc frontmatter, cắt theo heading (~800 ký tự, chồng lấn 120), rồi nhúng
vector. File lỗi được ghi vào `kb_index_jobs` và in ra, **không** làm dừng cả lượt.

**Cạm bẫy quan trọng — `--demo` không tạo file trên đĩa.** `seedKnowledge()` chỉ
ghi tài liệu vào DB (mỗi tài liệu một chunk toàn văn), **không** ghi file `.md` vào
`data/companies/`. Vì thế:

- Tìm kiếm **từ khoá** chạy được ngay sau `--demo`.
- `pnpm kb:index --company <slug>` sẽ báo `Không có thư mục kiến thức: ...` cho tới
  khi bạn tự tạo `data/companies/<slug>/kb/` và đặt nội dung Markdown vào đó.
- Muốn đồng bộ nội dung mẫu ra đĩa, chép nội dung từ màn hình Kho kiến thức (hoặc
  từ `seed/src/knowledge.ts`) thành file `.md` trong thư mục trên, rồi chạy lại
  `pnpm kb:index`.

Ở lần chạy đầu, `pnpm kb:index` cần `APP_SECRET` (nó mở DB qua cùng `createRepos`),
nên hãy chạy trong thư mục repo có `.env`.

---

## 4. Chạy chế độ phát triển

Cần **hai terminal** vì có hai tiến trình độc lập:

```bash
# Terminal 1 — API + SSE
pnpm dev:server        # tsx watch apps/server/src/main.ts

# Terminal 2 — giao diện
pnpm dev:web           # vite
```

Mở **http://127.0.0.1:5173**, không phải cổng 3000. Lý do: cookie phiên là
`HttpOnly` + `SameSite=Lax`, nên trình duyệt sẽ không gửi nó qua hai origin khác
nhau. Vite proxy `/api`, `/healthz`, `/readyz` về `http://127.0.0.1:3000`
(`apps/web/vite.config.ts`), nhờ vậy trình duyệt thấy **một origin duy nhất**.

Muốn trỏ Vite sang server khác cổng:

```bash
BACKEND_URL=http://127.0.0.1:4000 pnpm dev:web
```

`dev:server` dùng `tsx watch` nên tự nạp lại khi sửa mã nguồn. Server cũng tự nạp
lại khi bạn sửa `.env`? **Không** — `.env` chỉ được đọc lúc khởi động. Sửa `.env`
thì phải khởi động lại tiến trình.

---

## 5. Chạy production

```bash
pnpm build:web
NODE_ENV=production pnpm start
```

**Vì sao bắt buộc `build:web`:** `pnpm start` chỉ chạy server Node. Server phục vụ
SPA tĩnh từ `apps/web/dist` **nếu thư mục đó tồn tại** (`resolveWebDist` trong
`config.ts`); không có nó thì `GET /` trả "Chưa có bản dựng giao diện. Chạy:
pnpm build:web". Vite dev server không được dùng ở production.

Điều đáng nhớ về `NODE_ENV=production`:

1. Cookie phiên được gắn cờ `Secure` → trình duyệt **chỉ** gửi cookie qua HTTPS.
   Đặt production mà không có TLS phía trước ⇒ đăng nhập xong lại quay về màn hình
   đăng nhập. Đây là lỗi phổ biến nhất khi triển khai lần đầu.
2. Chi tiết lỗi 4xx bị ẩn khỏi phản hồi (vẫn ghi log đầy đủ ở server). Muốn xem
   chi tiết khi gỡ rối, tạm chạy không đặt `NODE_ENV`.

Chạy bằng systemd (ví dụ tối thiểu, đường dẫn theo máy của bạn):

```ini
[Service]
WorkingDirectory=/srv/marketing-agent
EnvironmentFile=/srv/marketing-agent/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/pnpm start
User=marketing
Restart=on-failure
```

Server bắt `SIGINT`/`SIGTERM`: đóng listener HTTP trước, rồi đóng DB sau, nên các
thao tác ghi đang dở được hoàn tất. Đừng dùng `kill -9` khi có thể `systemctl stop`.

---

## 6. Docker Compose

> **Trạng thái: CHƯA CÓ TRONG REPO.** Tại thời điểm viết tài liệu này, repo
> **không** có `Dockerfile`, `docker-compose.yml` hay `compose.yaml`. Phần dưới mô
> tả thiết kế đã chốt trong [kien-truc.md](./kien-truc.md) §2.2 (một instance +
> volume bền vững) và là mẫu tham chiếu để người thêm file sau này bám theo. Đừng
> coi các lệnh `docker compose` ở đây là đã chạy được.

Kiến trúc đúng là **một container ứng dụng + một volume**:

- Container chạy `NODE_ENV=production pnpm start` sau khi đã `pnpm build:web`
  trong giai đoạn build image.
- Volume gắn vào `/app/data` — chứa **cả** `marketing.db` và `companies/`. Chỉ
  mount một thư mục cha để backup là một đường duy nhất.
- `.env` đưa vào bằng `env_file`, hoặc biến môi trường từ secret manager. Không
  bake `.env` vào image.
- `APP_SECRET` nên là secret của orchestrator, không nằm trong image.

Mẫu tham chiếu (`docker-compose.yml`, **chưa có trong repo**):

```yaml
services:
  app:
    build: .
    env_file: .env
    environment:
      NODE_ENV: production
      DATABASE_PATH: /app/data/marketing.db
      COMPANIES_ROOT: /app/data/companies
      HOST: 0.0.0.0
      PORT: 3000
    ports:
      - "127.0.0.1:3000:3000"   # chỉ mở ra localhost; TLS do reverse proxy lo
    volumes:
      - marketing-data:/app/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s

volumes:
  marketing-data:
```

**Vì sao healthcheck dùng `/readyz` chứ không `/healthz`:** `/healthz` chỉ nói
"tiến trình còn sống" và luôn trả 200. `/readyz` trả **503 khi chưa seed catalog**
— đúng thứ bạn muốn trước khi để traffic vào. Dùng `/healthz` làm healthcheck sẽ
báo container "khoẻ" trong khi mọi thao tác tạo công ty đều thất bại.

**Cập nhật phiên bản:**

```bash
docker compose build          # build image mới (đã build web trong image)
docker compose up -d          # thay container, volume giữ nguyên
docker compose exec app node -e "console.log('kiểm tra sau nâng cấp')"
curl -s localhost:3000/api/system/status   # xem appliedMigrations
```

Migration chạy tự động khi mở DB (§10), nên bước duy nhất bắt buộc trước khi nâng
cấp là **sao lưu volume** (§8). Không thể quay lui schema nếu không có bản sao.

**Không chạy nhiều replica.** `deploy.replicas: 2` sẽ tạo hai tiến trình ghi lên
cùng file SQLite qua cùng volume — SQLite không hỗ trợ, và bạn sẽ gặp `SQLITE_BUSY`
cùng nguy cơ hỏng dữ liệu. Một instance là ràng buộc thiết kế, không phải cấu hình
thiếu.

---

## 7. Kiểm tra sức khoẻ

| Endpoint | Trả về | Khi nào dùng | Nguồn |
|---|---|---|---|
| `GET /healthz` | `200 {"status":"ok"}` — luôn luôn | Liveness probe, kiểm tra tiến trình còn thở | `apps/server/src/app.ts` |
| `GET /readyz` | `200 {"status":"ready",agentDefs,models,sseClients}` hoặc `503 {"status":"not-ready",...}` | Readiness probe, quyết định có đưa traffic vào | `apps/server/src/app.ts` |
| `GET /api/system/status` | `{"ready":bool,"catalog":{ready,agentDefs,skills,models,problem?},"appliedMigrations":[...]}` | Người vận hành đọc để biết thiếu gì | `apps/server/src/routes/auth-routes.ts` |

`/readyz` coi là chưa sẵn sàng khi **0 định nghĩa agent** hoặc **0 model đang bật**.
`appliedMigrations` chỉ liệt kê các migration **do tiến trình hiện tại áp dụng**;
sau lần khởi động thứ hai, danh sách này sẽ rỗng dù DB đã đầy đủ. Muốn xem toàn bộ,
đọc bảng `schema_migrations` (§10).

Lệnh kiểm tra nhanh:

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/healthz   # 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/readyz    # 200, hoặc 503 nếu chưa seed
curl -s localhost:3000/api/system/status | head -c 400
```

`sseClients` trong `/readyz` là số kết nối SSE đang mở. Nó tăng vọt bất thường
nghĩa là client không đóng kết nối khi rời trang.

---

## 8. Sao lưu & phục hồi

Đây là phần quan trọng nhất của tài liệu. SQLite ở chế độ **WAL**: dữ liệu mới
nhất có thể nằm trong `marketing.db-wal` và chưa được ghi vào `marketing.db`.
**Copy mỗi file `.db` trong lúc hệ thống đang chạy sẽ cho bạn một bản sao thiếu dữ
liệu hoặc hỏng.** Đừng làm vậy. Dùng API backup của SQLite.

### 8.1 Cách đúng: `VACUUM INTO`

`VACUUM INTO` tạo một file SQLite **mới, đã kiểm tra tính toàn vẹn**, từ một kết nối
chỉ đọc — an toàn khi server đang chạy. Máy này **không có `sqlite3` CLI**, nên
dùng chính `better-sqlite3` đã cài trong repo:

```bash
mkdir -p data/backup
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

node -e "const D=require('./packages/db/node_modules/better-sqlite3');\
const db=new D('data/marketing.db',{readonly:true});\
db.exec(\"VACUUM INTO 'data/backup/marketing-${STAMP}.db'\");\
db.close();console.log('đã sao lưu data/backup/marketing-${STAMP}.db')"
```

Hai điểm bắt buộc để lệnh này chạy đúng:

1. `require('./packages/db/node_modules/better-sqlite3')` — **không** phải
   `require('better-sqlite3')`. pnpm không hoist native module lên gốc.
2. Đường dẫn đích trong `VACUUM INTO` phải **chưa tồn tại**; SQLite từ chối ghi đè.

Đổi `data/marketing.db` nếu `DATABASE_PATH` của bạn khác.

### 8.2 Cách thay thế: `.backup` của `sqlite3`

Nếu máy có `sqlite3` CLI:

```bash
sqlite3 data/marketing.db ".backup 'data/backup/marketing-$(date -u +%Y%m%dT%H%M%SZ).db'"
```

`.backup` cũng dùng API backup, nên cũng an toàn khi đang chạy. Đừng nhầm với
`cp`.

### 8.3 Kiểm thử phục hồi — làm thật, không chỉ lưu file

Một bản sao chưa từng được mở thử thì chưa phải là bản sao. Quy trình dưới đây đã
chạy được trên repo này (bỏ dấu `<...>` đi):

```bash
# 1. Kiểm tra toàn vẹn bản sao
node -e "const D=require('./packages/db/node_modules/better-sqlite3');\
const c=new D('data/backup/<file>.db',{readonly:true});\
console.log('integrity_check:', c.pragma('integrity_check',{simple:true}));\
c.close()"
# Kỳ vọng: integrity_check: ok
```

```bash
# 2. Phục hồi vào một DB tạm rồi so sánh số liệu — không đụng DB thật
cp data/backup/<file>.db /tmp/restore-test.db
node -e "const D=require('./packages/db/node_modules/better-sqlite3');\
const c=new D('/tmp/restore-test.db',{readonly:true});\
console.log('migrations:', c.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(r=>r.id).join(', '));\
console.log('agents:', c.prepare('SELECT COUNT(*) n FROM agent_defs').get().n,\
 'companies:', c.prepare('SELECT COUNT(*) n FROM companies').get().n,\
 'chunks:', c.prepare('SELECT COUNT(*) n FROM kb_chunks').get().n);\
c.close()"
```

```bash
# 3. Phục hồi thật (chỉ khi cần)
systemctl stop marketing-agent          # hoặc: docker compose down
mv data/marketing.db data/marketing.db.broken
cp data/backup/<file>.db data/marketing.db
rm -f data/marketing.db-wal data/marketing.db-shm   # dọn sidecar của DB cũ
chmod 600 data/marketing.db
systemctl start marketing-agent
curl -s localhost:3000/readyz            # kỳ vọng 200 status=ready
```

Bước `rm -f ...-wal ...-shm` là bắt buộc nếu trước đó DB cũ bị hỏng giữa chừng:
sidecar còn sót lại thuộc về file `.db` cũ và có thể làm SQLite từ chối mở bản
mới.

### 8.4 Sao lưu `APP_SECRET` cùng lúc — không thương lượng

DB chứa `llm_providers.api_key_enc` và `integrations.config_enc`, mã hoá bằng khoá
dẫn xuất từ `APP_SECRET`. **Chỉ khôi phục DB mà không có `APP_SECRET` tương ứng
thì mọi API key đã lưu vĩnh viễn không giải mã được** (§9). Vì vậy mỗi bản sao DB
phải đi kèm một bản ghi `APP_SECRET` đúng thời điểm đó.

Thực hành: lưu `APP_SECRET` trong trình quản lý bí mật có phiên bản, và ghi lại
"bản sao DB ngày X dùng secret phiên bản Y". Đừng để `APP_SECRET` chỉ nằm trong
một file `.env` duy nhất trên một máy.

### 8.5 Tần suất đề xuất

| Kịch bản | Tần suất | Giữ bao lâu |
|---|---|---|
| Công ty đang chạy hằng ngày | `VACUUM INTO` mỗi 24 giờ (đặt cron/systemd timer) | 7 bản ngày + 4 bản tuần |
| Trước mỗi lần nâng cấp phiên bản | 1 bản ngay trước khi `git pull` | Cho tới khi xác nhận phiên bản mới ổn |
| Trước khi thao tác rủi ro (xoá công ty, reindex toàn bộ, đổi `APP_SECRET`) | 1 bản ngay trước | Ít nhất 30 ngày |
| Tải ghi thấp, dữ liệu quan trọng | Mỗi 6 giờ | 3 ngày |

Đây là khuyến nghị vận hành, không phải giới hạn kỹ thuật: `VACUUM INTO` trên DB
vài trăm MB mất dưới một giây nên chạy dày cũng rẻ. Chi phí thật là dung lượng đĩa.

Timer systemd mẫu — đặt lệnh sao lưu vào một script để không phải lồng dấu nháy
trong unit file:

```bash
# /srv/marketing-agent/scripts/backup.sh   (chmod 750)
#!/usr/bin/env bash
set -euo pipefail
cd /srv/marketing-agent
mkdir -p data/backup
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
node -e "const D=require('./packages/db/node_modules/better-sqlite3');\
const db=new D('data/marketing.db',{readonly:true});\
db.exec(\"VACUUM INTO 'data/backup/marketing-${STAMP}.db'\");\
db.close();console.log('đã sao lưu', '${STAMP}')"
find data/backup -name 'marketing-*.db' -mtime +30 -delete   # giữ 30 ngày
```

```ini
# /etc/systemd/system/marketing-backup.service
[Service]
Type=oneshot
User=marketing
ExecStart=/srv/marketing-agent/scripts/backup.sh

# /etc/systemd/system/marketing-backup.timer
[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
systemctl enable --now marketing-backup.timer
```

**Cạm bẫy dung lượng:** bản sao nằm cùng đĩa với DB thì một đĩa đầy sẽ phá cả hai.
Định kỳ đồng bộ `data/backup/` sang nơi khác (`rsync`, object storage). Bản sao
chứa email người dùng, hash mật khẩu và bí mật đã mã hoá → phải được bảo vệ và mã
hoá khi rời máy, và không được commit (repo đã chặn `data/`).

---

## 9. `APP_SECRET`: mất, đổi, và xoay khoá

### 9.1 Cơ chế thật (đọc từ `packages/db/src/crypto.ts`)

- Khoá mã hoá = `scryptSync(APP_SECRET, 'marketing-agent.secret.v1', 32)` → 32 byte
  cho AES-256-GCM. **Salt cố định**, nên cùng `APP_SECRET` luôn cho cùng khoá.
- Mỗi lần mã hoá dùng **IV 96-bit ngẫu nhiên mới**; auth tag 16 byte được gắn sau
  ciphertext rồi base64. Nhờ IV ngẫu nhiên, hai lần lưu cùng một API key cho hai
  chuỗi `enc` khác nhau.
- Yêu cầu tối thiểu **16 ký tự** (cả `config.ts` lẫn `SecretBox` đều chặn). Thông
  báo ở CLI KB có nhắc "32 ký tự" — đó là khuyến nghị độ mạnh, không phải ngưỡng
  kỹ thuật. Cứ dùng >= 32 ký tự ngẫu nhiên.
- Giải mã thất bại (auth tag sai) → `AppError('needs_configuration', 'Không giải mã
  được bí mật đã lưu. APP_SECRET có thể đã thay đổi — cần nhập lại API key.')`.
  **Không** rò rỉ giá trị bí mật, chỉ báo lỗi cấu hình.

### 9.2 Hệ quả khi MẤT `APP_SECRET`

- Mọi API key provider lưu trong DB (nhập qua giao diện) và mọi credential tích
  hợp (`integrations.config_enc`) **không thể giải mã**. Không có cửa hậu, không có
  brute-force: AES-256-GCM với khoá scrypt.
- Dữ liệu khác (công ty, người dùng, hội thoại, KB, chi phí) **vẫn nguyên vẹn** —
  chúng không phụ thuộc `APP_SECRET`.
- Provider dùng `api_key_ref` (trỏ tên biến môi trường) **không bị ảnh hưởng**, vì
  khoá của nó chưa bao giờ nằm trong DB. Đây là lý do nên dùng tham chiếu env cho
  key của deployment.

Cách chữa: khôi phục `APP_SECRET` cũ từ bản sao/nơi lưu, hoặc nhập lại từng key
trong giao diện Cài đặt.

### 9.3 Quy trình xoay khoá an toàn

Vì salt cố định và không có công cụ giải mã-rồi-mã-hoá lại trong repo, xoay khoá
thực chất là **đổi khoá + nhập lại bí mật**. Trình tự:

1. **Sao lưu DB ngay bây giờ** (§8) và ghi lại `APP_SECRET` cũ. Không có bước này
   thì không thể quay lui.
2. Sinh `APP_SECRET` mới: `openssl rand -base64 48`.
3. Cập nhật `APP_SECRET` ở nơi cấu hình (`.env`/secret manager).
4. Khởi động lại server. Các provider đang dùng key mã hoá sẽ lỗi giải mã cho tới
   bước 5.
5. Vào **Cài đặt → Nhà cung cấp**, nhập lại API key cho từng provider; và **Cài
   đặt → Tích hợp**, nhập lại credential cho từng tích hợp. Provider dùng
   `api_key_ref` bỏ qua bước này.
6. Kiểm tra: gửi một tin nhắn thử trong Chat, xem màn hình Chi phí có ghi `runs`
   mới, và `curl /readyz` trả 200.
7. Giữ `APP_SECRET` cũ ở nơi lưu trữ cho tới khi hết thời hạn lưu bản sao DB cũ,
   rồi huỷ.

**Làm ngoài giờ làm việc và thông báo trước.** Từ bước 4 tới hết bước 5, các agent
không gọi được provider nào dùng key mã hoá.

---

## 10. Nâng cấp schema & rollback

### 10.1 Migration là append-only

Schema nằm trong `packages/db/src/migrations.ts` dưới dạng mảng `MIGRATIONS`.
Hiện có **6** migration:

`0001_core_tenancy`, `0002_llm_registry`, `0003_team`, `0004_knowledge`,
`0005_work`, `0006_accounting_integrations`.

> Ghi chú: `docs/kien-truc.md` §4 nói "Bảy migration" — con số đúng tại thời điểm
> viết tài liệu này là **6** (xem cũng `schema_migrations` trên DB đã seed).

Quy tắc: **không sửa một migration đã phát hành.** DB của khách đã ghi id đó vào
`schema_migrations`; sửa nội dung chỉ khiến các deployment lệch nhau. Cần đổi gì
thì thêm entry mới.

### 10.2 Cách migration chạy

`openDatabase()` (`packages/db/src/database.ts`) thực hiện khi **mở** DB:

1. `CREATE TABLE IF NOT EXISTS schema_migrations (id, applied_at, statements)`.
2. Đọc các `id` đã áp dụng.
3. Với mỗi migration chưa có: `BEGIN` → chạy SQL → ghi `schema_migrations` →
   `COMMIT`; lỗi thì `ROLLBACK` và ném `AppError` (`Migration <id> thất bại: ...`).

Nghĩa là migration chạy **tự động** ở lần khởi động đầu tiên của phiên bản mới —
bạn không có lệnh `migrate` riêng. Đồng thời, tiến trình nào mở DB trước (server
hoặc `pnpm kb:index` hoặc `pnpm db:seed`) sẽ là tiến trình áp dụng migration.

Pragma đặt tại mỗi kết nối: `journal_mode = WAL`, `synchronous = NORMAL`,
`foreign_keys = ON`, `busy_timeout = 5000`.

### 10.3 Quy trình nâng cấp

```bash
# 1. Sao lưu trước — đây là "rollback" duy nhất bạn có
mkdir -p data/backup
node -e "const D=require('./packages/db/node_modules/better-sqlite3');const db=new D('data/marketing.db',{readonly:true});db.exec(\"VACUUM INTO 'data/backup/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ).db'\");db.close()"

# 2. Dừng server
systemctl stop marketing-agent

# 3. Cập nhật mã + phụ thuộc
git pull
pnpm install --store-dir .pnpm-store

# 4. Build lại giao diện (bắt buộc nếu apps/web đổi)
pnpm build:web

# 5. Khởi động; migration chạy trong lần mở DB đầu tiên
systemctl start marketing-agent
curl -s localhost:3000/api/system/status    # xem appliedMigrations + problem
curl -s localhost:3000/readyz               # 200 = catalog sẵn sàng
```

### 10.4 Rollback thực tế = khôi phục bản sao

Không có "down migration". Nếu phiên bản mới hỏng:

```bash
systemctl stop marketing-agent
mv data/marketing.db data/marketing.db.failed
cp data/backup/pre-upgrade-<stamp>.db data/marketing.db
rm -f data/marketing.db-wal data/marketing.db-shm
chmod 600 data/marketing.db
git checkout <tag-phiên-bản-cũ>
pnpm install --store-dir .pnpm-store
pnpm build:web
systemctl start marketing-agent
```

Đây là lý do bước 1 không được bỏ. Migration đã `COMMIT` thì không thể tự lùi; chỉ
có bản sao mới lùi được.

Nếu chỉ một migration lỗi giữa đường, `ROLLBACK` đảm bảo nó không để lại nửa vời —
nhưng các migration trước đó trong cùng lần mở đã commit, nên DB có thể đang ở
trạng thái trung gian. Khôi phục bản sao là đường sạch nhất.

### 10.5 Xem trạng thái schema

```bash
node -e "const D=require('./packages/db/node_modules/better-sqlite3');\
const c=new D('data/marketing.db',{readonly:true});\
console.table(c.prepare('SELECT id, applied_at, statements FROM schema_migrations ORDER BY id').all());\
c.close()"
```

---

## 11. Xử lý sự cố

### 11.1 `SQLITE_BUSY` / `database is locked`

**Triệu chứng:** log có `SQLITE_BUSY`, thao tác ghi chậm hoặc thất bại.

**Nguyên nhân thường gặp, theo thứ tự hay gặp:**

1. **Hai tiến trình ghi cùng DB.** Ví dụ chạy `pnpm dev:server` và `pnpm start`
   cùng lúc, hoặc chạy hai container cùng mount một volume. SQLite cho phép nhiều
   kết nối, nhưng chỉ một writer. → Chỉ chạy một server.
2. **`pnpm kb:index --watch` chạy song song với server.** Đây là tình huống *được
   phép*: WAL cho phép đọc trong lúc ghi và `busy_timeout = 5000` hấp thụ va chạm.
   Nếu vẫn thấy `SQLITE_BUSY`, index đang ghi quá dày — giảm tần suất, hoặc chấp
   nhận chạy CLI index theo lô thay vì `--watch`.
3. **Transaction bắc qua `await`.** Đây là lỗi lập trình, không phải lỗi vận hành:
   thiết kế yêu cầu transaction ngắn và không bao giờ giữ qua `await`. Nếu bạn là
   người phát triển và gặp lỗi này, hãy tìm chỗ đó.
4. **Volume mạng (NFS/SMB).** Khoá file của SQLite không hoạt động đúng trên
   filesystem mạng. → Đặt `data/` trên đĩa cục bộ.

**Kiểm tra nhanh:**

```bash
ps aux | grep -E 'main\.ts|seed\.ts|index-company' | grep -v grep
ls -la data/marketing.db*
```

Sidecar `marketing.db-wal` lớn bất thường là dấu hiệu checkpoint không chạy được —
thường do tiến trình khác đang giữ kết nối đọc mở mãi.

### 11.2 Provider trả 401/403

**Đây là lỗi cấu hình, hệ thống KHÔNG thử lại** — `isRetryableProviderError`
(`packages/llm/src/provider.ts`) trả `false` cho 4xx không phải 400 tạm thời.
Thử lại một request sai khoá chỉ tốn thời gian.

Việc cần làm:
1. Kiểm tra `DEEPSEEK_API_KEY` có giá trị trong `.env` không, và đã khởi động lại
   server chưa (`.env` chỉ đọc lúc boot).
2. Nếu provider nhập qua giao diện: **Cài đặt → Nhà cung cấp**, xem
   `apiKeyConfigured`. Nhập lại key nếu cần. Sau khi đổi `APP_SECRET`, mọi key mã
   hoá đều phải nhập lại (§9).
3. Dùng nút **Kiểm tra** của provider (endpoint `/providers/:id/test` khi route
   hoàn thành) để xác nhận kết nối.
4. Nhớ rằng `DEFAULT_LLM_BASE_URL`/`DEFAULT_LLM_API_KEY_REF` chỉ có tác dụng lúc
   `pnpm db:seed`. Chạy lại seed để tạo provider đúng, hoặc sửa trong giao diện.

### 11.3 Provider trả 429 / 5xx

Hệ thống **có** thử lại: backoff mũ có giới hạn, rồi escalate model cùng tier
(xem [luong-hoat-dong.md](./luong-hoat-dong.md) §5). Việc cần làm:

1. Chờ — thường tự khỏi.
2. Nếu kéo dài, kiểm tra hạn mức của gateway/nhà cung cấp.
3. Xem `runs.status` và `runs.error` trên màn hình Chi phí để biết task nào hỏng.
4. Giảm tải: giảm `maxParallelTasks` trong **Cài đặt → Giới hạn**, hoặc tạm dùng
   model rẻ hơn cho các vai trò không cần suy luận sâu.

### 11.4 Gateway trả 400 tạm thời khi đang dùng tool

Đây là hiện tượng **đã đo được**, không phải suy đoán: gateway định tuyến nội bộ có
lúc trả 400 `bad_request` cho một request hoàn toàn hợp lệ (1–2 lần hỏng trong 3
lần gọi cùng payload, theo ghi chú trong `packages/llm/src/provider.ts`).

Cách hệ thống xử lý: 400 **chỉ được thử lại** khi thân lỗi chứa dấu hiệu
`bad_request` **và** không khớp danh sách mẫu lỗi cấu hình đã biết
(`invalid_api_key`, `model_not_found`, `context_length`, `insufficient_quota`,
`billing`, ...). Nếu khớp lỗi cấu hình thì không thử lại.

Nghĩa là: bạn thấy lượt chạy chậm hơn một chút, nhưng không cần can thiệp. Nếu log
cho thấy 400 kèm `model_not_found`/`billing`, đó là lỗi cấu hình thật → §11.2.

### 11.5 Embedding rơi về `hash`

**Triệu chứng:** log `[kb] Không nạp được embedding cục bộ (...) — đang dùng
HashEmbeddingProvider để chạy offline.` Khi đó tìm kiếm **vẫn chạy** (từ khoá FTS5
đầy đủ) nhưng tìm kiếm ngữ nghĩa kém hơn hẳn.

**Vì sao hay gặp:** `EMBEDDING_PROVIDER=local` cần `@xenova/transformers`, và gói
này **không** có trong `package.json` của repo (dependency tuỳ chọn, chỉ nạp động).
Trên bản cài mặc định, fallback về `hash` là **hành vi bình thường**, không phải
lỗi.

**Ba lựa chọn:**

```bash
# A. Chấp nhận offline: khai báo thẳng, để log không còn cảnh báo gây nhiễu
EMBEDDING_PROVIDER=hash

# B. Cài model cục bộ (cần mạng ở lần chạy đầu để tải model)
pnpm add @xenova/transformers

# C. Dùng dịch vụ nhúng riêng
EMBEDDING_PROVIDER=remote
EMBEDDING_BASE_URL=https://api.example.com/v1
EMBEDDING_API_KEY=...
```

**Cạm bẫy:** đừng đặt `EMBEDDING_BASE_URL=http://localhost:20128/v1`. Gateway này
trả 400 cho `/v1/embeddings` — đã kiểm chứng.

**Đổi provider thì phải index lại.** `kb_embeddings` lưu tên model/provider cùng
vector và truy vấn không trộn hai không gian vector khác nhau. Sau khi đổi
`EMBEDDING_*`, chạy:

```bash
pnpm kb:index --company <slug> --force
```

### 11.6 Index lỗi

**Triệu chứng:** màn hình Kho kiến thức báo lỗi, hoặc CLI in `N tài liệu lỗi`.

Mỗi tài liệu lỗi được ghi vào `kb_index_jobs` với `status` và `error`; **một file
lỗi không làm hỏng cả lượt index**. Cách xử lý:

```bash
# Xem job lỗi gần nhất
node -e "const D=require('./packages/db/node_modules/better-sqlite3');\
const c=new D('data/marketing.db',{readonly:true});\
console.table(c.prepare(\"SELECT status, COUNT(*) n FROM kb_index_jobs GROUP BY status\").all());\
console.log(c.prepare(\"SELECT document_id, error, started_at FROM kb_index_jobs WHERE status='failed' ORDER BY started_at DESC LIMIT 5\").all());\
c.close()"

# Index lại toàn bộ
pnpm kb:index --company <slug> --force
```

Nguyên nhân hay gặp: file `.md` sai encoding, frontmatter hỏng, hoặc `category`
trong frontmatter không thuộc 6 danh mục (`00-cong-ty`, `10-brand`,
`20-thi-truong`, `30-kenh`, `40-du-lieu`, `90-ket-qua`). Tài liệu không đổi
checksum sẽ được **bỏ qua** — nếu "index lại mà không thấy gì", đó là lý do; dùng
`--force`.

### 11.7 SSE không nhận sự kiện

Kiểm tra theo thứ tự:

1. **Cùng origin chưa?** Nếu trình duyệt mở giao diện ở origin khác server API,
   cookie phiên không được gửi và SSE bị 401/không có sự kiện. Dùng Vite proxy ở
   dev, hoặc reverse proxy cùng tên miền ở production.
2. **Reverse proxy có đang đệm (buffer) response không?** Nginx mặc định đệm và sẽ
   giữ sự kiện SSE lại. Cần tắt cho route stream, và tăng timeout:

   ```nginx
   location /api/conversations/ {
     proxy_pass http://127.0.0.1:3000;
     proxy_buffering off;
     proxy_read_timeout 3600s;
     proxy_set_header Connection '';
     proxy_http_version 1.1;
   }
   ```

   (Mẫu tham chiếu — repo chưa có file cấu hình nginx nào.)

3. **Heartbeat chưa tới?** Server gửi comment giữ nhịp mỗi ~25 giây. Nếu proxy
   đóng kết nối nhàn rỗi trước mốc đó, giảm `proxy_read_timeout` không giải quyết —
   phải tăng timeout như trên.
4. **Có client nào đang treo không?** `curl -s localhost:3000/readyz` xem
   `sseClients`. Số này chỉ tăng là dấu hiệu tab cũ không đóng kết nối.
5. **Xác nhận server có phát sự kiện:** chạy dev, gửi tin trong giao diện, đồng
   thời xem log server.

### 11.8 `pnpm db:seed` chưa chạy

**Triệu chứng:**

- `GET /api/system/status` → `"ready": false`, và `catalog.problem` nói rõ thiếu gì
  (ví dụ "Chưa có định nghĩa agent nào. Hãy chạy: pnpm db:seed").
- `GET /readyz` → **503**.
- Log lúc khởi động: `[boot] CẢNH BÁO: ...` và "Máy chủ vẫn chạy, nhưng tạo công ty
  sẽ thất bại cho tới khi catalog được cài."
- Tạo công ty → HTTP **424** `needs_configuration`.

**Chữa:** `pnpm db:seed` (catalog), rồi tạo công ty. Nếu đã seed mà `models = 0`:
kiểm tra `DEFAULT_LLM_BASE_URL` có đúng không, rồi chạy lại seed hoặc thêm provider
trong giao diện.

**Đừng xoá DB để "chữa".** Seed là idempotent, chạy lại luôn an toàn.

### 11.9 `pnpm install` lỗi build `better-sqlite3`

**Triệu chứng:** lỗi `node-gyp`, `gyp ERR!`, `prebuild-install`, hoặc server chết
khi `import` với thông báo không tìm thấy module native.

**Nguyên nhân 1 — thiếu toolchain:** cài `python3`, `make`, `g++` rồi
`pnpm install --store-dir .pnpm-store` lại.

**Nguyên nhân 2 — postinstall bị chặn:** pnpm 10+ chặn script cài đặt mặc định.
`pnpm-workspace.yaml` phải còn:

```yaml
allowBuilds:
  better-sqlite3: true
  esbuild: true
```

Nếu thiếu, khôi phục lại rồi cài lại. Có thể buộc chạy lại:
`pnpm rebuild better-sqlite3`.

**Nguyên nhân 3 — store bị chặn quyền:** luôn dùng
`pnpm install --store-dir .pnpm-store` như hướng dẫn ở §3.2.

### 11.10 Cổng đã bị chiếm

`EADDRINUSE` khi khởi động. Kiểm tra và đổi:

```bash
ss -ltnp | grep -E ':(3000|5173)'
PORT=3001 pnpm dev:server
```

Nếu đổi cổng server, nhớ đặt `BACKEND_URL=http://127.0.0.1:3001 pnpm dev:web`, hoặc
để Vite tự dò cổng khác (`strictPort: false`) nhưng proxy vẫn trỏ về 3000.

---

## 12. Bảo mật vận hành

### 12.1 TLS ở reverse proxy — bắt buộc trên production

Server không tự phục vụ HTTPS. Đặt nginx/Caddy/Traefik ở trước, và:

- Chuyển toàn bộ HTTP sang HTTPS.
- Đặt `NODE_ENV=production` để cookie phiên có cờ `Secure` (cookie được gắn
  HttpOnly + SameSite=Lax + `path=/`; cờ Secure do `secureCookies: isProduction`
  quyết định trong `apps/server/src/app.ts`).
- **Chỉ đặt `NODE_ENV=production` khi TLS đã chạy.** Nếu không, cookie `Secure`
  không được lưu và người dùng rơi vào vòng lặp đăng nhập.
- Giữ `HOST=127.0.0.1` và để proxy nối vào localhost. Chỉ `HOST=0.0.0.0` khi có
  firewall chặn truy cập trực tiếp.

Mẫu nginx tham chiếu:

```nginx
server {
  listen 443 ssl;
  server_name marketing.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /api/conversations/ {   # SSE: tắt đệm
    proxy_pass http://127.0.0.1:3000;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
  }
}
```

### 12.2 Quyền file

```bash
chmod 700 data/                       # chỉ chủ sở hữu vào được
chmod 600 data/marketing.db           # DB: chỉ chủ sở hữu đọc/ghi
chmod 600 .env
chmod 700 data/companies
```

Chạy tiến trình bằng **user riêng không phải root** (`User=marketing` trong
systemd). DB chứa email, hash mật khẩu và bí mật đã mã hoá — không để world-readable.

Sau khi phục hồi bản sao, nhớ đặt lại `chmod 600` (bước 3 ở §8.3).

### 12.3 Bí mật

- **Không commit `.env`.** `.gitignore` đã chặn; đừng dùng `git add -f`.
- **Ưu tiên `api_key_ref` cho key của deployment.** Key của gateway nên đến từ biến
  môi trường, không được lưu vào DB. Key nhập qua giao diện được mã hoá AES-256-GCM
  và API chỉ trả `apiKeyConfigured` + 4 ký tự cuối, không bao giờ trả key.
- **Không dán key vào log, ticket, hay ảnh chụp màn hình.** Lỗi giải mã báo mã lỗi
  cấu hình, không in giá trị.
- **Bản sao lưu cũng là bí mật.** Xem §8.5.
- `APP_SECRET` nên đến từ trình quản lý bí mật có phiên bản, không từ file `.env`
  duy nhất trên một máy.

### 12.4 Ranh giới đã có sẵn (không cần cấu hình)

Đọc [kien-truc.md](./kien-truc.md) §6 để có bảng đầy đủ. Điểm cần nhớ khi vận hành:

- Mọi route `/api/companies/:companyId/...` đều qua `requireMembership`; người
  ngoài nhận **404** (không phải 403) để không dò được id công ty.
- Cấu hình cần `requireManage` (owner/admin); công việc cần `requireWork` (trừ
  viewer).
- Hành vi công khai (đăng bài, gửi email) mặc định tạo nháp chờ duyệt.
- ACL kho kiến thức lọc **trước khi xếp hạng**, nên không thể lọt qua prompt.

---

## 13. Giới hạn đã biết — nói thẳng

| Giới hạn | Biểu hiện vận hành | Khi nào cần xử lý |
|---|---|---|
| **Không scale ngang** | Không thể chạy 2 replica trên cùng volume; SQLite một writer | Khi cần nhiều instance → Postgres + hàng đợi ngoài |
| **Một instance, một volume** | Mọi backup/khôi phục xoay quanh `data/` | Ngay từ đầu — thiết kế, không phải lỗi |
| **Vector search brute-force** | Truy vấn chậm dần khi vượt ~10⁵ chunk/công ty | Chuyển `sqlite-vec`/pgvector; `packages/db/src/vector.ts` là điểm thay duy nhất |
| **`SQLITE_BUSY` khi tải ghi cao** | Xuất hiện quanh ~20 người dùng ghi đồng thời | Chuyển `packages/db` sang Postgres; repo API giữ nguyên |
| **Chưa render ảnh/video thật** | `design-video` chỉ sinh **spec/brief/storyboard**, không có bước render | Cần pipeline render riêng |
| **Google Ads / Meta Ads còn ở mức khuôn** | `ads_meta`/`ads_google` mặc định **chỉ trả kế hoạch**; chỉ gửi lên nền tảng khi `apply = true` sau phê duyệt, và cần developer token + tài khoản liên kết. Chưa kiểm chứng end-to-end với tài khoản thật | Khi chuẩn bị chạy quảng cáo thật |
| **Chưa có billing nhiều tổ chức** | Không có bảng `plans`/`subscriptions`; không giới hạn theo gói | Khi bán cho nhiều khách trả tiền |
| **`ENV` embedding local không kèm sẵn** | Mặc định rơi về `hash` → tìm kiếm ngữ nghĩa yếu | §11.5 |
| **Chi phí `deepseek-*` = 0** | Gateway nội bộ không tính tiền theo model, nên màn hình Chi phí hiển thị 0 cho các model này | Chỉ có ý nghĩa khi bạn thêm provider trả phí thật |
| **Route đang được hoàn thiện** | Một số module API có thể chưa nạp được; log `[routes] module "..." chưa sẵn sàng`, màn hình tương ứng trống | Xem [api.md](./api.md) — ghi rõ module nào chưa có |

Tham chiếu đầy đủ ngưỡng nâng cấp: [kien-truc.md](./kien-truc.md) §7.

---

## 14. Checklist vận hành định kỳ

**Hằng ngày**
- [ ] `/readyz` trả 200; `sseClients` không tăng bất thường.
- [ ] Bản sao `VACUUM INTO` chạy xong; file mới có kích thước hợp lý (> 0).
- [ ] Màn hình Chi phí: không có task `failed` hàng loạt.

**Hằng tuần**
- [ ] Mở thử một bản sao gần nhất, chạy `PRAGMA integrity_check` (§8.3). Kỳ vọng `ok`.
- [ ] Kiểm tra `data/` còn dư đĩa; dọn bản sao cũ theo lịch đã đặt.
- [ ] Xem `kb_index_jobs` có `failed` không; index lại nếu có.

**Trước mỗi lần nâng cấp**
- [ ] Sao lưu DB **và** ghi lại `APP_SECRET` đang dùng.
- [ ] Ghi lại phiên bản/tag hiện tại để có thể `git checkout` quay lui.
- [ ] Sau nâng cấp: `/api/system/status` xem `appliedMigrations`, `/readyz` = 200,
      gửi một tin nhắn thử, xem một artifact.
