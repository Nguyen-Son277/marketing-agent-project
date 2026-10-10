/**
 * Nối các mảnh thật của hệ thống thành phụ thuộc của vòng lặp agent.
 *
 * Vì sao cần hàm này: `runAgent` cố tình chỉ phụ thuộc vào giao diện hẹp để test được
 * bằng đối tượng giả. Server/orchestrator không nên tự ghép registry + router + cost
 * ở mỗi chỗ gọi — một điểm ghép duy nhất thì thay đổi cách chọn model chỉ sửa một nơi.
 */
import type { AccountingRepo, LlmRepo } from '@marketing-agent/db'
import { CostMeter, ModelRegistry, ModelRouter } from '@marketing-agent/llm'
import type { AgentRuntimeDeps } from './types.ts'

export interface RuntimeRepos {
  readonly llm: LlmRepo
  readonly accounting: AccountingRepo
}

export function createRuntimeDeps(repos: RuntimeRepos): AgentRuntimeDeps {
  const registry = new ModelRegistry(repos.llm)
  const router = new ModelRouter(registry, repos.llm)

  return {
    router,
    adapters: { adapterFor: (model) => registry.adapterFor(model) },
    meterFactory: (input) => {
      const meter = new CostMeter(repos.accounting)
      meter.open(input)
      return meter
    },
  }
}
