/**
 * Test đường nâng cấp của migration `0008` trên một DB đã tồn tại.
 *
 * Vì sao cần test riêng: `foundation.test.ts` chỉ chạy migration trên DB trắng, nơi
 * bảng mới được tạo mà không có dữ liệu cũ để chuyển. Đúng lúc nâng cấp thật mới là
 * lúc dễ mất dữ liệu nhất — khoá cấp provider phải được chuyển sang bảng khoá, còn
 * provider toàn cục do seed cũ phải bị xoá kèm model/route của nó.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRepos, type Repos } from '../src/index.ts'

const NEW_TABLES = ['llm_provider_keys', 'agent_model_fallbacks'] as const

let dir: string
let file: string
let repos: Repos
/** Bản mã hoá của khoá cũ, để đối chiếu sau khi migration chuyển nó sang bảng mới. */
let legacyEnc: { enc: string; iv: string }

/** Đưa DB về đúng trạng thái trước migration 0008 và gieo dữ liệu kiểu cũ. */
function seedLegacyState(repos: Repos): void {
  const db = repos.db
  // Khoá cũ phải là bản mã hoá thật (cùng APP_SECRET) để kiểm tra được việc chuyển sang
  // bảng mới mà vẫn giải mã ra đúng giá trị gốc.
  const encrypted = repos.secrets.encrypt('sk-real-key')
  legacyEnc = encrypted
  for (const table of NEW_TABLES) db.run(`DROP TABLE IF EXISTS ${table}`)
  db.run("DELETE FROM schema_migrations WHERE id = '0008_provider_keys_and_agent_fallbacks'")

  db.run('INSERT INTO companies (id, name, slug, created_at) VALUES (?, ?, ?, ?)', [
    'cmp1',
    'Cong ty cu',
    'cong-ty-cu',
    '2026-01-01T00:00:00.000Z',
  ])
  db.run(
    `INSERT INTO agent_defs (id, role, name, description, system_prompt, default_skills_json, default_tools_json, is_leader, created_at)
     VALUES (?, ?, ?, ?, ?, '[]', '[]', 0, ?)`,
    ['def1', 'content-writer', 'Viet noi dung', 'Viet', '# Vai tro', '2026-01-01T00:00:00.000Z'],
  )

  // Provider của công ty, khoá nằm ở cột cũ.
  db.run(
    `INSERT INTO llm_providers (id, company_id, name, kind, base_url, api_key_enc, api_key_iv, api_key_hint, api_key_ref, extra_json, enabled, created_at)
     VALUES ('prov-company', 'cmp1', 'Provider cong ty', 'openai_compatible', 'http://old/v1', @enc, @iv, 'sk-…abcd', NULL, NULL, 1, '2026-01-01T00:00:00.000Z')`,
    { enc: encrypted.enc, iv: encrypted.iv },
  )
  db.run(
    `INSERT INTO llm_models (id, provider_id, model_id, label, context_window, max_output, supports_tools, supports_vision, cost_in_per_mtok, cost_out_per_mtok, enabled, created_at)
     VALUES ('model-company', 'prov-company', 'm-company', 'Model cong ty', 128000, 16000, 1, 0, 0, 0, 1, '2026-01-01T00:00:00.000Z')`,
  )
  db.run(
    `INSERT INTO agent_presets (id, company_id, agent_def_id, display_name, enabled, model_fk, tier, reasoning_effort, max_tokens, context_budget_tokens, system_prompt_override, require_approval, created_at)
     VALUES ('preset1', 'cmp1', 'def1', NULL, 1, 'model-company', 'standard', NULL, NULL, 60000, NULL, 1, '2026-01-01T00:00:00.000Z')`,
  )

  // Provider toàn cục do seed cũ tạo, có model được route trỏ tới.
  db.run(
    `INSERT INTO llm_providers (id, company_id, name, kind, base_url, api_key_enc, api_key_iv, api_key_hint, api_key_ref, extra_json, enabled, created_at)
     VALUES ('prov-global', NULL, 'Gateway seed', 'openai_compatible', 'http://localhost:20128/v1', NULL, NULL, NULL, 'DEEPSEEK_API_KEY', NULL, 1, '2026-01-01T00:00:00.000Z')`,
  )
  db.run(
    `INSERT INTO llm_models (id, provider_id, model_id, label, context_window, max_output, supports_tools, supports_vision, cost_in_per_mtok, cost_out_per_mtok, enabled, created_at)
     VALUES ('model-global', 'prov-global', 'm-global', 'Model seed', 128000, 16000, 1, 0, 0, 0, 1, '2026-01-01T00:00:00.000Z')`,
  )
  db.run(
    `INSERT INTO model_routes (id, company_id, agent_def_id, tier, model_fk, reasoning_effort, max_tokens, priority)
     VALUES ('route1', 'cmp1', 'def1', 'standard', 'model-global', NULL, NULL, 100)`,
  )
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ma-migration-0008-'))
  file = join(dir, 'marketing.db')
  repos = createRepos({ file, allowWeakSecret: true })
  seedLegacyState(repos)
  repos.db.close()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('migration 0008 trên DB cũ', () => {
  it('chuyển khoá cấp provider thành bảng khoá và xoá provider seed toàn cục', () => {
    const migrated = createRepos({ file, allowWeakSecret: true })
    try {
      // Khoá cũ được chuyển sang bảng mới, giữ nguyên bản mã hoá và gợi ý.
      const keys = migrated.db.all<{ provider_id: string; label: string; api_key_enc: string; api_key_hint: string }>(
        'SELECT provider_id, label, api_key_enc, api_key_hint FROM llm_provider_keys',
      )
      expect(keys).toHaveLength(1)
      expect(keys[0]).toMatchObject({
        provider_id: 'prov-company',
        label: 'Key 1',
        api_key_enc: legacyEnc.enc,
        api_key_hint: 'sk-…abcd',
      })

      // Cột khoá cũ được dọn để không còn đường đọc khoá ngoài bảng mới.
      const legacy = migrated.db.get<{ api_key_enc: string | null; api_key_ref: string | null }>(
        'SELECT api_key_enc, api_key_ref FROM llm_providers WHERE id = ?',
        ['prov-company'],
      )
      expect(legacy?.api_key_enc).toBeNull()
      expect(legacy?.api_key_ref).toBeNull()

      // Provider toàn cục (seed cũ) bị xoá, model và route của nó theo cascade.
      expect(migrated.llm.findProvider('prov-global')).toBeUndefined()
      expect(migrated.llm.findModel('model-global')).toBeUndefined()
      expect(migrated.llm.listRoutes('cmp1')).toHaveLength(0)

      // Provider của công ty còn nguyên, và resolver đọc khoá từ bảng mới.
      expect(migrated.llm.findProvider('prov-company')?.name).toBe('Provider cong ty')
      expect(migrated.llm.resolveProviderKeys(migrated.llm.requireProvider('prov-company'))).toEqual([
        { id: expect.any(String), label: 'Key 1', apiKey: 'sk-real-key' },
      ])

      // Migration chỉ chạy một lần.
      migrated.db.close()
      const again = createRepos({ file, allowWeakSecret: true })
      expect(again.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM llm_provider_keys')?.n).toBe(1)
      again.db.close()
    } finally {
      // `migrated` có thể đã đóng ở nhánh trên; đóng lại là no-op với better-sqlite3.
      try {
        migrated.db.close()
      } catch {
        // đã đóng
      }
    }
  })
})
