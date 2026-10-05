export const OWNER_EMAIL = 'madfaygoo@gmail.com'
export const WORKSPACE_UPDATED_EVENT = 'mine:workspace-updated'
export const DASHBOARD_PIN = '0908'
const PIN_VAULT_KEY = 'mina-omar-pin-vault-v1'
type Config = { url: string; key: string }
type Session = { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string } }
let session: Session | null = null
let generation = 0
let refreshing: Promise<void> | null = null
let configPromise: Promise<Config> | null = null

type PinVault = { salt: string; iv: string; payload: string }
const bytesToBase64 = (value: Uint8Array) => btoa(String.fromCharCode(...value))
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))
async function pinKey(pin: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
async function savePinVault(pin: string) {
  if (!session) throw new Error('No hay una sesión para proteger.')
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pinKey(pin, salt), new TextEncoder().encode(JSON.stringify(session)))
  const vault: PinVault = { salt: bytesToBase64(salt), iv: bytesToBase64(iv), payload: bytesToBase64(new Uint8Array(encrypted)) }
  localStorage.setItem(PIN_VAULT_KEY, JSON.stringify(vault))
}

async function config() {
  if (!configPromise) configPromise = fetch(new URL('cloud-config.json', document.baseURI)).then(async r => {
    if (!r.ok) throw new Error('La conexión segura todavía no está configurada.')
    const c = await r.json()
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(c.url) || typeof c.key !== 'string' || !c.key) throw new Error('La conexión segura todavía no está configurada.')
    return c as Config
  }).catch(e => { configPromise = null; throw e })
  return configPromise
}
async function request(path: string, init: RequestInit = {}, token?: string) {
  const c = await config()
  const r = await fetch(c.url + path, { ...init, headers: { apikey: c.key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(r.status === 409 ? 'Los datos cambiaron en otro dispositivo. Actualiza la pantalla y vuelve a intentar.' : data?.msg || data?.message || data?.error_description || 'No se pudo conectar con los datos.')
  return data
}
function readSession(value: any): Session {
  if (value?.user?.email !== OWNER_EMAIL || !value.user.id || !value.access_token || !value.refresh_token || !Number.isFinite(value.expires_in)) throw new Error('Cuenta no autorizada.')
  return { ...value, expires_at: Date.now() + value.expires_in * 1000 }
}
export async function login(email: string, password: string) {
  if (email.trim().toLowerCase() !== OWNER_EMAIL) throw new Error('Correo o contraseña incorrectos.')
  const attempt = ++generation
  session = null
  const next = readSession(await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: OWNER_EMAIL, password }) }))
  if (attempt !== generation) throw new Error('Inicio de sesión cancelado.')
  session = next
  return owner()
}
export function hasPinAccess() { return typeof localStorage !== 'undefined' && Boolean(localStorage.getItem(PIN_VAULT_KEY)) }
export async function activatePinAccess(password: string, pin: string) {
  if (pin !== DASHBOARD_PIN) throw new Error('El PIN de activación no es correcto.')
  await login(OWNER_EMAIL, password)
  await savePinVault(pin)
  return owner()
}
export async function unlockWithPin(pin: string) {
  if (pin.length !== 4) throw new Error('Introduce los cuatro dígitos.')
  const raw = localStorage.getItem(PIN_VAULT_KEY)
  if (!raw) throw new Error('Este dispositivo todavía no está activado.')
  try {
    const vault = JSON.parse(raw) as PinVault
    const salt = base64ToBytes(vault.salt), iv = base64ToBytes(vault.iv)
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await pinKey(pin, salt), base64ToBytes(vault.payload))
    session = JSON.parse(new TextDecoder().decode(decrypted)) as Session
    readSession({ ...session, expires_in: Math.max(1, (session.expires_at - Date.now()) / 1000) })
    await token()
    await savePinVault(pin)
    return owner()
  } catch {
    session = null
    throw new Error('PIN incorrecto. Inténtalo otra vez.')
  }
}
export function lockSession() { generation++; session = null; refreshing = null }
export function forgetPinAccess() { lockSession(); localStorage.removeItem(PIN_VAULT_KEY) }
export function owner() {
  if (!session) throw new Error('Inicia sesión para continuar.')
  return { id: 1, name: 'Omar Miranda', email: OWNER_EMAIL, role: 'admin' }
}
export async function logout() {
  const old = session
  generation++; session = null; refreshing = null
  if (old) await request('/auth/v1/logout', { method: 'POST' }, old.access_token).catch(() => {})
}
async function token() {
  owner()
  if (session!.expires_at < Date.now() + 30000) {
    if (!refreshing) {
      const prior = session!
      const attempt = generation
      refreshing = request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: prior.refresh_token }) }).then(value => {
        const next = readSession(value)
        if (attempt !== generation || session !== prior) throw new Error('La sesión ha terminado.')
        if (next.user.id !== prior.user.id) throw new Error('Cuenta no autorizada.')
        session = next
        const vault = localStorage.getItem(PIN_VAULT_KEY)
        if (vault) void savePinVault(DASHBOARD_PIN)
      }).catch(error => { if (attempt === generation) session = null; throw error }).finally(() => { if (attempt === generation) refreshing = null })
    }
    await refreshing
  }
  owner()
  return session!.access_token
}
export async function loadCloud() {
  const access = await token()
  const rows = await request('/rest/v1/mine_workspace?owner_id=eq.' + session!.user.id + '&select=payload,revision', {}, access)
  if (!Array.isArray(rows)) throw new Error('Respuesta de datos inválida.')
  return rows[0] || { payload: null, revision: 0 }
}
export async function saveCloud(payload: unknown, revision: number) {
  const result=await request('/rest/v1/rpc/save_mine_workspace', { method: 'POST', body: JSON.stringify({ data: payload, expected_revision: revision }) }, await token())
  if(typeof window!=='undefined')window.dispatchEvent(new Event(WORKSPACE_UPDATED_EVENT))
  return result
}

