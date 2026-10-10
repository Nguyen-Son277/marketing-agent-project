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
]
