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
}

export type EditorProject={
  version:1
  unitMeters:number
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

export const distanceMeters=(a:Vector3Tuple,b:Vector3Tuple,unitMeters=1)=>Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2])*unitMeters

export function polylineMeters(points:Vector3Tuple[],unitMeters=1){
  return points.slice(1).reduce((sum,point,index)=>sum+distanceMeters(points[index],point,unitMeters),0)
}
