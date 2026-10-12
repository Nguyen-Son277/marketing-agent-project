import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe,it,expect } from 'vitest'
import { workforceWeek,vietnamDate,workforceTaskSchema,workforceReportSchema } from '@marketing-agent/shared'
const read=(p:string)=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),'utf8')
describe('lịch designer và hàng rào giao diện',()=>{
 it('tuần VN qua ranh giới ngày UTC, năm và Chủ nhật',()=>{
  expect(vietnamDate(new Date('2026-12-31T18:00:00Z'))).toBe('2027-01-01')
  expect(workforceWeek('2027-01-01')).toBe('2026-12-28')
  expect(workforceWeek('2026-10-18')).toBe('2026-10-12')
 })
 it('không nhận ngày ngoài tuần, tuần không phải thứ Hai, ngày giả hoặc link nguy hiểm',()=>{
  const task={companyId:'c',assigneeUserId:'e',title:'x',brief:'x',kind:'image',plannedWeek:'2026-10-12',deadline:'2026-10-17T17:00:00+07:00'}
  expect(workforceTaskSchema.safeParse({...task,plannedDate:'2026-10-19'}).success).toBe(false)
  expect(workforceTaskSchema.safeParse({...task,plannedWeek:'2026-10-13'}).success).toBe(false)
  expect(workforceTaskSchema.safeParse({...task,plannedDate:'2026-02-30'}).success).toBe(false)
  expect(workforceReportSchema.safeParse({version:1,kind:'submit',content:'x',links:[]}).success).toBe(false)
  expect(workforceReportSchema.safeParse({version:1,kind:'submit',content:'x',links:['data:text/html,test']}).success).toBe(false)
 })
 it('nhân viên đổi mật khẩu trước khi mở việc và không qua chọn công ty',()=>{
  const app=read('../src/App.tsx')
  expect(app.indexOf('if (user.mustChangePassword)')).toBeLessThan(app.indexOf("user.accountType === 'employee'"))
  expect(app.indexOf("user.accountType === 'employee'")).toBeLessThan(app.indexOf('if (!company)'))
 })
 it('board không nhận companyId từ Shell và calendar mobile không tràn 7 cột',()=>{
  const source=read('../src/screens/GiaoViecNhanVien.tsx'),css=read('../src/styles.css')
  expect(source).toContain('api.companies()')
  expect(source).toContain("params.overdue='true'")
  expect(source).toContain('editVersion')
  expect(css).toContain('.wf__week { grid-template-columns: minmax(0,1fr); }')
 })
})
