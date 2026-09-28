// Local Vite visual test only. Not an application route or a production build entry.
// The GLB is public; this harness has no authentication or private data access.
import React from 'react'
import { createRoot } from 'react-dom/client'
import Model3D from '../src/pages/Model3D'
import '../src/styles.css'
import '../src/styles-premium.css'
const base=document.createElement('base');base.href='/mina/';document.head.append(base)
createRoot(document.getElementById('root')!).render(<React.StrictMode><main style={{padding:16,maxWidth:1400,margin:'auto'}}><Model3D/></main></React.StrictMode>)
