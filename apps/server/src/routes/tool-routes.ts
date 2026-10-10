/**
 * Danh mục tool mà bản triển khai này cung cấp.
 *
 * Vì sao tách khỏi `team-routes.ts`: đây là thông tin của TIẾN TRÌNH (bản triển
 * khai có những tool nào), không phải cấu hình của công ty. Màn "Đội" cần cả hai
 * để biết tool nào có thể cấp và tool nào đang được cấp; gộp chúng lẫn nhau sẽ
 * khiến một thay đổi về registry kéo theo hình dạng của route cấu hình đội.
 *
 * Đường dẫn nằm dưới `/api/companies/:companyId` để mọi endpoint đều đi qua cùng
 * một hàng rào tenancy, dù dữ liệu trả về là toàn cục.
 */
import type { AppContext } from '../context.ts'
import { requireMembership } from '../http/middleware.ts'
import type { Router } from '../http/router.ts'
import { listToolDescriptors } from '../services/agent-services.ts'

export function toolRoutes() {
  return {
    name: 'tools',
    register(router: Router, ctx: AppContext): void {
      const repos = ctx.repos

      router.get(
        '/api/companies/:companyId/tools',
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
