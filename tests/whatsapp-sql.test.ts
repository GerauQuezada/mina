import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

test('QR SQL imports reports atomically with real PostgreSQL semantics',async t=>{
  const db=new PGlite()
  const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222'
  const phone='51900000001',day='2026-01-10'
  const parsed={status:'worked',sacks:18,confidence:.9,expenses:[{name:'Gasolina',amount:120.25,category:'Gasolina'}]}
  const fixture=()=>({labors:[{id:3,name:'Labor de prueba',status:'active',mine_percent:50,partner_percent:50}],whatsappContacts:[{id:1,labor_id:3,phone,enabled:true}],production:[],expenses:[],fieldReports:[],audit:[],sales:[{id:5,total_cents:99900}],debts:[{id:4,amount_cents:8800}]})
  const call=async(id:string,report:unknown=parsed,who=owner,date=day)=>db.query<{result:boolean}>(
    'select public.ingest_whatsapp_qr_report($1::uuid,$2::date,$3,$4,$5,$6,$7::jsonb,$8::bigint) as result',
    [who,date,phone,id,'text','Hoy sacamos 18 sacos; gastamos 120.25 soles en gasolina',JSON.stringify(report),3])
  const state=async(who=owner)=>(await db.query<{payload:any;revision:number}>('select payload,revision from public.mine_workspace where owner_id=$1::uuid',[who])).rows[0]
  const reset=async(payload=fixture())=>{await db.exec('truncate public.whatsapp_messages');await db.query('update public.mine_workspace set payload=$1::jsonb,revision=1 where owner_id=$2::uuid',[JSON.stringify(payload),owner])}
  try{
    await db.exec(`create schema auth; create table auth.users(id uuid primary key);
      create role service_role; create role authenticated;
      create function auth.role() returns text language sql as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      set request.jwt.claim.role='service_role';`)
    const schema=await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8')
    for(const name of ['mine_workspace','whatsapp_messages']){
      const table=schema.match(new RegExp(`create table if not exists public\\.${name}\\s*\\([\\s\\S]*?\\n\\);`))?.[0]
      assert.ok(table,`Missing authoritative schema for ${name}`)
      if(name==='mine_workspace')await db.query('insert into auth.users(id) values($1::uuid),($2::uuid)',[owner,other])
      await db.exec(table)
    }
    await db.exec(await readFile(new URL('../supabase/whatsapp-qr.sql',import.meta.url),'utf8'))
    for(const id of [owner,other])await db.query('insert into public.mine_workspace(owner_id,payload) values($1::uuid,$2::jsonb)',[id,JSON.stringify(fixture())])

    await t.test('sacks, expense cents and historical date go only to the selected owner/labor',async()=>{
      assert.equal((await call('qr:valid')).rows[0].result,true)
      const data=await state()
      assert.equal(data.payload.production[0].sacks,18)
      assert.equal(data.payload.production[0].mine_sacks,9)
      assert.equal(data.payload.production[0].partner_sacks,9)
      assert.equal(data.payload.production[0].labor_id,3)
      assert.equal(data.payload.production[0].date,day)
      assert.equal(data.payload.expenses[0].expense_date,day)
      assert.equal(data.payload.expenses[0].amount_cents,12025)
      assert.equal(data.payload.fieldReports[0].status,'worked')
      assert.deepEqual(data.payload.sales,fixture().sales);assert.deepEqual(data.payload.debts,fixture().debts)
      assert.equal((await state(other)).payload.production.length,0)
      assert.equal((await call('qr:valid')).rows[0].result,false)
      assert.equal((await state()).revision,data.revision)
    })
    await t.test('no-work and waste days never fabricate production or money',async()=>{
      await reset()
      for(const status of ['no_work','waste_only'])await call('qr:'+status,{status,sacks:null,confidence:.9,expenses:[]})
      const data=await state();assert.equal(data.payload.fieldReports.length,2);assert.equal(data.payload.production.length,0);assert.equal(data.payload.expenses.length,0)
    })
    await t.test('invalid reports roll back both bookkeeping and message deduplication',async()=>{
      await reset()
      for(const report of [{...parsed,sacks:-1},{...parsed,status:'no_work'},{...parsed,confidence:.1},{...parsed,expenses:[{name:'Invalid',amount:-50,category:'Otros'}]},{...parsed,expenses:[{name:'Invalid',amount:.001,category:'Otros'}]}]){
        await assert.rejects(call('qr:invalid',report),/inválid|contradictori|confianza/)
        assert.equal((await state()).revision,1)
        assert.equal((await db.query<{count:number}>('select count(*)::int as count from public.whatsapp_messages')).rows[0].count,0)
      }
      await assert.rejects(call('qr:future',parsed,owner,'2999-01-01'),/fecha inválida/)
    })
    await t.test('ambiguous assignments and inactive labors are rejected',async()=>{
      const duplicate=fixture();duplicate.whatsappContacts.push({...duplicate.whatsappContacts[0],id:2})
      await reset(duplicate);await assert.rejects(call('qr:ambiguous'),/vinculad|ambigu/)
      const inactive=fixture();inactive.labors[0].status='closed'
      await reset(inactive);await assert.rejects(call('qr:inactive'),/activa/)
      const reassigned=fixture();reassigned.labors[0].id=7;reassigned.whatsappContacts[0].labor_id=7
      await reset(reassigned);await assert.rejects(call('qr:reassigned'),/asignación.*cambió/)
      assert.equal((await state()).payload.production.length,0)
    })
    await t.test('a late storage failure rolls back the message and every accounting change',async()=>{
      await reset()
      await db.exec(`create function public.test_fail_workspace_update() returns trigger language plpgsql as $$ begin raise exception 'Simulated storage failure'; end; $$;
        create trigger test_reject_update before update on public.mine_workspace for each row execute function public.test_fail_workspace_update();`)
      try{
        await assert.rejects(call('qr:storage-failure'),/Simulated storage failure/)
        assert.equal((await state()).revision,1)
        assert.equal((await state()).payload.production.length,0)
        assert.equal((await state()).payload.expenses.length,0)
        assert.equal((await db.query<{count:number}>('select count(*)::int as count from public.whatsapp_messages')).rows[0].count,0)
      }finally{await db.exec('drop trigger test_reject_update on public.mine_workspace; drop function public.test_fail_workspace_update()')}
    })
    await t.test('normal users and missing service-role claims cannot invoke the private RPC',async()=>{
      await reset();await db.exec("set request.jwt.claim.role=''")
      await assert.rejects(call('qr:no-role'),/autorizado/)
      await db.exec("set request.jwt.claim.role='service_role'; set role authenticated")
      await assert.rejects(call('qr:user'),/permission denied/)
      await db.exec('reset role')
    })
  }finally{await db.close()}
})
