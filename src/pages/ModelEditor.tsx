import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { GizmoHelper, GizmoViewport, Line, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import { Box3, Group, Object3D, Vector3 } from 'three'
import { Box, Check, Crosshair, Eye, EyeOff, FolderOpen, Move3D, Plus, Redo2, Rotate3D, Ruler, Save, Scale3D, Trash2, Undo2 } from 'lucide-react'
import { deleteEditorAsset, emptyEditorProject, getEditorAsset, polylineMeters, putEditorAsset, readEditorProject, rigidAlignmentMatrix, saveEditorProject, type EditorProject, type EditorSegment, type Vector3Tuple } from '../lib/modelEditor'
import { api } from '../lib/api'
import { deleteEditorModel, downloadEditorModel, uploadEditorModel } from '../lib/cloud'
import { prepareModelUpload } from '../lib/modelImport'

type Tool='translate'|'rotate'|'scale'|'measure'|'align'
type LoadedSegment=EditorSegment&{url:string}
type PickSource='base'|'segment'

function StoredModel({segment,selected,picking,onObject,onPick}:{segment:LoadedSegment;selected:boolean;picking:boolean;onObject:(id:string,object:Object3D)=>void;onPick:(source:PickSource,id:string,point:Vector3)=>void}){
  const {scene}=useGLTF(segment.url)
  const cloned=useMemo(()=>scene.clone(true),[scene])
  const group=useRef<Group>(null)
  useEffect(()=>{if(group.current)onObject(segment.id,group.current)},[segment.id,onObject])
  useEffect(()=>{cloned.traverse(object=>{const mesh=object as any;if(!mesh.isMesh)return;const list=Array.isArray(mesh.material)?mesh.material:[mesh.material];mesh.material=list.map((material:any)=>{const next=material.clone();next.transparent=segment.opacity<1;next.opacity=segment.opacity;next.depthWrite=segment.opacity>.55;return next});if(!Array.isArray(mesh.material))mesh.material=mesh.material[0]})},[cloned,segment.opacity])
  if(!segment.visible)return null
  return <group ref={group} userData={{editorModel:true}} position={segment.position} rotation={segment.rotation} scale={segment.scale} onClick={(event:any)=>{event.stopPropagation();if(picking)onPick('segment',segment.id,event.point);else onObject(segment.id,event.eventObject)}}><primitive object={cloned}/>{selected&&<boxHelper args={[group.current||undefined,0xf3d58a] as any}/>}</group>
}

function BaseMine({picking,onPick}:{picking:boolean;onPick:(source:PickSource,id:string,point:Vector3)=>void}){
  const appPath=location.pathname.includes('/tests/')?location.pathname.split('/tests/')[0]+'/':location.pathname.replace(/[^/]*$/,'')
  const url=new URL(`${appPath}models/mine-mobile.glb`,location.origin).href
  const {scene}=useGLTF(url)
  const cloned=useMemo(()=>scene.clone(true),[scene])
  return <group userData={{editorModel:true}}><primitive object={cloned} onClick={(event:any)=>{if(picking){event.stopPropagation();onPick('base','base',event.point)}}}/></group>
}

function FitCamera(){
  const {camera,scene}=useThree()
  useEffect(()=>{const timer=setTimeout(()=>{const bounds=new Box3();scene.traverse(object=>{if(object.userData.editorModel)bounds.expandByObject(object)});if(bounds.isEmpty())return;const center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3()),distance=Math.max(size.x,size.y,size.z)*1.15;camera.position.copy(center).add(new Vector3(distance*.8,distance*.55,distance));camera.lookAt(center);camera.near=Math.max(.01,distance/500);camera.far=Math.max(500,distance*15);camera.updateProjectionMatrix()},650);return()=>clearTimeout(timer)},[camera,scene])
  return null
}

