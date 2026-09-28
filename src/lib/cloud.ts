export const OWNER_EMAIL = 'madfaygoo@gmail.com'
type Config = { url: string; key: string }
type Session = { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email: string } }
let session: Session | null = null
let generation = 0
let refreshing: Promise<void> | null = null
let configPromise: Promise<Config> | null = null

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
  return request('/rest/v1/rpc/save_mine_workspace', { method: 'POST', body: JSON.stringify({ data: payload, expected_revision: revision }) }, await token())
}
