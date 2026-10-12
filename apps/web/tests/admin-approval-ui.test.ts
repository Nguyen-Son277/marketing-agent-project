/** Các mốc điều hướng quan trọng; tương tác thực tế còn được kiểm bằng Chrome. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const app = read('../src/App.tsx')
const admin = read('../src/screens/AdminDuyetTaiKhoan.tsx')
const waiting = read('../src/screens/ChoDuyet.tsx')

describe('phân luồng user pending và admin riêng', () => {
  it('chờ duyệt/admin đứng trước kiểm tra công ty và Shell', () => {
    expect(app.indexOf("user.approvalStatus !== 'approved'")).toBeLessThan(app.indexOf('if (!company)'))
    expect(app.indexOf('if (user.isAdmin)')).toBeLessThan(app.indexOf('if (!company)'))
    expect(app).toContain('return <ChoDuyet />')
    expect(app).toContain('return <AdminDuyetTaiKhoan />')
  })
  it('màn pending chỉ kiểm tra trạng thái và đăng xuất', () => {
    expect(waiting).toContain('await api.me()')
    expect(waiting).toContain('signIn(me.user, me.companies)')
    expect(waiting).not.toContain('createCompany')
    expect(waiting).not.toContain('<Shell')
  })
  it('admin chỉ gọi API duyệt, có xác nhận đúng email và danh sách phân trang', () => {
    expect(admin).toContain('api.adminUsers')
    expect(admin).toContain('api.approveUser(selected.id)')
    expect(admin).toContain('<HopThoaiXacNhan')
    expect(admin).toContain("t('admin.confirm', { email: selected.email })")
    expect(admin).not.toContain('selectCompany')
    expect(admin).not.toContain('<Shell')
    expect(admin).toContain('data.pageSize')
  })
})
