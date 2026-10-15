import {afterEach,beforeEach,describe,expect,it} from 'vitest'
import {createRoutesTestContext,tenant,type RoutesTestContext} from './helpers/routes-helpers.ts'
import {startKnowledgeClassificationWorker,splitKnowledgeSource,type ClassifiedSection} from '../src/services/knowledge-classifier.ts'
import {createKbReadTool,createKbSearchTool} from '@marketing-agent/kb'
import type {ToolContext} from '@marketing-agent/shared'
let ctx:RoutesTestContext
beforeEach(async()=>{ctx=await createRoutesTestContext()})
afterEach(async()=>{await ctx.close()})
async function upload(companyId:string,headers:Record<string,string>,text:string){const form=new FormData();form.set('file',new Blob([text]),'mixed.txt');return fetch(`${ctx.client.baseUrl}/api/companies/${companyId}/knowledge/upload`,{method:'POST',headers,body:form})}
describe('automatic knowledge classification',()=>{
 it('accepts only file, classifies mixed source, preserves original and filters section ACL',async()=>{
  const {company,ownerCookie}=await tenant(ctx,'auto-kb@example.com','Auto KB')
  const source='# Brand\n\nBRANDORCHID giọng nói thương hiệu thân thiện.\n\n# KPI\n\nSECRETCAC chi phí khách hàng 88 đồng.'
  const response=await upload(company.id,ownerCookie,source)
  expect(response.status).toBe(202)
  const body=await response.json() as {document:{id:string;path:string;classificationStatus:string}}
  expect(body.document.classificationStatus).toBe('pending')
  expect(ctx.repos.knowledge.listChunks(body.document.id)).toHaveLength(0)
  const duplicate=await upload(company.id,ownerCookie,source);expect(duplicate.status).toBe(200)
  expect((await duplicate.json() as {duplicate:boolean}).duplicate).toBe(true)
  const worker=startKnowledgeClassificationWorker(ctx.repos,{intervalMs:60000,classify:async(_repos,_company,text)=>splitKnowledgeSource(text).map(s=>({...s,category:s.text.includes('KPI')||s.text.includes('SECRETCAC')?'40-du-lieu':'10-brand',tags:['auto'],title:'Part',confidence:0.9}))})
  try{await worker.runOnce()}finally{await worker.close()}
  expect(ctx.repos.knowledge.getClassificationJob(company.id,body.document.id)?.status).toBe('ready')
  const sections=ctx.repos.knowledge.listSections(company.id,body.document.id);expect(sections.length).toBeGreaterThan(1)
  expect(sections.map(s=>source.slice(s.startOffset,s.endOffset)).join('')).toBe(source)
  const agent=ctx.repos.team.findAgentDefByRole('content-writer')!
  const toolCtx:ToolContext={companyId:company.id,agentDefId:agent.id,agentRole:'content-writer',taskId:null,conversationId:null,log:()=>{}}
  const read=await createKbReadTool({repos:ctx.repos}).handler({path:body.document.path},toolCtx)
  expect(read.content).toContain('BRANDORCHID');expect(read.content).not.toContain('SECRETCAC')
  const search=await createKbSearchTool({repos:ctx.repos}).handler({query:'SECRETCAC'},toolCtx)
  expect(search.content).not.toContain('88 đồng')
  const detail=await ctx.client.request('GET',`/api/companies/${company.id}/knowledge/${body.document.id}`,{headers:ownerCookie})
  expect(detail.json<{document:{content:string};sections:{tags:string[]}[]}>().document.content).toBe(source)
  expect(detail.json<{sections:{tags:string[]}[]}>().sections[0]?.tags).toEqual(['auto'])
  const reindex=await ctx.client.request('POST',`/api/companies/${company.id}/knowledge/reindex`,{headers:ownerCookie,body:{force:true}})
  expect(reindex.status).toBe(200)
  const reread=await createKbReadTool({repos:ctx.repos}).handler({path:body.document.path},toolCtx)
  expect(reread.content).not.toContain('SECRETCAC')
 })
 it('requeues five failed sources through reindex without misleading section errors',async()=>{
  const {company,ownerCookie}=await tenant(ctx,'five-fail@example.com','Five failed')
  const ids:string[]=[]
  for(let i=0;i<5;i++) {const res=await upload(company.id,ownerCookie,`Kiến thức riêng ${i}`);ids.push((await res.json() as {document:{id:string}}).document.id)}
  for(const id of ids) {const job=ctx.repos.knowledge.claimClassificationJob()!;expect(ids).toContain(job.documentId);ctx.repos.knowledge.finishClassificationJob(job.id,'Nhà cung cấp LLM trả lỗi 530')}
  const list=await ctx.client.request('GET',`/api/companies/${company.id}/knowledge`,{headers:ownerCookie})
  const docs=list.json<{documents:{classificationStatus:string;chunkCount:number;classificationError:string}[]}>().documents
  expect(docs).toHaveLength(5);expect(docs.every(doc=>doc.classificationStatus==='failed'&&doc.chunkCount===0&&doc.classificationError.includes('530'))).toBe(true)
  const result=await ctx.client.request('POST',`/api/companies/${company.id}/knowledge/reindex`,{headers:ownerCookie,body:{force:true}})
  expect(result.json()).toMatchObject({indexed:0,queued:5,processing:0,skipped:0,errors:[]})
  const again=await ctx.client.request('POST',`/api/companies/${company.id}/knowledge/classification/retry`,{headers:ownerCookie,body:{}})
  expect(again.json()).toMatchObject({queued:0,processing:5})
  expect(ids.every(id=>ctx.repos.knowledge.getClassificationJob(company.id,id)?.attempts===0)).toBe(true)
 })

 it('keeps source on classifier failure and retry recovers without another upload',async()=>{
  const {company,ownerCookie}=await tenant(ctx,'auto-fail@example.com','Auto fail')
  const response=await upload(company.id,ownerCookie,'Nội dung công ty cần phân loại.')
  const {document}=await response.json() as {document:{id:string}}
  const worker=startKnowledgeClassificationWorker(ctx.repos,{intervalMs:60000,classify:async()=>{throw new Error('Chưa cấu hình model công ty')}})
  try{await worker.runOnce()}finally{await worker.close()}
  expect(ctx.repos.knowledge.getClassificationJob(company.id,document.id)?.status).toBe('failed')
  expect(ctx.repos.knowledge.documentContent(company.id,document.id)).toContain('Nội dung')
  const retry=await ctx.client.request('POST',`/api/companies/${company.id}/knowledge/${document.id}/classification/retry`,{headers:ownerCookie,body:{}})
  expect(retry.status).toBe(202)
  expect(ctx.repos.knowledge.getClassificationJob(company.id,document.id)?.status).toBe('pending')
 })
})
