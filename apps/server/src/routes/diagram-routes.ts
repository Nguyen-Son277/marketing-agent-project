/**
 * Sơ đồ đội agent và (đăng ký kèm) tổng quan/tài sản đầu ra.
 *
 * Vì sao sơ đồ được suy ra từ cấu hình thật thay vì vẽ cứng trong giao diện: mỗi
 * công ty có thể tắt agent, đổi model, thu hẹp quyền đọc kho kiến thức. Một sơ đồ
 * cứng sẽ nói dối ngay khi người dùng đổi cài đặt; sơ đồ dựng từ `agent_defs` +
 * `agent_presets` + `kb_acl` luôn khớp với thực tế đang chạy.
 *
 * Tệp này cũng đăng ký module dashboard: `main.ts` chỉ dò các tên cố định
 * (tool|team|knowledge|chat|tasks|settings|costs|diagram), nên dashboard không có
 * tệp riêng để được nạp — xem `dashboard-routes.ts`.
 */
import { KB_CATEGORIES } from '@marketing-agent/shared'
import type { AgentRole, DiagramEdge, DiagramNode, DiagramResponse } from '@marketing-agent/shared'
import type { AppContext } from '../context.ts'
import { requireMembership } from '../http/middleware.ts'
import type { Router } from '../http/router.ts'
import { dashboardRoutes } from './dashboard-routes.ts'
import { resolvePresetModel } from '../services/view-mappers.ts'

/** Vị trí của một vai trò trong sơ đồ, theo tầng công việc. */
const ROLE_LAYER: Readonly<Record<AgentRole, DiagramNode['layer']>> = {
  'marketing-leader': 'leader',
  'market-research': 'research',
  'content-writer': 'content',
  'seo-technical': 'content',
  'design-video': 'content',
  'social-media': 'channel',
  'paid-media': 'channel',
  'email-crm': 'channel',
  'community-care': 'channel',
  analytics: 'measure',
}

/** Bàn giao đầu ra giữa các chuyên môn, theo đúng luồng nghiệp vụ của playbook. */
const HANDOFFS: readonly (readonly [AgentRole, AgentRole])[] = [
  ['market-research', 'content-writer'],
  ['content-writer', 'seo-technical'],
  ['content-writer', 'social-media'],
  ['design-video', 'social-media'],
  ['social-media', 'analytics'],
  ['paid-media', 'analytics'],
  ['email-crm', 'analytics'],
  ['seo-technical', 'analytics'],
  ['community-care', 'analytics'],
]

/** Trao đổi ngang hàng: các chuyên môn nội dung phối hợp với nhau. */
const PEERS: readonly (readonly [AgentRole, AgentRole])[] = [
  ['content-writer', 'design-video'],
  ['social-media', 'paid-media'],
]

/** Các mốc cố định của một phiên làm việc; khớp `ConversationPhase`. */
const WORKFLOW: readonly { id: string; title: string; description: string }[] = [
  { id: 'intake', title: 'Nhận yêu cầu', description: 'Người dùng mô tả mục tiêu marketing bằng ngôn ngữ tự nhiên.' },
  { id: 'clarify', title: 'Chốt brief', description: 'Leader hỏi đúng những trường còn thiếu: mục tiêu, KPI, phạm vi, hạn, ngân sách, ràng buộc.' },
  { id: 'plan', title: 'Lập kế hoạch', description: 'Leader chia việc, giao mỗi việc cho một chuyên môn, nêu thứ tự phụ thuộc và đầu ra.' },
  { id: 'assign', title: 'Giao việc', description: 'Công việc được ghi vào sổ với người nhận, hạn và đầu ra kiểm chứng được.' },
  { id: 'execute', title: 'Thi hành', description: 'Từng chuyên môn chạy, dùng tool và kho kiến thức trong phạm vi được cấp.' },
  { id: 'review', title: 'Kiểm tra chất lượng', description: 'Cổng kiểm tra đối chiếu đầu ra với brief trước khi báo cáo.' },
  { id: 'report', title: 'Báo cáo', description: 'Tổng hợp bảy mục cố định, kèm chi phí và nguồn số liệu thật.' },
]

export function diagramRoutes() {
  const dashboard = dashboardRoutes()
  return {
    name: 'diagram',
    register(router: Router, ctx: AppContext): void {
      const repos = ctx.repos

      router.get(
        '/api/companies/:companyId/diagram',
        async (request) => {
          const companyId = request.params.companyId!
          const defs = repos.team.listAgentDefs()
          const idByRole = new Map(defs.map((def) => [def.role, def.id]))

          const nodes: DiagramNode[] = []
          for (const def of defs) {
            const preset = repos.team.findPreset(companyId, def.id)
            if (!preset) continue
            const model = resolvePresetModel(repos, companyId, def, preset)
            nodes.push({
              id: def.id,
              role: def.role,
              label: preset.displayName ?? def.name,
              layer: ROLE_LAYER[def.role],
              enabled: preset.enabled,
              modelLabel: model?.label ?? null,
              tier: preset.tier,
              skills: repos.team.listSkillsForPreset(preset.id).map((skill) => skill.name),
              tools: repos.team.listPresetTools(preset.id).map((tool) => tool.toolName),
              knowledgeRead: repos.team.readableCategories(companyId, def.id),
              knowledgeWrite: repos.team.writableCategories(companyId, def.id),
            })
          }

          const edges: DiagramEdge[] = []
          const leaderId = idByRole.get('marketing-leader')
          if (leaderId) {
            for (const node of nodes) {
              if (node.id === leaderId) continue
              edges.push({ from: leaderId, to: node.id, kind: 'delegates' })
            }
          }
          for (const [from, to] of HANDOFFS) addEdge(edges, idByRole, from, to, 'hands_off')
          for (const [from, to] of PEERS) addEdge(edges, idByRole, from, to, 'peer')

          const rolesByCategory = new Map<string, AgentRole[]>()
          for (const def of defs) {
            for (const category of repos.team.readableCategories(companyId, def.id)) {
              const bucket = rolesByCategory.get(category) ?? []
              bucket.push(def.role)
              rolesByCategory.set(category, bucket)
            }
          }

          const response: DiagramResponse = {
            nodes,
            edges,
            workflow: WORKFLOW.map((step) => ({ ...step })),
            knowledge: KB_CATEGORIES.map((category) => ({
              code: category.code,
              label: category.label,
              owners: (rolesByCategory.get(category.code) ?? []).sort(),
            })),
          }
          request.json(200, response)
        },
        [requireMembership(repos)],
      )

      // Dashboard + artifacts không có module riêng được `main.ts` dò tới.
      dashboard.register(router, ctx)
    },
  }
}

function addEdge(
  edges: DiagramEdge[],
  idByRole: ReadonlyMap<AgentRole, string>,
  from: AgentRole,
  to: AgentRole,
  kind: DiagramEdge['kind'],
): void {
  const fromId = idByRole.get(from)
  const toId = idByRole.get(to)
  if (!fromId || !toId) return
  edges.push({ from: fromId, to: toId, kind })
}
