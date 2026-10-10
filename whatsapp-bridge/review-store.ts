import {mkdir,readFile,appendFile} from 'node:fs/promises'
import path from 'node:path'

export type Review={id:string;ownerId:string;laborId:number;laborName?:string;phone:string;rawText:string;messageType:'text'|'audio';reason:string;reportDate:string;createdAt:string;status:'pending'|'approved'|'rejected';resolvedAt?:string}
export class ReviewStore{
  private rows:Review[]=[]
  private writing=Promise.resolve()
  constructor(private directory:string){}
  async load(){
    await mkdir(this.directory,{recursive:true})
    try{
      const lines=(await readFile(path.join(this.directory,'reviews.jsonl'),'utf8')).split('\n').filter(Boolean)
      for(const line of lines){const event=JSON.parse(line);if(event.type==='add')this.rows.push(event.row);else if(event.type==='resolve'){const row=this.rows.find(item=>item.id===event.id&&item.ownerId===event.ownerId);if(!row)throw new Error('Historial de revisión inválido.');row.status=event.status;row.resolvedAt=event.resolvedAt}else throw new Error('Historial de revisión inválido.')}
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
  }
  private mutate(action:()=>Promise<void>){
    const task=this.writing.then(action)
    this.writing=task.catch(()=>{})
    return task
  }
  private append(event:unknown){return appendFile(path.join(this.directory,'reviews.jsonl'),JSON.stringify(event)+'\n',{encoding:'utf8',mode:0o600,flush:true})}
  pending(ownerId:string){return this.rows.filter(row=>row.ownerId===ownerId&&row.status==='pending').map(row=>({...row}))}
  has(ownerId:string,id:string){return this.rows.some(row=>row.ownerId===ownerId&&row.id===id)}
  find(ownerId:string,id:string){return this.rows.find(row=>row.ownerId===ownerId&&row.id===id&&row.status==='pending')}
  async add(row:Omit<Review,'status'|'createdAt'>){
    return this.mutate(async()=>{if(this.rows.some(item=>item.ownerId===row.ownerId&&item.id===row.id))return;const value:Review={...row,status:'pending',createdAt:new Date().toISOString()};await this.append({type:'add',row:value});this.rows.push(value)})
  }
  async resolve(ownerId:string,id:string,status:'approved'|'rejected'){
    return this.mutate(async()=>{const row=this.find(ownerId,id);if(!row)throw new Error('Reporte pendiente no encontrado.');const resolvedAt=new Date().toISOString();await this.append({type:'resolve',ownerId,id,status,resolvedAt});row.status=status;row.resolvedAt=resolvedAt})
  }
}
