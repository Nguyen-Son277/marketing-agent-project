/**
 * Schema, expressed as ordered migrations. Each entry runs exactly once and is
 * recorded in `schema_migrations`; migrations are append-only — never edit one
 * that has shipped, add a new one.
 *
 * SQLite conventions used throughout:
 *  - ids are TEXT (uuid or prefixed id), timestamps are ISO-8601 TEXT
 *  - every business table carries company_id so tenancy filters are mandatory
 *  - foreign keys are enforced (PRAGMA foreign_keys = ON at connection time)
 *  - JSON payloads live in TEXT columns suffixed `_json`
 */

export interface Migration {
  readonly id: string
  readonly sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001_core_tenancy',
    sql: `
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE companies (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE memberships (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (company_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_memberships_company ON memberships(company_id);

CREATE TABLE auth_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);
`,
  },
  {
    id: '0002_llm_registry',
    sql: `
CREATE TABLE llm_providers (
  id          TEXT PRIMARY KEY,
  company_id  TEXT REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('openai_compatible','anthropic')),
  base_url    TEXT NOT NULL,
  api_key_enc TEXT,
  api_key_iv  TEXT,
  api_key_hint TEXT,
  api_key_ref TEXT,
  extra_json  TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_providers_company ON llm_providers(company_id);

CREATE TABLE llm_models (
  id                TEXT PRIMARY KEY,
  provider_id       TEXT NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
  model_id          TEXT NOT NULL,
  label             TEXT NOT NULL,
  context_window    INTEGER NOT NULL DEFAULT 128000,
  max_output        INTEGER NOT NULL DEFAULT 16000,
  supports_tools    INTEGER NOT NULL DEFAULT 1,
  supports_vision   INTEGER NOT NULL DEFAULT 0,
  cost_in_per_mtok  REAL NOT NULL DEFAULT 0,
  cost_out_per_mtok REAL NOT NULL DEFAULT 0,
  enabled           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  UNIQUE (provider_id, model_id)
);
CREATE INDEX idx_models_provider ON llm_models(provider_id);

CREATE TABLE model_routes (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_def_id    TEXT NOT NULL,
  tier            TEXT NOT NULL CHECK (tier IN ('light','standard','deep')),
  model_fk        TEXT NOT NULL REFERENCES llm_models(id) ON DELETE CASCADE,
  reasoning_effort TEXT,
  max_tokens      INTEGER,
  priority        INTEGER NOT NULL DEFAULT 100,
  UNIQUE (company_id, agent_def_id, tier)
);
CREATE INDEX idx_routes_company ON model_routes(company_id);
`,
  },
  {
    id: '0003_team',
    sql: `
CREATE TABLE agent_defs (
  id                  TEXT PRIMARY KEY,
  role                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL,
  system_prompt       TEXT NOT NULL,
  default_skills_json TEXT NOT NULL DEFAULT '[]',
  default_tools_json  TEXT NOT NULL DEFAULT '[]',
  is_leader           INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL
);

CREATE TABLE agent_presets (
  id                    TEXT PRIMARY KEY,
  company_id            TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_def_id          TEXT NOT NULL REFERENCES agent_defs(id) ON DELETE CASCADE,
  display_name          TEXT,
  enabled               INTEGER NOT NULL DEFAULT 1,
  model_fk              TEXT REFERENCES llm_models(id) ON DELETE SET NULL,
  tier                  TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('light','standard','deep')),
  reasoning_effort      TEXT,
  max_tokens            INTEGER,
  context_budget_tokens INTEGER NOT NULL DEFAULT 60000,
  system_prompt_override TEXT,
  require_approval      INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT NOT NULL,
  UNIQUE (company_id, agent_def_id)
);
CREATE INDEX idx_presets_company ON agent_presets(company_id);

CREATE TABLE agent_skills (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category    TEXT NOT NULL,
  body_md     TEXT NOT NULL,
  origin      TEXT NOT NULL DEFAULT 'builtin',
  created_at  TEXT NOT NULL
);

CREATE TABLE agent_preset_skills (
  preset_id  TEXT NOT NULL REFERENCES agent_presets(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  PRIMARY KEY (preset_id, skill_name)
);
CREATE INDEX idx_preset_skills_company ON agent_preset_skills(company_id);

CREATE TABLE agent_preset_tools (
  preset_id  TEXT NOT NULL REFERENCES agent_presets(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  tool_name  TEXT NOT NULL,
  config_json TEXT,
  PRIMARY KEY (preset_id, tool_name)
);
CREATE INDEX idx_preset_tools_company ON agent_preset_tools(company_id);
`,
  },
  {
    id: '0004_knowledge',
    sql: `
CREATE TABLE kb_documents (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  path        TEXT NOT NULL,
  title       TEXT NOT NULL,
  category    TEXT NOT NULL,
  tags_json   TEXT NOT NULL DEFAULT '[]',
  checksum    TEXT NOT NULL,
  mtime       TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  source      TEXT NOT NULL DEFAULT 'ui',
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (company_id, path)
);
CREATE INDEX idx_kb_docs_company_cat ON kb_documents(company_id, category);

CREATE TABLE kb_chunks (
  id           TEXT PRIMARY KEY,
  document_id  TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  company_id   TEXT NOT NULL,
  ordinal      INTEGER NOT NULL,
  text         TEXT NOT NULL,
  heading_path TEXT,
  tokens       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (document_id, ordinal)
);
CREATE INDEX idx_kb_chunks_company ON kb_chunks(company_id);
CREATE INDEX idx_kb_chunks_doc ON kb_chunks(document_id);

-- Lexical candidate generation. SQLite FTS5 is compiled into better-sqlite3 builds.
CREATE VIRTUAL TABLE kb_chunks_fts USING fts5(
  text,
  chunk_id UNINDEXED,
  company_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE kb_embeddings (
  chunk_id   TEXT PRIMARY KEY REFERENCES kb_chunks(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  dim        INTEGER NOT NULL,
  norm       REAL NOT NULL,
  vec        BLOB NOT NULL,
  model      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_kb_emb_company ON kb_embeddings(company_id);

CREATE TABLE kb_acl (
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  agent_def_id TEXT NOT NULL REFERENCES agent_defs(id) ON DELETE CASCADE,
  can_read    INTEGER NOT NULL DEFAULT 1,
  can_write   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, category, agent_def_id)
);
CREATE INDEX idx_kb_acl_agent ON kb_acl(company_id, agent_def_id);

CREATE TABLE kb_index_jobs (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  document_id TEXT,
  status      TEXT NOT NULL,
  chunks      INTEGER NOT NULL DEFAULT 0,
  error       TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_kb_jobs_company ON kb_index_jobs(company_id, started_at);
`,
  },
  {
    id: '0005_work',
    sql: `
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  phase       TEXT NOT NULL DEFAULT 'intake',
  brief_json  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_conversations_company ON conversations(company_id, updated_at);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  company_id      TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  author_kind     TEXT NOT NULL CHECK (author_kind IN ('user','leader','specialist','system','tool')),
  author_agent    TEXT,
  content_md      TEXT NOT NULL,
  meta_json       TEXT,
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_company ON messages(company_id);

CREATE TABLE tasks (
  id                  TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  conversation_id     TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  parent_task_id      TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  brief_md            TEXT NOT NULL,
  assignee_agent_def_id TEXT REFERENCES agent_defs(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'draft',
  priority            INTEGER NOT NULL DEFAULT 3,
  deadline            TEXT,
  result_md           TEXT,
  deliverable_spec    TEXT,
  revision_count      INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX idx_tasks_company_status ON tasks(company_id, status);
CREATE INDEX idx_tasks_conversation ON tasks(conversation_id);

CREATE TABLE task_deps (
  task_id            TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id)
);

CREATE TABLE task_events (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  kind       TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_task_events_task ON task_events(task_id, created_at);

CREATE TABLE artifacts (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id     TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('markdown','json','csv','image','html','link')),
  content     TEXT,
  path        TEXT,
  meta_json   TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_artifacts_company ON artifacts(company_id, created_at);
CREATE INDEX idx_artifacts_task ON artifacts(task_id);

CREATE TABLE agent_messages (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_agent  TEXT NOT NULL,
  to_agent    TEXT NOT NULL,
  task_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('handoff','request','reply','blocker')),
  content_md  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_agent_messages_company ON agent_messages(company_id, created_at);
CREATE INDEX idx_agent_messages_task ON agent_messages(task_id);
`,
  },
  {
    id: '0006_accounting_integrations',
    sql: `
CREATE TABLE runs (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  agent_def_id    TEXT NOT NULL,
  provider_id     TEXT,
  model_id        TEXT,
  status          TEXT NOT NULL,
  tokens_in       INTEGER NOT NULL DEFAULT 0,
  tokens_out      INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL NOT NULL DEFAULT 0,
  latency_ms      INTEGER NOT NULL DEFAULT 0,
  steps           INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_runs_company ON runs(company_id, created_at);
CREATE INDEX idx_runs_task ON runs(task_id);

CREATE TABLE usage_daily (
  company_id   TEXT NOT NULL,
  day          TEXT NOT NULL,
  agent_def_id TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  tokens_in    INTEGER NOT NULL DEFAULT 0,
  tokens_out   INTEGER NOT NULL DEFAULT 0,
  cost_usd     REAL NOT NULL DEFAULT 0,
  runs         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, day, agent_def_id, model_id)
);

CREATE TABLE integrations (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  config_enc    TEXT,
  config_iv     TEXT,
  status        TEXT NOT NULL DEFAULT 'unconfigured',
  last_check_at TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (company_id, kind, name)
);
CREATE INDEX idx_integrations_company ON integrations(company_id, kind);

CREATE TABLE audit_log (
  id           TEXT PRIMARY KEY,
  company_id   TEXT,
  user_id      TEXT,
  action       TEXT NOT NULL,
  target       TEXT,
  payload_json TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_audit_company ON audit_log(company_id, created_at);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    id: '0007_conversation_language',
    sql: `
-- Ngôn ngữ của cuộc trao đổi, quyết định ngôn ngữ mà agent trả lời.
--
-- Vì sao lưu ở PHIÊN chứ không ở người dùng hay công ty: báo cáo và kế hoạch đã tạo
-- phải giữ nguyên ngôn ngữ lúc tạo. Nếu lưu ở người dùng thì người đổi ngôn ngữ giao
-- diện sẽ vô tình đổi ngôn ngữ của cả những báo cáo cũ khi chạy lại, và hai báo cáo
-- trong cùng một công ty sẽ lẫn ngôn ngữ nhau.
--
-- Mặc định 'vi' để mọi hàng đã có giữ nguyên hành vi cũ.
ALTER TABLE conversations ADD COLUMN language TEXT NOT NULL DEFAULT 'vi';
CREATE INDEX idx_conversations_language ON conversations(language);
`,
  },
  {
    id: '0008_provider_keys_and_agent_fallbacks',
    sql: `
-- Một URL có nhiều API key, và mỗi agent có danh sách model dự phòng.
--
-- Vì sao tách khoá ra bảng riêng thay vì giữ một cột trên llm_providers:
--  - người dùng cần khai nhiều khoá cho cùng một URL để khoá hỏng còn khoá khác chạy;
--  - mỗi khoá có nhãn, thứ tự dùng và trạng thái bật/tắt riêng;
--  - khoá vẫn được mã hoá AES-GCM như trước, chỉ đổi chỗ lưu.
CREATE TABLE llm_provider_keys (
  id           TEXT PRIMARY KEY,
  provider_id  TEXT NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  api_key_enc  TEXT,
  api_key_iv   TEXT,
  api_key_hint TEXT,
  priority     INTEGER NOT NULL DEFAULT 100,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_provider_keys_provider ON llm_provider_keys(provider_id, priority);

-- Model dự phòng của agent, theo thứ tự dùng khi model chính lỗi.
CREATE TABLE agent_model_fallbacks (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  agent_def_id TEXT NOT NULL REFERENCES agent_defs(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  model_fk     TEXT NOT NULL REFERENCES llm_models(id) ON DELETE CASCADE,
  UNIQUE (company_id, agent_def_id, position),
  UNIQUE (company_id, agent_def_id, model_fk)
);
CREATE INDEX idx_model_fallbacks_agent ON agent_model_fallbacks(company_id, agent_def_id);

-- Chuyển khoá cấp provider cũ (nếu có) thành khoá đầu tiên của bảng mới, rồi bỏ
-- tham chiếu biến môi trường. Khoá qua env là nguồn lỗi thật: cài xong mà quên điền
-- .env thì mọi lượt chạy hỏng, còn giao diện không có gì để sửa.
INSERT INTO llm_provider_keys (id, provider_id, label, api_key_enc, api_key_iv, api_key_hint, priority, enabled, created_at)
SELECT
  'key_' || lower(hex(randomblob(12))),
  id,
  'Key 1',
  api_key_enc,
  api_key_iv,
  api_key_hint,
  100,
  1,
  created_at
FROM llm_providers
WHERE api_key_enc IS NOT NULL;

UPDATE llm_providers
   SET api_key_enc = NULL, api_key_iv = NULL, api_key_hint = NULL, api_key_ref = NULL;

-- Provider toàn cục chỉ có thể do seed cũ tạo (API công ty không tạo được provider
-- company_id NULL). Xoá chúng để không còn cấu hình mặc định chết: model cascade,
-- route cascade, agent_presets.model_fk về NULL — đúng trạng thái "chưa gắn cho agent".
DELETE FROM llm_providers WHERE company_id IS NULL;
`,
  },
  {
    id: '0009_user_approval',
    sql: `
-- Tài khoản mới phải được admin duyệt. Tài khoản đã có giữ quyền sử dụng để nâng cấp
-- không khoá người đang vận hành; không ghi giả danh admin đã duyệt những hàng cũ.
ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (approval_status IN ('pending', 'approved'));
ALTER TABLE users ADD COLUMN approved_at TEXT;
ALTER TABLE users ADD COLUMN approved_by TEXT REFERENCES users(id) ON DELETE SET NULL;
UPDATE users SET approval_status = 'approved';
CREATE INDEX idx_users_approval_created ON users(approval_status, created_at, id);
`,
  },
  {
    id: '0010_employee_workforce',
    sql: `
-- Không dùng memberships cho nhân viên: họ chỉ xem việc được giao, không xem dữ liệu marketing.
ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'user' CHECK(account_type IN ('user','employee'));
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
CREATE TABLE employee_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 manager_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL DEFAULT 'designer', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE employee_company_access (
 user_id TEXT NOT NULL REFERENCES employee_profiles(user_id) ON DELETE CASCADE,
 company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 PRIMARY KEY(user_id,company_id)
);
CREATE TABLE employee_tasks (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 manager_id TEXT NOT NULL REFERENCES users(id), assignee_user_id TEXT NOT NULL REFERENCES employee_profiles(user_id),
 title TEXT NOT NULL, brief TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('image','video','other')),
 priority INTEGER NOT NULL DEFAULT 2, planned_week TEXT NOT NULL, planned_date TEXT, deadline TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','assigned','in_progress','review','done','cancelled')),
 source TEXT NOT NULL DEFAULT 'manager', source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
 idempotency_key TEXT UNIQUE, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX idx_employee_tasks_schedule ON employee_tasks(manager_id,planned_week,planned_date);
CREATE INDEX idx_employee_tasks_assignee ON employee_tasks(assignee_user_id,status,deadline);
CREATE TABLE employee_task_reports (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES employee_tasks(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, content TEXT NOT NULL, links_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE employee_task_events (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES employee_tasks(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_employee_reports_task ON employee_task_reports(task_id,created_at);
CREATE INDEX idx_employee_events_task ON employee_task_events(task_id,created_at);
-- Cấp tool tạo nháp một lần cho công ty hiện có; không reset grant khác.
INSERT OR IGNORE INTO agent_preset_tools(preset_id,company_id,tool_name)
 SELECT p.id,p.company_id,'employee_list' FROM agent_presets p JOIN agent_defs d ON d.id=p.agent_def_id WHERE d.role IN ('marketing-leader','design-video');
INSERT OR IGNORE INTO agent_preset_tools(preset_id,company_id,tool_name)
 SELECT p.id,p.company_id,'employee_task_draft' FROM agent_presets p JOIN agent_defs d ON d.id=p.agent_def_id WHERE d.role IN ('marketing-leader','design-video');
`,
  },
  {
    id: '0011_provider_key_rotation',
    sql: `
ALTER TABLE llm_providers ADD COLUMN key_usage_mode TEXT NOT NULL DEFAULT 'failover'
  CHECK (key_usage_mode IN ('failover', 'round_robin'));
CREATE TABLE llm_provider_key_rotation (
  provider_id TEXT PRIMARY KEY REFERENCES llm_providers(id) ON DELETE CASCADE,
  key_id TEXT REFERENCES llm_provider_keys(id) ON DELETE SET NULL,
  calls_used INTEGER NOT NULL DEFAULT 0 CHECK (calls_used BETWEEN 0 AND 3),
  block_id TEXT NOT NULL
);
`,
  },
  {
    id: '0012_workflow_indexes',
    sql: `
CREATE INDEX idx_runs_workflow_history ON runs(company_id, conversation_id, created_at DESC, id DESC);
CREATE INDEX idx_tasks_workflow_stable ON tasks(company_id, conversation_id, created_at ASC, id ASC);
`,
  },
  {
    id: '0013_daily_reports',
    sql: `
CREATE TABLE daily_report_groups (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 name TEXT NOT NULL, title TEXT NOT NULL, enabled INTEGER NOT NULL, model_id TEXT,
 members_json TEXT NOT NULL, start_date TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE daily_report_rounds (
 id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES daily_report_groups(id) ON DELETE CASCADE,
 date TEXT NOT NULL, opens_at TEXT NOT NULL, deadline TEXT NOT NULL, closes_at TEXT NOT NULL,
 members_json TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_enc TEXT NOT NULL, token_iv TEXT NOT NULL,
 sealed_at TEXT, UNIQUE(group_id,date)
);
CREATE TABLE daily_report_submissions (
 id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES daily_report_rounds(id) ON DELETE CASCADE,
 member_id TEXT NOT NULL, edit_hash TEXT NOT NULL, UNIQUE(round_id,member_id)
);
CREATE TABLE daily_report_revisions (
 submission_id TEXT NOT NULL REFERENCES daily_report_submissions(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, work TEXT NOT NULL, blockers TEXT NOT NULL, next_steps TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(submission_id,version)
);
CREATE TABLE daily_report_versions (
 id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES daily_report_rounds(id) ON DELETE CASCADE,
 number INTEGER NOT NULL, snapshot_json TEXT NOT NULL, english_json TEXT,
 status TEXT NOT NULL CHECK(status IN ('pending','running','ready','failed')),
 error TEXT, created_at TEXT NOT NULL, started_at TEXT, UNIQUE(round_id,number)
);
CREATE INDEX idx_daily_rounds_deadline ON daily_report_rounds(sealed_at,deadline);
CREATE INDEX idx_daily_versions_jobs ON daily_report_versions(status,created_at);
`,
  },
  {
    id: '0014_kb_canonical_content_upload_metadata',
    sql: `
ALTER TABLE kb_documents ADD COLUMN content TEXT;
ALTER TABLE kb_documents ADD COLUMN original_name TEXT;
ALTER TABLE kb_documents ADD COLUMN mime_type TEXT;
ALTER TABLE kb_documents ADD COLUMN size_bytes INTEGER;
ALTER TABLE kb_documents ADD COLUMN storage_key TEXT;
ALTER TABLE kb_documents ADD COLUMN original_checksum TEXT;
`,
  },
  {
    id: '0015_kb_auto_classification',
    sql: `
ALTER TABLE kb_chunks ADD COLUMN section_id TEXT REFERENCES kb_sections(id) ON DELETE SET NULL;
ALTER TABLE kb_chunks ADD COLUMN category TEXT;

CREATE TABLE kb_sections (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK (end_offset >= start_offset),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  assignment_source TEXT NOT NULL,
  UNIQUE (document_id, ordinal)
);
CREATE INDEX idx_kb_sections_doc ON kb_sections(company_id, document_id, ordinal);

CREATE TABLE kb_classification_jobs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','ready','failed')),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (company_id, document_id)
);
CREATE INDEX idx_kb_classification_pending ON kb_classification_jobs(status, created_at);
`,
  },
  {
    id: '0016_kb_classification_retry_schedule',
    sql: `ALTER TABLE kb_classification_jobs ADD COLUMN next_attempt_at TEXT;`,
  },
  {
    id: '0017_notifications',
    sql: `
CREATE TABLE notification_events (
 company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 dedupe_key TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(company_id,dedupe_key)
);
CREATE TABLE notifications (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, user_id TEXT NOT NULL,
 type TEXT NOT NULL, severity TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT,
 title TEXT NOT NULL, body TEXT NOT NULL, link TEXT,
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id) ON DELETE CASCADE
);
CREATE INDEX idx_notifications_inbox ON notifications(company_id,user_id,created_at DESC,id DESC);
CREATE INDEX idx_notifications_unread ON notifications(company_id,user_id) WHERE read_at IS NULL;
CREATE TABLE notification_preferences (
 company_id TEXT NOT NULL, user_id TEXT NOT NULL,
 agent INTEGER NOT NULL DEFAULT 1 CHECK(agent IN (0,1)),
 action_required INTEGER NOT NULL DEFAULT 1 CHECK(action_required IN (0,1)),
 budget INTEGER NOT NULL DEFAULT 1 CHECK(budget IN (0,1)),
 PRIMARY KEY(company_id,user_id),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id) ON DELETE CASCADE
);
`,
  },
  {
    id: '0018_chat_attachments',
    sql: `
CREATE TABLE chat_attachments (
 id TEXT PRIMARY KEY,
 company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
 filename TEXT NOT NULL,
 mime_type TEXT NOT NULL,
 size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 10485760),
 bytes BLOB NOT NULL,
 extracted_text TEXT,
 created_at TEXT NOT NULL
);
CREATE INDEX idx_chat_attachments_scope ON chat_attachments(company_id, conversation_id, message_id);
`,
  },
  {
    id: '0019_daily_report_view_links',
    sql: `
CREATE TABLE daily_report_view_links (
 round_id TEXT PRIMARY KEY REFERENCES daily_report_rounds(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE, token_enc TEXT NOT NULL, token_iv TEXT NOT NULL,
 created_at TEXT NOT NULL
);
`,
  },
  {
    id: '0020_social_browser',
    sql: `
CREATE TABLE browser_desktops (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 name TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE, token_enc TEXT NOT NULL, token_iv TEXT NOT NULL,
 region TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'human' CHECK(mode IN ('human','agent','paused')),
 active_job_id TEXT, created_at TEXT NOT NULL, UNIQUE(company_id,id)
);
CREATE TABLE browser_channels (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 desktop_id TEXT NOT NULL, name TEXT NOT NULL, platform TEXT NOT NULL, entry_url TEXT NOT NULL,
 allowed_hosts_json TEXT NOT NULL, instructions TEXT NOT NULL, can_post INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, UNIQUE(company_id,id),
 FOREIGN KEY(company_id,desktop_id) REFERENCES browser_desktops(company_id,id)
);
CREATE TABLE browser_contents (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(company_id,id)
);
CREATE TABLE browser_assets (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, content_id TEXT NOT NULL,
 filename TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 268435456),
 created_at TEXT NOT NULL,
 FOREIGN KEY(company_id,content_id) REFERENCES browser_contents(company_id,id) ON DELETE CASCADE
);
CREATE TABLE browser_jobs (
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL, channel_id TEXT NOT NULL, content_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('publish','read')),
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','waiting_human','succeeded','failed','cancelled')),
 instructions TEXT NOT NULL, result_url TEXT, result TEXT, idempotency_key TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(company_id,idempotency_key),
 FOREIGN KEY(company_id,channel_id) REFERENCES browser_channels(company_id,id),
 FOREIGN KEY(company_id,content_id) REFERENCES browser_contents(company_id,id)
);
CREATE INDEX idx_browser_jobs_company ON browser_jobs(company_id,created_at DESC);
CREATE TABLE browser_job_events (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES browser_jobs(id) ON DELETE CASCADE,
 operation TEXT NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL
);
`,
  },
  {
    id: '0021_daily_report_day_off',
    sql: `
ALTER TABLE daily_report_revisions ADD COLUMN is_day_off INTEGER NOT NULL DEFAULT 0 CHECK(is_day_off IN (0,1));
`,
  },
  {
    id: '0018_campaign_loop',
    sql: `
CREATE TABLE agencies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE agency_memberships (
  agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','operator','analyst')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (agency_id, user_id)
);
CREATE INDEX idx_agency_memberships_user ON agency_memberships(user_id);

CREATE TABLE agency_clients (
  agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (agency_id, company_id)
);
CREATE INDEX idx_agency_clients_company ON agency_clients(company_id);

CREATE TABLE automation_policies (
  company_id TEXT PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  timezone TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  channels_json TEXT NOT NULL DEFAULT '["meta","linkedin","email"]',
  max_posts_per_day INTEGER NOT NULL DEFAULT 0 CHECK (max_posts_per_day >= 0),
  max_emails_per_day INTEGER NOT NULL DEFAULT 0 CHECK (max_emails_per_day >= 0),
  quiet_start TEXT,
  quiet_end TEXT,
  kill_switch INTEGER NOT NULL DEFAULT 0 CHECK (kill_switch IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE campaigns (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','running','paused','completed','failed')),
  timezone TEXT NOT NULL,
  objective TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_campaigns_company_status ON campaigns(company_id,status,updated_at DESC);

CREATE TABLE audiences (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(company_id,name)
);

CREATE TABLE audience_contacts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  audience_id TEXT NOT NULL REFERENCES audiences(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  consent_status TEXT NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('opted_in','unsubscribed','unknown')),
  source TEXT,
  consent_at TEXT,
  consent_version TEXT,
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(audience_id,email)
);
CREATE INDEX idx_audience_contacts_company_email ON audience_contacts(company_id,email);
CREATE INDEX idx_audience_contacts_opted_in ON audience_contacts(audience_id,consent_status);

CREATE TABLE consent_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES audience_contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('opt_in','unsubscribe','resubscribe','imported')),
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT
);
CREATE INDEX idx_consent_events_contact ON consent_events(contact_id,occurred_at DESC);

CREATE TABLE campaign_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('meta','linkedin','email')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  link TEXT,
  audience_id TEXT REFERENCES audiences(id) ON DELETE SET NULL,
  scheduled_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','running','accepted','failed','suppressed','cancelled')),
  artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
  provider_ref TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,idempotency_key)
);
CREATE INDEX idx_campaign_items_schedule ON campaign_items(company_id,status,scheduled_at);
CREATE INDEX idx_campaign_items_campaign ON campaign_items(campaign_id,created_at);

CREATE TABLE execution_jobs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_item_id TEXT NOT NULL REFERENCES campaign_items(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','leased','accepted','failed','suppressed','cancelled')),
  run_at TEXT NOT NULL,
  lease_until TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  idempotency_key TEXT NOT NULL,
  provider_request_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id,idempotency_key)
);
CREATE INDEX idx_execution_jobs_due ON execution_jobs(status,run_at,lease_until);
CREATE INDEX idx_execution_jobs_company ON execution_jobs(company_id,updated_at DESC);

CREATE TABLE execution_attempts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES execution_jobs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','leased','accepted','failed','suppressed','cancelled')),
  provider_request_id TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(job_id,attempt)
);
CREATE INDEX idx_execution_attempts_job ON execution_attempts(job_id,attempt);

CREATE TABLE metric_snapshots (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_item_id TEXT NOT NULL REFERENCES campaign_items(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('meta','linkedin','email')),
  metric_date TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(campaign_item_id,metric_date)
);
CREATE INDEX idx_metric_snapshots_company ON metric_snapshots(company_id,metric_date DESC);
`,
  },
  {
    id: '0019_campaign_job_contact',
    sql: `
ALTER TABLE execution_jobs ADD COLUMN contact_id TEXT REFERENCES audience_contacts(id) ON DELETE SET NULL;
CREATE INDEX idx_execution_jobs_contact ON execution_jobs(contact_id);
`,
  },
  {
    id: '0020_campaign_agency_clients_compat',
    sql: `
CREATE TABLE IF NOT EXISTS agency_clients (
  agency_id TEXT NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (agency_id, company_id)
);
CREATE INDEX IF NOT EXISTS idx_agency_clients_company ON agency_clients(company_id);
`,
  },
  {
    id: '0021_campaign_policy_hosts',
    sql: `ALTER TABLE automation_policies ADD COLUMN allowed_hosts_json TEXT NOT NULL DEFAULT '[]';`,
  },
]
