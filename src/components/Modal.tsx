import { type ReactNode, useEffect } from 'react'
import { X } from 'lucide-react'
export default function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){useEffect(()=>{const h=(e:KeyboardEvent)=>e.key==='Escape'&&onClose();document.addEventListener('keydown',h);return()=>document.removeEventListener('keydown',h)},[onClose]);return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><section className="modal glass"><header><h2>{title}</h2><button onClick={onClose}><X/></button></header>{children}</section></div>}
