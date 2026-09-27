import { useEffect, useState, type FormEvent } from 'react'
import { Mountain, ShieldCheck, ArrowRight } from 'lucide-react'
import { api } from '../lib/api'

export default function AuthPage({onAuth}:{onAuth:()=>void}){
  const [initialized,setInitialized]=useState<boolean|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false)
  useEffect(()=>{api<{initialized:boolean}>('/status').then(r=>setInitialized(r.initialized)).catch(e=>setError(e.message))},[])
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setError('');const data=Object.fromEntries(new FormData(e.currentTarget));try{await api(initialized?'/auth/login':'/auth/bootstrap',{method:'POST',body:JSON.stringify(data)});onAuth()}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <main className="auth-shell">
    <section className="auth-brand"><div className="brand-mark"><Mountain/></div><div><span className="eyebrow">Sistema integral de operación</span><h1>MINA<br/><strong>OMAR MIRANDA</strong></h1><p>Producción, costos y trazabilidad de cada labor, en un solo lugar.</p></div><div className="auth-proof"><ShieldCheck/><span>Sesiones privadas · Auditoría activa · Datos locales</span></div></section>
    <section className="auth-panel glass"><div><span className="status"><i/> Acceso seguro</span><h2>{initialized?'Bienvenido de nuevo':'Crear administrador'}</h2><p>{initialized?'Ingresa tus credenciales para continuar.':'Configura la primera cuenta. La contraseña se cifra y nunca queda visible.'}</p></div>
      {initialized===null?<div className="loader"/>:<form onSubmit={submit}>
        {!initialized&&<label>Nombre completo<input name="name" required minLength={3} autoComplete="name" placeholder="Administrador principal"/></label>}
        <label>Correo electrónico<input name="email" required type="email" autoComplete="username" placeholder="administrador@mina.pe"/></label>
        <label>Contraseña<input name="password" required type="password" minLength={initialized?1:10} autoComplete={initialized?'current-password':'new-password'} placeholder="••••••••••"/></label>
        {error&&<div className="alert error">{error}</div>}<button className="primary" disabled={busy}>{busy?'Procesando…':initialized?'Ingresar':'Crear cuenta y entrar'}<ArrowRight size={18}/></button>
      </form>}
      <small>El acceso está protegido y toda acción crítica queda registrada.</small>
    </section>
  </main>
}
