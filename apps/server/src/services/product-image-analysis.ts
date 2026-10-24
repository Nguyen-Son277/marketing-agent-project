import type { Repos } from '@marketing-agent/db'
import { ModelRegistry } from '@marketing-agent/llm'
import { resolveKnowledgeClassificationModels } from './knowledge-model-settings.ts'
import { readKnowledgeOriginal } from './knowledge-storage.ts'

export async function analyzeProductImage(repos: Repos, kbRoot: string, companyId: string, documentId: string): Promise<{ product: string; description: string; tags: string[] }> {
  const doc = repos.knowledge.findDocumentById(documentId, companyId)
  if (!doc?.storageKey || !doc.mimeType?.startsWith('image/')) throw new Error('Không tìm thấy ảnh sản phẩm')
  const model = resolveKnowledgeClassificationModels(repos, companyId).find((entry) => entry.model.supportsVision)
  if (!model) throw new Error('Chưa cấu hình model hỗ trợ vision cho phân tích ảnh')
  const adapter = new ModelRegistry(repos.llm).adapterFor(model.model)
  const bytes = await readKnowledgeOriginal(kbRoot, companyId, doc.storageKey)
  const mimeType = doc.mimeType as 'image/png' | 'image/jpeg' | 'image/webp'
  let text = ''
  for await (const chunk of adapter.chat({
    model: model.model.modelId,
    maxTokens: Math.min(model.model.maxOutput, 1200),
    messages: [{ role: 'user', content: 'Phân tích ảnh sản phẩm. Trả về đúng JSON {"product":"...","description":"...","tags":["..."]}. Mô tả ngắn gọn bằng tiếng Việt.', images: [{ mimeType, data: bytes.toString('base64') }] }],
  })) if (chunk.type === 'text') text += chunk.text
  const match = /\{[\s\S]*\}/.exec(text)
  if (!match) throw new Error('Model vision trả về dữ liệu không hợp lệ')
  const parsed = JSON.parse(match[0]) as Record<string, unknown>
  const product = typeof parsed.product === 'string' ? parsed.product.trim().slice(0, 200) : ''
  const description = typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 4000) : ''
  const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 30) : []
  if (!description) throw new Error('Model vision không trả về mô tả ảnh')
  repos.db.run('UPDATE kb_documents SET image_product = COALESCE(?, image_product), image_description = ?, tags_json = ?, image_analysis_status = \'ready\', image_analysis_error = NULL, updated_at = ? WHERE company_id = ? AND id = ?', [product || null, description, JSON.stringify(tags), new Date().toISOString(), companyId, documentId])
  return { product, description, tags }
}
