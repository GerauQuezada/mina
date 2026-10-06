import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Plus, MapPin, UserRound, Package, ReceiptText, ArrowUpRight, Search, Crown } from 'lucide-react'
import { api, number, soles } from '../lib/api'
import PhotoPicker from '../components/PhotoPicker'
import Modal from '../components/Modal'

export type Labor={id:number;name:string;code?:string;level?:string;location?:string;description?:string;status:string;ownership_type?:'partner'|'own';partner_name:string;partner_photo?:string;mine_percent:number;partner_percent:number;production_total:number;sold_sacks?:number;available_sacks?:number;production_month:number;expenses_cents:number;last_activity:string}

export default function Labors(){
  const [photo,setPhoto]=useState(''),[items,setItems]=useState<Labor[]>([]),[open,setOpen]=useState(false),[search,setSearch]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[kind,setKind]=useState<'partner'|'own'>('partner')
  const load=()=>api<Labor[]>('/labors').then(setItems).catch(e=>setError(e.message))
  useEffect(()=>{void load()},[])
  function close(){if(busy)return;setOpen(false);setPhoto('');setKind('partner');setError('')}
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('')
    const form=e.currentTarget
    const data={...Object.fromEntries(new FormData(form)),ownershipType:kind,partner_photo:kind==='partner'?photo:''}
    try{await api('/labors',{method:'POST',body:JSON.stringify(data)});setOpen(false);setPhoto('');setKind('partner');await load()}
    catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  const filtered=items.filter(x=>`${x.name} ${x.partner_name} ${x.code||''}`.toLowerCase().includes(search.toLowerCase()))
  return <>
    <div className="toolbar glass"><label className="search"><Search/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar labor o socio…"/></label><button className="primary" onClick={()=>setOpen(true)}><Plus/> Nueva labor</button></div>
    {error&&!open&&<div className="alert error">{error}</div>}
    <section className="labor-grid">{filtered.map(l=>{const own=l.ownership_type==='own'||l.partner_percent===0;return <article className={`labor-card glass ${own?'own-labor':''}`} key={l.id}>
      <div className="labor-top"><div className="profile-photo">{own?<Crown/>:l.partner_photo?<img src={l.partner_photo} alt={l.partner_name}/>:<UserRound/>}</div><span className={`badge ${own?'owned':l.status}`}>{own?'100% propia':l.status==='active'?'Activa':'Inactiva'}</span></div>
      <h2>{l.name}</h2><div className="labor-meta"><span>{own?<><Crown/> Labor propia</>:<><UserRound/> {l.partner_name}</>}</span><span><MapPin/> {l.level||l.location||'Sin ubicación'}</span></div>
      <div className="labor-stats"><div><Package/><span>Producción total</span><b>{number(l.production_total)} sacos</b></div><div><ReceiptText/><span>Gastos acumulados</span><b>{soles(l.expenses_cents)}</b></div></div>
      {own?<div className="own-share"><Crown/> Todos los sacos te pertenecen</div>:<div className="split"><span>Mina <b>{l.mine_percent}%</b></span><i><em style={{width:`${l.mine_percent}%`}}/></i><span>Socio <b>{l.partner_percent}%</b></span></div>}
      <Link to={`/labores/${l.id}`}>Abrir labor <ArrowUpRight/></Link>
    </article>})}{!filtered.length&&<div className="empty wide"><PickEmpty/><b>No hay labores todavía.</b><span>Crea una labor propia o una labor compartida con un socio.</span></div>}</section>
    {open&&<Modal title="Nueva labor" onClose={close}><form className="form-grid" onSubmit={submit}>
      <label className="span-2">Tipo de labor<select value={kind} onChange={e=>setKind(e.target.value as 'partner'|'own')}><option value="partner">Labor con socio</option><option value="own">Mi labor propia · 100% mío</option></select><small>{kind==='own'?'Toda la producción se contabilizará como tuya.':'La producción se repartirá usando los porcentajes indicados.'}</small></label>
      {kind==='partner'&&<PhotoPicker value={photo} onChange={setPhoto} label="Foto del socio"/>}
      <label>Nombre de labor<input name="name" required placeholder="Ej. Labor Arecio"/></label>
      {kind==='partner'?<label>Socio responsable<input name="partnerName" required placeholder="Nombre del socio"/></label>:<input type="hidden" name="partnerName" value="Omar Miranda"/>}
      <label>Código<input name="code" placeholder="LAB-001"/></label><label>Nivel<input name="level" placeholder="Nivel 420"/></label><label>Ubicación<input name="location" placeholder="Sector norte"/></label><label>Estado<select name="status"><option value="active">Activa</option><option value="inactive">Inactiva</option></select></label>
      {kind==='partner'?<><label>Porcentaje Mina<input name="minePercent" type="number" min="1" max="99" defaultValue="50" required/></label><label>Porcentaje Socio<input name="partnerPercent" type="number" min="1" max="99" defaultValue="50" required/></label></>:<><input type="hidden" name="minePercent" value="100"/><input type="hidden" name="partnerPercent" value="0"/></>}
      <label className="span-2">Descripción<textarea name="description" rows={3}/></label>{error&&<p className="alert error span-2">{error}</p>}
      <div className="form-actions span-2"><button type="button" disabled={busy} onClick={close}>Cancelar</button><button className="primary" disabled={busy}>{busy?'Guardando…':'Guardar labor'}</button></div>
    </form></Modal>}
  </>
}
function PickEmpty(){return <div className="labor-symbol"><span>+</span></div>}
