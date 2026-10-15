import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {addMember,createRoutesTestContext,tenant,type RoutesTestContext} from './helpers/routes-helpers.ts'
let ctx:RoutesTestContext
beforeEach(async()=>{ctx=await createRoutesTestContext()})
afterEach(async()=>{await ctx.close()})
describe('classification model settings API',()=>{
 it('reports absent model, saves dedicated config without starting jobs, and enforces permissions',async()=>{
  const {company,ownerCookie}=await tenant(ctx,'model-settings-owner@example.com','Model settings')
  const url=`/api/companies/${company.id}/knowledge/classification/settings`
  const initial=await ctx.client.request('GET',url,{headers:ownerCookie})
  expect(initial.status).toBe(200)
  expect(initial.json<{valid:boolean}>().valid).toBe(false)
  const provider=ctx.repos.llm.createProvider({companyId:company.id,name:'Own gateway',kind:'openai_compatible',baseUrl:'http://example.invalid/v1'})
  const model=ctx.repos.llm.createModel({providerId:provider.id,modelId:'classify-test',label:'Classifier'})
  const body={mode:'custom',modelFk:model.id,fallbackModelFks:[]}
  const saved=await ctx.client.request('PUT',url,{headers:ownerCookie,body})
  expect(saved.status).toBe(200)
  expect(saved.json()).toMatchObject({valid:true,source:'custom',settings:body,effectiveModels:[{id:model.id,providerName:'Own gateway'}]})
  expect(JSON.stringify(saved.json())).not.toContain('apiKey')
  const viewer=await addMember(ctx,company.id,'model-settings-viewer@example.com','viewer')
  expect((await ctx.client.request('GET',url,{headers:viewer.cookie})).status).toBe(200)
  expect((await ctx.client.request('PUT',url,{headers:viewer.cookie,body})).status).toBe(403)
  expect((await ctx.client.request('POST',`${url}/test`,{headers:viewer.cookie,body:{}})).status).toBe(403)
  const other=await tenant(ctx,'model-settings-other@example.com','Other settings')
  expect((await ctx.client.request('GET',url,{headers:other.ownerCookie})).status).toBe(404)
  const jobs=ctx.repos.db.get<{n:number}>('SELECT count(*) n FROM kb_classification_jobs')
  expect(jobs?.n).toBe(0)
 })
 it('returns a useful validation response without invoking a provider when model is absent',async()=>{
  const {company,ownerCookie}=await tenant(ctx,'model-test-missing@example.com','Missing model')
  const response=await ctx.client.request('POST',`/api/companies/${company.id}/knowledge/classification/settings/test`,{headers:ownerCookie,body:{}})
  expect(response.status).toBe(200)
  expect(response.json<{ok:boolean;message:string}>().ok).toBe(false)
  expect(response.json<{message:string}>().message.toLowerCase()).toContain('model')
 })
})
