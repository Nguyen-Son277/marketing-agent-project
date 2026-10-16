# Tài liệu dự án

Điểm vào cho mọi tài liệu của **Đội Agent Marketing**. Nếu bạn mới vào repo, đọc
theo thứ tự ở §4 — nó được xếp để bạn hiểu hệ thống trước khi chạy nó.

---

## 1. Mục lục tài liệu

| Tài liệu | Trả lời câu hỏi | Đối tượng |
|---|---|---|
| [van-hanh.md](./van-hanh.md) | Cài, chạy, sao lưu, xử lý sự cố thế nào? | Người vận hành / DevOps |
| [kien-truc.md](./kien-truc.md) | Vì sao thiết kế như vậy? Schema, ranh giới tin cậy, ngưỡng nâng cấp | Kỹ sư, người đánh giá |
| [so-do-doi-agent.md](./so-do-doi-agent.md) | Đội có ai, làm gì, đọc được tri thức nào, dùng model nào? | Người dùng, quản trị |
| [luong-hoat-dong.md](./luong-hoat-dong.md) | Một yêu cầu chạy qua những bước nào, khi nào bị chặn? | Người dùng, kỹ sư |
| [api.md](./api.md) | Có endpoint nào, quyền gì, trả về hình dạng gì, SSE ra sao? | Lập trình viên tích hợp |
| [thong-bao.md](./thong-bao.md) | Chuông thông báo, trạng thái đọc, cảnh báo chi phí và quyền trình duyệt hoạt động thế nào? | Người dùng, lập trình viên |
| [phan-loai-model-chat.md](./phan-loai-model-chat.md) | Model chat, ChatCompletion và lỗi JSON phân loại được xử lý thế nào? | Người dùng, lập trình viên |
| [../README.md](../README.md) | Đây là sản phẩm gì, chạy thử trong 5 lệnh | Mọi người |

---

## 2. Bản đồ mã nguồn

Repo là một **pnpm workspace**. Mười package, chia ba nhóm: hạ tầng dữ liệu, năng
lực agent, và ứng dụng.

### 2.1 Từng package làm gì

| Package | Vai trò | Nội dung chính |
|---|---|---|
| `packages/shared` | **Hợp đồng chung**, không phụ thuộc gì trong repo (chỉ `zod`) | Kiểu domain (`types.ts`), danh mục (`domain.ts`: 10 role, 6 danh mục KB), mã lỗi chuẩn (`errors.ts`), schema zod cho request (`schemas.ts`), **hợp đồng API** (`api.ts`), tiện ích (`util.ts`) |
| `packages/db` | **Tầng dữ liệu duy nhất**. Chỉ import `shared` | `database.ts` (mở SQLite, WAL + `busy_timeout`, chạy migration), `migrations.ts` (6 migration append-only), `repos/` (mỗi repo bắt buộc `companyId`), `crypto.ts` (`SecretBox` AES-256-GCM), `vector.ts` (mã hoá/cosine vector), `password.ts` |
| `packages/llm` | Nói chuyện với nhà cung cấp LLM | `provider.ts` (hợp đồng adapter + chính sách retry), `adapters/` (openai_compatible, anthropic), `sse.ts` (ghép luồng), `registry.ts` (ModelRegistry), `router.ts` (chọn model theo cấu hình người dùng + chuỗi model dự phòng + capability guard), `registry.ts` (một adapter cho mỗi API key), `cost.ts` (ghi `runs`/`usage_daily`) |
| `packages/agent-runtime` | Vòng lặp chạy **một** agent | `tool-loop.ts` (gọi model → thực thi tool → lặp), `prompt.ts` (`buildSystemPrompt` 5 khối), `context.ts` (nén ngữ cảnh), `deps.ts`, `types.ts` |
| `packages/kb` | Kho kiến thức công ty | `frontmatter.ts` + `chunker.ts` (Markdown → chunk theo heading), `embeddings.ts` (3 provider: local ONNX / remote / hash + factory có fallback), `indexer.ts` (quét đĩa → upsert → embed), `retriever.ts` (FTS5 + vector, gộp RRF, **lọc ACL trước khi xếp hạng**), `tools.ts` (`kb_search`/`kb_read`/`kb_write`), `cli/index-company.ts` (`pnpm kb:index`) |
| `packages/tools` | Tool cho agent | `registry.ts` (đăng ký + kiểm tra grant của preset), `core.ts` (`files.*`, `artifact_publish` — biên giới đường dẫn), `coordination.ts` (`task.*`, `agent_ask`), `http-tools.ts` (`web_search`, `web_scrape`), `google/` (GA4, Search Console, Sheets, OAuth), `meta.ts`, `linkedin.ts`, `paid-ads.ts`, `email.ts`, `integrations.ts` (lưu credential đã mã hoá) |
| `packages/orchestrator` | **Bộ điều phối**: Leader, Planner, DAG, Dispatcher, ReviewGate, Reporter | `service.ts` (`ConversationOrchestrator`), `planner.ts` (sinh DAG + kiểm tra), `dispatcher.ts` (thứ tự topo, chạy song song), `agent-runner.ts` (ghép preset + model + skill + tool + ACL thành `ResolvedAgent`), `review.ts` (ReviewGate 6 mục), `reporter.ts` (báo cáo 7 mục), `events.ts` (sự kiện → SSE), `types.ts` |
| `apps/server` | HTTP API + SSE + phục vụ SPA | `main.ts` (boot, nạp module route tuỳ chọn, shutdown), `app.ts` (định tuyến, phục vụ tĩnh, error boundary), `config.ts` (đọc `.env`, kiểm tra cấu hình), `context.ts` (`AppContext` + `EventBus`), `http/` (`router.ts`, `middleware.ts`), `routes/` (`auth-routes.ts` đã có; các module còn lại đang hoàn thiện), `services/company-service.ts` |
| `apps/web` | Giao diện React + Vite (tiếng Việt) | `src/lib/api.ts` (client gọi `API_ROUTES`), `src/lib/session.tsx`, `vite.config.ts` (**proxy `/api`, `/healthz`, `/readyz`** để cookie cùng origin), `index.html` |
| `seed` | Cài catalog & cấu hình công ty mẫu | `src/agents.ts` (10 định nghĩa agent + danh mục tri thức), `src/skills.ts`, `src/providers.ts` (`DEFAULT_BUDGET`; KHÔNG seed provider/model — người dùng khai trong Cài đặt), `src/knowledge.ts` (11 tài liệu mẫu), `cli/seed.ts` (`pnpm db:seed`) |

