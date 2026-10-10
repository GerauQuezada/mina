import {createServer, type IncomingMessage} from 'node:http'
import {mkdir,readFile,appendFile} from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import makeWASocket,{DisconnectReason,useMultiFileAuthState,downloadMediaMessage,normalizeMessageContent} from 'baileys'
import pino from 'pino'
import QRCode from 'qrcode'
import {interpretReport} from './report-ai.ts'
import {ReviewStore} from './review-store.ts'
import {assignedContact,dueReminders} from './workflow.ts'

const root=path.dirname(fileURLToPath(import.meta.url)),runtime=path.join(root,'runtime')
const supabase=process.env.SUPABASE_URL||'',serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||''
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(supabase)||!serviceKey)throw new Error('Configura SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en whatsapp-bridge/.env antes de iniciar.')
const origins=new Set((process.env.ALLOWED_ORIGINS||'https://gerauquezada.github.io').split(','))
const logger=pino({level:'silent'})
let socket:ReturnType<typeof makeWASocket>|undefined,connecting=false,enabled=false
let state='disconnected',qr='',lastError='',lastReceived='',lastSent='',ownerId=''
let incoming=Promise.resolve()
await mkdir(runtime,{recursive:true})
const reviews=new ReviewStore(runtime);await reviews.load()
let ledger:Record<string,'pending'|'sent'>={}
try{for(const line of (await readFile(path.join(runtime,'deliveries.jsonl'),'utf8')).split('\n').filter(Boolean)){const [key,status]=JSON.parse(line);ledger[key]=status}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;try{ledger=JSON.parse(await readFile(path.join(runtime,'deliveries.json'),'utf8'))}catch(legacyError){if((legacyError as NodeJS.ErrnoException).code!=='ENOENT')throw legacyError}}
async function recordDelivery(key:string,status:'pending'|'sent'){await appendFile(path.join(runtime,'deliveries.jsonl'),JSON.stringify([key,status])+'\n',{encoding:'utf8',mode:0o600,flush:true});ledger[key]=status}
async function admin(route:string,body?:unknown){
  const response=await fetch(supabase+'/rest/v1/'+route,{method:body?'POST':'GET',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)})
  const result=await response.json();if(!response.ok)throw new Error(result.message||'No se pudo sincronizar Supabase.');return result
}
async function workspace(){if(!ownerId)throw new Error('Abre el panel e inicia sesión como administrador.');const rows=await admin('mine_workspace?select=owner_id,payload&owner_id=eq.'+encodeURIComponent(ownerId));return rows as any[]}
function allowedContact(rows:any[],phone:string){return assignedContact(rows,ownerId,phone)}
function limaClock(){const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());return {date:parts.slice(0,10),time:parts.slice(11,16)}}
async function transcribe(message:any){
  if(!process.env.TRANSCRIPTION_URL)throw new Error('Llegó un audio. Configura TRANSCRIPTION_URL para interpretarlo; no se registraron datos inventados.')
  if(Number(normalizeMessageContent(message.message)?.audioMessage?.seconds||0)>180)throw new Error('El audio supera 3 minutos. Requiere revisión manual.')
  const audio=await downloadMediaMessage(message,'buffer',{}, {logger,reuploadRequest:socket!.updateMediaMessage})
  if(audio.length>20*1024*1024)throw new Error('El audio supera 20 MB.')
  const form=new FormData();form.append('file',new Blob([new Uint8Array(audio)],{type:'audio/ogg'}),'reporte.ogg');form.append('model',process.env.TRANSCRIPTION_MODEL||'whisper-1');form.append('language','es')
  const response=await fetch(process.env.TRANSCRIPTION_URL,{method:'POST',headers:process.env.TRANSCRIPTION_KEY?{Authorization:'Bearer '+process.env.TRANSCRIPTION_KEY}:{},body:form,signal:AbortSignal.timeout(120000)})
  if(!response.ok)throw new Error('No se pudo transcribir el audio.');const data=await response.json();return String(data.text||'')
}
async function ingest(message:any){
  if(message.key.fromMe||!enabled)return
  if(!message.key.id||reviews.has(ownerId,'qr:'+message.key.id))return
  const jid=message.key.remoteJid||''
  // Solo chats individuales autorizados. No se sincroniza el historial ni grupos.
  if(jid.endsWith('@g.us')||jid==='status@broadcast')return
  const alternate=message.key.remoteJidAlt||''
  let phone=(jid.endsWith('@s.whatsapp.net')?jid:alternate.endsWith('@s.whatsapp.net')?alternate:'').split('@')[0].split(':')[0].replace(/\D/g,'')
  if(!phone&&jid.endsWith('@lid')){const mapped=await socket?.signalRepository.lidMapping.getPNForLID(jid);phone=String(mapped||'').split('@')[0].replace(/\D/g,'')}
  const assignment=phone?allowedContact(await workspace(),phone):null
  if(!assignment||!message.key.id)return
  const content=normalizeMessageContent(message.message),type=content?.audioMessage?'audio':'text'
  let text=String(content?.conversation||content?.extendedTextMessage?.text||'').trim()
  const stamp=Number(message.messageTimestamp||Date.now()/1000)
  const reportDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp*1000))
  try{
    if(reportDate!==limaClock().date)throw new Error('Mensaje recibido fuera de su día original; revisa la fecha antes de contabilizarlo.')
    if(content?.audioMessage)text=await transcribe(message)
    if(!text)return
    const parsed=await interpretReport(text,{url:process.env.OLLAMA_URL,model:process.env.OLLAMA_MODEL})
    if(parsed.confidence<.6||(parsed.sacks===null&&!parsed.expenses.length&&parsed.status==='worked'))throw new Error('Cifras ausentes o contradictorias: requiere revisión.')
    await admin('rpc/ingest_whatsapp_qr_report',{p_owner_id:ownerId,p_report_date:reportDate,p_phone:phone,p_message_id:'qr:'+message.key.id,p_message_type:type,p_raw_text:text,p_parsed:parsed,p_expected_labor_id:Number(assignment.contact.labor_id)})
    lastReceived=new Date().toISOString();lastError=''
  }catch(error){
    const reason=(error as Error).message
    const laborName=(assignment.row.payload?.labors||[]).find((labor:any)=>Number(labor.id)===Number(assignment.contact.labor_id))?.name
    await reviews.add({id:'qr:'+message.key.id,ownerId,laborId:Number(assignment.contact.labor_id),laborName,phone,rawText:text.slice(0,10000)||'[Audio pendiente: escúchalo en el chat original y escribe los datos verificados.]',messageType:type,reason,reportDate})
    lastError='Hay reportes pendientes de revisión. '+reason
  }
}
async function connect(){
  if(connecting||state==='connected')return
  connecting=true;state='connecting';lastError=''
  try{
    const {state:auth,saveCreds}=await useMultiFileAuthState(path.join(root,'session'))
    socket=makeWASocket({auth,logger,markOnlineOnConnect:false,syncFullHistory:false,shouldSyncHistoryMessage:()=>false})
    socket.ev.on('creds.update',saveCreds)
    socket.ev.on('connection.update',async update=>{
      if(update.qr){qr=await QRCode.toDataURL(update.qr,{width:300,margin:2});state='qr'}
      if(update.connection==='open'){qr='';state='connected';connecting=false}
      if(update.connection==='close'){
        const code=(update.lastDisconnect?.error as any)?.output?.statusCode
        connecting=false;qr='';state=code===DisconnectReason.loggedOut?'logged_out':'disconnected'
        if(code!==DisconnectReason.loggedOut)setTimeout(()=>void connect().catch(error=>lastError=error.message),5000)
      }
    })
    socket.ev.on('messages.upsert',event=>{if(event.type!=='notify')return;for(const message of event.messages)incoming=incoming.then(()=>ingest(message)).catch(error=>{lastError=error.message})})
  }catch(error){connecting=false;state='error';throw error}
}
let scheduling=false
async function daily(){
  if(scheduling||!enabled||state!=='connected'||!socket)return
  scheduling=true
  try{
    const clock=limaClock()
    for(const {contact,labor,phone,key} of dueReminders(await workspace(),ownerId,clock,ledger)){
      // Persistimos antes del envío para impedir reenvíos tras un reinicio incierto.
      await recordDelivery(key,'pending')
      await socket.sendMessage(phone+'@s.whatsapp.net',{text:`Hola ${contact.contact_name||'socio'}, reporte de hoy (${clock.date}) · ${labor.name}:\n¿Cuántos sacos sacaron? ¿Cuánto gastaron y en qué? ¿No trabajaron o solo botaron desmonte? Puedes responder por texto o audio.\nEjemplo: Sacamos 12 sacos; gastamos 40 soles en gasolina.`})
      await recordDelivery(key,'sent');lastSent=new Date().toISOString()
    }
  }catch(error){lastError=(error as Error).message}finally{scheduling=false}
}
setInterval(()=>void daily(),15000).unref()
async function authorized(request:IncomingMessage){
  const bearer=request.headers.authorization;if(!bearer?.startsWith('Bearer '))return false
  const response=await fetch(supabase+'/auth/v1/user',{headers:{apikey:serviceKey,Authorization:bearer},signal:AbortSignal.timeout(10000)})
  if(!response.ok)return false;const user=await response.json();if(user.email!==(process.env.OWNER_EMAIL||'madfaygoo@gmail.com'))return false;ownerId=user.id;return true
}
async function readBody(request:IncomingMessage){
  let body=''
  for await(const chunk of request){body+=chunk.toString();if(Buffer.byteLength(body)>12000)throw new Error('El reporte supera el tamaño permitido.')}
  return JSON.parse(body||'{}') as {correctedText?:string;reportDate?:string}
}
createServer(async(request,response)=>{
  const origin=request.headers.origin||''
  if(!origins.has(origin)){response.writeHead(403);response.end();return}
  response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Vary','Origin');response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');response.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');response.setHeader('Cache-Control','no-store')
  if(request.method==='OPTIONS'){response.writeHead(204);response.end();return}
  const reply=(data:unknown,status=200)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(data))}
  try{
    if(!await authorized(request))return reply({error:'Inicia sesión con la cuenta del administrador.'},401)
    if(request.url==='/reviews'&&request.method==='GET')return reply({reviews:reviews.pending(ownerId)})
    const reviewAction=request.url?.match(/^\/reviews\/([^/]+)\/(approve|reject)$/)
    if(reviewAction&&request.method==='POST'){
      const id=decodeURIComponent(reviewAction[1]),review=reviews.find(ownerId,id)
      if(!review)return reply({error:'Reporte pendiente no encontrado.'},404)
      if(reviewAction[2]==='reject'){await reviews.resolve(ownerId,id,'rejected');return reply({ok:true})}
      const assignment=allowedContact(await workspace(),review.phone)
      if(!assignment||Number(assignment.contact.labor_id)!==review.laborId)return reply({error:'La asignación de este contacto cambió. Registra el reporte manualmente en su labor correcta.'},409)
      const body=await readBody(request),correctedText=body.correctedText
      const reportDay=body.reportDate||review.reportDate
      if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDay)||reportDay>limaClock().date||reportDay<'2000-01-01')return reply({error:'Verifica la fecha real del reporte; no puede ser futura.'},400)
      if(typeof correctedText!=='string'||correctedText.length<3||correctedText.length>10000)return reply({error:'Escribe los datos verificados.'},400)
      const parsed=await interpretReport(correctedText,{})
      if(parsed.confidence<.6)return reply({error:'Separa cada gasto con punto y coma y verifica las cifras antes de confirmar.'},400)
      await admin('rpc/ingest_whatsapp_qr_report',{p_owner_id:ownerId,p_report_date:reportDay,p_phone:review.phone,p_message_id:review.id,p_message_type:review.messageType,p_raw_text:correctedText,p_parsed:parsed,p_expected_labor_id:review.laborId})
      await reviews.resolve(ownerId,id,'approved');lastReceived=new Date().toISOString();return reply({ok:true})
    }
    if(request.url==='/connect'&&request.method==='POST')await connect()
    else if(request.url==='/automation/start'&&request.method==='POST'){if(state!=='connected')return reply({error:'Escanea primero el QR.'},409);enabled=true}
    else if(request.url==='/automation/stop'&&request.method==='POST')enabled=false
    else if(request.url!=='/status')return reply({error:'Ruta no encontrada'},404)
    reply({state,qr,enabled,lastError,lastReceived,lastSent,audioReady:Boolean(process.env.TRANSCRIPTION_URL),aiReady:Boolean(process.env.OLLAMA_URL&&process.env.OLLAMA_MODEL),pendingReviews:reviews.pending(ownerId).length})
  }catch(error){reply({error:(error as Error).message},500)}
}).listen(Number(process.env.PORT||3080),process.env.HOST||'127.0.0.1',()=>console.log('Servicio QR listo en puerto '+(process.env.PORT||3080)+'. Abre WhatsApp en el dashboard para vincular.'))
