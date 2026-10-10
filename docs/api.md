# API reference

Nguồn chân lý của tài liệu này là **`packages/shared/src/api.ts`** (hợp đồng đã chốt
giữa server và giao diện) cùng các module trong `apps/server/src/routes/`. Khi tài
liệu và mã lệch nhau, **mã nguồn thắng** — và chỗ lệch được ghi rõ bên dưới.

> **Trạng thái triển khai (đọc trước).** Tại thời điểm viết, chỉ
> `apps/server/src/routes/auth-routes.ts` tồn tại. Các module còn lại
> (team, knowledge, chat, tasks, settings, costs, diagram, dashboard) **đang được
> hoàn thiện** — chúng đã có trong hợp đồng `API_ROUTES` và kiểu phản hồi trong
> `api.ts`, nhưng file route chưa có. Trong bảng bên dưới, cột **Trạng thái** đánh
> dấu:
>
> - ✅ **đã có** — đọc trực tiếp từ `auth-routes.ts` / `app.ts`
> - ⏳ **đang hoàn thiện** — đường dẫn và hình dạng phản hồi lấy từ hợp đồng
>   `api.ts`; chi tiết request body lấy từ `packages/shared/src/schemas.ts`; quyền
>   yêu cầu theo quy ước bắt buộc của kiến trúc. Khi module được thêm, đối chiếu lại
>   file route tương ứng.

---

## 1. Quy ước chung

| Quy ước | Chi tiết |
|---|---|
| Định dạng | JSON (`application/json; charset=utf-8`), trừ SSE và tệp tĩnh |
| Xác thực | Cookie phiên **`ma_session`** (HttpOnly, SameSite=Lax, `path=/`; cờ `Secure` khi `NODE_ENV=production`). Không dùng bearer token |
| Tenancy | Mọi route dưới `/api/companies/:companyId/...` chạy `requireMembership`. `companyId` **chỉ** lấy từ đường dẫn; **không bao giờ** tin `companyId` trong body |
| Cô lập công ty | Người không thuộc công ty nhận **404** (`not_found`) hoặc **403** tuỳ trường hợp — cố ý không phân biệt rõ để không dò được id công ty |
| `405` | Gọi đúng đường dẫn nhưng sai method → 405 kèm header `Allow` và `{ error: { code: 'method_not_allowed', allowed: [...] } }` |
| `404` | Đường dẫn `/api/...` không tồn tại → `{ error: { code: 'not_found', message: 'Không tìm thấy đường dẫn API' } }` |
| Chi tiết lỗi | Trường `details` chỉ được trả khi **không** phải production và lỗi < 500 |
| Kích thước body | Trần `MAX_BODY_BYTES` (mặc định 2 MB) |

### 1.1 Phong bì lỗi (mọi lỗi)

```json
{ "error": { "code": "<AppErrorCode>", "message": "<tiếng Việt>", "details": "<tuỳ chọn>" } }
```

`AppErrorCode` và HTTP status tương ứng (`packages/shared/src/errors.ts`):

| `code` | HTTP | Nghĩa |
|---|---|---|
| `unauthorized` | 401 | Chưa đăng nhập hoặc phiên hết hạn |
| `forbidden` | 403 | Đã đăng nhập nhưng không đủ quyền |
| `not_found` | 404 | Không thấy tài nguyên (hoặc không thuộc công ty) |
| `validation` | 400 | Dữ liệu vào sai; `details` là danh sách `{path, message}` |
| `conflict` | 409 | Xung đột trạng thái |
| `rate_limited` | 429 | Bị giới hạn tần suất |
| `provider_error` | 502 | Nhà cung cấp LLM/tích hợp trả lỗi |
| `tool_error` | 502 | Tool của agent thất bại |
| `needs_configuration` | 424 | Thiếu cấu hình (chưa seed, thiếu key, thiếu credential) |
| `budget_exceeded` | 429 | Vượt trần ngân sách |
| `internal` | 500 | Lỗi phía server |

### 1.2 Vai trò và middleware

| Middleware | Vai trò được phép | Dùng cho |
|---|---|---|
| `requireAuth` | Bất kỳ user đã đăng nhập | Route không gắn công ty |
| `requireMembership(repos)` | owner / admin / member / viewer | **Mọi** route `/api/companies/:companyId/...` |
| `requireManage` | owner / admin | Thay đổi cấu hình (provider, model, route, tích hợp, giới hạn, đội agent) |
| `requireWork` | owner / admin / member | Bắt đầu/điều khiển công việc (gửi tin, gửi plan, chạy, duyệt task) |

