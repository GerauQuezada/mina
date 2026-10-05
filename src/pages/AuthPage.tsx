import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Delete, Fingerprint, KeyRound, LockKeyhole, Mountain, ShieldCheck } from 'lucide-react'
import { activatePinAccess, DASHBOARD_PIN, hasPinAccess, unlockWithPin } from '../lib/cloud'

const digits = ['1','2','3','4','5','6','7','8','9','','0','delete']

export default function AuthPage({ onAuth }: { onAuth: () => void }) {
  const [activated, setActivated] = useState(hasPinAccess)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [opening, setOpening] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const passwordRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (activated && pin.length === 4 && !busy) void unlock(pin) }, [pin, activated])

  function press(value: string) {
    if (busy || opening) return
    setError('')
    if (value === 'delete') setPin(current => current.slice(0, -1))
    else if (value && pin.length < 4) setPin(current => current + value)
  }

  async function unlock(value: string) {
    setBusy(true); setError('')
    try {
      await unlockWithPin(value)
      setOpening(true)
      window.setTimeout(onAuth, 1350)
    } catch (reason) {
      setError((reason as Error).message)
      setPin(''); setAttempt(value => value + 1)
    } finally { setBusy(false) }
  }

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await activatePinAccess(passwordRef.current?.value || '', DASHBOARD_PIN)
      setActivated(true); setPin('')
    } catch (reason) { setError((reason as Error).message) }
    finally { setBusy(false) }
  }

  return <main className={`vault-auth ${opening ? 'is-opening' : ''}`}>
    <div className="vault-ambient" aria-hidden="true"><i/><i/><i/></div>
    <section className="vault-copy">
      <div className="vault-logo"><Mountain/><span>MINA OMAR<br/><b>MIRANDA</b></span></div>
      <span className="eyebrow">Centro de control privado</span>
      <h1>Tu operación.<br/><strong>Bajo control.</strong></h1>
      <p>Producción, socios y cada movimiento de la mina protegidos en un solo lugar.</p>
      <div className="vault-security"><ShieldCheck/><span>Sesión cifrada en este dispositivo</span></div>
    </section>

    <section className="safe-stage" aria-live="polite">
      <div className="safe-frame">
        <div className="safe-bolts" aria-hidden="true">{[0,1,2,3].map(i=><i key={i}/>)}</div>
        <div className="safe-door">
          <div className="safe-wheel" aria-hidden="true"><i/><i/><i/><span><LockKeyhole/></span></div>
          <div className="safe-content">
            {activated ? <>
              <div className="safe-title"><Fingerprint/><div><span>ACCESO SEGURO</span><h2>Introduce tu PIN</h2></div></div>
              <div className={`pin-display ${error ? 'has-error' : ''}`} key={attempt}>
                {[0,1,2,3].map(index=><span className={pin.length > index ? 'filled' : ''} key={index}>{pin.length > index ? '●' : ''}</span>)}
              </div>
              <div className="pin-keypad">{digits.map((digit,index)=>digit ? <button type="button" key={`${digit}-${index}`} aria-label={digit==='delete'?'Borrar':`Número ${digit}`} onClick={()=>press(digit)}>{digit==='delete'?<Delete/>:digit}</button>:<i key={index}/>)}</div>
              <p className="pin-status">{opening ? 'Bóveda desbloqueada · Abriendo…' : busy ? 'Verificando acceso…' : error || 'El acceso se abrirá al completar los 4 dígitos.'}</p>
            </> : <form className="pin-activation" onSubmit={activate}>
              <div className="safe-title"><KeyRound/><div><span>ACTIVACIÓN ÚNICA</span><h2>Protege este dispositivo</h2></div></div>
              <p>Por seguridad, confirma una sola vez tu contraseña actual. Después entrarás únicamente con el PIN <b>0908</b>.</p>
              <label>Contraseña actual<input ref={passwordRef} type="password" autoComplete="current-password" required placeholder="Contraseña de tu cuenta"/></label>
              {error&&<p className="alert error" role="alert">{error}</p>}
              <button className="primary" disabled={busy}>{busy?'Protegiendo…':'Activar acceso con PIN'}<ShieldCheck/></button>
              <small>La contraseña no se guarda. La sesión queda cifrada localmente con el PIN.</small>
            </form>}
          </div>
        </div>
        <div className="safe-unlocked" aria-hidden={!opening}><ShieldCheck/><strong>ACCESO CONCEDIDO</strong><span>Bienvenido, Omar</span></div>
      </div>
    </section>
  </main>
}
