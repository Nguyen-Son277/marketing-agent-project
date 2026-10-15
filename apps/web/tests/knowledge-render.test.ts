import {createElement} from 'react'
import {renderToString} from 'react-dom/server'
import {describe,expect,it,vi} from 'vitest'
import {KhoKienThuc} from '../src/screens/KhoKienThuc.tsx'
import {api} from '../src/lib/api.ts'
vi.mock('../src/lib/i18n.tsx',()=>({useI18n:()=>({t:(key:string)=>key,locale:'vi',formatNumber:(value:number)=>String(value),formatDateTime:(value:unknown)=>String(value)})}))

describe('knowledge first render',()=>{
 it('renders loading before the API response rather than dereferencing null documents',()=>{
  const request=vi.spyOn(api,'knowledge')
  expect(()=>renderToString(createElement(KhoKienThuc,{companyId:'company-a'}))).not.toThrow()
  const html=renderToString(createElement(KhoKienThuc,{companyId:'company-a'}))
  expect(html).toContain('knowledge.loading')
  expect(html).not.toContain('knowledge.empty')
  expect(request).not.toHaveBeenCalled()
  request.mockRestore()
 })
 it('renders safely with a different company while no data is available',()=>{
  for(const companyId of ['company-a','company-b']) {
   expect(renderToString(createElement(KhoKienThuc,{companyId}))).toContain('knowledge.loading')
  }
 })
})
