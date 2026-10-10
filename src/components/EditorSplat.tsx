import { useEffect, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { SparkRenderer, SplatFileType, SplatMesh } from '@sparkjsdev/spark'
import type { Group, Object3D, Vector3 } from 'three'
import type { EditorSegment } from '../lib/modelEditor'

// One renderer for the editor canvas, not one GPU accumulator per scan.
export function EditorSparkRenderer(){
  const {gl,scene,invalidate}=useThree()
  useEffect(()=>{
    const renderer=new SparkRenderer({renderer:gl,onDirty:invalidate})
    scene.add(renderer)
    return()=>{scene.remove(renderer);renderer.dispose()}
  },[gl,scene,invalidate])
  return null
}

export default function EditorSplat({segment,picking,onObject,onPick,onError}:{
  segment:EditorSegment&{url:string};picking:boolean
  onObject:(id:string,object:Object3D)=>void
  onPick:(source:'segment',id:string,point:Vector3)=>void
  onError:(message:string)=>void
}){
  const group=useRef<Group>(null)
  const [mesh,setMesh]=useState<SplatMesh|null>(null)
  const {invalidate}=useThree()
  const ready=useRef(onObject);ready.current=onObject
  useEffect(()=>{
    let active=true
    const object=new SplatMesh({url:segment.url,fileType:SplatFileType.PLY,raycastable:true})
    let disposed=false
    const dispose=()=>{if(!disposed){disposed=true;object.dispose()}}
    object.initialized.then(()=>{
      if(!active){dispose();return}
      const bounds=object.getBoundingBox()
      if(bounds.isEmpty()){dispose();onError('El Gaussian PLY no contiene puntos visibles.');return}
      // Box3.setFromObject recognises this local bound for camera framing.
      Object.assign(object,{boundingBox:bounds})
      group.current?.add(object);setMesh(object)
      if(group.current)ready.current(segment.id,group.current)
      invalidate()
    }).catch(error=>{dispose();if(active)onError(`No se pudo mostrar el Gaussian PLY: ${String(error)}`)})
    return()=>{active=false;object.removeFromParent();if(object.isInitialized)dispose()}
  },[segment.id,segment.url,onError,invalidate])
  useEffect(()=>{if(mesh){mesh.opacity=segment.opacity;mesh.needsUpdate=true;invalidate()}},[mesh,segment.opacity,invalidate])
  useEffect(()=>{if(mesh&&group.current)onObject(segment.id,group.current)},[mesh,onObject,segment.id])
  return <group ref={group} visible={segment.visible} position={segment.position} rotation={segment.rotation} scale={segment.scale}
    onClick={event=>{event.stopPropagation();if(picking)onPick('segment',segment.id,event.point);else if(group.current)onObject(segment.id,group.current)}}/>
}
