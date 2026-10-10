import {useEffect,useState} from 'react'
import {QrCode,RefreshCw,Play,Pause} from 'lucide-react'
import {whatsappBridgeRequest} from '../lib/cloud'
import WhatsAppReviewInbox from './WhatsAppReviewInbox'

type BridgeState={state:string;qr:string;enabled:boolean;lastError:string;lastReceived:string;lastSent:string;audioReady:boolean;aiReady?:boolean}
const labels:Record<string,string>={disconnected:'Servicio listo para vincular',connecting:'Conectando con WhatsApp…',qr:'Escanea con Dispositivos vinculados',connected:'WhatsApp conectado',logged_out:'Sesión cerrada: vuelve a vincular',error:'Revisa el servicio'}
export default function WhatsAppQrConnection(){
  const [url,setUrl]=useState(()=>localStorage.getItem('mina-whatsapp-bridge-url')||'')
  const [linkedUrl,setLinkedUrl]=useState(()=>localStorage.getItem('mina-whatsapp-bridge-url')||'')
  const [status,setStatus]=useState<BridgeState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  async function refresh(base=linkedUrl){if(!base)return;try{setStatus(await whatsappBridgeRequest(base,'/status'));setError('')}catch(error){setError((error as Error).message)}}
  useEffect(()=>{if(!linkedUrl)return;void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer)},[linkedUrl])
  async function action(route:string){
    setBusy(true)
    try{const base=route==='/connect'?url.trim():linkedUrl;const result=await whatsappBridgeRequest(base,route,'POST');localStorage.setItem('mina-whatsapp-bridge-url',base);setLinkedUrl(base);setStatus(result);setError('')}catch(error){setError((error as Error).message)}finally{setBusy(false)}
  }
  return <section className="wa-connection glass">
    <div className="wa-connection-head"><div><span className="connection-dot"/><span><b>{status?labels[status.state]||status.state:'Vincular mi WhatsApp con QR'}</b><small>Los mensajes se enviarán desde la cuenta que vincules aquí.</small></span></div><QrCode/></div>
    <label>Dirección de tu servicio QR privado<input type="url" placeholder="https://tu-servicio-qr.example.com" value={url} onChange={event=>setUrl(event.target.value)}/></label>
    <small>Utiliza únicamente una dirección bajo tu control: se enviará tu sesión del administrador a ese servicio para autenticarte.</small>
    <div className="wa-actions"><button disabled={busy||!url.trim()} onClick={()=>void action('/connect')}><QrCode/> Obtener QR</button><button disabled={busy||!linkedUrl} onClick={()=>void refresh()}><RefreshCw/> Actualizar</button></div>
    {error&&<div className="notice" role="alert">{error}</div>}
    {status?.qr&&<div className="wa-real-qr"><img src={status.qr} alt="Código QR real para vincular tu WhatsApp"/><p>En tu teléfono: WhatsApp → Configuración → Dispositivos vinculados → Vincular dispositivo. Escanea este QR desde otra pantalla.</p></div>}
    {status?.state==='connected'&&<>
      <div className="notice">Cuenta vinculada · {status.enabled?'Recordatorios automáticos activos':'Recordatorios pausados'}</div>
      <div className="wa-actions"><button disabled={busy} onClick={()=>void action(status.enabled?'/automation/stop':'/automation/start')}>{status.enabled?<Pause/>:<Play/>}{status.enabled?'Pausar recordatorios':'Activar recordatorios diarios'}</button></div>
      <small>Audios: {status.audioReady?'transcriptor configurado':'falta configurar el transcriptor'}. Interpretación: {status.aiReady?'IA local configurada':'reglas, sin modelo de IA'}. Solo se procesan los números autorizados que asignes abajo.</small>
    </>}
    {status?.lastError&&<div className="notice">{status.lastError}</div>}
    {status?.lastSent&&<small>Último recordatorio: {new Date(status.lastSent).toLocaleString('es-PE',{timeZone:'America/Lima'})}</small>}
    {status?.lastReceived&&<small>Último reporte registrado: {new Date(status.lastReceived).toLocaleString('es-PE',{timeZone:'America/Lima'})}</small>}
    {status&&linkedUrl&&<WhatsAppReviewInbox base={linkedUrl}/>}
    <p>El servicio QR debe permanecer encendido en una computadora o servidor. GitHub Pages muestra esta pantalla; el servicio mantiene WhatsApp conectado, envía a las horas asignadas y recibe las respuestas. El número del socio determina su labor.</p>
  </section>
}