`viewer` đọc được nhưng không được ghi hay khởi động việc.

---

## 2. Bảng endpoint

### 2.1 Xác thực

| Method | Path | Quyền | Mô tả | Phản hồi (200/201) | Trạng thái |
|---|---|---|---|---|---|
| `POST` | `/api/auth/register` | công khai | Đăng ký tài khoản mới, tạo phiên ngay | `201` `MeResponse` (user + `companies: []`) | ✅ |
| `POST` | `/api/auth/login` | công khai | Đăng nhập; thất bại trả **401** với thông báo giống nhau cho email sai và mật khẩu sai (chống dò tài khoản) | `200` `MeResponse` | ✅ |
| `POST` | `/api/auth/logout` | công khai (idempotent) | Xoá phiên hiện tại và cookie | `200 { ok: true }` | ✅ |
| `GET` | `/api/auth/me` | đã đăng nhập | Người dùng hiện tại + danh sách công ty họ thuộc | `200` `MeResponse` | ✅ |

Request body: `registerSchema` `{ email, password, name }`;
`loginSchema` `{ email, password }` (`packages/shared/src/schemas.ts`).

### 2.2 Công ty và thành viên

| Method | Path | Quyền | Mô tả | Phản hồi | Trạng thái |
|---|---|---|---|---|---|
| `GET` | `/api/companies` | đã đăng nhập | Danh sách công ty của tôi | `{ companies: CompanySummary[] }` | ✅ |
| `POST` | `/api/companies` | đã đăng nhập | Tạo công ty; server cấp preset cho 10 agent + ACL tri thức (**yêu cầu catalog đã seed**, nếu không → `424`). Không tạo provider/model | `201 { company, role, presets, aclEntries }` | ✅ |
| `DELETE` | `/api/companies/:companyId` | membership + `requireManage` | Xoá công ty; cascade toàn bộ dữ liệu con | `200 { deleted: true }` | ✅ |
| `GET` | `/api/companies/:companyId/members` | membership | Danh sách thành viên | `{ members: [...] }` | ✅ |

Body tạo công ty: `createCompanySchema` `{ name }`.

### 2.3 Hệ thống

| Method | Path | Quyền | Mô tả | Phản hồi | Trạng thái |
|---|---|---|---|---|---|
| `GET` | `/healthz` | công khai | Liveness — **luôn** 200 khi tiến trình sống | `{ status: 'ok' }` | ✅ |
| `GET` | `/readyz` | công khai | Readiness — **503** khi chưa seed catalog (định nghĩa agent + kỹ năng); model không bắt buộc | `{ status, agentDefs, skills, models, sseClients }` | ✅ |
| `GET` | `/api/system/status` | công khai | Trạng thái catalog + migration đã áp dụng ở lần boot này | `SystemStatusResponse` | ✅ |

`SystemStatusResponse`: `{ ready, catalog: { ready, agentDefs, skills, models, problem? }, appliedMigrations }`.

### 2.4 Đội agent

| Method | Path | Quyền | Mô tả | Phản hồi | Trạng thái |
|---|---|---|---|---|---|
| `GET` | `/api/companies/:companyId/team` | membership | Toàn bộ agent đã ghép định nghĩa + cấu hình công ty, kèm skill/tool/KB ACL, danh sách skill & tool khả dụng và model để chọn | `TeamResponse` | ⏳ |
| `PATCH` | `/api/companies/:companyId/team/:role` | `requireManage` | Sửa cấu hình một agent: bật/tắt, model, tier, `reasoningEffort`, `maxTokens`, ngân sách context, prompt override, `requireApproval`, skill, tool, danh mục tri thức đọc/ghi | `TeamMemberView` | ⏳ |
| `GET` | `/api/companies/:companyId/team/skills` | membership | Danh sách kỹ năng hệ thống biết | `{ skills: [...] }` | ⏳ |
| `GET` | `/api/companies/:companyId/team/tools` | membership | Tool khả dụng + tool nào cần phê duyệt | `{ tools: [{ name, description, requiresApproval }] }` | ⏳ |

Body: `updateTeamMemberSchema` — mọi trường đều tuỳ chọn; `knowledge[]` gồm
`{ category, canRead, canWrite }`.

### 2.5 Kho kiến thức

