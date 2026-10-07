import { login, logout, lockSession, owner, loadCloud, saveCloud } from './cloud'
import { readAttachment } from './media'
import { validateBackup, validDate, validTime, requiredText, validMedia, validAttachments } from './validation'
type Row=Record<string,any>
type LocalDb={version:number;users:Row[];labors:Row[];production:Row[];expenses:Row[];recoveries:Row[];liquidations:Row[];sales:Row[];audit:Row[];debts:Row[];withdrawals:Row[];shipments:Row[];whatsappContacts:Row[];fieldReports:Row[]}

const emptyDb=():LocalDb=>({version:5,users:[],labors:[],production:[],expenses:[],recoveries:[],liquidations:[],sales:[],audit:[],debts:[],withdrawals:[],shipments:[],whatsappContacts:[],fieldReports:[]})
const nextId=(rows:Row[])=>Math.max(0,...rows.map(x=>Number(x.id)||0))+1
const now=()=>new Date().toISOString().replace('T',' ').slice(0,19)
const addAudit=(db:LocalDb,user:Row|undefined,action:string,entity:string,entityId?:number,details?:unknown)=>db.audit.unshift({id:nextId(db.audit),user_id:user?.id,user_name:user?.name||'Sistema',action,entity,entity_id:entityId||null,details:details?JSON.stringify(details):null,created_at:now()})
const laborFor=(db:LocalDb,id:number)=>db.labors.find(x=>x.id===id)
const withLabor=(db:LocalDb,row:Row):Row=>({...row,labor_name:laborFor(db,Number(row.labor_id))?.name||'Labor eliminada'})
const money=(value:unknown)=>Math.round(Number(value||0)*100)
const currentProductionFor=(db:LocalDb,laborId:number)=>{const labor=laborFor(db,laborId),cutoff=Number(labor?.production_cutoff_id||0);return db.production.filter(x=>!x.deleted_at&&Number(x.labor_id)===laborId&&Number(x.id)>cutoff)}
const currentSalesFor=(db:LocalDb,laborId:number)=>{const labor=laborFor(db,laborId),cutoff=Number(labor?.sale_cutoff_id||0);return db.sales.filter(x=>Number(x.labor_id)===laborId&&Number(x.id)>cutoff)}

async function values(options:RequestInit){
  if(options.body instanceof FormData){const data:Row={};for(const [key,value] of options.body.entries())data[key]=value;return data}
  if(typeof options.body==='string')return JSON.parse(options.body||'{}')
  return {}
}
async function receipt(data:Row){
  const file=data.receipt;delete data.receipt
  if(!(file instanceof File)||!file.size)return null
  return readAttachment(file)
}
const list=(db:LocalDb,key:keyof Pick<LocalDb,'production'|'expenses'|'recoveries'|'liquidations'|'sales'>,laborId:number)=>db[key].filter(x=>!x.deleted_at&&(!laborId||Number(x.labor_id)===laborId)).map(x=>withLabor(db,x))

