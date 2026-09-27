type Row=Record<string,any>
type LocalDb={version:number;users:Row[];labors:Row[];production:Row[];expenses:Row[];recoveries:Row[];liquidations:Row[];sales:Row[];audit:Row[]}

const DB_KEY='mina-omar-miranda-db-v1'
const SESSION_KEY='mina-omar-miranda-session'
const emptyDb=():LocalDb=>({version:1,users:[],labors:[],production:[],expenses:[],recoveries:[],liquidations:[],sales:[],audit:[]})
const readDb=():LocalDb=>{try{return {...emptyDb(),...JSON.parse(localStorage.getItem(DB_KEY)||'{}')}}catch{return emptyDb()}}
const writeDb=(db:LocalDb)=>localStorage.setItem(DB_KEY,JSON.stringify(db))
const nextId=(rows:Row[])=>Math.max(0,...rows.map(x=>Number(x.id)||0))+1
const now=()=>new Date().toISOString().replace('T',' ').slice(0,19)
const currentUser=(db:LocalDb)=>db.users.find(x=>x.id===Number(sessionStorage.getItem(SESSION_KEY)))
const requireUser=(db:LocalDb)=>{const user=currentUser(db);if(!user)throw new Error('Inicia sesión para continuar.');return user}
const addAudit=(db:LocalDb,user:Row|undefined,action:string,entity:string,entityId?:number,details?:unknown)=>db.audit.unshift({id:nextId(db.audit),user_id:user?.id,user_name:user?.name||'Sistema',action,entity,entity_id:entityId||null,details:details?JSON.stringify(details):null,created_at:now()})
const laborFor=(db:LocalDb,id:number)=>db.labors.find(x=>x.id===id)
const withLabor=(db:LocalDb,row:Row):Row=>({...row,labor_name:laborFor(db,Number(row.labor_id))?.name||'Labor eliminada'})
const money=(value:unknown)=>Math.round(Number(value||0)*100)

async function hash(value:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('')}
async function values(options:RequestInit){
  if(options.body instanceof FormData){const data:Row={};for(const [key,value] of options.body.entries())data[key]=value;return data}
  if(typeof options.body==='string')return JSON.parse(options.body||'{}')
  return {}
}
async function receipt(data:Row){
  const file=data.receipt;delete data.receipt
  if(!(file instanceof File)||!file.size)return null
  if(file.size>1024*1024)throw new Error('En la versión gratuita el comprobante debe pesar como máximo 1 MB.')
  return await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('No se pudo leer el comprobante.'));reader.readAsDataURL(file)})
}
const list=(db:LocalDb,key:keyof Pick<LocalDb,'production'|'expenses'|'recoveries'|'liquidations'|'sales'>,laborId:number)=>db[key].filter(x=>!x.deleted_at&&(!laborId||Number(x.labor_id)===laborId)).map(x=>withLabor(db,x))

