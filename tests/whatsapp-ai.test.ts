import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {interpretReport,numericEvidence,validateAiReport} from '../whatsapp-bridge/report-ai.ts'
import {ReviewStore} from '../whatsapp-bridge/review-store.ts'
import {assignedContact,dueReminders} from '../whatsapp-bridge/workflow.ts'

test('daily reminders catch up today, keep owner assignments and never resend uncertain deliveries',()=>{
  const contact={id:1,phone:'51 900 000 001',labor_id:3,enabled:true,send_time:'18:30'}
  const rows=[{owner_id:'owner-one',payload:{labors:[{id:3,status:'active'}],whatsappContacts:[contact]}}]
  assert.equal(dueReminders(rows,'owner-one',{date:'2026-10-10',time:'18:29'},{}).length,0)
  const due=dueReminders(rows,'owner-one',{date:'2026-10-10',time:'19:10'},{})
  assert.equal(due.length,1);assert.equal(due[0].key,'owner-one:1:2026-10-10')
  for(const status of ['pending','sent'] as const)assert.equal(dueReminders(rows,'owner-one',{date:'2026-10-10',time:'19:10'},{[due[0].key]:status}).length,0)
  assert.equal(dueReminders(rows,'other-owner',{date:'2026-10-10',time:'19:10'},{}).length,0)
  rows[0].payload.whatsappContacts.push({...contact,id:2})
  assert.equal(assignedContact(rows,'owner-one','51900000001'),null)
  assert.equal(dueReminders(rows,'owner-one',{date:'2026-10-10',time:'19:10'},{}).length,0)
  rows[0].payload.whatsappContacts.pop();rows[0].payload.labors[0].status='closed'
  assert.equal(assignedContact(rows,'owner-one','51900000001'),null)
})

test('local AI validates Spanish spoken amounts against quoted evidence',()=>{
  const text='Hoy sacamos dieciocho sacos y gastamos ciento veinte soles en gasolina y ochenta soles en comida.'
  assert.match(numericEvidence(text),/18 sacos/)
  assert.match(numericEvidence('mil quinientos veinte soles'),/1520 soles/)
  const parsed=validateAiReport(text,{status:'worked',sacks:18,sacksEvidence:'sacamos dieciocho sacos',requiresReview:false,expenses:[{name:'Gasolina',amount:120,category:'Gasolina',evidence:'ciento veinte soles en gasolina'},{name:'Comida',amount:80,category:'Alimentación',evidence:'ochenta soles en comida'}]})
  assert.equal(parsed.sacks,18)
  assert.deepEqual(parsed.expenses.map(row=>row.amount),[120,80])
})

test('AI cannot invent money, quote nonexistent evidence, or record conflicting sacks',()=>{
  const text='12 sacos; gastamos 40 soles en gasolina'
  const base={status:'worked',sacks:12,sacksEvidence:'12 sacos',requiresReview:false,expenses:[]}
  assert.throws(()=>validateAiReport(text,{...base,sacks:40}),/sacos no coinciden/)
  assert.throws(()=>validateAiReport(text,{...base,expenses:[{name:'Gasolina',category:'Gasolina',amount:400,evidence:'40 soles en gasolina'}]}),/monto verificable/)
  assert.throws(()=>validateAiReport(text,{...base,sacksEvidence:'120 sacos'}),/evidencia real/)
  assert.throws(()=>validateAiReport('12 sacos, perdón, fueron 10 sacos',base),/contradictorias/)
  assert.throws(()=>validateAiReport('Ayer sacamos 12 sacos',base),/fechas/)
  assert.throws(()=>validateAiReport(text,{...base,requiresReview:true}),/ambigüedad/)
})

test('AI uses local structured outputs and refuses third-party report transmission',async()=>{
  let calls=0
  const fetcher:typeof fetch=async(input,init)=>{
    calls++;assert.equal(String(input),'http://127.0.0.1:11434/api/chat')
    const body=JSON.parse(String(init?.body));assert.equal(body.stream,false);assert.equal(body.format.type,'object');assert.equal(body.messages.at(-1).content,'Solo botamos desmonte')
    return Response.json({message:{content:JSON.stringify({status:'waste_only',sacks:null,sacksEvidence:'',requiresReview:false,expenses:[]})}})
  }
  const parsed=await interpretReport('Solo botamos desmonte',{url:'http://127.0.0.1:11434',model:'local-test'},fetcher)
  assert.equal(parsed.status,'waste_only');assert.equal(calls,1)
  await assert.rejects(interpretReport('12 sacos',{url:'https://external.example',model:'test'},fetcher),/limitada al equipo local/)
  assert.equal(calls,1)
  await assert.rejects(interpretReport('No sacamos 12 sacos',{},fetcher),/cifras negadas/)
  await assert.rejects(interpretReport('Sacaremos 12 sacos',{},fetcher),/planes/)
})

test('review queue persists, isolates owners and deduplicates messages',async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'mina-review-test-'))
  try{
    const store=new ReviewStore(directory);await store.load()
    const row={id:'qr:message-1',ownerId:'owner-one',laborId:3,phone:'51900000001',rawText:'Mensaje de muestra',messageType:'text' as const,reason:'Ambiguo',reportDate:'2026-10-10'}
    await Promise.all([store.add(row),store.add(row)])
    assert.equal(store.pending('owner-one').length,1);assert.equal(store.pending('other-owner').length,0)
    const restored=new ReviewStore(directory);await restored.load();assert.equal(restored.pending('owner-one')[0].laborId,3)
    await restored.resolve('owner-one',row.id,'approved')
    assert.equal(restored.has('owner-one',row.id),true)
    assert.equal(restored.has('other-owner',row.id),false)
    assert.equal(restored.pending('owner-one').length,0)
    await restored.add(row);assert.equal(restored.pending('owner-one').length,0)
    await restored.add({...row,id:'qr:rejected'})
    await restored.resolve('owner-one','qr:rejected','rejected')
    const reloaded=new ReviewStore(directory);await reloaded.load()
    assert.equal(reloaded.has('owner-one','qr:rejected'),true)
  }finally{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('mina-review-test-'));await rm(directory,{recursive:true,force:true})}
})