| Method | Path | Quyền | Mô tả | Phản hồi | Trạng thái |
|---|---|---|---|---|---|
| `GET` | `/api/companies/:companyId/knowledge` | membership | Danh sách tài liệu + 6 danh mục kèm số lượng + thống kê `{documents, chunks, embedded}` | `KnowledgeResponse` | ⏳ |
| `POST` | `/api/companies/:companyId/knowledge` | `requireWork` | Thêm tài liệu; server index ngay | `KnowledgeDocumentView` | ⏳ |
| `GET` | `/api/companies/:companyId/knowledge/:docId` | membership | Chi tiết tài liệu, kèm `content` | `KnowledgeDocumentView` | ⏳ |
| `PATCH` | `/api/companies/:companyId/knowledge/:docId` | `requireWork` | Sửa tài liệu và index lại | `KnowledgeDocumentView` | ⏳ |
| `DELETE` | `/api/companies/:companyId/knowledge/:docId` | `requireManage` | Xoá tài liệu + chunk + vector | `200 { deleted: true }` | ⏳ |
| `POST` | `/api/companies/:companyId/knowledge/reindex` | `requireWork` | Index lại (tuỳ chọn theo `paths`, `force`) | `ReindexResponse` `{ indexed, skipped, chunks, errors[] }` | ⏳ |
| `GET` | `/api/companies/:companyId/knowledge/jobs` | membership | Lịch sử job index (`kb_index_jobs`) để xem lỗi | danh sách job index (hình dạng chưa chốt trong `api.ts`) | ⏳ |
| `GET` | `/api/companies/:companyId/knowledge/stats` | membership | Thống kê nhanh `{documents, chunks, embedded}` | `{ stats: {...} }` | ⏳ |

Body: `upsertKnowledgeSchema` `{ path, title, category, tags[], content }`;
`reindexSchema` `{ paths?, force }`. `category` phải thuộc 6 mã:
`00-cong-ty`, `10-brand`, `20-thi-truong`, `30-kenh`, `40-du-lieu`, `90-ket-qua`.

### 2.6 Hội thoại, kế hoạch, chạy, báo cáo

| Method | Path | Quyền | Mô tả | Phản hồi | Trạng thái |
|---|---|---|---|---|---|
| `GET` | `/api/companies/:companyId/conversations` | membership | Danh sách hội thoại | `{ conversations: ConversationView[] }` | ⏳ |
| `POST` | `/api/companies/:companyId/conversations` | `requireWork` | Tạo hội thoại | `201 ConversationView` | ⏳ |
| `GET` | `/api/conversations/:id` | membership (suy ra từ hội thoại) | Chi tiết: hội thoại + tin nhắn + task + chi phí + usage | `ConversationDetailResponse` | ⏳ |
| `GET` | `/api/conversations/:id/messages` | membership | Lịch sử tin nhắn | `{ messages: MessageView[] }` | ⏳ |
| `POST` | `/api/conversations/:id/messages` | `requireWork` | Gửi tin cho Leader. Leader chạy BriefGate và trả lời; `autoPlan: true` thì lập kế hoạch và giao việc luôn | `SendMessageResponse` | ⏳ |
| `POST` | `/api/conversations/:id/plan` | `requireWork` | Sinh DAG từ brief đã chốt (validate chu trình + role) | `{ tasks: TaskView[] }` hoặc lỗi `validation` | ⏳ |
| `POST` | `/api/conversations/:id/run` | `requireWork` | Thực thi kế hoạch theo thứ tự topo (task cùng mức chạy song song) | `{ tasks: TaskView[], status }` | ⏳ |
| `POST` | `/api/conversations/:id/report` | `requireWork` | Tổng hợp báo cáo **7 mục** thành artifact | `{ artifact: ArtifactView }` | ⏳ |
| `GET` | `/api/conversations/:id/stream` | membership | **SSE** — nhận sự kiện trực tiếp (§3) | `text/event-stream` | ⏳ |

Body: `createConversationSchema` `{ title }`; `sendMessageSchema`
`{ content, autoPlan }`.

### 2.7 Công việc và tài sản đầu ra