export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
  const db=readDb();const method=(options.method||'GET').toUpperCase();const url=new URL(path,'https://local.invalid');const route=url.pathname;const input=await values(options)
  if(route==='/status')return {initialized:db.users.length>0} as T
  if(route==='/auth/bootstrap'&&method==='POST'){
    if(db.users.length)throw new Error('La cuenta principal ya fue creada en este dispositivo.')
    if(String(input.password||'').length<10)throw new Error('La contraseña debe tener al menos 10 caracteres.')
    const user={id:1,name:String(input.name),email:String(input.email).toLowerCase(),password_hash:await hash(String(input.password)),role:'admin',active:1,created_at:now()};db.users.push(user);sessionStorage.setItem(SESSION_KEY,'1');addAudit(db,user,'CREATE','User',1);writeDb(db);return {id:1} as T
  }
  if(route==='/auth/login'&&method==='POST'){
    const user=db.users.find(x=>x.email===String(input.email).toLowerCase()&&x.active!==0)
    if(!user||user.password_hash!==await hash(String(input.password)))throw new Error('Correo o contraseña incorrectos.')
    sessionStorage.setItem(SESSION_KEY,String(user.id));addAudit(db,user,'LOGIN','Session');writeDb(db);return {ok:true} as T
  }
  if(route==='/auth/me'){const user=requireUser(db);return {id:user.id,name:user.name,email:user.email,role:user.role} as T}
  if(route==='/auth/logout'&&method==='POST'){const user=currentUser(db);if(user)addAudit(db,user,'LOGOUT','Session');sessionStorage.removeItem(SESSION_KEY);writeDb(db);return {ok:true} as T}
  const user=requireUser(db)
  if(route==='/users'&&method==='GET')return db.users.map(({password_hash,...x})=>x) as T
  if(route==='/users'&&method==='POST'){
    if(user.role!=='admin')throw new Error('Solo el administrador puede crear usuarios.')
    if(db.users.some(x=>x.email===String(input.email).toLowerCase()))throw new Error('Ese correo ya está registrado en este dispositivo.')
    const id=nextId(db.users);const created={id,name:String(input.name),email:String(input.email).toLowerCase(),password_hash:await hash(String(input.password)),role:String(input.role||'operator'),active:1,created_at:now()};db.users.push(created);addAudit(db,user,'CREATE','User',id);writeDb(db);return {id} as T
  }
  if(route==='/labors'&&method==='GET'){
    const month=new Date().toISOString().slice(0,7)
    return db.labors.map(l=>({...l,production_total:db.production.filter(x=>!x.deleted_at&&x.labor_id===l.id).reduce((a,x)=>a+Number(x.sacks),0),production_month:db.production.filter(x=>!x.deleted_at&&x.labor_id===l.id&&String(x.date).startsWith(month)).reduce((a,x)=>a+Number(x.sacks),0),expenses_cents:db.expenses.filter(x=>!x.deleted_at&&x.labor_id===l.id).reduce((a,x)=>a+Number(x.amount_cents),0),last_activity:l.updated_at||l.created_at})) as T
  }
  if(route==='/labors'&&method==='POST'){
    if(Number(input.minePercent)+Number(input.partnerPercent)!==100)throw new Error('Los porcentajes Mina y Socio deben sumar 100%.')
    const id=nextId(db.labors);const created={id,name:String(input.name),partner_name:String(input.partnerName),code:String(input.code||''),level:String(input.level||''),location:String(input.location||''),description:String(input.description||''),status:String(input.status||'active'),mine_percent:Number(input.minePercent),partner_percent:Number(input.partnerPercent),created_at:now()};db.labors.push(created);addAudit(db,user,'CREATE','Labor',id,input);writeDb(db);return {id} as T
  }
  const laborId=Number(url.searchParams.get('laborId')||0)
  if(route==='/production'&&method==='GET')return list(db,'production',laborId).sort((a,b)=>String(b.date).localeCompare(String(a.date))) as T
  if(route==='/production'&&method==='POST'){
    const labor=laborFor(db,Number(input.laborId));if(!labor)throw new Error('Selecciona una labor válida.');const sacks=Number(input.sacks);const id=nextId(db.production);db.production.push({id,labor_id:labor.id,date:String(input.date),sacks,mine_percent:labor.mine_percent,partner_percent:labor.partner_percent,mine_sacks:sacks*labor.mine_percent/100,partner_sacks:sacks*labor.partner_percent/100,note:String(input.note||''),created_by:user.id,created_at:now()});addAudit(db,user,'CREATE','ProductionRecord',id,input);writeDb(db);return {id} as T
  }
  if(route==='/expenses'&&method==='GET')return list(db,'expenses',laborId).map((x):Row=>({...x,amount:Number(x.amount_cents)/100,partner_share:Number(x.amount_cents)*Number(x.partner_percent)/10000,user_name:db.users.find(u=>u.id===x.created_by)?.name||'Usuario'})).sort((a,b)=>`${b.expense_date} ${b.expense_time}`.localeCompare(`${a.expense_date} ${a.expense_time}`)) as T
  if(route==='/expenses'&&method==='POST'){
    const labor=laborFor(db,Number(input.laborId));if(!labor)throw new Error('Selecciona una labor válida.');const id=nextId(db.expenses);db.expenses.push({id,labor_id:labor.id,name:String(input.name),amount_cents:money(input.amount),description:String(input.description||''),expense_date:String(input.expenseDate),expense_time:String(input.expenseTime),category:String(input.category),payment_method:String(input.paymentMethod),observation:String(input.observation||''),partner_percent:labor.partner_percent,receipt_data_url:await receipt(input),created_by:user.id,created_at:now()});addAudit(db,user,'CREATE','Expense',id,{name:input.name,amount:input.amount});writeDb(db);return {id} as T
  }
  if(route==='/recoveries'&&method==='GET')return list(db,'recoveries',laborId).map((x):Row=>({...x,amount:Number(x.amount_cents)/100,user_name:db.users.find(u=>u.id===x.created_by)?.name||'Usuario'})).sort((a,b)=>`${b.recovery_date} ${b.recovery_time}`.localeCompare(`${a.recovery_date} ${a.recovery_time}`)) as T
  if(route==='/recoveries'&&method==='POST'){
    const labor=laborFor(db,Number(input.laborId));if(!labor)throw new Error('Selecciona una labor válida.');const id=nextId(db.recoveries);db.recoveries.push({id,labor_id:labor.id,recovery_date:String(input.date),recovery_time:String(input.time),amount_cents:money(input.amount),payment_method:String(input.paymentMethod),observation:String(input.observation||''),receipt_data_url:await receipt(input),created_by:user.id,created_at:now()});addAudit(db,user,'CREATE','ExpenseRecovery',id,{amount:input.amount});writeDb(db);return {id} as T
  }
  if(route==='/liquidations'&&method==='GET')return list(db,'liquidations',laborId).map((x):Row=>{const pending=Math.max(0,Number(x.partner_expense_cents)-Number(x.paid_cents));return {...x,expenses:Number(x.expenses_cents)/100,partner_expense:Number(x.partner_expense_cents)/100,paid:Number(x.paid_cents)/100,pending:pending/100,status:Number(x.paid_cents)>=Number(x.partner_expense_cents)?'Pagado':Number(x.paid_cents)>0?'Parcial':'Pendiente'}}).sort((a,b)=>String(b.liquidation_date).localeCompare(String(a.liquidation_date))) as T
  if(route==='/liquidations'&&method==='POST'){
    const labor=laborFor(db,Number(input.laborId));if(!labor)throw new Error('Selecciona una labor válida.');const sacks=Number(input.sacks);const expenses=db.expenses.filter(x=>!x.deleted_at&&x.labor_id===labor.id).reduce((a,x)=>a+Number(x.amount_cents),0);const id=nextId(db.liquidations);db.liquidations.push({id,labor_id:labor.id,liquidation_date:String(input.date),sacks,mine_percent:labor.mine_percent,partner_percent:labor.partner_percent,mine_sacks:sacks*labor.mine_percent/100,partner_sacks:sacks*labor.partner_percent/100,expenses_cents:expenses,partner_expense_cents:Math.round(expenses*labor.partner_percent/100),paid_cents:money(input.paid),observation:String(input.observation||''),receipt_data_url:await receipt(input),created_by:user.id,created_at:now()});addAudit(db,user,'CREATE','Liquidation',id);writeDb(db);return {id} as T
  }
  if(route==='/sales'&&method==='GET')return list(db,'sales',laborId).map((x):Row=>({...x,price:Number(x.price_cents)/100,total:Number(x.total_cents)/100})).sort((a,b)=>`${b.sale_date} ${b.sale_time}`.localeCompare(`${a.sale_date} ${a.sale_time}`)) as T
  if(route==='/sales'&&method==='POST'){
    const labor=laborFor(db,Number(input.laborId));if(!labor)throw new Error('Selecciona una labor válida.');const id=nextId(db.sales);const price=money(input.price);const sacks=Number(input.sacks);db.sales.push({id,labor_id:labor.id,sale_date:String(input.date),sale_time:String(input.time),sacks,price_cents:price,total_cents:Math.round(sacks*price),buyer:String(input.buyer),observation:String(input.observation||''),receipt_data_url:await receipt(input),created_by:user.id,created_at:now()});addAudit(db,user,'CREATE','Sale',id);writeDb(db);return {id} as T
  }
  const deleteMatch=route.match(/^\/(production|expenses)\/(\d+)$/)
  if(deleteMatch&&method==='DELETE'){
    const rows=db[deleteMatch[1] as 'production'|'expenses'];const row=rows.find(x=>x.id===Number(deleteMatch[2]));if(row)row.deleted_at=now();addAudit(db,user,'DELETE',deleteMatch[1],Number(deleteMatch[2]));writeDb(db);return {ok:true} as T
  }
  if(route==='/audit')return db.audit.slice(0,500) as T
  if(route==='/pois')return [] as T
  if(route==='/dashboard'){
    const date=new Date().toISOString().slice(0,10);const month=date.slice(0,7);const activeLabors=db.labors.filter(x=>x.status==='active');const prod=db.production.filter(x=>!x.deleted_at);const exp=db.expenses.filter(x=>!x.deleted_at);const sales=db.sales;const pending=db.liquidations.reduce((a,x)=>a+Math.max(0,Number(x.partner_expense_cents)-Number(x.paid_cents)),0)-db.recoveries.reduce((a,x)=>a+Number(x.amount_cents),0)
    const dailyMap=new Map<string,number>();prod.slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-30).forEach(x=>dailyMap.set(x.date,(dailyMap.get(x.date)||0)+Number(x.sacks)))
    const categories=new Map<string,number>();exp.forEach(x=>categories.set(x.category,(categories.get(x.category)||0)+Number(x.amount_cents)/100))
    return {cards:{todaySacks:prod.filter(x=>x.date===date).reduce((a,x)=>a+Number(x.sacks),0),monthSacks:prod.filter(x=>String(x.date).startsWith(month)).reduce((a,x)=>a+Number(x.sacks),0),activeLabors:activeLabors.length,monthExpensesCents:exp.filter(x=>String(x.expense_date).startsWith(month)).reduce((a,x)=>a+Number(x.amount_cents),0),pendingCents:Math.max(0,pending),monthSalesCents:sales.filter(x=>String(x.sale_date).startsWith(month)).reduce((a,x)=>a+Number(x.total_cents),0)},daily:Array.from(dailyMap,([label,value])=>({label:label.slice(5),value})),byLabor:activeLabors.map(l=>({label:l.name,value:prod.filter(x=>x.labor_id===l.id).reduce((a,x)=>a+Number(x.sacks),0)})),expensesByLabor:activeLabors.map(l=>({label:l.name,value:exp.filter(x=>x.labor_id===l.id).reduce((a,x)=>a+Number(x.amount_cents)/100,0)})),categories:Array.from(categories,([label,value])=>({label,value})).sort((a,b)=>b.value-a.value),activity:db.audit.slice(0,8)} as T
  }
  throw new Error(`Función local no disponible: ${method} ${route}`)
}

export const soles=(cents:number)=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format((cents||0)/100)
export const number=(value:number)=>new Intl.NumberFormat('es-PE',{maximumFractionDigits:2}).format(value||0)
export const today=()=>new Date().toISOString().slice(0,10)
export const timeNow=()=>new Date().toTimeString().slice(0,5)
