import {useEffect,useState} from 'react'
import {api} from '../lib/api.ts'
import {useI18n} from '../lib/i18n.tsx'
import {Card,DangTai,ThongBao} from './ui.tsx'
type Model={id:string;modelId:string;label:string;providerName:string}
type SettingsView={valid:boolean;issues:string[];source:'leader'|'custom';effectiveModels:Model[];lastUsed?:Model & {usedAt?:string}|null}
/** Read-only visibility: loading settings never calls a model or exposes secrets. */
export function KnowledgeModelStatus({companyId}:{companyId:string}) {
 const {t}=useI18n()
 const [data,setData]=useState<SettingsView|null>(null)
 const [error,setError]=useState<string|null>(null)
 useEffect(()=>{let cancelled=false;setData(null);setError(null)
  api.classificationModelSettings(companyId).then(result=>{if(!cancelled)setData(result)}).catch(()=>{if(!cancelled)setError(t('knowledge.modelStatusError'))})
  return()=>{cancelled=true}
 },[companyId,t])
 return <Card tieuDe={t('knowledge.classificationModel')}>
  {!data&&!error ? <DangTai nhan={t('common.loading')}/> : null}
  {error ? <ThongBao loai="loi">{error}</ThongBao>:null}
  {data ? <div className="cot">
   <span>{data.source==='custom' ? t('knowledge.modelCustom') : t('knowledge.modelLeader')}</span>
   {data.effectiveModels.map((model,index)=><div key={model.id}><strong>{index===0?t('knowledge.modelPrimary'):t('knowledge.modelFallback')}: </strong>{model.label} · {model.providerName} <code>{model.modelId}</code></div>)}
   {!data.valid ? <ThongBao loai="canh-bao">{data.issues.join('; ') || t('knowledge.modelMissing')}</ThongBao>:null}
   {data.lastUsed ? <span>{t('knowledge.modelLastUsed')}: {data.lastUsed.label} · {data.lastUsed.providerName}</span>:null}
  </div>:null}
  <a href="#/cai-dat">{t('knowledge.configureModel')}</a>
 </Card>
}
