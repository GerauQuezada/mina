import { useEffect, useState } from 'react'
import { Download, FileSpreadsheet, FileText, Table2 } from 'lucide-react'
import { api, today } from '../lib/api'
import type { Labor } from './Labors'

const dateFields:Record<string,string>={production:'date',expenses:'expense_date',liquidations:'liquidation_date',sales:'sale_date'}
const names:Record<string,string>={production:'produccion',expenses:'gastos',liquidations:'liquidaciones',sales:'ventas'}
const escapeCsv=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`

export default function Reports(){
  const [labors,setLabors]=useState<Labor[]>([]);const [type,setType]=useState('production');const [labor,setLabor]=useState('0');const [from,setFrom]=useState(new Date(new Date().setDate(1)).toISOString().slice(0,10));const [to,setTo]=useState(today());const [message,setMessage]=useState('')
  useEffect(()=>{api<Labor[]>('/labors').then(setLabors)},[])
  async function rows(){const data=await api<any[]>(`/${type}?laborId=${labor}`);const field=dateFields[type];return data.filter(x=>String(x[field])>=from&&String(x[field])<=to)}
  async function download(format:'csv'|'xlsx'|'pdf'){
    const data=await rows();if(!data.length){setMessage('No hay registros en el periodo seleccionado.');return}
    const keys=Object.keys(data[0]).filter(x=>!['receipt_data_url','deleted_at'].includes(x));const matrix=[keys,...data.map(row=>keys.map(key=>row[key]))]
    if(format==='pdf'){
      const popup=window.open('','_blank');if(!popup){setMessage('Permite ventanas emergentes para imprimir el reporte.');return}
      popup.document.write(`<title>Reporte de ${names[type]}</title><style>body{font-family:Arial;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px;text-align:left;font-size:11px}h1{font-size:20px}</style><h1>MINA OMAR MIRANDA · ${names[type].toUpperCase()}</h1><p>${from} — ${to}</p><table><thead><tr>${keys.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${data.map(row=>`<tr>${keys.map(key=>`<td>${String(row[key]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);popup.document.close();popup.focus();popup.print();return
    }
    const separator=format==='xlsx'?'\t':',';const content='\ufeff'+matrix.map(row=>row.map(escapeCsv).join(separator)).join('\n');const blob=new Blob([content],{type:format==='xlsx'?'application/vnd.ms-excel;charset=utf-8':'text/csv;charset=utf-8'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`${names[type]}-${from}-${to}.${format==='xlsx'?'xls':'csv'}`;link.click();URL.revokeObjectURL(link.href);setMessage('Reporte generado en este dispositivo.')
  }
  return <section className="reports"><article className="panel glass report-builder"><div className="panel-head"><div><span className="eyebrow">Generador local</span><h2>Crear reporte</h2></div><FileText/></div><div className="form-grid"><label>Tipo de reporte<select value={type} onChange={e=>setType(e.target.value)}><option value="production">Producción</option><option value="expenses">Gastos</option><option value="liquidations">Liquidaciones</option><option value="sales">Ventas</option></select></label><label>Labor<select value={labor} onChange={e=>setLabor(e.target.value)}><option value="0">Toda la mina</option>{labors.map(l=><option value={l.id} key={l.id}>{l.name}</option>)}</select></label><label>Desde<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Hasta<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label></div>{message&&<div className="alert">{message}</div>}<div className="export-buttons"><button onClick={()=>download('pdf')}><FileText/><span><b>PDF</b><small>Vista lista para imprimir</small></span><Download/></button><button onClick={()=>download('xlsx')}><FileSpreadsheet/><span><b>Excel</b><small>Hoja compatible con Excel</small></span><Download/></button><button onClick={()=>download('csv')}><Table2/><span><b>CSV</b><small>Datos compatibles con otros sistemas</small></span><Download/></button></div></article><article className="panel glass report-info"><span className="eyebrow">Persistencia gratuita</span><h2>Datos guardados en tu navegador</h2><p>Los reportes se generan con los registros de este dispositivo. Puedes exportarlos para crear respaldos y abrirlos en otros programas.</p><div><span>✓ Filtros por fecha y labor</span><span>✓ Montos expresados en soles</span><span>✓ Sin servidores ni pagos</span></div></article></section>
}
