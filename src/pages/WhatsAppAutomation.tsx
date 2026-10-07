import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Bot, Check, Clock3, ExternalLink, MessageCircleMore, Mic, QrCode, Save, Send, ShieldCheck, Sparkles } from 'lucide-react'
import { api, timeNow, today } from '../lib/api'
import { dailyPrompt, parseFieldReport, type ParsedFieldReport } from '../lib/whatsappParser'

type Labor={id:number;name:string;partner_name:string;status:string}
type Contact={id?:number;labor_id:number;labor_name?:string;phone:string;send_time:string;enabled:boolean}
type Report={id:number;labor_name:string;date:string;status:string;raw_text:string;created_at:string}

const stateLabel:Record<string,string>={worked:'Trabajaron',no_work:'No trabajaron',waste_only:'Solo desmonte'}

export default function WhatsAppAutomation(){
  const [labors,setLabors]=useState<Labor[]>([]),[contacts,setContacts]=useState<Contact[]>([]),[reports,setReports]=useState<Report[]>([])
  const [laborId,setLaborId]=useState(0),[phone,setPhone]=useState(''),[sendTime,setSendTime]=useState('18:00')
  const [text,setText]=useState(''),[parsed,setParsed]=useState<ParsedFieldReport|null>(null),[qr,setQr]=useState(''),[message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const labor=labors.find(x=>x.id===laborId)
  const contact=contacts.find(x=>x.labor_id===laborId)
  const prompt=labor?dailyPrompt(labor.name):''
  const waUrl=phone?`https://wa.me/${phone.replace(/\D/g,'')}?text=${encodeURIComponent(prompt)}`:''
  async function load(){const [l,c,r]=await Promise.all([api<Labor[]>('/labors'),api<Contact[]>('/whatsapp/contacts'),api<Report[]>('/whatsapp/reports')]);setLabors(l.filter(x=>x.status==='active'));setContacts(c);setReports(r);if(!laborId&&l.length)setLaborId(l[0].id)}
  useEffect(()=>{void load().catch(error=>setMessage((error as Error).message))},[])
  useEffect(()=>{const saved=contacts.find(x=>x.labor_id===laborId);setPhone(saved?.phone||'');setSendTime(saved?.send_time||'18:00')},[laborId,contacts])
  useEffect(()=>{let active=true;if(!waUrl){setQr('');return}QRCode.toDataURL(waUrl,{width:260,margin:1,color:{dark:'#111216',light:'#f7f7f8'}}).then(value=>{if(active)setQr(value)});return()=>{active=false}},[waUrl])
  async function saveContact(){setBusy(true);setMessage('');try{await api('/whatsapp/contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({laborId,phone,sendTime,enabled:true})});await load();setMessage('Contacto guardado y vinculado a esta labor.')}catch(error){setMessage((error as Error).message)}finally{setBusy(false)}}
  function analyze(){if(text.trim().length<3)return setMessage('Pega una respuesta de WhatsApp para analizarla.');setParsed(parseFieldReport(text));setMessage('Revisa el resultado antes de guardarlo. La aplicación nunca registra datos sin tu confirmación.')}
  async function confirm(){if(!parsed||!labor)return;setBusy(true);setMessage('');try{
    if(parsed.sacks&&parsed.sacks>0)await api('/production',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({laborId:labor.id,date:today(),sacks:parsed.sacks,note:'Importado desde respuesta de WhatsApp: '+text.slice(0,300)})})
    for(const expense of parsed.expenses)await api('/expenses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({laborId:labor.id,name:expense.name,amount:expense.amount,expenseDate:today(),expenseTime:timeNow(),category:expense.category,paymentMethod:'Por confirmar',observation:'Importado desde respuesta de WhatsApp'})})
    await api('/whatsapp/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({laborId:labor.id,date:today(),status:parsed.status,rawText:text})})
    setText('');setParsed(null);await load();setMessage('Reporte confirmado: producción, gastos y actividad quedaron sincronizados.')
  }catch(error){setMessage((error as Error).message)}finally{setBusy(false)}}
  const lastReports=useMemo(()=>reports.slice(0,8),[reports])
  return <div className="whatsapp-page">
    <section className="wa-hero glass"><div className="wa-bot"><Bot/></div><div><span className="eyebrow">ASISTENTE DE CAMPO</span><h2>Reportes diarios por WhatsApp</h2><p>Prepara la pregunta, abre el chat y convierte la respuesta del socio en producción y gastos verificables.</p></div><span className="safe-badge"><ShieldCheck/> Confirmación humana activa</span></section>
    {message&&<div className="notice">{message}</div>}
    <div className="wa-grid">
      <section className="wa-card glass"><header><div><span className="eyebrow">PASO 1</span><h3>Vincular labor y teléfono</h3></div><QrCode/></header><label>Labor<select value={laborId} onChange={event=>setLaborId(Number(event.target.value))}>{labors.map(item=><option key={item.id} value={item.id}>{item.name} · {item.partner_name}</option>)}</select></label><div className="form-grid"><label>WhatsApp con código de país<input inputMode="tel" placeholder="51964518509" value={phone} onChange={event=>setPhone(event.target.value.replace(/[^\d+ ]/g,''))}/></label><label>Hora diaria<input type="time" value={sendTime} onChange={event=>setSendTime(event.target.value)}/></label></div><button className="primary-button" disabled={busy||!laborId} onClick={()=>void saveContact()}><Save/> Guardar vínculo</button>{qr&&<div className="wa-qr"><img src={qr} alt="QR para abrir el mensaje de WhatsApp"/><div><b>Escanea con tu teléfono</b><p>Abre WhatsApp con la pregunta diaria ya escrita para esta labor.</p><a href={waUrl} target="_blank" rel="noreferrer"><ExternalLink/> Abrir WhatsApp</a></div></div>}<div className="prompt-preview"><MessageCircleMore/><p>{prompt||'Selecciona una labor.'}</p></div></section>
      <section className="wa-card glass"><header><div><span className="eyebrow">PASO 2</span><h3>Interpretar la respuesta</h3></div><Sparkles/></header><label>Respuesta escrita o transcripción del audio<textarea rows={7} placeholder={'Ejemplo: Hoy sacamos 18 sacos. Gastamos 120 soles en gasolina y 80 en comida.'} value={text} onChange={event=>setText(event.target.value)}/></label><div className="wa-actions"><button onClick={analyze}><Sparkles/> Analizar respuesta</button><label className="disabled-upload" title="Se habilita al conectar la API oficial"><Mic/> Audio automático<input type="file" accept="audio/*" disabled hidden/></label></div>{parsed&&<div className="parse-preview"><header><b>Vista previa</b><span>{Math.round(parsed.confidence*100)}% de confianza</span></header><div className="parse-metrics"><div><small>Actividad</small><strong>{stateLabel[parsed.status]}</strong></div><div><small>Sacos</small><strong>{parsed.sacks??'—'}</strong></div><div><small>Gastos</small><strong>{parsed.expenses.length}</strong></div></div>{parsed.expenses.map((expense,index)=><p key={index}><span>{expense.category} · {expense.name}</span><b>S/ {expense.amount.toFixed(2)}</b></p>)}{parsed.notes.map(note=><small key={note}>• {note}</small>)}<button className="confirm-button" disabled={busy} onClick={()=>void confirm()}><Check/> Confirmar y guardar datos</button></div>}</section>
    </div>
    <div className="wa-grid lower">
      <section className="wa-card glass"><header><div><span className="eyebrow">ÚLTIMOS REPORTES</span><h3>Trazabilidad diaria</h3></div><Clock3/></header>{lastReports.length?lastReports.map(report=><div className="wa-log" key={report.id}><i/><div><b>{report.labor_name}</b><span>{stateLabel[report.status]||report.status} · {report.date}</span></div><small>{report.raw_text.slice(0,90)}</small></div>):<div className="editor-empty">Todavía no hay respuestas importadas.</div>}</section>
      <section className="wa-card glass integration-card"><header><div><span className="eyebrow">AUTOMATIZACIÓN 24/7</span><h3>Conexión oficial de Meta</h3></div><Send/></header><p>La lectura automática de mensajes y audios requiere un número de <b>WhatsApp Business Cloud API</b>, un webhook público y credenciales guardadas como secretos. GitHub Pages por sí solo no puede recibir mensajes.</p><ul><li><Check/> La interfaz y el registro contable ya están preparados.</li><li><Check/> Los contactos y horarios quedan sincronizados.</li><li><Clock3/> Falta conectar el número de Meta y desplegar el receptor seguro.</li></ul><div className="integration-warning">No se guardarán tokens de WhatsApp en GitHub ni en el navegador.</div></section>
    </div>
  </div>
}