| Method | Path | Quyền | Mô tả | Phản hồi | Trạng thái |
|---|---|---|---|---|---|
| `GET` | `/api/companies/:companyId/tasks` | membership | Danh sách task + số lượng theo từng trạng thái | `TaskListResponse` | ⏳ |
| `GET` | `/api/tasks/:taskId` | membership | Chi tiết task: sự kiện, artifact, trao đổi giữa agent | `TaskDetailResponse` | ⏳ |
| `POST` | `/api/tasks/:taskId/review` | `requireWork` | Duyệt / yêu cầu sửa / huỷ task đang chờ review | `ReviewTaskResponse` | ⏳ |
| `GET` | `/api/companies/:companyId/artifacts` | membership | Danh sách artifact của công ty | `{ artifacts: ArtifactView[] }` | ⏳ |
| `GET` | `/api/artifacts/:artifactId` | membership | Chi tiết artifact | `ArtifactView` | ⏳ |

Body: `reviewTaskSchema` `{ decision: 'approve' \| 'request_changes' \| 'cancel', note? }`.

### 2.8 Cài đặt

| Method | Path | Quyền | Mô tả | Phản hồi | Trạng thái |
|---|---|---|---|---|---|
| `GET` | `/api/companies/:companyId/providers` | membership | Nhà cung cấp kèm danh sách khoá (chỉ nhãn/hint) và model; **không** trả khoá gốc | `ProvidersResponse` | ✅ |
| `POST` | `/api/companies/:companyId/providers` | `requireManage` | Thêm nhà cung cấp (URL); `apiKey`/`apiKeyLabel` tuỳ chọn tạo luôn khoá đầu | `201 ProviderView` | ✅ |
| `PATCH` | `/api/companies/:companyId/providers/:providerId` | `requireManage` | Sửa tên/loại/URL/bật-tắt — **không** đổi khoá | `ProviderView` | ✅ |
| `DELETE` | `/api/companies/:companyId/providers/:providerId` | `requireManage` | Xoá nhà cung cấp (cascade khoá + model) | `200 { deleted: true }` | ✅ |
| `POST` | `/api/companies/:companyId/providers/:providerId/test` | `requireManage` | Gọi thử bằng khoá đang bật đầu tiên (hoặc `{ keyId }`) | `ProviderTestResponse` `{ ok, message, latencyMs, modelsSeen? }` | ✅ |
| `GET` | `/api/companies/:companyId/providers/:providerId/keys` | membership | Danh sách khoá của URL | `{ keys: ProviderKeyView[] }` | ✅ |
| `POST` | `/api/companies/:companyId/providers/:providerId/keys` | `requireManage` | Thêm khoá (`label`, `apiKey`, `priority`, `enabled`) | `201 ProviderKeyView` | ✅ |
| `PATCH` | `/api/companies/:companyId/providers/:providerId/keys/:keyId` | `requireManage` | Sửa nhãn/thứ tự/bật-tắt, đổi khoá nếu gửi `apiKey` | `ProviderKeyView` | ✅ |
| `DELETE` | `/api/companies/:companyId/providers/:providerId/keys/:keyId` | `requireManage` | Xoá một khoá | `200 { deleted: true }` | ✅ |
| `POST` | `/api/companies/:companyId/providers/:providerId/keys/:keyId/test` | `requireManage` | Gọi thử riêng khoá đó | `ProviderTestResponse` | ✅ |
| `POST` | `/api/companies/:companyId/providers/:providerId/fetch-models` | `requireManage` | Gọi `GET {baseURL}/models` (body `{ keyId? }`), **không ghi DB** | `FetchModelsResponse` | ✅ |
| `POST` | `/api/companies/:companyId/providers/:providerId/import-models` | `requireManage` | Lưu các model đã chọn; bỏ qua model đã có | `201 { created, skipped }` | ✅ |
| `POST` | `/api/companies/:companyId/providers/:providerId/purge-models` | `requireManage` | Xoá mọi model của URL không được tham chiếu | `{ deleted }` | ✅ |
| `GET` | `/api/companies/:companyId/models` | membership | Danh sách model + giá + số agent đang dùng | `{ models: ModelOptionView[] }` | ✅ |
| `POST` | `/api/companies/:companyId/models` | `requireManage` | Khai báo model (model id, context, giá vào/ra, hỗ trợ tool/vision) | `201 ModelOptionView` | ✅ |
| `PATCH` | `/api/companies/:companyId/models/:modelId` | `requireManage` | Sửa model (không đổi `providerId`) | `ModelOptionView` | ✅ |
| `DELETE` | `/api/companies/:companyId/models/:modelId` | `requireManage` | Xoá model; **409** nếu còn được agent/route/fallback dùng | `200 { deleted: true }` | ✅ |
| `GET` | `/api/companies/:companyId/routes` | membership | Route model theo agent + tier | `{ routes: [...] }` | ⏳ |
| `POST` | `/api/companies/:companyId/routes` | `requireManage` | Gán model cho một `agentRole` + `tier` | `201 { route }` | ⏳ |
| `GET` | `/api/companies/:companyId/integrations` | membership | Tích hợp đã cấu hình (không trả credential) | `IntegrationsResponse` | ⏳ |
| `POST` | `/api/companies/:companyId/integrations` | `requireManage` | Thêm tích hợp; `config` được mã hoá | `201 IntegrationView` | ⏳ |
| `PATCH` | `/api/companies/:companyId/integrations/:integrationId` | `requireManage` | Sửa tích hợp | `IntegrationView` | ⏳ |
| `DELETE` | `/api/companies/:companyId/integrations/:integrationId` | `requireManage` | Xoá tích hợp | `200 { deleted: true }` | ⏳ |
| `POST` | `/api/companies/:companyId/integrations/:integrationId/test` | `requireManage` | Kiểm tra kết nối tích hợp | `ProviderTestResponse` | ⏳ |
| `GET` | `/api/companies/:companyId/limits` | membership | Giới hạn hiện tại + chi phí đã dùng hôm nay | `LimitsView` | ⏳ |
| `PATCH` | `/api/companies/:companyId/limits` | `requireManage` | Đổi trần: chi phí/ngày, chi phí/task, bước/lượt chạy, vòng hỏi ngang, số lần sửa, số task song song | `LimitsView` | ⏳ |

