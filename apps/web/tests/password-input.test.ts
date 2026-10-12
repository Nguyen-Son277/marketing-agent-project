/** Các bất biến an toàn; thao tác type/value còn được kiểm bằng Chrome thật. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe,it,expect } from 'vitest'
const read=(p:string)=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),'utf8')
const ui=read('../src/components/ui.tsx')
const input=ui.slice(ui.indexOf('export function ONhap'),ui.indexOf('export function OChon'))
describe('ONhap password hiện/ẩn',()=>{
 it('mặc định che, ô thường không có wrapper hoặc nút',()=>{
  expect(input).toContain('useState(false)')
  expect(input).toContain("type === 'password'")
  expect(input).toContain('if (!laMatKhau) return input')
  expect(input).toContain("type={laMatKhau && hien ? 'text' : type}")
 })
 it('nút không submit, đổi trạng thái không thay nội dung',()=>{
  const button=input.slice(input.indexOf('<button'))
  expect(button).toContain('type="button"')
  expect(button).toContain('disabled={disabled}')
  expect(button).toContain('aria-controls={inputId}')
  expect(button).toContain('aria-pressed={hien}')
  expect(button).toContain('onClick={() => setHien((truoc) => !truoc)}')
  expect(button).not.toContain('onChange(')
 })
 it('reset khi form mới, xoá giá trị hoặc disabled; không lưu trạng thái ra storage',()=>{
  expect(input).toContain('[type, visibilityResetKey]')
  expect(input).toContain('if (value.length === 0 || disabled) setHien(false)')
  expect(input).not.toContain('localStorage')
  expect(input).not.toContain('console.')
  expect(read('../src/screens/DangNhap.tsx')).toContain('visibilityResetKey={cheDo}')
  expect(read('../src/screens/CaiDat.tsx')).toContain('visibilityResetKey={hopMo}')
  expect(read('../src/screens/CaiDat.tsx')).toContain('visibilityResetKey={moThemKetNoi}')
 })
 it('nhãn có đủ vi/en, padding không đè nội dung',()=>{
  for(const catalog of ['vi','en']){
   const text=read(`../../../packages/i18n/src/catalogs/${catalog}.ts`)
   for(const key of ['showSecret','hideSecret','showPassword','hidePassword'])expect(text).toContain(`common.${key}`)
  }
  expect(read('../src/styles.css')).toContain('padding-right: 76px')
 })
})
