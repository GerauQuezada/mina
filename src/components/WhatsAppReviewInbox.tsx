import {useEffect,useState} from 'react'
import {Check,RefreshCw,X} from 'lucide-react'
import {whatsappBridgeRequest} from '../lib/cloud'

type Review={id:string;laborId:number;laborName?:string;reportDate:string;phone:string;rawText:string;reason:string;messageType:string;createdAt:string}
export default function WhatsAppReviewInbox({base}:{base:string}){
  const [rows,setRows]=useState<Review[]>([]),[drafts,setDrafts]=useState<Record<string,string>>({}),[dates,setDates]=useState<Record<string,string>>({}),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null)
  async function load(){try{const result=await whatsappBridgeRequest(base,'/reviews');setRows(result.reviews);setError('')}catch(error){setError((error as Error).message)}}
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),10000);return()=>clearInterval(timer)},[base])
  async function resolve(row:Review,action:'approve'|'reject'){
    if(!window.confirm(action==='approve'?'¿Confirmas que verificaste estos sacos y gastos? Se registrarán en la labor asignada.':'¿Marcar este reporte como descartado sin modificar la contabilidad?'))return
    setBusy(row.id)
    try{await whatsappBridgeRequest(base,`/reviews/${encodeURIComponent(row.id)}/${action}`,'POST',{correctedText:drafts[row.id]??row.rawText,reportDate:dates[row.id]??row.reportDate});await load()}catch(error){setError((error as Error).message)}finally{setBusy(null)}
  }
  return <section className="wa-review-inbox"><header><div><b>Reportes pendientes de revisión · {rows.length}</b><small>No afectan la contabilidad hasta confirmarlos.</small></div><button onClick={()=>void load()} aria-label="Actualizar pendientes"><RefreshCw size={17}/></button></header>{error&&<p role="alert">{error}</p>}{rows.map(row=><article key={row.id}><b>{row.laborName||`Labor #${row.laborId}`} · +{row.phone}</b><small>{new Date(row.createdAt).toLocaleString('es-PE',{timeZone:'America/Lima'})} · {row.messageType==='audio'?'Audio':'Texto'}</small><p>{row.reason}</p><details><summary>Mensaje original</summary><blockquote>{row.rawText}</blockquote></details><label>Fecha real del reporte<input type="date" value={dates[row.id]??row.reportDate} onChange={event=>setDates(current=>({...current,[row.id]:event.target.value}))}/></label><label>Datos verificados<textarea maxLength={10000} rows={3} value={drafts[row.id]??row.rawText} placeholder="12 sacos; 40 soles en gasolina; 20 soles en comida" onChange={event=>setDrafts(current=>({...current,[row.id]:event.target.value}))}/></label><div className="wa-actions"><button disabled={busy!==null} onClick={()=>void resolve(row,'approve')}><Check size={17}/> Confirmar</button><button disabled={busy!==null} onClick={()=>void resolve(row,'reject')}><X size={17}/> Descartar</button></div></article>)}{!rows.length&&!error&&<small>No hay mensajes pendientes.</small>}</section>
}
