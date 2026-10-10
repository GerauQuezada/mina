import test from 'node:test'
import assert from 'node:assert/strict'
import type {EditorProject,EditorSegment} from '../src/lib/modelEditor'
import {mergeEditorUploads,selectEditorProject,syncEditorAssets} from '../src/lib/modelEditorSync'

const segment=(id:string,changes:Partial<EditorSegment>={}):EditorSegment=>({id,name:id,fileName:id+'.glb',createdAt:'2026-10-10',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],opacity:1,visible:true,...changes})
const project=(segments:EditorSegment[]):EditorProject=>({version:1,unitMeters:1,segments})

test('reload preserves unsynced local drafts and honours confirmed remote deletions',()=>{
  const local={...project([segment('draft')]),syncPending:true}
  const older=project([segment('older')])
  assert.equal(selectEditorProject(older,local),local)
  assert.equal(selectEditorProject(null,local),local)
  const emptyRemote=project([])
  assert.equal(selectEditorProject(emptyRemote,{...local,syncPending:false}),emptyRemote)
})

test('editor retries only local copies and reports failures without hiding successful uploads',async()=>{
  const initial=project([segment('saved',{storagePath:'owner/saved.glb'}),segment('retry'),segment('gaussian',{format:'splat-ply'}),segment('missing')])
  const uploaded:string[]=[]
  const result=await syncEditorAssets(initial,async id=>id==='missing'?undefined:new Uint8Array([1,2,3]).buffer,async(id,file,format)=>{
    uploaded.push(id)
    if(id==='retry')throw new Error('Sin conexión')
    assert.equal(format,'splat-ply');assert.equal(file.type,'application/octet-stream')
    assert.equal(file.size,3)
    return 'owner/gaussian.ply'
  })
  assert.deepEqual(uploaded,['retry','gaussian'])
  assert.deepEqual(result.paths,{gaussian:'owner/gaussian.ply'})
  assert.deepEqual(result.failures.map(item=>item.id),['retry','missing'])
  assert.equal(initial.segments[2].storagePath,undefined)
  const next=mergeEditorUploads(initial,result.paths)
  const retry=await syncEditorAssets(next,async()=>new Uint8Array([1]).buffer,async(id,file,format)=>{
    assert.notEqual(id,'saved');assert.notEqual(id,'gaussian');assert.equal(format,'glb');assert.equal(file.type,'model/gltf-binary');return 'owner/'+id+'.glb'
  })
  assert.equal(retry.failures.length,0)
  assert.deepEqual(Object.keys(retry.paths),['retry','missing'])
})

test('upload completion preserves current transforms and cannot resurrect a removed scan',()=>{
  const latest=project([segment('moved',{position:[4,5,6],rotation:[.1,.2,.3],scale:[2,2,2]}),segment('new')])
  latest.scaleVerified=true;latest.unitMeters=.98
  const merged=mergeEditorUploads(latest,{moved:'owner/moved.glb',deleted:'owner/deleted.glb'})
  assert.deepEqual(merged.segments[0].position,[4,5,6])
  assert.deepEqual(merged.segments[0].rotation,[.1,.2,.3])
  assert.deepEqual(merged.segments[0].scale,[2,2,2])
  assert.equal(merged.scaleVerified,true);assert.equal(merged.unitMeters,.98)
  assert.deepEqual(merged.segments.map(item=>item.id),['moved','new'])
  assert.equal(latest.segments[0].storagePath,undefined)
})