Body: `createProviderSchema` `{ name, kind, baseUrl, apiKey?, extraJson?, enabled }`
(khi `PATCH` dùng bản partial); `createModelSchema`
`{ providerId, modelId, label, contextWindow, maxOutput, supportsTools, supportsVision, costInPerMtok, costOutPerMtok, enabled }`;
`upsertRouteSchema` `{ agentRole, tier, modelFk, reasoningEffort?, maxTokens?, priority }`;
`upsertIntegrationSchema` `{ kind, name, config }`.

**Bảo mật bí mật:** `apiKey` và `config` chỉ nhận khi ghi, được mã hoá AES-256-GCM
trước khi lưu. Mọi phản hồi chỉ trả `apiKeyConfigured` + `apiKeyHint` (4 ký tự đầu
và cuối). Trường `apiKeyEnc` **không bao giờ** xuất hiện trong API.

### 2.9 Chi phí, lịch sử chạy, kiểm toán

| Method | Path | Quyền | Mô tả | Phản hồi | Trạng thái |
|---|---|---|---|---|---|
| `GET` | `/api/companies/:companyId/costs` | membership | Tổng + theo ngày + theo agent + danh sách run; lọc theo `from`/`to` | `CostsResponse` | ⏳ |
| `GET` | `/api/companies/:companyId/runs` | membership | Lịch sử run (trạng thái, token, chi phí, số bước, lỗi) | `{ runs: RunView[] }` | ⏳ |
| `GET` | `/api/companies/:companyId/audit` | `requireManage` | Nhật ký kiểm toán | `{ entries: [...] }` | ⏳ |

Query: `costQuerySchema` `{ from?, to? }`; `paginationSchema` `{ limit, offset }`.

### 2.10 Sơ đồ và tổng quan

| Method | Path | Quyền | Mô tả | Phản hồi | Trạng thái |
|---|---|---|---|---|---|
| `GET` | `/api/companies/:companyId/diagram` | membership | Sơ đồ đội agent (node + edge + quy trình + danh mục tri thức) | `DiagramResponse` | ⏳ |
| `GET` | `/api/companies/:companyId/dashboard` | membership | Tổng quan: đếm task/hội thoại/tài liệu/agent, chi phí hôm nay & 30 ngày, hoạt động gần đây | `DashboardResponse` | ⏳ |

> `dashboard` và `artifacts` **không** nằm trong danh sách module `main.ts` tự nạp
> (`tools`, `team`, `knowledge`, `chat`, `tasks`, `settings`, `costs`, `diagram`).
> Vì vậy chúng được đăng ký bên trong một module đã được nạp (theo thiết kế của
> module dashboard) chứ không phải một file rời. Khi route được viết, kiểm tra lại
> vị trí đăng ký thực tế.

---

## 3. SSE — định dạng sự kiện

Endpoint: `GET /api/conversations/:id/stream`. Server ghi từng sự kiện theo đúng
định dạng SSE chuẩn (`apps/server/src/http/router.ts`):

