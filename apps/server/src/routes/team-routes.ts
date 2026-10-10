/**
 * Đội agent của một công ty: ai đang bật, dùng model nào, có kỹ năng/tool/quyền
 * đọc kho kiến thức nào.
 *
 * Vì sao gộp đọc và ghi cấu hình vào một module: cả hai đều xoay quanh `agent_presets`
 * — bản ghi duy nhất định nghĩa "agent này chạy thế nào cho công ty này". Tách ra
 * sẽ khiến hai route phải giữ cùng một logic ghép định nghĩa + preset + ACL.
 */
import { notFound, parseOrThrow, updateTeamMemberSchema } from '@marketing-agent/shared'
import type { AppContext } from '../context.ts'
import { readAuth, requireManage, requireMembership } from '../http/middleware.ts'
import type { RequestContext, Router } from '../http/router.ts'
import { listToolDescriptors } from '../services/agent-services.ts'
import { toModelOptionView, toTeamMemberView } from '../services/view-mappers.ts'

export function teamRoutes() {
  return {
    name: 'team',
    register(router: Router, ctx: AppContext): void {
      const repos = ctx.repos

      router.get(
        '/api/companies/:companyId/team',
        async (request) => {
          const companyId = request.params.companyId!
          const defs = repos.team.listAgentDefs()
          const members = []
          for (const def of defs) {
            const preset = repos.team.findPreset(companyId, def.id)
            if (!preset) continue
            members.push(toTeamMemberView({ repos, companyId, def, preset }))
          }

          const providerNames = new Map(
            repos.llm
              .listProviders(companyId, { includeDisabled: true })
              .map((provider) => [provider.id, provider.name]),
          )
          const usage = repos.llm.modelUsage(companyId)
          const models = repos.llm.listModels(companyId).map((model) => ({
            ...toModelOptionView(model, {
              providerName: providerNames.get(model.providerId) ?? '',
              usedByAgentCount: usage.get(model.id) ?? 0,
            }),
          }))
          const tools = await listToolDescriptors(ctx)

          request.json(200, {
            members,
            availableSkills: repos.team.listSkills().map((skill) => ({
              name: skill.name,
              description: skill.description,
              category: skill.category,
            })),
            availableTools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              requiresApproval: tool.requiresApproval,
            })),
            models,
          })
        },
        [requireMembership(repos)],
      )

      router.patch(
        '/api/companies/:companyId/team/:role',
        async (request) => {
          const companyId = request.params.companyId!
          const role = request.params.role!
          const def = repos.team.findAgentDefByRole(role)
          if (!def) throw notFound(`Không có agent với vai trò ${role}`)
          const preset = repos.team.findPreset(companyId, def.id)
          if (!preset) throw notFound('Công ty chưa cấu hình agent này')

          const input = parseOrThrow(updateTeamMemberSchema, await request.body(), 'cấu hình agent')
          repos.team.updatePreset(companyId, def.id, {
            ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
            ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
            ...(input.modelFk === undefined ? {} : { modelFk: input.modelFk }),
            ...(input.tier === undefined ? {} : { tier: input.tier }),
            ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
            ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
            ...(input.contextBudgetTokens === undefined ? {} : { contextBudgetTokens: input.contextBudgetTokens }),
            ...(input.systemPromptOverride === undefined ? {} : { systemPromptOverride: input.systemPromptOverride }),
            ...(input.requireApproval === undefined ? {} : { requireApproval: input.requireApproval }),
          })
          if (input.skills !== undefined) repos.team.setPresetSkills(preset.id, companyId, input.skills)
          if (input.tools !== undefined) repos.team.setPresetTools(preset.id, companyId, input.tools)
          if (input.fallbackModelFks !== undefined) {
            // Mọi model dự phòng phải thuộc công ty này; nếu không, một id gõ sai sẽ
            // nằm im trong DB và chỉ lộ ra khi model chính hỏng.
            const unique = [...new Set(input.fallbackModelFks)]
            for (const modelFk of unique) {
              const model = repos.llm.findModel(modelFk)
              if (!model) throw notFound(`Không tìm thấy model dự phòng ${modelFk}`)
              const provider = repos.llm.findProvider(model.providerId)
              if (!provider || provider.companyId !== companyId) {
                throw notFound(`Model dự phòng ${model.label} không thuộc công ty này`)
              }
            }
            repos.llm.setModelFallbacks(companyId, def.id, unique)
          }
          if (input.knowledge !== undefined) {
            repos.team.setKnowledgeAcl(
              companyId,
              def.id,
              input.knowledge.map((entry) => ({
                category: entry.category,
                canRead: entry.canRead ?? true,
                canWrite: entry.canWrite ?? false,
              })),
            )
          }

          repos.accounting.audit({
            companyId,
            userId: currentUserId(request),
            action: 'team.update',
            target: role,
            payload: { fields: Object.keys(input) },
          })

          const updated = repos.team.requirePresetByCompanyAgent(companyId, def.id)
          request.json(200, { member: toTeamMemberView({ repos, companyId, def, preset: updated }) })
        },
        [requireMembership(repos), requireManage],
      )

      router.get(
        '/api/companies/:companyId/team/skills',
        async (request) => {
          request.json(200, {
            skills: repos.team.listSkills().map((skill) => ({
              name: skill.name,
              description: skill.description,
              category: skill.category,
            })),
          })
        },
        [requireMembership(repos)],
      )

      router.get(
        '/api/companies/:companyId/team/tools',
        async (request) => {
          const tools = await listToolDescriptors(ctx)
          request.json(200, {
            tools: tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              requiresApproval: tool.requiresApproval,
              roles: tool.roles,
            })),
          })
        },
        [requireMembership(repos)],
      )
    },
  }
}

/** Người thực hiện thao tác ghi, lấy từ state đã được middleware xác thực. */
function currentUserId(request: RequestContext): string | undefined {
  return readAuth(request)?.user.id
}