export type PartnerAccess = { labor_id: number; share_token: string; enabled: boolean; updated_at: string }
export type PartnerWorkspace = { labor: Record<string, any>; production: Record<string, any>[]; expenses: Record<string, any>[] }

export async function listPartnerAccess(): Promise<PartnerAccess[]> {
  const rows = await request('/rest/v1/rpc/list_partner_portals', { method: 'POST', body: '{}' }, await token())
  return Array.isArray(rows) ? rows : []
}

export async function setPartnerAccess(laborId: number, password: string): Promise<PartnerAccess> {
  const rows = await request('/rest/v1/rpc/set_partner_portal', { method: 'POST', body: JSON.stringify({ p_labor_id: laborId, p_password: password }) }, await token())
  const row = Array.isArray(rows) ? rows[0] : rows
  if (!row?.share_token) throw new Error('No se pudo crear el acceso del socio.')
  return row
}

export async function disablePartnerAccess(laborId: number) {
  return request('/rest/v1/rpc/disable_partner_portal', { method: 'POST', body: JSON.stringify({ p_labor_id: laborId }) }, await token())
}

export async function openPartnerPortal(shareToken: string, password: string): Promise<PartnerWorkspace> {
  return request('/rest/v1/rpc/partner_portal_view', { method: 'POST', body: JSON.stringify({ p_token: shareToken, p_password: password }) })
}

export async function partnerAddProduction(shareToken: string, password: string, input: { date: string; sacks: number; note?: string }) {
  return request('/rest/v1/rpc/partner_portal_add_production', { method: 'POST', body: JSON.stringify({ p_token: shareToken, p_password: password, p_date: input.date, p_sacks: input.sacks, p_note: input.note || '' }) })
}

export async function partnerAddExpense(shareToken: string, password: string, input: { name: string; amountCents: number; date: string; time: string; category: string; paymentMethod: string; description?: string; observation?: string }) {
  return request('/rest/v1/rpc/partner_portal_add_expense', { method: 'POST', body: JSON.stringify({ p_token: shareToken, p_password: password, p_name: input.name, p_amount_cents: input.amountCents, p_date: input.date, p_time: input.time, p_category: input.category, p_payment_method: input.paymentMethod, p_description: input.description || '', p_observation: input.observation || '' }) })
}