```
event: <type>
data: <json>

```

- `event:` là một giá trị của `StreamEventType`.
- `data:` là JSON **một dòng** (server dùng `JSON.stringify`, không xuống dòng).
- Mỗi sự kiện kết thúc bằng **một dòng trống** (`\n\n`).
- Server gửi **comment giữ nhịp mỗi ~25 giây** để proxy không cắt kết nối nhàn rỗi.
- Server hủy đăng ký khỏi `EventBus` khi client đóng kết nối.
- Kết nối dùng **cookie phiên**, không dùng query token. Vì thế giao diện phải cùng
  origin với API (trình duyệt không cho `EventSource` gửi header tuỳ biến).

### 3.1 Danh sách `StreamEventType`

Định nghĩa tại `packages/shared/src/api.ts`, khớp `ORCHESTRATOR_EVENT_TYPES` trong
`packages/orchestrator/src/events.ts`:

| `type` | Khi nào phát | Payload (gợi ý theo tên) |
|---|---|---|
| `leader.thinking` | Leader bắt đầu/kết thúc một lượt suy nghĩ | trạng thái suy nghĩ |
| `leader.replied` | Leader trả lời người dùng | liên quan tới `MessageView` vừa tạo |
| `brief.updated` | Brief đủ hoặc còn thiếu trường | `{ briefComplete, missingFields }` |
| `plan.created` | Planner sinh xong DAG | danh sách task/dep |
| `task.updated` | Một task đổi trạng thái | `TaskView` / `{ taskId, status }` |
| `agent.started` | Agent chuyên môn bắt đầu chạy | `{ agentRole, taskId }` |
| `tool.called` | Một tool đã được gọi | tên tool + kết quả rút gọn |
| `artifact.created` | Có tài sản đầu ra mới | `ArtifactView` |
| `agent.message` | Trao đổi giữa các agent (handoff / request / reply / blocker) | `{ fromAgent, toAgent, kind }` |
| `review.completed` | ReviewGate kết thúc | `{ taskId, passed }` |
| `report.created` | Báo cáo 7 mục sẵn sàng | `{ artifactId }` |
| `warning` | Lỗi không chặn cả lượt chạy | `{ message }` |

Payload chính xác tuỳ từng nơi phát; giao diện nên đọc `type` trước rồi mới đọc
`payload`, và bỏ qua an toàn những sự kiện chưa biết.

### 3.2 Ví dụ thô

```
event: brief.updated
data: {"briefComplete":false,"missingFields":["ngân sách","thời hạn"]}

event: task.updated
data: {"taskId":"tsk_ab12","status":"in_progress"}

event: report.created
data: {"artifactId":"art_9f3c"}
```

---

## 4. Phụ lục — hình dạng phản hồi

Các interface dưới đây **không** được chép lại đầy đủ ở đây để tránh lệch; đọc
định nghĩa chuẩn trong `packages/shared/src/api.ts`. Bảng dưới là chỉ mục nhanh:

| Kiểu | Dùng ở |
|---|---|
| `ErrorEnvelope` | Mọi lỗi |
| `MeResponse`, `CompanySummary` | Auth, công ty |
| `TeamResponse`, `TeamMemberView`, `ModelOptionView` | Đội agent |
| `KnowledgeResponse`, `KnowledgeDocumentView`, `ReindexResponse` | Kho kiến thức |
| `ConversationView`, `MessageView`, `SendMessageResponse`, `ConversationDetailResponse` | Hội thoại |
| `TaskView`, `TaskListResponse`, `TaskDetailResponse`, `ReviewTaskResponse` | Công việc |
| `ArtifactView` | Tài sản đầu ra |
| `ProviderView`, `ProvidersResponse`, `ProviderTestResponse`, `IntegrationView`, `IntegrationsResponse`, `LimitsView` | Cài đặt |
| `CostsResponse`, `CostDayRow`, `CostAgentRow`, `RunView` | Chi phí |
| `DiagramResponse`, `DiagramNode`, `DiagramEdge` | Sơ đồ |
| `DashboardResponse` | Tổng quan |
| `SystemStatusResponse` | Trạng thái hệ thống |
| `StreamEventType` | SSE |

Giao diện **không** ghép chuỗi đường dẫn thủ công: dùng hằng số `API_ROUTES` trong
`packages/shared/src/api.ts` (ví dụ `API_ROUTES.team(companyId)`), để đổi đường dẫn
chỉ phải sửa một chỗ.
