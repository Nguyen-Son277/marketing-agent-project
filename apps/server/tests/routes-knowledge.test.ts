/**
 * Test module kho kiến thức.
 *
 * Hai điểm quan trọng: `content` phải có ngay trong danh sách (hợp đồng mới), và
 * ghi/xoá tài liệu phải bị chặn với viewer — kho kiến thức là thứ agent đọc để
 * viết nội dung, nên ghi bừa là ghi bừa vào nguồn sự thật.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addMember,
  createRoutesTestContext,
  errorCode,
  seedDocument,
  tenant,
  writeKbFile,
  type RoutesTestContext,
} from './helpers/routes-helpers.ts'

let ctx: RoutesTestContext

beforeEach(async () => {
  ctx = await createRoutesTestContext()
})

afterEach(async () => {
  await ctx.close()
})

describe('knowledge routes', () => {
  it('trả tài liệu kèm nội dung, đủ sáu category và thống kê (happy path)', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'kb-owner@example.com', 'KB Co')
    seedDocument(ctx, company.id, {
      path: '00-cong-ty/gioi-thieu.md',
      title: 'Giới thiệu công ty',
      category: '00-cong-ty',
      content: '# Giới thiệu\n\nChúng tôi làm phần mềm quản lý tồn kho.',
    })

    const response = await ctx.client.request('GET', `/api/companies/${company.id}/knowledge`, {
      headers: ownerCookie,
    })
    expect(response.status).toBe(200)
    const body = response.json<{
      documents: { path: string; content: string; category: string; indexed: boolean }[]
      categories: { code: string; count: number }[]
      stats: { documents: number; chunks: number }
    }>()
    expect(body.categories).toHaveLength(6)
    expect(body.documents).toHaveLength(1)
    expect(body.documents[0]?.content).toContain('quản lý tồn kho')
    const detail = await ctx.client.request('GET', `/api/companies/${company.id}/knowledge/stats`, {headers:ownerCookie})
    expect(detail.status).toBe(200)
    expect(body.stats.documents).toBe(1)
    expect(body.categories.find((c) => c.code === '00-cong-ty')?.count).toBe(1)
  })

  it('ghi, sửa rồi xoá một tài liệu qua HTTP', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'kb-write@example.com', 'KB Write')
    const created = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge`, {
      headers: ownerCookie,
      body: {
        path: '10-brand/giong-noi.md',
        title: 'Giọng nói thương hiệu',
        category: '10-brand',
        tags: ['brand'],
        content: '# Giọng nói\n\nThân thiện, ngắn gọn, không dùng từ chuyên môn.',
      },
    })
    expect(created.status).toBe(201)
    const document = created.json<{ documents: { id: string; content: string }[] }>().documents[0]!
    expect(document.content).toContain('Thân thiện')

    const patched = await ctx.client.request(
      'PATCH',
      `/api/companies/${company.id}/knowledge/${document.id}`,
      {
        headers: ownerCookie,
        body: { title: 'Giọng nói thương hiệu (v2)', content: '# Giọng nói v2\n\nẤm áp và rõ ràng.' },
      },
    )
    expect(patched.status).toBe(200)
    expect(patched.json<{ document: { title: string; content: string } }>().document.title).toBe(
      'Giọng nói thương hiệu (v2)',
    )

    const removed = await ctx.client.request(
      'DELETE',
      `/api/companies/${company.id}/knowledge/${document.id}`,
      { headers: ownerCookie },
    )
    expect(removed.status).toBe(200)
    const after = await ctx.client.request('GET', `/api/companies/${company.id}/knowledge`, {
      headers: ownerCookie,
    })
    expect(after.json<{ documents: unknown[] }>().documents).toHaveLength(0)
  })

  it('index lại đọc file thật trong thư mục KB của công ty', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'kb-reindex@example.com', 'KB Reindex')
    // Ghi vào `kbRoot` (kho kiến thức), KHÔNG phải `companiesRoot` (vùng file của agent).
    writeKbFile(
      ctx.kbRoot,
      company.slug,
      '20-thi-truong/doi-thu.md',
      '# Đối thủ\n\nĐối thủ chính là phần mềm nhập khẩu giá cao.',
    )

    const response = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge/reindex`, {
      headers: ownerCookie,
      body: { force: true },
    })
    expect(response.status).toBe(200)
    const body = response.json<{ indexed: number; errors: string[] }>()
    expect(body.indexed).toBe(1)
    expect(body.errors).toHaveLength(0)

    const jobs = await ctx.client.request('GET', `/api/companies/${company.id}/knowledge/jobs`, {
      headers: ownerCookie,
    })
    expect(jobs.status).toBe(200)
    expect(jobs.json<{ jobs: unknown[] }>().jobs.length).toBeGreaterThan(0)

    const stats = await ctx.client.request('GET', `/api/companies/${company.id}/knowledge/stats`, {
      headers: ownerCookie,
    })
    expect(stats.status).toBe(200)
    expect(stats.json<{ stats: { documents: number } }>().stats.documents).toBe(1)
  })

  it('index DB khi chưa có thư mục KB và kho trống không báo lỗi', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'kb-no-dir@example.com', 'No folder')
    const empty = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge/reindex`, { headers: ownerCookie, body: {} })
    expect(empty.status).toBe(200)
    expect(empty.json<{errors: string[]}>().errors).toEqual([])
    await ctx.client.request('POST', `/api/companies/${company.id}/knowledge`, {
      headers: ownerCookie, body: { path: '00-cong-ty/only-db.md', title: 'Trong DB', category: '00-cong-ty', tags: [], content: '# Công ty\n\nSản phẩm riêng chỉ lưu trong cơ sở dữ liệu.' },
    })
    const result = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge/reindex`, { headers: ownerCookie, body: {force: true} })
    expect(result.json<{indexed: number; errors:string[]}>()).toMatchObject({indexed: 1, errors: []})
  })

  it('upload, đọc nội dung, tải gốc, chống trùng và xóa không hồi sinh', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'kb-upload@example.com', 'Uploads')
    const url = `${ctx.client.baseUrl}/api/companies/${company.id}/knowledge`
    const original = 'Chính sách công ty: bảo hành sản phẩm trong 37 tháng.'
    const upload = async () => {
      const form = new FormData()
      form.set('file', new Blob([original], {type: 'text/plain'}), 'chinh-sach.txt')
      form.set('category', '00-cong-ty')
      return fetch(`${url}/upload`, {method: 'POST', headers: ownerCookie, body: form})
    }
    const created = await upload()
    expect(created.status).toBe(201)
    const {document} = await created.json() as {document:{id:string; originalName:string; content:string}}
    expect(document.originalName).toBe('chinh-sach.txt')
    expect(document.content).toContain('37 tháng')
    const list = await ctx.client.request('GET', `/api/companies/${company.id}/knowledge`, {headers:ownerCookie})
    expect(list.json<{documents:{content:string}[]}>().documents[0]?.content).toBe('')
    const detail = await fetch(`${url}/${document.id}`, {headers:ownerCookie})
    expect((await detail.json() as {document:{content:string}}).document.content).toBe(original)
    const reindexed = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge/reindex`, {headers:ownerCookie,body:{force:true}})
    expect(reindexed.json<{indexed:number;errors:string[]}>()).toMatchObject({indexed:1,errors:[]})
    const stillOriginal = await fetch(`${url}/${document.id}`, {headers:ownerCookie})
    expect((await stillOriginal.json() as {document:{content:string}}).document.content).toBe(original)
    const download = await fetch(`${url}/${document.id}/download`, {headers:ownerCookie})
    expect(download.status).toBe(200)
    expect(await download.text()).toBe(original)
    expect(download.headers.get('content-disposition')).toContain('attachment')
    expect((await (await upload()).json() as {duplicate:boolean}).duplicate).toBe(true)
    const patch = await ctx.client.request('PATCH', `/api/companies/${company.id}/knowledge/${document.id}`, {headers:ownerCookie,body:{content:'khác'}})
    expect(patch.status).toBe(400)
    const metadata = await ctx.client.request('PATCH', `/api/companies/${company.id}/knowledge/${document.id}`, {headers:ownerCookie,body:{title:'Chính sách mới',category:'10-brand',tags:['policy']}})
    expect(metadata.status).toBe(200)
    expect(metadata.json<{document:{originalName:string;content:string;category:string}}>().document).toMatchObject({originalName:'chinh-sach.txt',content:original,category:'10-brand'})
    await ctx.client.request('DELETE', `/api/companies/${company.id}/knowledge/${document.id}`, {headers:ownerCookie})
    const reindex = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge/reindex`, {headers:ownerCookie,body:{force:true}})
    expect(reindex.json<{indexed:number}>().indexed).toBe(0)
    expect((await fetch(`${url}/${document.id}/download`, {headers:ownerCookie})).status).toBe(404)
  })

  it('chặn upload/view/download trái quyền và file không hỗ trợ', async () => {
    const a = await tenant(ctx, 'kb-upload-owner@example.com', 'Upload access')
    const b = await tenant(ctx, 'kb-upload-other@example.com', 'Other company')
    const viewer = await addMember(ctx, a.company.id, 'kb-upload-viewer@example.com', 'viewer')
    const url = `${ctx.client.baseUrl}/api/companies/${a.company.id}/knowledge`
    const send = (headers:Record<string,string>, filename='data.txt') => {
      const form = new FormData()
      form.set('file',new Blob(['Nội dung được bảo vệ.']),'data.txt')
      if(filename !== 'data.txt') form.set('file',new Blob(['bad']), filename)
      form.set('category','00-cong-ty')
      return fetch(`${url}/upload`,{method:'POST',headers,body:form})
    }
    expect((await send(viewer.cookie)).status).toBe(403)
    expect((await send(b.ownerCookie)).status).toBe(404)
    expect((await send(a.ownerCookie,'virus.exe')).status).toBe(400)
    const created = await send(a.ownerCookie)
    expect(created.status).toBe(201)
    const {document} = await created.json() as {document:{id:string}}
    expect((await fetch(`${url}/${document.id}`,{headers:b.ownerCookie})).status).toBe(404)
    expect((await fetch(`${url}/${document.id}/download`,{headers:b.ownerCookie})).status).toBe(404)
    expect((await fetch(`${url}/${document.id}/download`,{headers:viewer.cookie})).status).toBe(200)
  })

  it('xóa Markdown nguồn cũ không hồi sinh sau index lại', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'kb-delete-file@example.com', 'Delete file')
    writeKbFile(ctx.kbRoot, company.slug, '00-cong-ty/delete.md', '# Xóa\n\nNội dung phải được xóa.')
    const url = `/api/companies/${company.id}/knowledge`
    await ctx.client.request('POST', `${url}/reindex`, {headers:ownerCookie,body:{force:true}})
    const list = await ctx.client.request('GET',url,{headers:ownerCookie})
    const id = list.json<{documents:{id:string}[]}>().documents[0]!.id
    expect((await ctx.client.request('DELETE',`${url}/${id}`,{headers:ownerCookie})).status).toBe(200)
    const reindex = await ctx.client.request('POST',`${url}/reindex`,{headers:ownerCookie,body:{force:true}})
    expect(reindex.json<{indexed:number;errors:string[]}>()).toMatchObject({indexed:0,errors:[]})
  })

  it('trả 400 kèm error.code=validation khi thiếu category', async () => {
    const { ownerCookie, company } = await tenant(ctx, 'kb-invalid@example.com', 'KB Invalid')
    const response = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge`, {
      headers: ownerCookie,
      body: { path: 'x.md', title: 'Thiếu category', tags: [], content: 'nội dung' },
    })
    expect(response.status).toBe(400)
    expect(errorCode(response)).toBe('validation')
  })

  it('viewer KHÔNG ghi được tài liệu', async () => {
    const { company } = await tenant(ctx, 'kb-owner2@example.com', 'KB Viewer')
    const viewer = await addMember(ctx, company.id, 'kb-viewer@example.com', 'viewer')
    const response = await ctx.client.request('POST', `/api/companies/${company.id}/knowledge`, {
      headers: viewer.cookie,
      body: {
        path: '00-cong-ty/viewer.md',
        title: 'Viewer thử ghi',
        category: '00-cong-ty',
        tags: [],
        content: 'không được phép',
      },
    })
    expect(response.status).toBe(403)
  })

  it('cô lập tenant: công ty B không đọc/ghi được kho công ty A', async () => {
    const a = await tenant(ctx, 'kb-a@example.com', 'KB A')
    const b = await tenant(ctx, 'kb-b@example.com', 'KB B')
    seedDocument(ctx, a.company.id, {
      path: '00-cong-ty/a.md',
      title: 'Tài liệu A',
      category: '00-cong-ty',
      content: 'bí mật của A',
    })

    const read = await ctx.client.request('GET', `/api/companies/${a.company.id}/knowledge`, {
      headers: b.ownerCookie,
    })
    expect(read.status).toBe(404)

    const write = await ctx.client.request('POST', `/api/companies/${a.company.id}/knowledge`, {
      headers: b.ownerCookie,
      body: {
        path: '00-cong-ty/b.md',
        title: 'B ghi vào A',
        category: '00-cong-ty',
        tags: [],
        content: 'x',
      },
    })
    expect(write.status).toBe(404)
  })
})
