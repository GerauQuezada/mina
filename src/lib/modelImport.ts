import { Mesh, MeshStandardMaterial } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { unzipSync } from 'fflate'

export type ImportableModel={data:ArrayBuffer;name:string;source:'glb'|'ply'|'zip-glb'|'zip-ply'}

function arrayBuffer(bytes:Uint8Array){
  return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer
}

export function modelEntryNames(entries:Record<string,Uint8Array>){
  return Object.keys(entries).filter(name=>!name.endsWith('/')&&/\.(glb|ply)$/i.test(name))
}

async function plyToGlb(data:ArrayBuffer,name:string):Promise<ImportableModel>{
  const geometry=new PLYLoader().parse(data)
  if(!geometry.getAttribute('normal'))geometry.computeVertexNormals()
  const material=new MeshStandardMaterial({color:0xffffff,vertexColors:Boolean(geometry.getAttribute('color')),roughness:.82,metalness:0})
  const mesh=new Mesh(geometry,material);mesh.name=name.replace(/\.ply$/i,'')
  try{
    const exported=await new GLTFExporter().parseAsync(mesh,{binary:true,onlyVisible:true})
    if(!(exported instanceof ArrayBuffer))throw new Error('No se pudo crear el GLB binario.')
    return {data:exported,name:mesh.name+'.glb',source:'ply'}
  }finally{geometry.dispose();material.dispose()}
}

export async function prepareModelUpload(file:File):Promise<ImportableModel>{
  const lower=file.name.toLowerCase()
  if(lower.endsWith('.glb'))return {data:await file.arrayBuffer(),name:file.name,source:'glb'}
  if(lower.endsWith('.ply'))return plyToGlb(await file.arrayBuffer(),file.name)
  if(!lower.endsWith('.zip'))throw new Error(`${file.name}: usa GLB, PLY o el ZIP que exporta Polycam.`)
  if(file.size>150*1024*1024)throw new Error(`${file.name}: el ZIP supera 150 MB. Redúcelo en Polycam antes de abrirlo en el teléfono.`)
  let entries:Record<string,Uint8Array>
  try{entries=unzipSync(new Uint8Array(await file.arrayBuffer()))}catch{throw new Error(`${file.name}: el ZIP está dañado o usa un método de compresión no compatible.`)}
  const candidates=modelEntryNames(entries)
  if(!candidates.length)throw new Error(`${file.name}: no contiene ningún archivo GLB o PLY.`)
  const glb=candidates.find(name=>name.toLowerCase().endsWith('.glb'))
  if(glb)return {data:arrayBuffer(entries[glb]),name:glb.split('/').pop()||'ampliacion.glb',source:'zip-glb'}
  const ply=candidates.find(name=>name.toLowerCase().endsWith('.ply'))!
  const converted=await plyToGlb(arrayBuffer(entries[ply]),ply.split('/').pop()||'ampliacion.ply')
  return {...converted,source:'zip-ply'}
}
