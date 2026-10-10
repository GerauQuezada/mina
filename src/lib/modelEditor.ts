import { Matrix4, Vector3 } from 'three'

export type Vector3Tuple=[number,number,number]
export type EditorSegment={
  id:string
  name:string
  fileName:string
  createdAt:string
  position:Vector3Tuple
  rotation:Vector3Tuple
  scale:Vector3Tuple
  opacity:number
  visible:boolean
  storagePath?:string
  format?:'glb'|'splat-ply'
}

export type EditorProject={
  version:1
  unitMeters:number
  scaleVerified?:boolean
  syncPending?:boolean
  segments:EditorSegment[]
}

const PROJECT_KEY='mina-3d-editor-project-v1'
const DATABASE='mina-3d-editor-assets-v1'
const STORE='models'

export const emptyEditorProject=():EditorProject=>({version:1,unitMeters:1,segments:[]})

export function readEditorProject():EditorProject{
  try{
    const value=JSON.parse(localStorage.getItem(PROJECT_KEY)||'null')
    if(value?.version===1&&Array.isArray(value.segments))return {...emptyEditorProject(),...value}
  }catch{}
  return emptyEditorProject()
}

export function saveEditorProject(project:EditorProject){localStorage.setItem(PROJECT_KEY,JSON.stringify(project))}

function database(){return new Promise<IDBDatabase>((resolve,reject)=>{
  const request=indexedDB.open(DATABASE,1)
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE)}
  request.onsuccess=()=>resolve(request.result)
  request.onerror=()=>reject(request.error)
})}

export async function putEditorAsset(id:string,data:ArrayBuffer){
  const db=await database()
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(data,id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})
  db.close()
}

export async function getEditorAsset(id:string){
  const db=await database()
  const value=await new Promise<ArrayBuffer|undefined>((resolve,reject)=>{const request=db.transaction(STORE).objectStore(STORE).get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
  db.close();return value
}

export async function deleteEditorAsset(id:string){
  const db=await database()
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})
  db.close()
}

export const validEditorTransform=(value:unknown):value is Vector3Tuple=>Array.isArray(value)&&value.length===3&&value.every(item=>Number.isFinite(Number(item))&&Math.abs(Number(item))<1_000_000)

export const distanceMeters=(a:Vector3Tuple,b:Vector3Tuple,unitMeters=1)=>Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2])*unitMeters

export function polylineMeters(points:Vector3Tuple[],unitMeters=1){
  return points.slice(1).reduce((sum,point,index)=>sum+distanceMeters(points[index],point,unitMeters),0)
}

export function calibratedUnitMeters(points:Vector3Tuple[],realMeters:number){
  if(points.length<2||points.some(point=>!validEditorTransform(point)))throw new Error('Marca dos puntos válidos para calibrar.')
  const raw=polylineMeters(points.slice(-2),1),scale=realMeters/raw
  if(!Number.isFinite(realMeters)||realMeters<=0||raw<1e-9||!Number.isFinite(scale)||scale<=0||scale>100000)throw new Error('Introduce una distancia real válida y puntos separados.')
  return scale
}

function pointFrame(points:Vector3Tuple[]){
  if(points.length!==3)throw new Error('Selecciona exactamente tres puntos.')
  const origin=new Vector3(...points[0]),x=new Vector3(...points[1]).sub(origin)
  const guide=new Vector3(...points[2]).sub(origin)
  if(x.lengthSq()<1e-10||guide.lengthSq()<1e-10)throw new Error('Los puntos deben estar separados.')
  x.normalize()
  const z=new Vector3().crossVectors(x,guide)
  if(z.lengthSq()<1e-10)throw new Error('Los tres puntos no pueden estar en una misma línea.')
  z.normalize()
  const y=new Vector3().crossVectors(z,x).normalize()
  const frame=new Matrix4().makeBasis(x,y,z)
  frame.setPosition(origin)
  return frame
}

/** Rigid transform that maps three ordered source points onto three ordered target points. */
export function rigidAlignmentMatrix(source:Vector3Tuple[],target:Vector3Tuple[]){
  return pointFrame(target).multiply(pointFrame(source).invert())
}
