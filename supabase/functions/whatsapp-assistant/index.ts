import { parseReport } from '../_shared/report-parser.ts'

const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})
const env=(name:string,required=true)=>{const value=Deno.env.get(name)||'';if(required&&!value)throw new Error(`Falta el secreto ${name}`);return value}
const graphVersion=()=>Deno.env.get('META_GRAPH_VERSION')||'v23.0'

async function verifySignature(request:Request,body:string){
  const signature=request.headers.get('x-hub-signature-256')||'',secret=env('WHATSAPP_APP_SECRET')
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
  const digest=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))
  const expected='sha256='+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')
  if(signature.length!==expected.length)return false
  let different=0;for(let index=0;index<signature.length;index++)different|=signature.charCodeAt(index)^expected.charCodeAt(index)
  return different===0
}

async function admin(path:string,init:RequestInit={}){
  const base=env('SUPABASE_URL'),key=env('SUPABASE_SERVICE_ROLE_KEY')
  const response=await fetch(base+'/rest/v1/'+path,{...init,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(init.headers||{})}})
  const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(data?.message||'Error de base de datos');return data
}

async function graph(path:string,init:RequestInit={}){
  const token=env('WHATSAPP_ACCESS_TOKEN')
  const response=await fetch(`https://graph.facebook.com/${graphVersion()}/${path}`,{...init,headers:{Authorization:'Bearer '+token,...(init.headers||{})}})
  const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(data?.error?.message||'Error de WhatsApp');return data
}

async function transcribeAudio(mediaId:string){
  const metadata=await graph(mediaId),media=await fetch(metadata.url,{headers:{Authorization:'Bearer '+env('WHATSAPP_ACCESS_TOKEN')}})
  if(!media.ok)throw new Error('No se pudo descargar el audio')
  const endpoint=env('TRANSCRIPTION_API_URL',false),key=env('TRANSCRIPTION_API_KEY',false)
  if(!endpoint)return ''
  const form=new FormData();form.append('file',await media.blob(),'reporte.ogg');form.append('model',Deno.env.get('TRANSCRIPTION_MODEL')||'whisper-1')
  const response=await fetch(endpoint,{method:'POST',headers:key?{Authorization:'Bearer '+key}:{},body:form});const data=await response.json().catch(()=>null)
  if(!response.ok)throw new Error(data?.error?.message||'No se pudo transcribir el audio')
  return String(data?.text||'')
}

async function ingestMessage(message:any){
  const phone=String(message.from||'').replace(/\D/g,''),type=String(message.type||''),text=type==='text'?String(message.text?.body||''):type==='audio'?await transcribeAudio(String(message.audio?.id||'')):''
  if(!text)return {ignored:true,reason:type==='audio'?'transcription_not_configured':'unsupported_message'}
  const parsed=parseReport(text)
  await admin('rpc/ingest_whatsapp_report',{method:'POST',body:JSON.stringify({p_phone:phone,p_message_id:String(message.id||crypto.randomUUID()),p_message_type:type,p_raw_text:text,p_parsed:parsed})})
  return {ok:true,phone,type,parsed}
}

async function sendDaily(){
  const workspaces=await admin('mine_workspace?select=owner_id,payload'),hour=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date())
  const sent=[] as unknown[]
  for(const workspace of workspaces){const labors=workspace.payload?.labors||[],contacts=workspace.payload?.whatsappContacts||[];for(const contact of contacts){if(!contact.enabled||contact.send_time!==hour)continue;const labor=labors.find((item:any)=>Number(item.id)===Number(contact.labor_id));if(!labor)continue;const claimed=await admin('rpc/claim_whatsapp_daily',{method:'POST',body:JSON.stringify({p_owner_id:workspace.owner_id,p_labor_id:Number(labor.id),p_report_date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())})});if(!claimed)continue;const result=await graph(`${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:contact.phone,type:'template',template:{name:env('WHATSAPP_TEMPLATE_NAME'),language:{code:Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE')||'es'},components:[{type:'body',parameters:[{type:'text',text:labor.name}]}]}})});sent.push(result)}}
  return sent
}

Deno.serve(async request=>{
  try{
    const url=new URL(request.url)
    if(request.method==='GET'){
      const mode=url.searchParams.get('hub.mode'),token=url.searchParams.get('hub.verify_token'),challenge=url.searchParams.get('hub.challenge')
      return mode==='subscribe'&&token===env('WHATSAPP_VERIFY_TOKEN')?new Response(challenge||'',{status:200}):new Response('Forbidden',{status:403})
    }
    const body=await request.text()
    if(request.headers.get('x-cron-secret')){
      if(request.headers.get('x-cron-secret')!==env('WHATSAPP_CRON_SECRET'))return json({error:'Forbidden'},403)
      return json({ok:true,sent:await sendDaily()})
    }
    if(!await verifySignature(request,body))return json({error:'Invalid signature'},401)
    const payload=JSON.parse(body),messages=(payload.entry||[]).flatMap((entry:any)=>(entry.changes||[]).flatMap((change:any)=>change.value?.messages||[]))
    const results=[];for(const message of messages)results.push(await ingestMessage(message))
    return json({ok:true,results})
  }catch(error){console.error(error);return json({error:(error as Error).message},500)}
})