export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
  const method=(options.method||'GET').toUpperCase();const url=new URL(path,'https://local.invalid');const route=url.pathname;const input=await values(options)
  if(route==='/auth/login'&&method==='POST')return await login(String(input.email),String(input.password)) as T
  if(route==='/auth/me')return owner() as T
  if(route==='/auth/logout'){await logout();return {ok:true} as T}
  if(route==='/auth/lock'){lockSession();return {ok:true} as T}
  const user=owner()
  const snapshot=await loadCloud()
  const db:LocalDb={...emptyDb(),...(snapshot.payload||{}),users:[user]}
  const writeDb=async(data:LocalDb)=>saveCloud({...data,users:[]},snapshot.revision)
  if(route==='/backup'&&method==='GET')return {...db,users:[]} as T
  if(route==='/backup'&&method==='POST'){
    const restored={...emptyDb(),...validateBackup(input),users:[]};await writeDb(restored);return {ok:true} as T
  }
  if(route==='/sync'&&method==='POST'){
    await writeDb(db);return {ok:true} as T
  }
  if(route.match(/^\/labors\/\d+$/)&&method==='PUT'){
    const labor=laborFor(db,Number(route.split('/')[2]));if(!labor)throw new Error('Labor no encontrada.')
    labor.partner_photo=validMedia(input.partner_photo,true);labor.updated_at=now();addAudit(db,user,'UPDATE','Partner',labor.id);await writeDb(db);return {ok:true} as T
  }
  if(route==='/debts'&&method==='GET')return db.debts.map(debtSummary) as T
  if(route==='/debts'&&method==='POST'||route.match(/^\/debts\/\d+$/)&&method==='PUT'){
    const id=method==='POST'?nextId(db.debts):Number(route.split('/')[2]);const previous=db.debts.find(x=>x.id===id)
    if(method==='PUT'&&!previous)throw new Error('Préstamo no encontrado.');
    const amount=money(input.amount);if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('Introduce un monto positivo.')
    const paid=(previous?.payments||[]).reduce((sum:number,x:Row)=>sum+x.amount_cents,0)
    if(amount<paid)throw new Error('El préstamo no puede ser menor a los abonos registrados.')
    if(previous?.payments?.length&&previous.currency!==input.currency)throw new Error('No se puede cambiar la moneda de un préstamo con abonos.')
    const row={id,name:requiredText(input.name,'el nombre'),photo:validMedia(input.photo,true),date:validDate(input.date),due_date:validDate(input.due_date,true),amount_cents:amount,currency:input.currency==='USD'?'USD':'PEN',note:String(input.note||''),attachments:validAttachments(input.attachments||[]),payments:previous?.payments||[],created_at:previous?.created_at||now()}
    if(!row.name)throw new Error('Introduce el nombre de la persona.')
    if(previous)Object.assign(previous,row);else db.debts.push(row)
    addAudit(db,user,previous?'UPDATE':'CREATE','Debt',id);await writeDb(db);return {id} as T
  }
  if(route.match(/^\/debts\/\d+\/payments$/)&&method==='POST'){
    const debt=db.debts.find(x=>x.id===Number(route.split('/')[2]));if(!debt)throw new Error('Préstamo no encontrado.')
    const amount=money(input.amount);if(!Number.isSafeInteger(amount)||amount<=0||amount>debtSummary(debt).pending_cents)throw new Error('El abono debe ser positivo y no superar el saldo.')
    debt.payments.push({id:nextId(debt.payments),date:validDate(input.date),amount_cents:amount,note:String(input.note||''),receipt_data_url:await receipt(input)})
    addAudit(db,user,'CREATE','DebtPayment',debt.id,{amount});await writeDb(db);return {ok:true} as T
  }
  if(route==='/labors'&&method==='GET'){
    const month=today().slice(0,7)
    return db.labors.map(l=>{const current=currentProductionFor(db,l.id),produced=current.reduce((a,x)=>a+Number(x.sacks),0),historical=db.production.filter(x=>!x.deleted_at&&x.labor_id===l.id).reduce((a,x)=>a+Number(x.sacks),0),sold=currentSalesFor(db,l.id).reduce((a,x)=>a+Number(x.sold_sacks||0),0);return {...l,ownership_type:l.ownership_type||(Number(l.partner_percent)===0?'own':'partner'),production_total:produced,historical_production_total:historical,sold_sacks:sold,available_sacks:Math.max(0,produced-sold),production_month:current.filter(x=>String(x.date).startsWith(month)).reduce((a,x)=>a+Number(x.sacks),0),expenses_cents:db.expenses.filter(x=>!x.deleted_at&&x.labor_id===l.id).reduce((a,x)=>a+Number(x.amount_cents),0),last_activity:l.updated_at||l.created_at}}) as T
  }
  if(route==='/labors'&&method==='POST'){
    const ownershipType=input.ownershipType==='own'?'own':'partner';const minePercent=ownershipType==='own'?100:Number(input.minePercent),partnerPercent=ownershipType==='own'?0:Number(input.partnerPercent);if(!Number.isInteger(minePercent)||!Number.isInteger(partnerPercent)||minePercent<0||partnerPercent<0||minePercent+partnerPercent!==100||(ownershipType==='partner'&&(minePercent===0||partnerPercent===0)))throw new Error('Los porcentajes Mina y Socio deben ser enteros, positivos y sumar 100%.')
    const id=nextId(db.labors);const created={id,name:requiredText(input.name,'el nombre de la labor'),ownership_type:ownershipType,partner_name:ownershipType==='own'?'Omar Miranda':requiredText(input.partnerName,'el socio'),partner_photo:ownershipType==='own'?'':validMedia(input.partner_photo,true),code:String(input.code||''),level:String(input.level||''),location:String(input.location||''),description:String(input.description||''),status:input.status==='inactive'?'inactive':'active',mine_percent:minePercent,partner_percent:partnerPercent,created_at:now()};db.labors.push(created);addAudit(db,user,'CREATE','Labor',id,{ownershipType,minePercent,partnerPercent});await writeDb(db);return {id} as T
  }
  const laborId=Number(url.searchParams.get('laborId')||0)
  if(route==='/production'&&method==='GET')return list(db,'production',laborId).sort((a,b)=>String(b.date).localeCompare(String(a.date))) as T
  if(route==='/production'&&method==='POST'){
    const labor=laborFor(db,Number(input.laborId));if(!labor)throw new Error('Selecciona una labor válida.');const sacks=Number(input.sacks);if(!Number.isFinite(sacks)||sacks<=0)throw new Error('Introduce una cantidad de sacos positiva.');const id=nextId(db.production);db.production.push({id,labor_id:labor.id,date:validDate(input.date),sacks,mine_percent:labor.mine_percent,partner_percent:labor.partner_percent,mine_sacks:sacks*labor.mine_percent/100,partner_sacks:sacks*labor.partner_percent/100,note:String(input.note||''),created_by:user.id,created_at:now()});addAudit(db,user,'CREATE','ProductionRecord',id,input);await writeDb(db);return {id} as T
  }
  if(route==='/expenses'&&method==='GET')return list(db,'expenses',laborId).map((x):Row=>({...x,amount:Number(x.amount_cents)/100,partner_share:Number(x.amount_cents)*Number(x.partner_percent)/10000,user_name:db.users.find(u=>u.id===x.created_by)?.name||'Usuario'})).sort((a,b)=>`${b.expense_date} ${b.expense_time}`.localeCompare(`${a.expense_date} ${a.expense_time}`)) as T
  if(route==='/expenses'&&method==='POST'){
    const labor=laborFor(db,Number(input.laborId));if(!labor)throw new Error('Selecciona una labor válida.');const amount=money(input.amount);if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('Introduce un monto positivo.');const id=nextId(db.expenses);db.expenses.push({id,labor_id:labor.id,name:requiredText(input.name,'el nombre del gasto'),amount_cents:amount,description:String(input.description||''),expense_date:validDate(input.expenseDate),expense_time:validTime(input.expenseTime),category:String(input.category),payment_method:String(input.paymentMethod),observation:String(input.observation||''),partner_percent:labor.partner_percent,receipt_data_url:await receipt(input),created_by:user.id,created_at:now()});addAudit(db,user,'CREATE','Expense',id,{name:input.name,amount:input.amount});await writeDb(db);return {id} as T
  }
  if(route==='/recoveries'&&method==='GET')return list(db,'recoveries',laborId).map((x):Row=>({...x,amount:Number(x.amount_cents)/100,user_name:db.users.find(u=>u.id===x.created_by)?.name||'Usuario'})).sort((a,b)=>`${b.recovery_date} ${b.recovery_time}`.localeCompare(`${a.recovery_date} ${a.recovery_time}`)) as T
  if(route==='/recoveries'&&method==='POST'){
    const labor=laborFor(db,Number(input.laborId));if(!labor)throw new Error('Selecciona una labor válida.');const id=nextId(db.recoveries);db.recoveries.push({id,labor_id:labor.id,recovery_date:validDate(input.date),recovery_time:String(input.time),amount_cents:money(input.amount),payment_method:String(input.paymentMethod),observation:String(input.observation||''),receipt_data_url:await receipt(input),created_by:user.id,created_at:now()});addAudit(db,user,'CREATE','ExpenseRecovery',id,{amount:input.amount});await writeDb(db);return {id} as T
  }
  if(route==='/liquidations'&&method==='GET')return list(db,'liquidations',laborId).map((x):Row=>{const pending=Math.max(0,Number(x.partner_expense_cents)-Number(x.paid_cents));return {...x,expenses:Number(x.expenses_cents)/100,partner_expense:Number(x.partner_expense_cents)/100,paid:Number(x.paid_cents)/100,pending:pending/100,status:Number(x.paid_cents)>=Number(x.partner_expense_cents)?'Pagado':Number(x.paid_cents)>0?'Parcial':'Pendiente'}}).sort((a,b)=>String(b.liquidation_date).localeCompare(String(a.liquidation_date))) as T
  if(route==='/liquidations'&&method==='POST'){
    const labor=laborFor(db,Number(input.laborId));if(!labor)throw new Error('Selecciona una labor válida.');const sacks=Number(input.sacks);const expenses=db.expenses.filter(x=>!x.deleted_at&&x.labor_id===labor.id).reduce((a,x)=>a+Number(x.amount_cents),0);const id=nextId(db.liquidations);db.liquidations.push({id,labor_id:labor.id,liquidation_date:validDate(input.date),sacks,mine_percent:labor.mine_percent,partner_percent:labor.partner_percent,mine_sacks:sacks*labor.mine_percent/100,partner_sacks:sacks*labor.partner_percent/100,expenses_cents:expenses,partner_expense_cents:Math.round(expenses*labor.partner_percent/100),paid_cents:money(input.paid),observation:String(input.observation||''),receipt_data_url:await receipt(input),created_by:user.id,created_at:now()});addAudit(db,user,'CREATE','Liquidation',id);await writeDb(db);return {id} as T
  }
  if(route==='/sales'&&method==='GET')return list(db,'sales',laborId).map((x):Row=>({...x,price:x.price_cents==null?null:Number(x.price_cents)/100,total:Number(x.total_cents)/100})).sort((a,b)=>`${b.sale_date} ${b.sale_time}`.localeCompare(`${a.sale_date} ${a.sale_time}`)) as T
  if(route==='/shipments'&&method==='GET')return db.shipments.slice().sort((a,b)=>`${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)) as T
  if(route==='/shipments'&&method==='POST'){
    const productionCutoff=nextId(db.production)-1,saleCutoff=nextId(db.sales)-1
    const summary=db.labors.map(l=>{const production=currentProductionFor(db,l.id),sales=currentSalesFor(db,l.id),produced=production.reduce((sum,x)=>sum+Number(x.sacks||0),0),mine=production.reduce((sum,x)=>sum+(Number.isFinite(Number(x.mine_sacks))?Number(x.mine_sacks):Number(x.sacks||0)*Number(l.mine_percent||0)/100),0),partner=production.reduce((sum,x)=>sum+(Number.isFinite(Number(x.partner_sacks))?Number(x.partner_sacks):Number(x.sacks||0)*Number(l.partner_percent||0)/100),0),sold=sales.reduce((sum,x)=>sum+Number(x.sold_sacks||0),0);return {labor_id:l.id,labor_name:l.name,produced_sacks:produced,mine_sacks:mine,partner_sacks:partner,sold_sacks:sold,remaining_sacks:Math.max(0,produced-sold)}}).filter(x=>x.produced_sacks>0||x.sold_sacks>0)
    if(!summary.length)throw new Error('No hay sacos en el lote actual para despachar.')
    const id=nextId(db.shipments),closedSacks=summary.reduce((sum,x)=>sum+x.produced_sacks,0),remainingSacks=summary.reduce((sum,x)=>sum+x.remaining_sacks,0)
    db.shipments.push({id,date:validDate(input.date),time:validTime(input.time),note:String(input.note||''),closed_sacks:closedSacks,remaining_sacks:remainingSacks,production_cutoff_id:productionCutoff,sale_cutoff_id:saleCutoff,summary,created_by:user.id,created_at:now()})
    db.labors.forEach(l=>{l.production_cutoff_id=productionCutoff;l.sale_cutoff_id=saleCutoff;l.cycle_started_at=now();l.updated_at=now()})
    addAudit(db,user,'CREATE','Shipment',id,{closedSacks,remainingSacks,labors:summary.length});await writeDb(db);return {id} as T
  }
  if(route==='/whatsapp/contacts'&&method==='GET')return db.whatsappContacts.map(contact=>({...contact,labor_name:laborFor(db,Number(contact.labor_id))?.name||'Labor eliminada'})) as T
  if(route==='/whatsapp/contacts'&&method==='POST'){
    const labor=laborFor(db,Number(input.laborId));if(!labor)throw new Error('Selecciona una labor válida.')
    const phone=String(input.phone||'').replace(/\D/g,'');if(phone.length<9||phone.length>15)throw new Error('Introduce el número con código de país, por ejemplo 51964518509.')
    const previous=db.whatsappContacts.find(x=>Number(x.labor_id)===labor.id),row={id:previous?.id||nextId(db.whatsappContacts),labor_id:labor.id,phone,send_time:validTime(input.sendTime||'18:00'),enabled:input.enabled!==false,updated_at:now()}
    if(previous)Object.assign(previous,row);else db.whatsappContacts.push(row)
    addAudit(db,user,previous?'UPDATE':'CREATE','WhatsAppContact',row.id,{laborId:labor.id});await writeDb(db);return row as T
  }
  if(route==='/whatsapp/reports'&&method==='GET')return db.fieldReports.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).map(row=>({...row,labor_name:laborFor(db,Number(row.labor_id))?.name||'Labor eliminada'})) as T
  if(route==='/whatsapp/reports'&&method==='POST'){
    const labor=laborFor(db,Number(input.laborId));if(!labor)throw new Error('Selecciona una labor válida.')
    const id=nextId(db.fieldReports),row={id,labor_id:labor.id,date:validDate(input.date),status:['worked','no_work','waste_only'].includes(input.status)?input.status:'worked',raw_text:String(input.rawText||'').slice(0,5000),source:'whatsapp_assistant',created_at:now()};db.fieldReports.push(row);addAudit(db,user,'CREATE','FieldReport',id,{laborId:labor.id,status:row.status});await writeDb(db);return row as T
  }
  if(route==='/sales'&&method==='POST'){
    const labor=laborFor(db,Number(input.laborId));if(!labor)throw new Error('Selecciona una labor válida.')
    const weight=Number(input.weight),grade=Number(input.grade),soldSacks=Number(input.soldSacks),total=money(input.received),costs=money(input.costs)
    if(!Number.isFinite(weight)||weight<=0||!Number.isFinite(grade)||grade<0||!Number.isFinite(soldSacks)||soldSacks<=0||!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(costs)||costs<0)throw new Error('Revisa sacos, peso, ley, importe y costos.')
    const produced=currentProductionFor(db,labor.id).reduce((a,x)=>a+Number(x.sacks),0),alreadySold=currentSalesFor(db,labor.id).reduce((a,x)=>a+Number(x.sold_sacks||0),0),available=Math.max(0,produced-alreadySold)
    if(soldSacks>available)throw new Error(`Solo hay ${number(available)} sacos disponibles en esta labor.`)
    const id=nextId(db.sales);db.sales.push({id,labor_id:labor.id,sale_date:validDate(input.date),sale_time:validTime(input.time),sold_sacks:soldSacks,weight,weight_unit:String(input.weight_unit),grade,grade_unit:String(input.grade_unit),currency:input.currency==='USD'?'USD':'PEN',total_cents:total,costs_cents:input.costs==null||input.costs===''?null:costs,profit_cents:input.costs==null||input.costs===''?null:total-costs,buyer:requiredText(input.buyer,'el comprador'),observation:String(input.observation||''),receipt_data_url:await receipt(input),created_by:user.id,created_at:now()});addAudit(db,user,'CREATE','Sale',id,{soldSacks,total});await writeDb(db);return {id} as T
  }
  if(route==='/withdrawals'&&method==='GET')return db.withdrawals.slice().sort((a,b)=>`${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)) as T
  if(route==='/withdrawals'&&method==='POST'){
    const amount=money(input.amount);if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('Introduce un retiro positivo.')
    const penSales=db.sales.filter(x=>!x.currency||x.currency==='PEN').reduce((a,x)=>a+Number(x.total_cents),0),saleCosts=db.sales.filter(x=>!x.currency||x.currency==='PEN').reduce((a,x)=>a+Number(x.costs_cents||0),0),expenses=db.expenses.reduce((a,x)=>a+Number(x.amount_cents||0),0),withdrawn=db.withdrawals.reduce((a,x)=>a+Number(x.amount_cents||0),0),available=penSales-saleCosts-expenses-withdrawn
    if(amount>available)throw new Error(`El retiro supera el saldo disponible de ${soles(Math.max(0,available))}.`)
    const id=nextId(db.withdrawals);db.withdrawals.push({id,date:validDate(input.date),time:validTime(input.time),amount_cents:amount,note:String(input.note||''),created_by:user.id,created_at:now()});addAudit(db,user,'CREATE','Withdrawal',id,{amount});await writeDb(db);return {id} as T
  }
  const deleteMatch=route.match(/^\/(production|expenses)\/(\d+)$/)
  if(deleteMatch&&method==='DELETE'){
    const rows=db[deleteMatch[1] as 'production'|'expenses'];const row=rows.find(x=>x.id===Number(deleteMatch[2]));if(row)row.deleted_at=now();addAudit(db,user,'DELETE',deleteMatch[1],Number(deleteMatch[2]));await writeDb(db);return {ok:true} as T
  }
  if(route==='/audit')return db.audit.slice(0,500) as T
  if(route==='/pois')return [] as T
  if(route==='/dashboard'){
    const date=today();const month=date.slice(0,7);const year=date.slice(0,4);const period=url.searchParams.get('period')||'month';const activeLabors=db.labors.filter(x=>x.status==='active');const historicalProd=db.production.filter(x=>!x.deleted_at);const prod=db.labors.flatMap(l=>currentProductionFor(db,l.id));const exp=db.expenses.filter(x=>!x.deleted_at);const sales=db.sales;const withdrawals=db.withdrawals;const pending=db.debts.filter(x=>x.currency==='PEN').reduce((sum,x)=>sum+debtSummary(x).pending_cents,0)
    const ownLaborIds=new Set(db.labors.filter(x=>x.ownership_type==='own'||Number(x.partner_percent)===0).map(x=>x.id));const ownRecords=prod.filter(x=>ownLaborIds.has(x.labor_id));const partnerRecords=prod.filter(x=>!ownLaborIds.has(x.labor_id));const partnerShare=(rows:Row[])=>rows.reduce((sum,x)=>sum+(Number.isFinite(Number(x.mine_sacks))?Number(x.mine_sacks):Number(x.sacks)*Number(laborFor(db,x.labor_id)?.mine_percent||0)/100),0);const ownSacks=(rows:Row[])=>rows.reduce((sum,x)=>sum+Number(x.sacks||0),0);const partnerAll=partnerShare(partnerRecords),ownAll=ownSacks(ownRecords),partnerMonth=partnerShare(partnerRecords.filter(x=>String(x.date).startsWith(month))),ownMonth=ownSacks(ownRecords.filter(x=>String(x.date).startsWith(month)))
    const dailyMap=new Map<string,number>();prod.slice().sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-30).forEach(x=>dailyMap.set(x.date,(dailyMap.get(x.date)||0)+Number(x.sacks)))
    const progressDates=[...new Set(prod.map(x=>String(x.date)))].sort().slice(-30);const laborTotals:Record<string,number>={};const laborProgress=progressDates.map(progressDate=>{prod.filter(x=>String(x.date)===progressDate).forEach(x=>{const labor=activeLabors.find(l=>l.id===x.labor_id);if(labor)laborTotals[labor.name]=(laborTotals[labor.name]||0)+Number(x.sacks)});return {label:progressDate.slice(5),...laborTotals}})
    const categories=new Map<string,number>();exp.forEach(x=>categories.set(x.category,(categories.get(x.category)||0)+Number(x.amount_cents)/100))
    const penSales=sales.filter(x=>!x.currency||x.currency==='PEN'),gross=penSales.reduce((a,x)=>a+Number(x.total_cents),0),saleCosts=penSales.reduce((a,x)=>a+Number(x.costs_cents||0),0),expenseTotal=exp.reduce((a,x)=>a+Number(x.amount_cents),0),withdrawn=withdrawals.reduce((a,x)=>a+Number(x.amount_cents),0),profit=gross-saleCosts-expenseTotal,balance=profit-withdrawn,soldSacks=db.labors.reduce((sum,l)=>sum+currentSalesFor(db,l.id).reduce((a,x)=>a+Number(x.sold_sacks||0),0),0),availableSacks=Math.max(0,prod.reduce((a,x)=>a+Number(x.sacks),0)-soldSacks)
    const monthGross=penSales.filter(x=>String(x.sale_date).startsWith(month)).reduce((a,x)=>a+Number(x.total_cents),0),monthCosts=penSales.filter(x=>String(x.sale_date).startsWith(month)).reduce((a,x)=>a+Number(x.costs_cents||0),0),monthExpense=exp.filter(x=>String(x.expense_date).startsWith(month)).reduce((a,x)=>a+Number(x.amount_cents),0),monthProfit=monthGross-monthCosts-monthExpense
    const inPeriod=(value:unknown)=>{const key=String(value||'');return period==='today'?key===date:period==='month'?key.startsWith(month):period==='year'?key.startsWith(year):true},cash=new Map<string,{date:string;income:number;expenses:number;withdrawals:number}>();const cashDay=(d:string)=>{const current=cash.get(d)||{date:d,income:0,expenses:0,withdrawals:0};cash.set(d,current);return current};penSales.filter(x=>inPeriod(x.sale_date)).forEach(x=>{const day=cashDay(String(x.sale_date));day.income+=Number(x.total_cents);day.expenses+=Number(x.costs_cents||0)});exp.filter(x=>inPeriod(x.expense_date)).forEach(x=>cashDay(String(x.expense_date)).expenses+=Number(x.amount_cents));withdrawals.filter(x=>inPeriod(x.date)).forEach(x=>cashDay(String(x.date)).withdrawals+=Number(x.amount_cents));let running=0;const cashFlow=[...cash.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-31).map(x=>{running+=x.income-x.expenses-x.withdrawals;return {label:x.date.slice(5),full:x.date,income:x.income/100,expenses:(x.expenses+x.withdrawals)/100,balance:running/100}})
    const movements=[...penSales.filter(x=>inPeriod(x.sale_date)).map(x=>({id:`s-${x.id}`,type:'sale',date:x.sale_date,time:x.sale_time,title:'Venta de mineral',detail:x.buyer,amount_cents:Number(x.total_cents)})),...exp.filter(x=>inPeriod(x.expense_date)).map(x=>({id:`e-${x.id}`,type:'expense',date:x.expense_date,time:x.expense_time,title:x.name||'Gasto',detail:x.category,amount_cents:-Number(x.amount_cents)})),...withdrawals.filter(x=>inPeriod(x.date)).map(x=>({id:`w-${x.id}`,type:'withdrawal',date:x.date,time:x.time,title:'Retiro personal',detail:x.note||'Retiro de dinero',amount_cents:-Number(x.amount_cents)}))].sort((a,b)=>`${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)).slice(0,8)
    return {ownerProduction:{partnerShareAll:partnerAll,ownAll,totalAll:partnerAll+ownAll,partnerShareMonth:partnerMonth,ownMonth,totalMonth:partnerMonth+ownMonth},cycle:{startedAt:db.labors.map(x=>x.cycle_started_at).filter(Boolean).sort().at(-1)||null,closedLots:db.shipments.length,historicalSacks:historicalProd.reduce((a,x)=>a+Number(x.sacks||0),0)},finance:{balanceCents:balance,historicalProfitCents:profit,monthProfitCents:monthProfit,grossSalesCents:gross,withdrawnCents:withdrawn,availableSacks,soldSacks,cashFlow,movements,period},cards:{todaySacks:prod.filter(x=>x.date===date).reduce((a,x)=>a+Number(x.sacks),0),totalSacks:prod.reduce((a,x)=>a+Number(x.sacks),0),monthSacks:prod.filter(x=>String(x.date).startsWith(month)).reduce((a,x)=>a+Number(x.sacks),0),activeLabors:activeLabors.length,totalExpensesCents:expenseTotal,monthExpensesCents:monthExpense,pendingCents:Math.max(0,pending),totalSalesCents:gross,monthSalesCents:monthGross},daily:Array.from(dailyMap,([label,value])=>({label:label.slice(5),value})),byLabor:activeLabors.map(l=>({label:l.name,value:prod.filter(x=>x.labor_id===l.id).reduce((a,x)=>a+Number(x.sacks),0),isOwn:l.ownership_type==='own'||Number(l.partner_percent)===0})),laborProgress,expensesByLabor:activeLabors.map(l=>({label:l.name,value:exp.filter(x=>x.labor_id===l.id).reduce((a,x)=>a+Number(x.amount_cents)/100,0)})),categories:Array.from(categories,([label,value])=>({label,value})).sort((a,b)=>b.value-a.value),activity:db.audit.slice(0,8)} as T
  }
  throw new Error(`Función no disponible: ${method} ${route}`)
}

export const soles=(cents:number)=>new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format((cents||0)/100)
export const number=(value:number)=>new Intl.NumberFormat('es-PE',{maximumFractionDigits:2}).format(value||0)
export const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export const timeNow=()=>new Date().toTimeString().slice(0,5)
export function debtSummary(debt:Row){const paid=(debt.payments||[]).reduce((sum:number,x:Row)=>sum+Number(x.amount_cents),0);const pending=Math.max(0,debt.amount_cents-paid);return {...debt,paid_cents:paid,pending_cents:pending,status:pending===0?'Pagado':paid>0?'Parcial':'Pendiente'}}
export const currencyMoney=(cents:number,currency='PEN')=>new Intl.NumberFormat('es-PE',{style:'currency',currency}).format((cents||0)/100)