### 2.2 Quan hệ phụ thuộc (đọc từ `packages/*/package.json`)

Quy tắc bất biến: **tầng trên chỉ được import tầng dưới.** `shared` không import gì
trong repo; `db` chỉ import `shared`. Không có import ngược.

```
                         apps/web ──────────────► shared
                                                     ▲
   apps/server ─────────► shared, db ───────────────┤
        │  (import động, tuỳ chọn)                   │
        ├──► orchestrator ──► shared, db, llm, agent-runtime, kb, tools
        │                          │         │         ▲       │
        │                          ▼         ▼         │       ▼
        ├──► kb ──────────► shared, db        │    agent-runtime ──► db, llm, shared
        │                                     │         ▲
        └──► tools ───────► shared, db        └── llm ──┘
                                              llm ──► db, shared
   seed ────────────────► shared, db
```

Bảng phụ thuộc trực tiếp (chính xác theo `package.json`):

| Package | Phụ thuộc workspace | Phụ thuộc ngoài |
|---|---|---|
| `shared` | — | `zod` |
| `db` | `shared` | `better-sqlite3`, `zod` |
| `llm` | `shared`, `db` | `zod` |
| `kb` | `shared`, `db` | `zod` |
| `tools` | `shared`, `db` | `zod` |
| `agent-runtime` | `shared`, `db`, `llm` | — |
| `orchestrator` | `shared`, `db`, `llm`, `agent-runtime`, `kb`, `tools` | `zod` |
| `apps/server` | `shared`, `db` | `zod` |
| `apps/web` | `shared` | `react`, `react-dom` (dev: `vite`, `@vitejs/plugin-react`) |
| `seed` | `shared`, `db` | — |

**Lưu ý về `apps/server`:** `package.json` hiện chỉ khai báo `shared`, `db`, `zod`.
`main.ts` nạp các module route và `@marketing-agent/tools` bằng `import()` **động,
bọc `try/catch`** — cố ý, để một package chưa xong không làm sập boot. Nhờ vậy
server vẫn khởi động được trong checkout từng phần. Giao diện dùng alias Vite trỏ
thẳng vào `packages/shared/src/index.ts` (`vite.config.ts`), nên không cần build
package trước khi chạy dev.

### 2.3 Vòng đời một request (đường ngắn nhất để định vị mã)

```
apps/web (fetch, cookie ma_session)
  → apps/server/src/app.ts         định tuyến + error boundary
  → http/middleware.ts             session → requireMembership → requireManage|requireWork
  → routes/*.ts                    validate body (packages/shared/schemas.ts)
  → packages/orchestrator          Leader / Planner / Dispatcher / Review / Report
  → packages/agent-runtime         vòng lặp tool
  → packages/llm + packages/tools + packages/kb
  → packages/db (SQLite)           repos, companyId bắt buộc
  → SSE: ctx.events → `event: <type>` + `data: <json>`
```

---

## 3. Trạng thái hiện tại — cái gì đã có, cái gì chưa

Nói thẳng để người mới không mất thời gian đi tìm thứ chưa tồn tại:

**Đã xong và đã commit**
- Pha 0: `shared`, schema SQLite + repos, crypto, seed catalog 10 agent.
- Pha 1: `llm`, `agent-runtime`, `kb`, `tools`, lõi `apps/server` (auth, tenancy,
  health, phục vụ SPA).
- Pha 2: `orchestrator` (Leader, Planner, DAG, ReviewGate, Reporter).

**Đang hoàn thiện**
- `apps/server/src/routes/*` — mới có `auth-routes.ts`. Các module
  team/knowledge/chat/tasks/settings/costs/diagram/dashboard đang được viết.
  Trong lúc đó, log boot in `[routes] module "..." chưa sẵn sàng` và các màn hình
  tương ứng chưa có dữ liệu.
- `apps/web` — mới có client API và session; các màn hình chưa dựng.

**Chưa có trong repo**
- `Dockerfile` / `docker-compose.yml` — tài liệu [van-hanh.md](./van-hanh.md) §6 mô
  tả thiết kế và ghi rõ file chưa tồn tại.
- Render ảnh/video thật; ads thật (Google/Meta mới ở mức khuôn, mặc định chỉ trả
  kế hoạch); billing nhiều tổ chức.

---

## 4. Thứ tự đọc đề xuất cho người mới

**Nếu bạn sẽ vận hành (không viết mã):**

1. [../README.md](../README.md) — sản phẩm là gì, quick start 5 lệnh.
2. [van-hanh.md](./van-hanh.md) §1–§5 — cài, biến môi trường, chạy dev/production.
3. [van-hanh.md](./van-hanh.md) §7–§9 — sức khoẻ, **sao lưu**, `APP_SECRET`. Ba mục
   này quyết định bạn có mất dữ liệu hay không.
4. [so-do-doi-agent.md](./so-do-doi-agent.md) — biết đội có ai, ai đọc được gì.
5. [van-hanh.md](./van-hanh.md) §11–§13 — xử lý sự cố và giới hạn.

**Nếu bạn sẽ đọc/sửa mã:**

1. [kien-truc.md](./kien-truc.md) — bài toán, 5 quyết định kiến trúc, và **vì sao**
   mỗi quyết định. Đọc hết; mọi thứ khác suy ra từ đây.
2. `packages/shared/src/types.ts` + `domain.ts` — vốn từ của toàn hệ thống.
3. `packages/shared/src/api.ts` — hợp đồng giữa web và server.
4. `packages/db/src/migrations.ts` + `database.ts` — hình dạng dữ liệu và ràng buộc
   vận hành (append-only, WAL, một writer).
5. [luong-hoat-dong.md](./luong-hoat-dong.md) — state machine và 4 cơ chế kiểm soát.
6. `packages/orchestrator/src/service.ts` rồi `planner.ts` → `dispatcher.ts` →
   `agent-runner.ts` → `review.ts` → `reporter.ts` — theo đúng thứ tự một lượt chạy.
7. `packages/agent-runtime/src/tool-loop.ts` + `packages/llm/src/router.ts` — chỗ
   dễ sai nhất: vòng lặp, ngân sách, chọn model.
8. `apps/server/src/app.ts` + `http/middleware.ts` + `routes/` — ranh giới tin cậy.
9. `packages/kb/src/retriever.ts` — lọc ACL **trước** khi xếp hạng; đọc kỹ trước
   khi sửa bất cứ thứ gì trong kho kiến thức.
10. [api.md](./api.md) — khi cần đụng vào route hoặc giao diện.

**Nếu bạn là kỹ sư đánh giá thiết kế:** đọc [kien-truc.md](./kien-truc.md) §1 (ràng
buộc đã kiểm chứng), §6 (ranh giới tin cậy), §7 (ngưỡng nâng cấp) — đó là phần trả
lời "vì sao không phải X".

---

## 5. Quy ước tài liệu

- Viết tiếng Việt, câu ngắn, ưu tiên **vì sao** và **cạm bẫy** hơn danh sách lệnh.
- Mọi thông tin kỹ thuật (lệnh, biến môi trường, đường dẫn, endpoint) phải kiểm
  chứng được từ mã nguồn. Khi tài liệu và mã lệch nhau, **mã nguồn là nguồn chân lý**
  — và chỗ lệch được ghi rõ trong tài liệu thay vì bỏ qua.
- Nguồn chân lý theo loại thông tin:
  - Hợp đồng API và hình dạng phản hồi → `packages/shared/src/api.ts`
  - Kiểu domain và danh mục → `packages/shared/src/domain.ts`, `types.ts`
  - Schema DB → `packages/db/src/migrations.ts`
  - Cấu hình và biến môi trường → `apps/server/src/config.ts`, `.env.example`
  - Lệnh chạy → `package.json` (scripts)
