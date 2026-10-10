/**
 * Test cho đa ngôn ngữ ở tầng backend.
 *
 * Trọng tâm là những chỗ dễ sai âm thầm:
 *  - `Accept-Language` quyết định ngôn ngữ của `message` trong phong bì lỗi.
 *  - `messageKey` và `messageParams` phải có mặt để trình duyệt dịch lại được.
 *  - Ngôn ngữ của phiên lưu ở CSDL, và KHÔNG đổi khi người dùng đổi ngôn ngữ giao diện.
 *  - Giá trị ngôn ngữ không hợp lệ bị từ chối thay vì âm thầm đổi thành tiếng Việt.
 */
import { describe, expect, it } from 'vitest'
import { createRoutesTestContext, tenant } from './helpers/routes-helpers.ts'

describe('ngôn ngữ trong phong bì lỗi', () => {
  it('dịch thông báo lỗi theo Accept-Language và trả kèm khoá', async () => {
    const ctx = await createRoutesTestContext()
    try {
      // Gọi một đường dẫn API không tồn tại để nhận phong bì lỗi có khoá.
      const response = await ctx.client.request('GET', '/api/khong-ton-tai', {
        headers: { 'Accept-Language': 'en-US,en;q=0.9' },
      })
      expect(response.status).toBe(404)
      const body = response.json<{ error: { code: string; message: string; messageKey?: string } }>()
      expect(body.error.code).toBe('not_found')
      expect(body.error.messageKey).toBe('errors.generic.endpointNotFound')
      // Điểm cốt lõi: cùng một lỗi nhưng câu chữ theo ngôn ngữ yêu cầu.
      expect(body.error.message).not.toContain('không')
      expect(body.error.message.toLowerCase()).toContain('endpoint')
    } finally {
      await ctx.close()
    }
  })

  it('trả thông báo tiếng Việt khi Accept-Language là vi', async () => {
    const ctx = await createRoutesTestContext()
    try {
      const response = await ctx.client.request('GET', '/api/khong-ton-tai', {
        headers: { 'Accept-Language': 'vi-VN,vi;q=0.9' },
      })
      const body = response.json<{ error: { message: string } }>()
      expect(body.error.message).toContain('không tồn tại')
    } finally {
      await ctx.close()
    }
  })

  it('dùng ngôn ngữ mặc định khi không có Accept-Language', async () => {
    const ctx = await createRoutesTestContext()
    try {
      const response = await ctx.client.request('GET', '/api/khong-ton-tai')
      const body = response.json<{ error: { message: string } }>()
      expect(body.error.message).toContain('không tồn tại')
    } finally {
      await ctx.close()
    }
  })
})

describe('ngôn ngữ của cuộc trao đổi', () => {
  it('lưu ngôn ngữ đã gửi và trả lại trong view', async () => {
    const ctx = await createRoutesTestContext()
    try {
      const { ownerCookie: cookie, company } = await tenant(ctx, 'i18n-en@example.com', 'Cong Ty EN')
      const companyId = company.id
      const response = await ctx.client.request('POST', `/api/companies/${companyId}/conversations`, {
        headers: cookie,
        body: { title: 'English session', language: 'en' },
      })
      expect(response.status).toBe(201)
      const body = response.json<{ conversation: { id: string; language: string } }>()
      expect(body.conversation.language).toBe('en')

      // Đọc lại từ CSDL để chắc rằng giá trị đã được lưu, không chỉ phản chiếu tham số.
      const stored = ctx.repos.work.findConversation(body.conversation.id, companyId)
      expect(stored?.language).toBe('en')
    } finally {
      await ctx.close()
    }
  })

  it('mặc định là tiếng Việt khi không gửi ngôn ngữ', async () => {
    const ctx = await createRoutesTestContext()
    try {
      const { ownerCookie: cookie, company } = await tenant(ctx, 'i18n-en@example.com', 'Cong Ty EN')
      const companyId = company.id
      const response = await ctx.client.request('POST', `/api/companies/${companyId}/conversations`, {
        headers: cookie,
        body: { title: 'Phiên mặc định' },
      })
      const body = response.json<{ conversation: { id: string; language: string } }>()
      expect(body.conversation.language).toBe('vi')
    } finally {
      await ctx.close()
    }
  })

  it('từ chối ngôn ngữ không hỗ trợ thay vì âm thầm đổi thành tiếng Việt', async () => {
    const ctx = await createRoutesTestContext()
    try {
      const { ownerCookie: cookie, company } = await tenant(ctx, 'i18n-en@example.com', 'Cong Ty EN')
      const companyId = company.id
      const response = await ctx.client.request('POST', `/api/companies/${companyId}/conversations`, {
        headers: cookie,
        body: { title: 'Sai ngôn ngữ', language: 'ja' },
      })
      // Nếu âm thầm đổi thành 'vi' thì người gọi tưởng đã đặt được tiếng Nhật và chỉ phát
      // hiện khi đọc báo cáo — sai lệch âm thầm khó lần ra hơn một lỗi rõ ràng.
      expect(response.status).toBe(400)
      const body = response.json<{ error: { code: string } }>()
      expect(body.error.code).toBe('validation')
    } finally {
      await ctx.close()
    }
  })

  it('ngôn ngữ của phiên cũ không đổi khi người dùng đổi ngôn ngữ giao diện', async () => {
    const ctx = await createRoutesTestContext()
    try {
      const { ownerCookie: cookie, company } = await tenant(ctx, 'i18n-en@example.com', 'Cong Ty EN')
      const companyId = company.id
      const created = await ctx.client.request('POST', `/api/companies/${companyId}/conversations`, {
        headers: cookie,
        body: { title: 'Phiên tiếng Anh', language: 'en' },
      })
      const conversationId = created.json<{ conversation: { id: string } }>().conversation.id

      // "Đổi ngôn ngữ giao diện" ở đây tương đương với việc các yêu cầu sau mang
      // Accept-Language khác — ngôn ngữ của phiên là dữ liệu, không phải tuỳ chọn hiển thị.
      const detail = await ctx.client.request('GET', `/api/conversations/${conversationId}`, {
        headers: { ...cookie, 'Accept-Language': 'vi-VN,vi;q=0.9' },
      })
      expect(detail.status).toBe(200)
      expect(detail.json<{ conversation: { language: string } }>().conversation.language).toBe('en')
    } finally {
      await ctx.close()
    }
  })
})
