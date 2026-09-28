import { useState } from 'react'
import { Camera, ImagePlus, UserRound } from 'lucide-react'
import { readAttachment } from '../lib/media'

export default function PhotoPicker({value,onChange,label='Fotografía'}:{value?:string;onChange:(value:string)=>void;label?:string}){
  const [error,setError]=useState('');const [busy,setBusy]=useState(false)
  async function pick(file?:File){if(!file)return;setBusy(true);setError('');try{onChange(await readAttachment(file))}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <div className="photo-picker"><div className="profile-photo">{value?<img src={value} alt={label}/>:<UserRound/>}</div><div><b>{label}</b><div className="photo-actions"><label className="secondary"><ImagePlus size={16}/> Galería<input aria-label={`${label}: galería`} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={e=>{void pick(e.target.files?.[0]);e.target.value=''}}/></label><label className="secondary"><Camera size={16}/> Cámara<input aria-label={`${label}: cámara`} type="file" accept="image/*" capture="user" hidden disabled={busy} onChange={e=>{void pick(e.target.files?.[0]);e.target.value=''}}/></label>{value&&<button className="secondary" type="button" onClick={()=>onChange('')}>Quitar</button>}</div>{busy&&<small>Preparando imagen…</small>}{error&&<p role="alert">{error}</p>}</div></div>
}
