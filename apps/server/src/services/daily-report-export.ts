import { Document, Packer, Paragraph, HeadingLevel } from 'docx'
import PDFDocument from 'pdfkit'
import { fileURLToPath } from 'node:url'
import type { DailyReportVersion } from '@marketing-agent/shared'
export const dailyStatusLabel = {on_time:'On time',overdue:'Overdue — no report submitted by the deadline.',late_submission:'Late submission',updated_after_deadline:'Updated after deadline (original report was on time)'} as const
export function dailyReportLines(v:DailyReportVersion):{text:string;heading?:boolean}[] {
 if(v.status!=='ready'||!v.english)throw new Error('Bản tiếng Anh chưa sẵn sàng')
 const s=v.snapshot,lines:{text:string;heading?:boolean}[]=[{text:s.title,heading:true},{text:`${s.companyName} | ${s.groupName} | ${s.date}`},{text:`Reporting timezone: Asia/Ho_Chi_Minh | Deadline: 16:50 | Version: ${v.number}`},{text:`Snapshot captured: ${s.capturedAt} | Report created: ${v.createdAt}`},{text:`Team members: ${s.members.length} | On time: ${s.members.filter(m=>m.status==='on_time').length} | Missing: ${s.members.filter(m=>m.status==='overdue').length} | Late / updated: ${s.members.filter(m=>['late_submission','updated_after_deadline'].includes(m.status)).length}`},{text:'Executive Summary',heading:true},{text:v.english.executiveSummary},{text:'Individual Reports',heading:true}]
 for(const m of s.members){const e=v.english.individuals.find(i=>i.memberId===m.memberId);lines.push({text:m.name,heading:true},{text:`Status: ${dailyStatusLabel[m.status]}`});if(m.submittedAt)lines.push({text:`Submission time: ${new Date(m.submittedAt).toLocaleString('en-GB',{timeZone:'Asia/Ho_Chi_Minh'})} (Vietnam time)`});if(e)lines.push({text:e.work||'No work details provided.'},{text:`Blockers: ${e.blockers||'None reported.'}`},{text:`Next steps: ${e.nextSteps||'Not provided.'}`})}
 lines.push({text:'Overdue / Late Submissions',heading:true})
 const late=s.members.filter(m=>m.status!=='on_time');lines.push(...(late.length?late.map(m=>({text:`${m.name}: ${dailyStatusLabel[m.status]}`})):[{text:'None.'}]))
 return lines
}
export async function exportDailyReport(v:DailyReportVersion,format:'docx'|'pdf'):Promise<Buffer> {
 const lines=dailyReportLines(v)
 if(format==='docx')return Packer.toBuffer(new Document({sections:[{children:lines.map(l=>new Paragraph({text:l.text,...(l.heading?{heading:HeadingLevel.HEADING_1}:{spacing:{after:160}})}))}]}))
 return new Promise((resolve,reject)=>{const chunks:Buffer[]=[];const doc=new PDFDocument({size:'A4',margin:48,info:{Title:v.snapshot.title}});doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject)
  doc.font(fileURLToPath(new URL('../../assets/DejaVuSans.ttf',import.meta.url)))
  for(const line of lines){doc.fontSize(line.heading?15:10).text(line.text,{lineGap:3});doc.moveDown(.5)}doc.end()
 })
}
