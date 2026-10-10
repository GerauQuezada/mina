import type {EditorProject} from './modelEditor'

export type EditorUploadResult={paths:Record<string,string>;failures:{id:string;name:string;reason:string}[]}

export function selectEditorProject(remote:EditorProject|null,local:EditorProject):EditorProject{
  return local.syncPending||!remote?local:remote
}

/** Retry only assets still missing a private copy. Metadata is merged later,
 * so an upload completing cannot overwrite edits made during the request. */
export async function syncEditorAssets(project:EditorProject,load:(id:string)=>Promise<ArrayBuffer|undefined>,upload:(id:string,file:Blob,format:'glb'|'splat-ply')=>Promise<string>):Promise<EditorUploadResult>{
  const result:EditorUploadResult={paths:{},failures:[]}
  for(const segment of project.segments){
    if(segment.storagePath)continue
    try{
      const data=await load(segment.id)
      if(!data)throw new Error('Falta el archivo local; vuelve a importar este escaneo.')
      const format=segment.format||'glb'
      result.paths[segment.id]=await upload(segment.id,new Blob([data],{type:format==='splat-ply'?'application/octet-stream':'model/gltf-binary'}),format)
    }catch(error){result.failures.push({id:segment.id,name:segment.name,reason:error instanceof Error?error.message:String(error)})}
  }
  return result
}

export function mergeEditorUploads(current:EditorProject,paths:Record<string,string>):EditorProject{
  return {...current,segments:current.segments.map(segment=>paths[segment.id]?{...segment,storagePath:paths[segment.id]}:segment)}
}
