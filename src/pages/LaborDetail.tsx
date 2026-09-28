import {useEffect,useState} from 'react'
import {Link,useParams} from 'react-router-dom'
import {api,number,soles} from '../lib/api'
import PhotoPicker from '../components/PhotoPicker'
import {Crown} from 'lucide-react'
import type {Labor} from './Labors'
export default function LaborDetail(){
 const {id}=useParams();const [labor,setLabor]=useState<Labor>();const [production,setProduction]=useState<any[]>([]);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false)
 useEffect(()=>{Promise.all([api<Labor[]>('/labors'),api<any[]>('/production?laborId='+id)]).then(([ls,p])=>{setLabor(ls.find(x=>x.id===Number(id)));setProduction(p)}).catch(e=>setMessage(e.message))},[id])
 async function photo(value:string){setBusy(true);try{await api('/labors/'+id,{method:'PUT',body:JSON.stringify({partner_photo:value})});setLabor(l=>l?{...l,partner_photo:value}:l);setMessage('Fotografía del socio actualizada.')}catch(e){setMessage((e as Error).message)}finally{setBusy(false)}}
 if(!labor)return <div className="panel glass">{message||'Cargando labor…'}</div>
 const own=labor.ownership_type==='own'||labor.partner_percent===0
 return <><Link className="back-link" to="/labores">← Volver a labores</Link><section className="labor-hero glass"><div><span className="eyebrow">Perfil de labor</span><h2>{labor.name}</h2><p>{own?<><Crown/> Labor propia de Omar Miranda</>:<>Socio responsable: {labor.partner_name}</>}</p></div><div className="split-card"><span>Distribución vigente</span><b>{own?'100% de los sacos son tuyos':`${labor.mine_percent}% Mina / ${labor.partner_percent}% Socio`}</b></div></section>{!own&&<section className="panel glass"><PhotoPicker value={labor.partner_photo} onChange={v=>!busy&&void photo(v)} label={labor.partner_name}/>{message&&<p role="status">{message}</p>}</section>}<section className="detail-grid"><Link className="mini-card glass" to="/produccion"><span>Producción</span><b>{number(labor.production_total)} sacos</b></Link><Link className="mini-card glass" to="/gastos"><span>Gastos</span><b>{soles(labor.expenses_cents)}</b></Link><Link className="mini-card glass" to="/ventas"><span>Comercialización</span><b>Ver ventas ↗</b></Link></section><section className="panel glass"><h2>Última producción</h2><div className="table-scroll"><table><thead><tr><th>Fecha</th><th>Sacos</th><th>{own?'Tuyos':'Mina'}</th>{!own&&<th>Socio</th>}</tr></thead><tbody>{production.slice(0,8).map(x=><tr key={x.id}><td>{x.date}</td><td>{number(x.sacks)}</td><td>{number(x.mine_sacks)}</td>{!own&&<td>{number(x.partner_sacks)}</td>}</tr>)}</tbody></table></div></section></>
}
