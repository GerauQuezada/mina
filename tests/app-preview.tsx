// Local visual QA only: fake records, no connection to Supabase or production data.
import React from 'react'
import {createRoot} from 'react-dom/client'
import {HashRouter} from 'react-router-dom'
import App from '../src/App'
import {api} from '../src/lib/api'
import '../src/styles.css'
import '../src/styles-premium.css'

const date=new Date().toISOString().slice(0,10)
const day=(offset:number)=>new Date(Date.now()-offset*86400000).toISOString().slice(0,10)
let revision=1
let payload:any={version:2,users:[],labors:[
  {id:1,name:'Galería Esperanza',partner_name:'Elena Rojas',partner_photo:'',code:'GE-01',level:'Nivel 120',location:'Sector Norte',description:'Galería principal',status:'active',mine_percent:50,partner_percent:50,created_at:'2026-09-01 08:00:00'},
  {id:2,name:'Veta Aurora',partner_name:'Carlos Vega',partner_photo:'',code:'VA-02',level:'Nivel 80',location:'Sector Este',description:'Frente activo',status:'active',ownership_type:'partner',mine_percent:60,partner_percent:40,created_at:'2026-09-03 09:00:00'},
  {id:3,name:'Labor Omar',partner_name:'Omar Miranda',partner_photo:'',code:'OM-01',level:'Nivel 60',location:'Sector Central',description:'Labor propia',status:'active',ownership_type:'own',mine_percent:100,partner_percent:0,created_at:'2026-09-04 07:00:00'}
],production:[
  {id:11,labor_id:1,date:day(3),sacks:18,mine_sacks:9,partner_sacks:9,created_at:day(3)+' 08:00:00'},
  {id:12,labor_id:2,date:day(3),sacks:9,mine_sacks:5.4,partner_sacks:3.6,created_at:day(3)+' 10:00:00'},
  {id:13,labor_id:1,date:day(2),sacks:24,mine_sacks:12,partner_sacks:12,created_at:day(2)+' 08:00:00'},
  {id:14,labor_id:3,date:day(2),sacks:21,mine_sacks:21,partner_sacks:0,created_at:day(2)+' 12:00:00'},
  {id:15,labor_id:2,date:day(1),sacks:22,mine_sacks:13.2,partner_sacks:8.8,created_at:day(1)+' 09:00:00'},
  {id:16,labor_id:3,date:day(1),sacks:33,mine_sacks:33,partner_sacks:0,created_at:day(1)+' 13:00:00'},
  {id:1,labor_id:1,date,sacks:42,mine_sacks:21,partner_sacks:21,created_at:date+' 08:00:00'},
  {id:2,labor_id:2,date,sacks:31,mine_sacks:18.6,partner_sacks:12.4,created_at:date+' 10:00:00'},
  {id:3,labor_id:3,date,sacks:54,mine_sacks:54,partner_sacks:0,created_at:date+' 13:00:00'}
],expenses:[
  {id:1,labor_id:1,name:'Madera para sostenimiento',amount_cents:165000,expense_date:date,expense_time:'09:30',category:'Materiales',partner_percent:50,created_at:date+' 09:30:00'},
  {id:2,labor_id:2,name:'Transporte',amount_cents:48000,expense_date:date,expense_time:'11:00',category:'Transporte',partner_percent:40,created_at:date+' 11:00:00'}
],sales:[
  {id:1,labor_id:1,sale_date:date,sale_time:'16:20',buyer:'Minerales del Sur',weight:1850,weight_unit:'kg',grade:13.8,grade_unit:'g/t',currency:'PEN',total_cents:2475000,costs_cents:410000,profit_cents:2065000,observation:'Lote principal',created_at:date+' 16:20:00'}
],debts:[
  {id:1,name:'Rosa Medina',photo:'',date,amount_cents:1200000,currency:'PEN',due_date:'2026-12-15',note:'Capital para equipos',attachments:[],payments:[{id:1,date,amount_cents:250000,note:'Primer abono',receipt_data_url:''}],created_at:date+' 07:00:00'},
  {id:2,name:'Jorge Salas',photo:'',date,amount_cents:350000,currency:'USD',due_date:'',note:'Compra de compresor',attachments:[],payments:[],created_at:date+' 07:10:00'}
],audit:[
  {id:2,user_id:1,user_name:'Omar Miranda',action:'CREATE',entity:'Sale',entity_id:1,created_at:date+' 16:20:00'},
  {id:1,user_id:1,user_name:'Omar Miranda',action:'CREATE',entity:'ProductionRecord',entity_id:2,created_at:date+' 10:00:00'}
],recoveries:[],liquidations:[]}

