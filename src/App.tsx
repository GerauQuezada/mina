import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { api } from './lib/api'
import AuthPage from './pages/AuthPage'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Labors from './pages/Labors'
import LaborDetail from './pages/LaborDetail'
import RecordsPage from './pages/RecordsPage'
import MineMap from './pages/MineMap'
import Model3D from './pages/Model3D'
import Reports from './pages/Reports'
import Audit from './pages/Audit'
import Settings from './pages/Settings'
import Debts from './pages/Debts'
import Sales from './pages/Sales'
import PartnerPortal from './pages/PartnerPortal'
const ModelEditor=lazy(()=>import('./pages/ModelEditor'))
const WhatsAppAutomation=lazy(()=>import('./pages/WhatsAppAutomation'))

export type User={id:number;name:string;email:string;role:string}

export default function App(){return <Routes><Route path="/socio/:token" element={<PartnerPortal/>}/><Route path="*" element={<AdminApp/>}/></Routes>}

function AdminApp(){
  const [user,setUser]=useState<User|null|undefined>(undefined)
  useEffect(()=>{api<User>('/auth/me').then(setUser).catch(()=>setUser(null))},[])
  if(user===undefined)return <div className="boot"><span className="loader"/><p>Preparando la operación…</p></div>
  if(!user)return <AuthPage onAuth={()=>api<User>('/auth/me').then(setUser)}/>
  return <Routes><Route element={<Layout user={user} onLogout={()=>setUser(null)}/>}>
    <Route index element={<Dashboard/>}/>
    <Route path="labores" element={<Labors/>}/><Route path="labores/:id" element={<LaborDetail/>}/>
    <Route path="produccion" element={<RecordsPage type="production"/>}/>
    <Route path="gastos" element={<RecordsPage type="expenses"/>}/>
    <Route path="ventas" element={<Sales/>}/><Route path="prestamos" element={<Debts/>}/>
    <Route path="recorrido" element={<MineMap/>}/><Route path="modelo-3d" element={<Model3D/>}/>
    <Route path="edicion-3d" element={<Suspense fallback={<PageLoader/>}><ModelEditor/></Suspense>}/><Route path="whatsapp" element={<Suspense fallback={<PageLoader/>}><WhatsAppAutomation/></Suspense>}/>
    <Route path="reportes" element={<Reports/>}/><Route path="historial" element={<Audit/>}/>
    <Route path="configuracion" element={<Settings user={user}/>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Route></Routes>
}

function PageLoader(){return <div className="boot inline"><span className="loader"/><p>Cargando herramienta…</p></div>}
