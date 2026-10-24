import { newId, nowIso } from '@marketing-agent/shared'
import { randomBytes } from 'node:crypto'
import { createHash } from 'node:crypto'
import type { Database } from '../database.ts'
import type { SecretBox } from '../crypto.ts'

export type McpTransport = 'streamable_http' | 'sse' | 'stdio'
export type McpAuthType = 'none' | 'api_key' | 'bearer' | 'oauth2' | 'stdio_env'
export interface McpCapabilitySnapshot { tools: unknown[]; resources: unknown[]; prompts: unknown[] }
export interface McpServerRecord {
  id: string; companyId: string; name: string; transport: McpTransport; endpoint: string | null;
  command: string | null; args: string[]; authType: McpAuthType; authConfigEnc: string | null;
  authConfigIv: string | null; envEnc: string | null; envIv: string | null; enabled: boolean;
  status: string; capabilities: McpCapabilitySnapshot; lastCheckAt: string | null; lastError: string | null;
  createdAt: string; updatedAt: string
  inboundKeyEnc: string | null; inboundKeyIv: string | null
}
interface Row { id:string; company_id:string; name:string; transport:McpTransport; endpoint:string|null; command:string|null; args_json:string; auth_type:McpAuthType; auth_config_enc:string|null; auth_config_iv:string|null; env_enc:string|null; env_iv:string|null; enabled:number; status:string; capabilities_json:string; last_check_at:string|null; last_error:string|null; created_at:string; updated_at:string; inbound_key_enc:string|null; inbound_key_iv:string|null }
const view = (r: Row): McpServerRecord => ({ id:r.id, companyId:r.company_id, name:r.name, transport:r.transport, endpoint:r.endpoint, command:r.command, args:JSON.parse(r.args_json) as string[], authType:r.auth_type, authConfigEnc:r.auth_config_enc, authConfigIv:r.auth_config_iv, envEnc:r.env_enc, envIv:r.env_iv, enabled:r.enabled===1, status:r.status, capabilities:JSON.parse(r.capabilities_json) as McpCapabilitySnapshot, lastCheckAt:r.last_check_at, lastError:r.last_error, createdAt:r.created_at, updatedAt:r.updated_at, inboundKeyEnc:r.inbound_key_enc ?? null, inboundKeyIv:r.inbound_key_iv ?? null })
export class McpRepo {
  constructor(private readonly db: Database, private readonly secrets: SecretBox) {}
  list(companyId:string): McpServerRecord[] { return this.db.all<Row>('SELECT * FROM mcp_servers WHERE company_id=? ORDER BY name',[companyId]).map(view) }
  get(id:string, companyId:string): McpServerRecord|undefined { const r=this.db.get<Row>('SELECT * FROM mcp_servers WHERE id=? AND company_id=?',[id,companyId]); return r?view(r):undefined }
  create(input:{companyId:string;name:string;transport:McpTransport;endpoint?:string;command?:string;args?:string[];authType:McpAuthType;authConfig?:Record<string,unknown>;env?:Record<string,string>;enabled?:boolean}): McpServerRecord {
    const id=newId(), now=nowIso(), auth=input.authConfig?this.secrets.encrypt(JSON.stringify(input.authConfig)):null, env=input.env?this.secrets.encrypt(JSON.stringify(input.env)):null, inbound=this.secrets.encrypt(randomBytes(32).toString('base64url'))
    this.db.run('INSERT INTO mcp_servers (id,company_id,name,transport,endpoint,command,args_json,auth_type,auth_config_enc,auth_config_iv,env_enc,env_iv,enabled,status,created_at,updated_at,inbound_key_enc,inbound_key_iv) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,input.companyId,input.name,input.transport,input.endpoint??null,input.command??null,JSON.stringify(input.args??[]),input.authType,auth?.enc??null,auth?.iv??null,env?.enc??null,env?.iv??null,input.enabled===false?0:1,'configured',now,now,inbound.enc,inbound.iv]); return this.get(id,input.companyId)!
  }
  update(id:string,companyId:string,input:Partial<{name:string;transport:McpTransport;endpoint:string|null;command:string|null;args:string[];authType:McpAuthType;authConfig:Record<string,unknown>|null;env:Record<string,string>|null;enabled:boolean}>): McpServerRecord {
    const r=this.get(id,companyId); if(!r) throw new Error('MCP server không tồn tại'); const auth=input.authConfig===undefined?null:(input.authConfig?this.secrets.encrypt(JSON.stringify(input.authConfig)):null); const env=input.env===undefined?null:(input.env?this.secrets.encrypt(JSON.stringify(input.env)):null); const sets:string[]=[]; const vals:unknown[]=[]
    const add=(s:string,v:unknown)=>{sets.push(s);vals.push(v)}; if(input.name!==undefined)add('name=?',input.name); if(input.transport!==undefined)add('transport=?',input.transport); if(input.endpoint!==undefined)add('endpoint=?',input.endpoint); if(input.command!==undefined)add('command=?',input.command); if(input.args!==undefined)add('args_json=?',JSON.stringify(input.args)); if(input.authType!==undefined)add('auth_type=?',input.authType); if(input.authConfig!==undefined){add('auth_config_enc=?',auth?.enc??null);add('auth_config_iv=?',auth?.iv??null)} if(input.env!==undefined){add('env_enc=?',env?.enc??null);add('env_iv=?',env?.iv??null)} if(input.enabled!==undefined)add('enabled=?',input.enabled?1:0); add('updated_at=?',nowIso()); vals.push(id,companyId); this.db.run(`UPDATE mcp_servers SET ${sets.join(',')} WHERE id=? AND company_id=?`,vals); return this.get(id,companyId)!
  }
  remove(id:string,companyId:string):void { this.db.run('DELETE FROM mcp_servers WHERE id=? AND company_id=?',[id,companyId]) }
  resolveSecrets(r:McpServerRecord):{auth:Record<string,unknown>;env:Record<string,string>} { const auth=r.authConfigEnc&&r.authConfigIv?JSON.parse(this.secrets.decrypt(r.authConfigEnc,r.authConfigIv)) as Record<string,unknown>:{}; const env=r.envEnc&&r.envIv?JSON.parse(this.secrets.decrypt(r.envEnc,r.envIv)) as Record<string,string>:{}; return {auth,env} }
  inboundKey(r:McpServerRecord): string { if(!r.inboundKeyEnc||!r.inboundKeyIv) throw new Error('MCP server chưa có API key'); return this.secrets.decrypt(r.inboundKeyEnc,r.inboundKeyIv) }
  updateDiscovery(id:string,companyId:string,status:string,capabilities:McpCapabilitySnapshot,error?:string):void { this.db.run('UPDATE mcp_servers SET status=?,capabilities_json=?,last_check_at=?,last_error=?,updated_at=? WHERE id=? AND company_id=?',[status,JSON.stringify(capabilities),nowIso(),error??null,nowIso(),id,companyId]) }
  createOAuthState(input:{state:string;companyId:string;serverId:string;userId:string;verifier:string;redirectUri:string;expiresAt:string}):void { const encrypted=this.secrets.encrypt(input.verifier); this.db.run('INSERT INTO mcp_oauth_states (state_hash,company_id,server_id,user_id,verifier_enc,verifier_iv,redirect_uri,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[createHash('sha256').update(input.state).digest('hex'),input.companyId,input.serverId,input.userId,encrypted.enc,encrypted.iv,input.redirectUri,input.expiresAt,nowIso()]) }
  consumeOAuthState(state:string):{companyId:string;serverId:string;userId:string;verifier:string;redirectUri:string;expiresAt:string}|undefined { const hash=createHash('sha256').update(state).digest('hex'); const row=this.db.get<any>('SELECT * FROM mcp_oauth_states WHERE state_hash=?',[hash]); if(!row){return undefined} this.db.run('DELETE FROM mcp_oauth_states WHERE state_hash=?',[hash]); if(Date.parse(row.expires_at)<=Date.now()) return undefined; return {companyId:row.company_id,serverId:row.server_id,userId:row.user_id,verifier:this.secrets.decrypt(row.verifier_enc,row.verifier_iv),redirectUri:row.redirect_uri,expiresAt:row.expires_at} }
}