const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}})
const partnerToken='11111111-2222-4333-8444-555555555555',partnerPassword='SocioDemo2026!'
globalThis.fetch=async(input,options={})=>{
  const url=String(input)
  if(url.endsWith('cloud-config.json'))return response({url:'https://visual-test.supabase.co',key:'sb_publishable_visual_test'})
  if(url.includes('/auth/v1/token'))return response({access_token:'visual-token',refresh_token:'visual-refresh',expires_in:3600,user:{id:'visual-owner',email:'madfaygoo@gmail.com'}})
  if(url.includes('/auth/v1/logout'))return response({})
  if(url.includes('/rest/v1/mine_workspace?'))return response([{payload:structuredClone(payload),revision}])
  if(url.endsWith('/rest/v1/rpc/list_partner_portals'))return response([{labor_id:1,share_token:partnerToken,enabled:true,updated_at:new Date().toISOString()}])
  if(url.endsWith('/rest/v1/rpc/set_partner_portal'))return response({labor_id:1,share_token:partnerToken,enabled:true,updated_at:new Date().toISOString()})
  if(url.endsWith('/rest/v1/rpc/disable_partner_portal'))return response(true)
  if(url.endsWith('/rest/v1/rpc/partner_portal_view')){const body=JSON.parse(String(options.body));if(body.p_token!==partnerToken||body.p_password!==partnerPassword)return response({message:'Enlace o contraseña incorrectos'},401);return response({labor:payload.labors[0],production:payload.production.filter((x:any)=>x.labor_id===1),expenses:payload.expenses.filter((x:any)=>x.labor_id===1)})}
  if(url.endsWith('/rest/v1/rpc/partner_portal_add_production')){const body=JSON.parse(String(options.body));payload.production.push({id:99,labor_id:1,date:body.p_date,sacks:body.p_sacks,mine_sacks:body.p_sacks/2,partner_sacks:body.p_sacks/2,note:body.p_note,source:'partner_portal',created_at:new Date().toISOString()});return response({ok:true,id:99})}
  if(url.endsWith('/rest/v1/rpc/partner_portal_add_expense')){const body=JSON.parse(String(options.body));payload.expenses.push({id:99,labor_id:1,name:body.p_name,amount_cents:body.p_amount_cents,expense_date:body.p_date,expense_time:body.p_time,category:body.p_category,payment_method:body.p_payment_method,source:'partner_portal',created_at:new Date().toISOString()});return response({ok:true,id:99})}
  if(url.includes('/rest/v1/rpc/save_mine_workspace')){const body=JSON.parse(String(options.body));payload=body.data;revision++;return response(revision)}
  if(url==='https://api.gold-api.com/price/XAU')return response({name:'Gold',symbol:'XAU',currency:'USD',price:4261.5,updatedAt:new Date().toISOString()})
  if(url.startsWith('https://api.open-meteo.com/v1/forecast'))return response({current:{temperature_2m:14.2,apparent_temperature:13.1,relative_humidity_2m:72,precipitation:0,weather_code:2,wind_speed_10m:8.4,is_day:1,time:new Date().toISOString()},daily:{temperature_2m_max:[18.4],temperature_2m_min:[7.8]}})
  throw new Error('Solicitud inesperada en vista QA: '+url)
}

await api('/auth/login',{method:'POST',body:JSON.stringify({email:'madfaygoo@gmail.com',password:'visual-only'})})
createRoot(document.getElementById('root')!).render(<React.StrictMode><HashRouter><App/></HashRouter></React.StrictMode>)
