export async function api<T=any>(url:string, options:RequestInit={}) {
  const isForm=options.body instanceof FormData
  const response=await fetch(`/api${url}`,{...options,credentials:'include',headers:{...(isForm?{}:{'Content-Type':'application/json'}),...(options.headers||{})}})
  if(!response.ok){const body=await response.json().catch(()=>({error:'Error de conexión'}));throw new Error(body.error||'No se pudo completar la operación')}
  return response.json() as Promise<T>
}

export const soles=(cents:number)=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format((cents||0)/100)
export const number=(value:number)=>new Intl.NumberFormat('es-PE',{maximumFractionDigits:2}).format(value||0)
export const today=()=>new Date().toISOString().slice(0,10)
export const timeNow=()=>new Date().toTimeString().slice(0,5)
