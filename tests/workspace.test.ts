import test from 'node:test'
import assert from 'node:assert/strict'
import { api } from '../src/lib/api.ts'
import { OWNER_EMAIL, WORKSPACE_UPDATED_EVENT, logout } from '../src/lib/cloud.ts'
import { validateBackup, validDate, validMedia } from '../src/lib/validation.ts'
import { reportCsv, reportKeys } from '../src/lib/reports.ts'

test('workspace cloud adapter: private access, loans, sales and backups', async t => {
  let payload: any = null, revision = 0, saves = 0
  const originalFetch = globalThis.fetch
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const browserEvents=new EventTarget();let updateEvents=0
  browserEvents.addEventListener(WORKSPACE_UPDATED_EVENT,()=>updateEvents++)
  Object.defineProperty(globalThis, 'document', {configurable:true,value:{baseURI:'https://example.test/mina/'}})
  Object.defineProperty(globalThis, 'window', {configurable:true,value:browserEvents})
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input)
    const json = (value: unknown, status=200) => new Response(JSON.stringify(value), {status,headers:{'Content-Type':'application/json'}})
    if (url.endsWith('/cloud-config.json')) return json({url:'https://fixture.supabase.co',key:'sb_publishable_fixture'})
    if (url.includes('/auth/v1/token')) {
      assert.equal(JSON.parse(String(options.body)).password, 'TEST-ONLY-NOT-A-REAL-PASSWORD')
      return json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,user:{id:'fixture-owner',email:OWNER_EMAIL}})
    }
    assert.equal((options.headers as Record<string,string>).Authorization, 'Bearer fixture-access')
    if (url.endsWith('/auth/v1/logout')) return json({})
    if (url.includes('/rest/v1/mine_workspace?')) return json(payload ? [{payload:structuredClone(payload),revision}] : [])
    if (url.endsWith('/rpc/save_mine_workspace')) {
      const body = JSON.parse(String(options.body))
      if (body.expected_revision !== revision) return json({message:'Conflict'},409)
      payload = body.data; revision++; saves++
      return json(revision)
    }
    throw new Error('Unexpected request ' + url)
  }
  const post=(url:string,data:any,method='POST')=>api(url,{method,body:JSON.stringify(data)})
  try {
    await t.test('data requires a session and other emails cannot login', async () => {
      await assert.rejects(api('/backup'), /Inicia sesión/)
      await assert.rejects(post('/auth/login',{email:'other@example.test',password:'anything'}), /incorrectos/)
      await post('/auth/login',{email:OWNER_EMAIL,password:'TEST-ONLY-NOT-A-REAL-PASSWORD'})
    })
    await t.test('loans track partial and full payments, reject overpayment and currency changes', async () => {
      const created:any=await post('/debts',{name:'Prestamista',date:'2026-09-27',amount:'100.25',currency:'PEN',attachments:[]})
      await post(`/debts/${created.id}/payments`,{date:'2026-09-27',amount:'30.15'})
      const rows:any[]=await api('/debts')
      assert.equal(rows[0].paid_cents,3015); assert.equal(rows[0].pending_cents,7010); assert.equal(rows[0].status,'Parcial')
      await assert.rejects(post(`/debts/${created.id}/payments`,{date:'2026-09-27',amount:'70.11'}), /saldo/)
      await assert.rejects(post(`/debts/${created.id}`,{name:'Persona',date:'2026-09-27',amount:'20',currency:'PEN'},'PUT'), /menor/)
      await assert.rejects(post(`/debts/${created.id}`,{name:'Persona',date:'2026-09-27',amount:'100.25',currency:'USD'},'PUT'), /moneda/)
      await post(`/debts/${created.id}/payments`,{date:'2026-09-28',amount:'70.10'})
      assert.equal((await api<any[]>('/debts'))[0].status,'Pagado')
      await assert.rejects(post('/debts/999',{name:'Nadie',date:'2026-09-27',amount:10},'PUT'), /no encontrado/)
    })
    await t.test('sales distinguish gross receipts from known net profit', async () => {
      const labor:any=await post('/labors',{name:'Galería',partnerName:'Socio',minePercent:50,partnerPercent:50})
      const sale={laborId:labor.id,date:'2026-09-27',time:'14:20',buyer:'Comprador',weight:'200',weight_unit:'kg',grade:'12',grade_unit:'g/t',currency:'PEN',received:'500.10',costs:''}
      await post('/sales',sale)
      await post('/sales',{...sale,currency:'USD',costs:'200.05'})
      const rows:any[]=await api('/sales')
      assert.equal(rows[0].total_cents,50010); assert.equal(rows[0].profit_cents,null); assert.equal(rows[0].price,null)
      assert.equal(rows[1].profit_cents,30005)
      await assert.rejects(post('/sales',{...sale,time:'25:10'}), /hora/)
      await assert.rejects(post('/sales',{...sale,weight:-1}), /peso/)
    })
    await t.test('production and expenses reject negative or malformed operations', async () => {
      await assert.rejects(post('/production',{laborId:1,date:'2026-09-27',sacks:0}),/positiva/)
      await assert.rejects(post('/production',{laborId:1,date:'2026-02-30',sacks:10}),/fecha/)
      await assert.rejects(post('/expenses',{laborId:1,name:'Combustible',amount:-2,expenseDate:'2026-09-27',expenseTime:'10:00'}),/positivo/)
      await assert.rejects(post('/expenses',{laborId:1,name:'Combustible',amount:2,expenseDate:'2026-09-27',expenseTime:'29:00'}),/hora/)
    })
    await t.test('dashboard separates partner share, own labor and owner total', async () => {
      const own:any=await post('/labors',{name:'Labor propia',ownershipType:'own',partnerName:'No debe usarse',minePercent:50,partnerPercent:50})
      const labors:any[]=await api('/labors')
      const ownLabor=labors.find(x=>x.id===own.id)
      assert.equal(ownLabor.ownership_type,'own');assert.equal(ownLabor.mine_percent,100);assert.equal(ownLabor.partner_percent,0);assert.equal(ownLabor.partner_name,'Omar Miranda')
      await post('/production',{laborId:1,date:'2026-09-27',sacks:20})
      await post('/production',{laborId:own.id,date:'2026-09-27',sacks:30})
      const dashboard:any=await api('/dashboard')
      assert.deepEqual(dashboard.ownerProduction,{partnerShareAll:10,ownAll:30,totalAll:40,partnerShareMonth:10,ownMonth:30,totalMonth:40})
    })
    await t.test('backup preserves pictures and legacy history but drops credentials', async () => {
      const backup:any=await api('/backup')
      backup.users=[{password:'never-upload-this'}]
      backup.labors[0].partner_photo='data:image/jpeg;base64,YWJj'
      backup.recoveries=[{id:1,amount_cents:20}]
      await post('/backup',backup)
      assert.deepEqual(payload.users,[])
      assert.equal(payload.labors[0].partner_photo,backup.labors[0].partner_photo)
      assert.equal(payload.recoveries.length,1)
      const before=saves
      await assert.rejects(post('/backup',{...backup,debts:[{id:1,amount_cents:-1}]}))
      assert.equal(saves,before)
    })
    await t.test('concurrent writers receive a conflict instead of losing data', async () => {
      const first={name:'A',amount:10,date:'2026-09-27',currency:'PEN',attachments:[]}
      const result=await Promise.allSettled([post('/debts',first),post('/debts',{...first,name:'B'})])
      assert.equal(result.filter(x=>x.status==='fulfilled').length,1)
      assert.equal(result.filter(x=>x.status==='rejected').length,1)
    })
    await logout()
    assert.equal(updateEvents,saves,'every successful write notifies the live dashboard')
    await assert.rejects(api('/debts'),/Inicia sesión/)
  } finally {
    globalThis.fetch=originalFetch
    if(originalDocument)Object.defineProperty(globalThis,'document',originalDocument)
    else Reflect.deleteProperty(globalThis,'document')
    if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow)
    else Reflect.deleteProperty(globalThis,'window')
  }
})

test('media, dates and backup validation reject unsafe inputs',()=>{
  assert.throws(()=>validDate('2026-02-30'))
  assert.throws(()=>validMedia('javascript:alert(1)'))
  assert.throws(()=>validMedia('data:image/svg+xml;base64,YWJj'))
  const backup={labors:[{id:1},{id:1}],production:[],expenses:[],sales:[],audit:[],debts:[],recoveries:[],liquidations:[]}
  assert.throws(()=>validateBackup(backup),/duplicado/)
})
test('CSV neutralizes formulas, quotes fields and includes heterogeneous legacy columns',()=>{
  const rows=[{id:1,buyer:'=HYPERLINK("unsafe")',total_cents:120},{id:2,buyer:'Normal',weight:20}]
  const keys=reportKeys(rows)
  assert.ok(keys.includes('weight'))
  const csv=reportCsv(keys,rows)
  assert.ok(csv.includes("'=HYPERLINK")); assert.ok(csv.includes('""unsafe""'))
  assert.equal(reportKeys([{receipt_data_url:'data:secret',id:1}]).includes('receipt_data_url'),false)
})