function Measurement({points,unitMeters}:{points:Vector3Tuple[];unitMeters:number}){
  if(!points.length)return null
  return <>{points.length>1&&<Line points={points} color="#f3d58a" lineWidth={3}/>} {points.map((point,index)=><mesh key={index} position={point}><sphereGeometry args={[.065,16,16]}/><meshBasicMaterial color={index===0?'#f5f5f7':'#f3d58a'}/></mesh>)}</>
}

function AlignmentMarkers({base,segment}:{base:Vector3Tuple[];segment:Vector3Tuple[]}){
  return <>{base.map((point,index)=><mesh key={`b-${index}`} position={point}><sphereGeometry args={[.09,18,18]}/><meshBasicMaterial color="#54b9ff" depthTest={false}/></mesh>)}{segment.map((point,index)=><mesh key={`s-${index}`} position={point}><sphereGeometry args={[.09,18,18]}/><meshBasicMaterial color="#7ee7a6" depthTest={false}/></mesh>)}</>
}

export default function ModelEditor(){
  const [project,setProject]=useState<EditorProject>(()=>typeof localStorage==='undefined'?emptyEditorProject():readEditorProject())
  const [models,setModels]=useState<LoadedSegment[]>([])
  const [selectedId,setSelectedId]=useState<string|null>(null)
  const [selectedObject,setSelectedObject]=useState<Object3D|null>(null)
  const [tool,setTool]=useState<Tool>('translate')
  const [orbitEnabled,setOrbitEnabled]=useState(true)
  const [measurePoints,setMeasurePoints]=useState<Vector3Tuple[]>([])
  const [alignBase,setAlignBase]=useState<Vector3Tuple[]>([])
  const [alignSegment,setAlignSegment]=useState<Vector3Tuple[]>([])
  const [message,setMessage]=useState('El modelo original está protegido. Aquí solo se añaden ampliaciones.')
  const [calibration,setCalibration]=useState('')
  const objects=useRef(new Map<string,Object3D>())
  const history=useRef<EditorProject[]>([])
  const future=useRef<EditorProject[]>([])

  useEffect(()=>{let active=true;const urls:string[]=[];(async()=>{const remote=await api<EditorProject>('/editor/project').catch(()=>emptyEditorProject());const local=readEditorProject();const selectedProject=remote.segments?.length?remote:local;setProject(selectedProject);saveEditorProject(selectedProject);const loaded:LoadedSegment[]=[];let cloudCount=0;for(const segment of selectedProject.segments){let data:Blob|ArrayBuffer|undefined;if(segment.storagePath){try{data=await downloadEditorModel(segment.storagePath);cloudCount++;await putEditorAsset(segment.id,await data.arrayBuffer())}catch{data=await getEditorAsset(segment.id)}}else data=await getEditorAsset(segment.id);if(!data)continue;const url=URL.createObjectURL(data instanceof Blob?data:new Blob([data],{type:'model/gltf-binary'}));urls.push(url);loaded.push({...segment,url})}if(active){setModels(loaded);setMessage(loaded.length?`${loaded.length} ampliación${loaded.length>1?'es':''} recuperada${loaded.length>1?'s':''}${cloudCount?` · ${cloudCount} desde almacenamiento privado`:''}.`:'El modelo original está protegido. Aquí solo se añaden ampliaciones.')}})().catch(()=>setMessage('No se pudieron recuperar algunas ampliaciones guardadas.'));return()=>{active=false;urls.forEach(URL.revokeObjectURL)}},[])
  const commit=useCallback((next:EditorProject)=>{history.current.push(project);if(history.current.length>40)history.current.shift();future.current=[];setProject(next);saveEditorProject(next)},[project])
  const updateSegment=useCallback((id:string,changes:Partial<EditorSegment>,record=true)=>{const next={...project,segments:project.segments.map(segment=>segment.id===id?{...segment,...changes}:segment)};if(record)commit(next);else{setProject(next);saveEditorProject(next)};setModels(current=>current.map(segment=>segment.id===id?{...segment,...changes}:segment))},[project,commit])
  const objectReady=useCallback((id:string,object:Object3D)=>{objects.current.set(id,object);if(id===selectedId)setSelectedObject(object)},[selectedId])
  useEffect(()=>{setSelectedObject(selectedId?objects.current.get(selectedId)||null:null)},[selectedId,models])
  const pickPoint=useCallback((source:PickSource,id:string,point:Vector3)=>{
    const tuple=[point.x,point.y,point.z] as Vector3Tuple
    if(tool==='measure'){setMeasurePoints(current=>[...current,tuple]);return}
    if(tool!=='align'||!selectedId)return
    if(alignBase.length<3){
      if(source!=='base'){setMessage('Primero toca 3 puntos en la mina principal (azules).');return}
      const next=[...alignBase,tuple];setAlignBase(next)
      setMessage(next.length===3?'Ahora toca los mismos 3 puntos, en el mismo orden, sobre la ampliación.':`Punto maestro ${next.length}/3 marcado.`)
      return
    }
    if(source!=='segment'||id!==selectedId){setMessage('Toca ahora la ampliación seleccionada, no la mina principal.');return}
    const next=[...alignSegment,tuple];setAlignSegment(next)
    if(next.length<3){setMessage(`Punto de ampliación ${next.length}/3 marcado.`);return}
    const object=objects.current.get(selectedId)
    if(!object)return setMessage('Selecciona nuevamente la ampliación para alinearla.')
    try{
      object.updateWorldMatrix(true,false)
      const aligned=rigidAlignmentMatrix(next,alignBase).multiply(object.matrixWorld.clone())
      aligned.decompose(object.position,object.quaternion,object.scale)
      object.updateMatrixWorld(true)
      updateSegment(selectedId,{position:object.position.toArray() as Vector3Tuple,rotation:[object.rotation.x,object.rotation.y,object.rotation.z],scale:object.scale.toArray() as Vector3Tuple})
      setTool('translate');setAlignBase([]);setAlignSegment([]);setMessage('Encaje por 3 puntos aplicado. Revisa la unión y haz un ajuste fino si fuera necesario.')
    }catch(error){setAlignSegment([]);setMessage((error as Error).message)}
  },[tool,selectedId,alignBase,alignSegment,updateSegment])

  function startAlignment(){
    if(!selectedId)return setMessage('Selecciona primero la ampliación que deseas encajar.')
    setTool('align');setAlignBase([]);setAlignSegment([]);setMessage('Encaje 3 puntos: toca 3 referencias claras en la mina principal, siempre en el mismo orden.')
  }

  function setTransformVector(kind:'position'|'rotation'|'scale',index:number,raw:string){
    if(!selected)return
    const value=Number(raw);if(!Number.isFinite(value))return
    const vector=[...selected[kind]] as Vector3Tuple
    vector[index]=kind==='rotation'?value*Math.PI/180:value
    updateSegment(selected.id,{[kind]:vector},false)
  }
  function nudge(axis:0|1|2,amount:number){
    if(!selected)return
    const position=[...selected.position] as Vector3Tuple;position[axis]+=amount;updateSegment(selected.id,{position})
  }

  async function addFiles(files:FileList|null){
    if(!files?.length)return
    const additions:EditorSegment[]=[];const loaded:LoadedSegment[]=[]
    for(const file of Array.from(files)){
      let prepared
      try{setMessage(`Preparando ${file.name}…`);prepared=await prepareModelUpload(file)}catch(error){setMessage((error as Error).message);continue}
      const id=crypto.randomUUID(),data=prepared.data;await putEditorAsset(id,data);let storagePath='';try{storagePath=await uploadEditorModel(id,new Blob([data],{type:'model/gltf-binary'}))}catch{}
      const segment:EditorSegment={id,name:prepared.name.replace(/\.glb$/i,''),fileName:file.name,createdAt:new Date().toISOString(),position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],opacity:1,visible:true,storagePath}
      const url=URL.createObjectURL(new Blob([data],{type:'model/gltf-binary'}));additions.push(segment);loaded.push({...segment,url})
    }
    if(additions.length){commit({...project,segments:[...project.segments,...additions]});setModels(current=>[...current,...loaded]);setSelectedId(additions.at(-1)!.id);const cloud=additions.filter(x=>x.storagePath).length;setMessage(`${additions.length} ampliación${additions.length>1?'es':''} cargada${additions.length>1?'s':''}${cloud===additions.length?' y protegida en la nube':' localmente'}. Usa Mover y llévala hasta el extremo correspondiente de la mina.`)}
  }
  function captureTransform(){if(!selectedId||!selectedObject)return;updateSegment(selectedId,{position:selectedObject.position.toArray() as Vector3Tuple,rotation:[selectedObject.rotation.x,selectedObject.rotation.y,selectedObject.rotation.z],scale:selectedObject.scale.toArray() as Vector3Tuple})}
  function undo(){const previous=history.current.pop();if(!previous)return;future.current.push(project);setProject(previous);saveEditorProject(previous);setModels(current=>current.map(model=>({...model,...previous.segments.find(x=>x.id===model.id)})));setMessage('Cambio deshecho.')}
  function redo(){const next=future.current.pop();if(!next)return;history.current.push(project);setProject(next);saveEditorProject(next);setModels(current=>current.map(model=>({...model,...next.segments.find(x=>x.id===model.id)})));setMessage('Cambio recuperado.')}
  async function removeSelected(){if(!selectedId)return;const current=models.find(x=>x.id===selectedId);if(!confirm(`¿Quitar la ampliación “${current?.name||''}”? El modelo original no será afectado.`))return;await deleteEditorAsset(selectedId);if(current?.storagePath)await deleteEditorModel(current.storagePath).catch(()=>{});if(current)URL.revokeObjectURL(current.url);const next={...project,segments:project.segments.filter(x=>x.id!==selectedId)};commit(next);setModels(value=>value.filter(x=>x.id!==selectedId));setSelectedId(null);setSelectedObject(null);await api('/editor/project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)}).catch(()=>{})}
  async function saveEverywhere(){saveEditorProject(project);try{await api('/editor/project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(project)});const localOnly=project.segments.filter(x=>!x.storagePath).length;setMessage(localOnly?`Proyecto sincronizado. ${localOnly} archivo${localOnly>1?'s':''} GLB permanece${localOnly>1?'n':''} solo en este dispositivo hasta activar el almacenamiento privado.`:'Proyecto y archivos sincronizados de forma privada. Ya puedes abrirlos desde otra computadora.')}catch(error){setMessage(`Guardado localmente. ${(error as Error).message}`)}}
  function calibrate(){if(measurePoints.length<2)return setMessage('Marca primero dos puntos de una distancia conocida.');const real=Number(calibration.replace(',','.'));const raw=polylineMeters(measurePoints.slice(-2),1);if(!Number.isFinite(real)||real<=0||raw<=0)return setMessage('Introduce una distancia real válida en metros.');const next={...project,unitMeters:real/raw};commit(next);setMessage(`Escala calibrada: las mediciones ya se muestran en metros reales.`)}
  const distance=polylineMeters(measurePoints,project.unitMeters)
  const visibleModels=models.filter(model=>project.segments.some(segment=>segment.id===model.id))
  const selected=visibleModels.find(x=>x.id===selectedId)
  return <div className="editor-page">
    <section className="editor-intro glass"><div><span className="eyebrow">LABORATORIO AISLADO</span><h2>Editor de ampliaciones 3D</h2><p>Carga únicamente el avance nuevo, colócalo junto al escaneo maestro y mide tramos. Esta sección no escribe ni transforma <b>Modelo 3D</b>.</p></div><label className="primary-button"><Plus/> Subir GLB, PLY o ZIP<input type="file" accept=".glb,.ply,.zip,model/gltf-binary,application/zip" multiple hidden onChange={event=>{void addFiles(event.target.files);event.currentTarget.value=''}}/></label></section>
    <div className="editor-workspace">
      <aside className="editor-panel glass"><div className="editor-panel-title"><FolderOpen/><div><b>Capas del proyecto</b><small>Modelo maestro + avances</small></div></div><button className="segment-row master active"><Box/><span><b>Mina principal</b><small>Protegida · solo lectura</small></span><Eye/></button>{visibleModels.map(segment=><button key={segment.id} className={`segment-row ${selectedId===segment.id?'active':''}`} onClick={()=>setSelectedId(segment.id)}><span className="segment-dot"/><span><b>{segment.name}</b><small>{new Date(segment.createdAt).toLocaleDateString('es-PE')}</small></span><i onClick={event=>{event.stopPropagation();updateSegment(segment.id,{visible:!segment.visible})}}>{segment.visible?<Eye/>:<EyeOff/>}</i></button>)}{!visibleModels.length&&<div className="editor-empty">Sube el siguiente escaneo de Polycam en GLB, PLY o ZIP. Si el ZIP contiene un PLY, se convierte automáticamente a GLB.</div>}
        {selected&&<div className="segment-properties"><label>Nombre<input value={selected.name} onChange={event=>updateSegment(selected.id,{name:event.target.value},false)}/></label><div className="transform-section"><b>Posición</b><div className="transform-grid">{(['X','Y','Z'] as const).map((axis,index)=><label key={axis}>{axis}<input key={`${selected.id}-p-${index}-${selected.position[index]}`} inputMode="decimal" defaultValue={selected.position[index].toFixed(2)} onFocus={event=>event.currentTarget.select()} onBlur={event=>setTransformVector('position',index,event.target.value)}/></label>)}</div><div className="nudge-grid"><button onClick={()=>nudge(0,-.1)}>−X</button><button onClick={()=>nudge(0,.1)}>+X</button><button onClick={()=>nudge(1,-.1)}>−Y</button><button onClick={()=>nudge(1,.1)}>+Y</button><button onClick={()=>nudge(2,-.1)}>−Z</button><button onClick={()=>nudge(2,.1)}>+Z</button></div></div><div className="transform-section"><b>Rotación · grados</b><div className="transform-grid">{(['X','Y','Z'] as const).map((axis,index)=><label key={axis}>{axis}<input key={`${selected.id}-r-${index}-${selected.rotation[index]}`} inputMode="decimal" defaultValue={(selected.rotation[index]*180/Math.PI).toFixed(1)} onFocus={event=>event.currentTarget.select()} onBlur={event=>setTransformVector('rotation',index,event.target.value)}/></label>)}</div></div><div className="transform-section"><b>Escala</b><div className="transform-grid">{(['X','Y','Z'] as const).map((axis,index)=><label key={axis}>{axis}<input key={`${selected.id}-s-${index}-${selected.scale[index]}`} inputMode="decimal" defaultValue={selected.scale[index].toFixed(3)} onFocus={event=>event.currentTarget.select()} onBlur={event=>setTransformVector('scale',index,event.target.value)}/></label>)}</div></div><label>Transparencia <b>{Math.round(selected.opacity*100)}%</b><input type="range" min="0.15" max="1" step="0.05" value={selected.opacity} onChange={event=>updateSegment(selected.id,{opacity:Number(event.target.value)},false)}/></label><button className={`align-button ${tool==='align'?'active':''}`} onClick={startAlignment}><Crosshair/> Encaje por 3 puntos</button><button className="danger subtle" onClick={()=>void removeSelected()}><Trash2/> Quitar ampliación</button></div>}
      </aside>
      <section className="editor-canvas glass">
        <div className="editor-toolbar"><button className={tool==='translate'?'active':''} onClick={()=>setTool('translate')} disabled={!selected}><Move3D/> Mover</button><button className={tool==='rotate'?'active':''} onClick={()=>setTool('rotate')} disabled={!selected}><Rotate3D/> Girar</button><button className={tool==='scale'?'active':''} onClick={()=>setTool('scale')} disabled={!selected}><Scale3D/> Escala</button><button className={tool==='align'?'active':''} onClick={startAlignment} disabled={!selected}><Crosshair/> Encajar</button><button className={tool==='measure'?'active':''} onClick={()=>{setTool('measure');setSelectedId(null);setAlignBase([]);setAlignSegment([])}}><Ruler/> Medir</button><span/><button onClick={undo} title="Deshacer"><Undo2/></button><button onClick={redo} title="Rehacer"><Redo2/></button><button onClick={()=>void saveEverywhere()}><Save/> Guardar</button></div>
        <Canvas camera={{position:[15,12,18],fov:52,near:.02,far:1000}} dpr={[1,1.6]} gl={{antialias:true,powerPreference:'high-performance'}} onPointerMissed={()=>{if(tool!=='measure')setSelectedId(null)}}>
          <color attach="background" args={['#090a0c']}/><ambientLight intensity={2}/><directionalLight position={[15,22,10]} intensity={1.2}/><gridHelper args={[120,120,'#4a4c52','#202126']} position={[0,-.03,0]}/>
          <Suspense fallback={null}><BaseMine picking={tool==='measure'||tool==='align'} onPick={pickPoint}/>{visibleModels.map(segment=><StoredModel key={segment.id} segment={segment} selected={selectedId===segment.id} picking={tool==='measure'||tool==='align'} onObject={objectReady} onPick={pickPoint}/>)}</Suspense>
          <Measurement points={measurePoints} unitMeters={project.unitMeters}/><AlignmentMarkers base={alignBase} segment={alignSegment}/>{selectedObject&&['translate','rotate','scale'].includes(tool)&&<TransformControls object={selectedObject} mode={tool as 'translate'|'rotate'|'scale'} translationSnap={.01} rotationSnap={Math.PI/180} scaleSnap={.01} onMouseDown={()=>setOrbitEnabled(false)} onMouseUp={()=>{setOrbitEnabled(true);captureTransform()}}/>}<OrbitControls makeDefault enabled={orbitEnabled} enableDamping screenSpacePanning/><GizmoHelper alignment="bottom-right" margin={[75,75]}><GizmoViewport axisColors={['#e66f74','#78c99d','#78aee8']} labelColor="white"/></GizmoHelper><FitCamera/>
        </Canvas>
        <div className="editor-status"><span>{message}</span>{tool==='measure'&&<b>{measurePoints.length} puntos · {distance.toFixed(2)} m</b>}{tool==='align'&&<b>Maestro {alignBase.length}/3 · Ampliación {alignSegment.length}/3</b>}</div>
      </section>
      <aside className="measure-panel glass"><div className="editor-panel-title"><Ruler/><div><b>Medición real</b><small>Polilínea sobre la geometría</small></div></div><p>Activa <b>Medir</b> y toca el inicio, curvas y final del tramo.</p><div className="measure-total"><span>Longitud acumulada</span><strong>{distance.toFixed(2)} m</strong></div><button onClick={()=>setMeasurePoints([])} disabled={!measurePoints.length}>Limpiar puntos</button><hr/><label>Distancia real entre los últimos 2 puntos<input inputMode="decimal" placeholder="Ej. 2.50" value={calibration} onChange={event=>setCalibration(event.target.value)}/></label><button onClick={calibrate}><Check/> Calibrar escala</button><small>Si Polycam exportó en metros, deja la escala en 1. Calibra con una medida física conocida para mayor precisión.</small></aside>
    </div>
  </div>
}
