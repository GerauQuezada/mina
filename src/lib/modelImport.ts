import { DoubleSide, Mesh, MeshStandardMaterial, Points, PointsMaterial } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { unzip, unzipSync } from 'fflate'

export type ImportableModel={data:ArrayBuffer;name:string;source:'glb'|'ply'|'zip-glb'|'zip-ply';format?:'glb'|'splat-ply';notice?:string}

export function isGaussianPly(data:ArrayBuffer){
  const header=new TextDecoder().decode(new Uint8Array(data,0,Math.min(data.byteLength,65536))).split('end_header')[0]
  const properties=new Set([...header.matchAll(/^property\s+\w+\s+(\w+)\s*$/gm)].map(match=>match[1]))
  return ['f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'].every(name=>properties.has(name))
}

const supportedEntry=(name:string)=>/\.(glb|ply)$/i.test(name)&&!name.includes('__MACOSX/')&&!name.split('/').pop()?.startsWith('._')

function arrayBuffer(bytes:Uint8Array){
  return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer
}

export function modelEntryNames(entries:Record<string,Uint8Array>){
  return Object.keys(entries).filter(supportedEntry)
}

export function parsePlyObject(data:ArrayBuffer,name:string){
  const geometry=new PLYLoader().parse(data)
  const positions=geometry.getAttribute('position')
  if(!positions?.count)throw new Error('El PLY no contiene puntos visibles.')
  geometry.computeBoundingBox();geometry.computeBoundingSphere()
  if(!geometry.boundingSphere||!Number.isFinite(geometry.boundingSphere.radius))throw new Error('El PLY contiene coordenadas inválidas.')
  const hasFaces=Boolean(geometry.index?.count)
  if(hasFaces&&!geometry.getAttribute('normal'))geometry.computeVertexNormals()
  const vertexColors=Boolean(geometry.getAttribute('color'))
  const material=hasFaces?new MeshStandardMaterial({color:0xffffff,vertexColors,roughness:.82,metalness:0,side:DoubleSide}):new PointsMaterial({color:vertexColors?0xffffff:0xcfddeb,vertexColors,size:Math.max(geometry.boundingSphere.radius/350,.003),sizeAttenuation:true})
  const object=hasFaces?new Mesh(geometry,material):new Points(geometry,material)
  object.name=name.replace(/\.ply$/i,'')
  if(material instanceof PointsMaterial)object.userData.pointSize=material.size
  return object
}

async function plyToGlb(data:ArrayBuffer,name:string):Promise<ImportableModel>{
  if(isGaussianPly(data))return {data,name,source:'ply',format:'splat-ply',notice:'Gaussian Splat: se conserva el PLY original y se muestra con Spark.'}
  const mesh=parsePlyObject(data,name)
  try{
    const exported=await new GLTFExporter().parseAsync(mesh,{binary:true,onlyVisible:true})
    if(!(exported instanceof ArrayBuffer))throw new Error('No se pudo crear el GLB binario.')
    return {data:exported,name:mesh.name+'.glb',source:'ply',notice:mesh instanceof Points?'Nube de puntos: se muestran sus puntos y colores originales.':'Superficie PLY importada.'}
  }finally{mesh.geometry.dispose();mesh.material.dispose()}
}

export async function prepareModelUpload(file:File):Promise<ImportableModel>{
  const lower=file.name.toLowerCase()
  if(lower.endsWith('.glb'))return {data:await file.arrayBuffer(),name:file.name,source:'glb'}
  if(lower.endsWith('.ply'))return plyToGlb(await file.arrayBuffer(),file.name)
  if(!lower.endsWith('.zip'))throw new Error(`${file.name}: usa GLB, PLY o el ZIP que exporta Polycam.`)
  if(file.size>150*1024*1024)throw new Error(`${file.name}: el ZIP supera 150 MB. Redúcelo en Polycam antes de abrirlo en el teléfono.`)
  let entries:Record<string,Uint8Array>
  let oversized=false,total=0
  const bytes=new Uint8Array(await file.arrayBuffer())
  try{
    // Inspeccionar tamaños antes de reservar memoria. No extraer fotos o texturas ajenas al GLB/PLY.
    unzipSync(bytes,{filter:entry=>{if(supportedEntry(entry.name))total+=entry.originalSize;return false}})
    oversized=total>300*1024*1024
    if(oversized)throw new Error('oversized')
    // fflate descomprime modelos grandes en workers para no bloquear los controles táctiles.
    entries=await new Promise((resolve,reject)=>unzip(bytes,{filter:entry=>supportedEntry(entry.name)},(error,data)=>error?reject(error):resolve(data)))
  }catch{
    if(oversized)throw new Error(`${file.name}: los modelos descomprimidos superan 300 MB. Reduce la resolución en Polycam para abrirlos en el teléfono.`)
    throw new Error(`${file.name}: el ZIP está dañado o usa un método de compresión no compatible.`)
  }
  const candidates=modelEntryNames(entries)
  if(!candidates.length)throw new Error(`${file.name}: no contiene ningún archivo GLB o PLY.`)
  const glb=candidates.find(name=>name.toLowerCase().endsWith('.glb'))
  if(glb)return {data:arrayBuffer(entries[glb]),name:glb.split('/').pop()||'ampliacion.glb',source:'zip-glb'}
  const ply=candidates.filter(name=>name.toLowerCase().endsWith('.ply')).sort((a,b)=>entries[b].byteLength-entries[a].byteLength)[0]
  const converted=await plyToGlb(arrayBuffer(entries[ply]),ply.split('/').pop()||'ampliacion.ply')
  return {...converted,source:'zip-ply'}
}
