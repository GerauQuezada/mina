import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF, useProgress } from '@react-three/drei'
import { Box, Expand, Focus, Footprints, LocateFixed, MousePointer2, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import * as THREE from 'three'
import { WALK_KEYS, WALK_START_POSITION, WALK_START_TARGET } from '../three/walkConfig'

import { createRuntime, firstDistance, isWalkPosition, snapStartToFloor, stepWalkExplore, walkTarget, type ModelRuntime } from '../three/walkPhysics'

type Mode='exterior'|'walk'
type MoveState={x:number;z:number;lookX:number;lookY:number}
const tempForward=new THREE.Vector3()
const tempPlanarForward=new THREE.Vector3()
const tempRight=new THREE.Vector3()
const tempInput=new THREE.Vector3()
const tempEuler=new THREE.Euler(0,0,0,'YXZ')

function MineModel({url,onReady,selecting,onSelect}:{url:string;onReady:(runtime:ModelRuntime)=>void;selecting:boolean;onSelect:(point:THREE.Vector3)=>void}){
  const {scene}=useGLTF(url)
  const {gl}=useThree()
  const runtime=useMemo(()=>createRuntime(scene),[scene])
  useEffect(()=>{scene.traverse(object=>{if((object as THREE.Mesh).isMesh){const mesh=object as THREE.Mesh;mesh.castShadow=false;mesh.receiveShadow=true;mesh.frustumCulled=true;const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];materials.forEach(material=>{if(material instanceof THREE.MeshStandardMaterial){material.metalness=0;material.roughness=1}const map=(material as THREE.MeshStandardMaterial).map;if(map){map.anisotropy=Math.min(8,gl.capabilities.getMaxAnisotropy());map.needsUpdate=true}})}});onReady(runtime);return()=>{}},[scene,runtime,onReady])
  return <primitive object={scene} onClick={(event:any)=>{if(selecting&&event.delta<5){event.stopPropagation();onSelect(event.point)}}}/>
}

function Loading(){
  const {progress,errors}=useProgress()
  if(progress>=100&&!errors.length)return null
  return <div className="model-loading model-loading-overlay glass"><span className="loader"/><b>{errors.length?'No se pudo cargar el modelo':'Cargando modelo 3D…'}</b><div><i style={{width:`${progress}%`}}/></div><span>{Math.round(progress)}%</span></div>
}

function ExteriorCamera({active,runtime}:{active:boolean;runtime:ModelRuntime|null}){
  const {camera,size}=useThree()
  useEffect(()=>{
    if(!active||!runtime)return
    const perspective=camera as THREE.PerspectiveCamera
    const halfVertical=THREE.MathUtils.degToRad(perspective.fov/2)
    const halfHorizontal=Math.atan(Math.tan(halfVertical)*size.width/size.height)
    const distance=runtime.sphere.radius/Math.sin(Math.min(halfVertical,halfHorizontal))*1.05
    camera.near=Math.max(.05,runtime.metrics.near);camera.far=Math.max(runtime.metrics.far,distance*3)
    camera.position.copy(runtime.center).addScaledVector(new THREE.Vector3(.7,.46,1).normalize(),distance)
    camera.lookAt(runtime.center);camera.updateProjectionMatrix()
  },[active,runtime,camera,size.width,size.height])
  return null
}

function WalkController({active,runtime,move,onPosition,onLock,startOverride,resetKey}:{active:boolean;runtime:ModelRuntime|null;startOverride:THREE.Vector3|null;resetKey:number;move:React.MutableRefObject<MoveState>;onPosition:(position:THREE.Vector3)=>void;onLock:(locked:boolean)=>void}){
  const {camera,gl}=useThree()
  const keys=useRef<Record<string,boolean>>({})
  const velocity=useRef(new THREE.Vector3())
  const lastPositionReport=useRef(0)
  const startPosition=useRef(new THREE.Vector3())
  useEffect(()=>{if(!active||!runtime)return;const start=startOverride||snapStartToFloor(runtime,runtime.metrics.eyeHeight);if(!start)return;startPosition.current.copy(start);camera.position.copy(start);camera.near=runtime.metrics.near;camera.far=runtime.metrics.far;camera.up.set(0,1,0);camera.lookAt(startOverride?walkTarget(runtime,startOverride):runtime.detectedTarget||WALK_START_TARGET);camera.updateProjectionMatrix();tempEuler.setFromQuaternion(camera.quaternion,'YXZ');velocity.current.set(0,0,0);onPosition(camera.position)},[active,runtime,camera,onPosition,startOverride,resetKey])
  useEffect(()=>{if(!active)return;const clear=()=>{keys.current={};velocity.current.set(0,0,0);move.current={x:0,z:0,lookX:0,lookY:0}};clear();const down=(event:KeyboardEvent)=>{if(WALK_KEYS.has(event.code)){event.preventDefault();keys.current[event.code]=true}};const up=(event:KeyboardEvent)=>{if(WALK_KEYS.has(event.code)){event.preventDefault();keys.current[event.code]=false}};addEventListener('blur',clear);document.addEventListener('visibilitychange',clear);addEventListener('keydown',down,{passive:false});addEventListener('keyup',up,{passive:false});return()=>{clear();removeEventListener('blur',clear);document.removeEventListener('visibilitychange',clear);removeEventListener('keydown',down);removeEventListener('keyup',up)}},[active])
  useEffect(()=>{if(!active)return;const isTouch=matchMedia('(pointer: coarse), (max-width: 760px)').matches;const pointerLock=()=>{if(!isTouch&&document.pointerLockElement!==gl.domElement)gl.domElement.requestPointerLock?.()?.catch?.(()=>{})};const lockChange=()=>onLock(document.pointerLockElement===gl.domElement);const mouseMove=(event:MouseEvent)=>{if(document.pointerLockElement===gl.domElement){move.current.lookX+=event.movementX;move.current.lookY+=event.movementY}};gl.domElement.addEventListener('mousedown',pointerLock);document.addEventListener('pointerlockchange',lockChange);document.addEventListener('mousemove',mouseMove);return()=>{gl.domElement.removeEventListener('mousedown',pointerLock);document.removeEventListener('pointerlockchange',lockChange);document.removeEventListener('mousemove',mouseMove);if(document.pointerLockElement===gl.domElement)document.exitPointerLock?.();onLock(false)}},[active,gl,move,onLock])
  useFrame(({clock},frameDelta)=>{
    if(!active||!runtime)return
    const delta=Math.min(frameDelta,.1)
    tempEuler.setFromQuaternion(camera.quaternion,'YXZ')
    tempEuler.y-=move.current.lookX*.0022;tempEuler.x=THREE.MathUtils.clamp(tempEuler.x-move.current.lookY*.0022,-Math.PI*.47,Math.PI*.47);tempEuler.z=0;camera.quaternion.setFromEuler(tempEuler);move.current.lookX=0;move.current.lookY=0
    camera.getWorldDirection(tempForward);tempForward.normalize();tempPlanarForward.set(tempForward.x,0,tempForward.z);if(tempPlanarForward.lengthSq()<1e-8)tempPlanarForward.set(0,0,-1);tempPlanarForward.normalize();tempRight.crossVectors(tempPlanarForward,camera.up).normalize()
    const forward=(keys.current.KeyW||keys.current.ArrowUp?1:0)-(keys.current.KeyS||keys.current.ArrowDown?1:0)+move.current.z
    const side=(keys.current.KeyD||keys.current.ArrowRight?1:0)-(keys.current.KeyA||keys.current.ArrowLeft?1:0)+move.current.x
    // Keep full walking speed on the horizontal plane even while looking at
    // the floor or ceiling. Camera pitch only guides which floor level to
    // follow; it must never make W stall in front of rubble.
    tempInput.set(0,0,0).addScaledVector(tempPlanarForward,forward).addScaledVector(tempRight,side);if(tempInput.lengthSq()>1)tempInput.normalize()
    const damping=Math.exp(-10*delta);velocity.current.x*=damping;velocity.current.z*=damping
    velocity.current.x+=tempInput.x*runtime.metrics.speed*(1-damping);velocity.current.z+=tempInput.z*runtime.metrics.speed*(1-damping)
    const verticalSpeed=tempForward.y*forward*runtime.metrics.speed
    const steps=Math.max(1,Math.ceil(delta/(1/120)),Math.ceil(velocity.current.length()*delta/(runtime.metrics.radius*.45)));const step=delta/steps
    for(let index=0;index<steps;index++){
      velocity.current.y=verticalSpeed
      stepWalkExplore(camera.position,velocity.current,runtime,step)
    }
    const margin=runtime.metrics.eyeHeight*2
    if(camera.position.x<runtime.bounds.min.x-margin||camera.position.x>runtime.bounds.max.x+margin||camera.position.y<runtime.bounds.min.y-margin||camera.position.y>runtime.bounds.max.y+margin||camera.position.z<runtime.bounds.min.z-margin||camera.position.z>runtime.bounds.max.z+margin){camera.position.copy(startPosition.current);velocity.current.set(0,0,0)}
    if(clock.elapsedTime-lastPositionReport.current>.25){lastPositionReport.current=clock.elapsedTime;onPosition(camera.position)}
  })
  return null
}

export default function Model3D(){
  const [mode,setMode]=useState<Mode>('exterior')
  const [retry,setRetry]=useState(0)
  const [resetKey,setResetKey]=useState(0)
  const [quality,setQuality]=useState<'auto'|'original'>('auto')
  const [selecting,setSelecting]=useState(false)
  const [startOverride,setStartOverride]=useState<THREE.Vector3|null>(null)
  const [hint,setHint]=useState('')
  const [runtime,setRuntime]=useState<ModelRuntime|null>(null)
  const [position,setPosition]=useState(new THREE.Vector3())
  const [pointerLocked,setPointerLocked]=useState(false)
  const wrap=useRef<HTMLDivElement>(null)
  const controls=useRef<any>(null)
  const move=useRef<MoveState>({x:0,z:0,lookX:0,lookY:0})
  const touchDevice=matchMedia('(pointer: coarse), (max-width: 760px)').matches
  const mobile=matchMedia('(max-width: 760px)').matches||((navigator.hardwareConcurrency||8)<=4)
  const url=new URL(`models/${mobile&&quality==='auto'?'mine-mobile.glb':'mine.glb'}`,document.baseURI).href
  const handlePosition=useCallback((value:THREE.Vector3)=>setPosition(value.clone()),[])
  const enterWalk=()=>{if(!runtime||!(startOverride||snapStartToFloor(runtime,runtime.metrics.eyeHeight))){setHint('No se encontró un inicio transitable. Usa Elegir entrada y toca el suelo visible.');return}setSelecting(false);setMode('walk');move.current={x:0,z:0,lookX:0,lookY:0}}
  const exitWalk=()=>{document.exitPointerLock?.();setMode('exterior');move.current={x:0,z:0,lookX:0,lookY:0}}
  const reloadModel=()=>{setMode('exterior');document.exitPointerLock?.();setRuntime(null);move.current={x:0,z:0,lookX:0,lookY:0};setRetry(value=>value+1)}
  const reset=()=>{if(mode==='walk')setResetKey(x=>x+1);else controls.current?.reset()}
  const fullscreen=()=>wrap.current?.requestFullscreen?.()
  const choose=useCallback((point:THREE.Vector3)=>{if(!runtime)return;const eye=point.clone();eye.y+=runtime.metrics.eyeHeight;if(!isWalkPosition(runtime.collider,eye,runtime.metrics)){setHint('Ese punto no tiene espacio libre. Toca otra superficie del suelo.');return}const floor=firstDistance(runtime.collider,eye,new THREE.Vector3(0,-1,0),runtime.metrics.eyeHeight*1.15);if(Math.abs(floor-runtime.metrics.eyeHeight)>runtime.metrics.radius){setHint('Elige una superficie horizontal con suelo.');return}setStartOverride(eye);setSelecting(false);setHint('Entrada elegida. Pulsa Recorrido para caminar desde aquí.')},[runtime])
  const ready=runtime!==null
  return <div className="model-page">
    <div className="model-toolbar glass"><div><Box/><span><b>Modelo Polycam real</b><small>{runtime?`${runtime.size.x.toFixed(1)} × ${runtime.size.y.toFixed(1)} × ${runtime.size.z.toFixed(1)} u · ${Math.round(runtime.triangles).toLocaleString('es-PE')} triángulos`:(mobile?'Calidad móvil optimizada':'Calidad original · 43.9 MB')}</small></span></div><div className="mode-buttons"><button className={mode==='exterior'?'active':''} onClick={exitWalk}><Focus/> Explorar</button><button className={mode==='walk'?'active':''} onClick={enterWalk} disabled={!ready}><Footprints/> Recorrido</button><button onClick={()=>{exitWalk();setSelecting(x=>!x);setHint("Toca un suelo visible del modelo para elegir tu entrada.")}} disabled={!ready}><LocateFixed/> Elegir entrada</button><select aria-label="Calidad de texturas" className="quality-control" value={quality} onChange={e=>{exitWalk();setRuntime(null);setStartOverride(null);setQuality(e.target.value as typeof quality);setRetry(x=>x+1)}}><option value="auto">Calidad adaptable</option><option value="original">Texturas originales</option></select></div></div>
    <div className={`viewer glass ${mode==='walk'?'walking':''}`} ref={wrap}>
      <Canvas key={url+retry} camera={{position:[22,18,28],fov:58,near:.03,far:500}} dpr={quality==='original'?[1,2]:mobile?[1,1.5]:[1,2]} gl={{antialias:!mobile,powerPreference:'high-performance'}}>
        <color attach="background" args={['#777a80']}/><ambientLight intensity={1.8}/><directionalLight position={[12,20,10]} intensity={1}/>
        <Suspense fallback={null}><MineModel url={url} onReady={setRuntime} selecting={selecting} onSelect={choose}/></Suspense>
        <ExteriorCamera active={mode==='exterior'} runtime={runtime}/>
        {mode==='exterior'&&<OrbitControls ref={controls} makeDefault enableDamping enablePan screenSpacePanning touches={{ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN}} target={runtime?.center||new THREE.Vector3()} minDistance={.2} maxDistance={runtime?runtime.sphere.radius*8:240}/>}
        <WalkController active={mode==='walk'} runtime={runtime} startOverride={startOverride} resetKey={resetKey} move={move} onPosition={handlePosition} onLock={setPointerLocked}/>
      </Canvas>
      <Loading/>
      {mode==='exterior'&&hint&&<div className="selection-hint glass">{hint}</div>}
      <div className="viewer-actions"><button onClick={()=>controls.current?.dollyIn(1.3)} title="Acercar" disabled={mode==='walk'}><ZoomIn/></button><button onClick={()=>controls.current?.dollyOut(1.3)} title="Alejar" disabled={mode==='walk'}><ZoomOut/></button><button onClick={reset} title="Restablecer"><Undo2/></button><button onClick={fullscreen} title="Pantalla completa"><Expand/></button></div>
      {mode==='walk'&&<><div className="walk-debug glass"><LocateFixed/><span>X {position.x.toFixed(2)} · Y {position.y.toFixed(2)} · Z {position.z.toFixed(2)}</span><small>Altura {runtime?.metrics.eyeHeight.toFixed(2)} u · Perfil ultracompacto · Suelo activo · {startOverride?'Entrada elegida':'Inicio interior validado'}</small></div><div className="walk-crosshair"/><div className="walk-help glass"><MousePointer2/><span>{touchDevice?'Joystick para caminar · Mira arriba o abajo para cambiar de nivel':pointerLocked?'WASD/Flechas · La inclinación de la mirada guía subidas y bajadas · ESC libera el ratón':'Haz clic dentro del visor para controlar la mirada'}</span></div><button className="exit-walk glass" onClick={exitWalk}><X/> Salir del recorrido</button>{touchDevice&&<MobileWalkControls move={move}/>}</>}
    </div>
    <div className="model-note"><b>{mode==='walk'?'Recorrido interno en primera persona':'Modelo original sin modificaciones'}</b><p>{mode==='walk'?'Las paredes amplias permanecen sólidas. Cinco puntos detectan el suelo y conservan una altura segura sobre huecos del escaneo, sin caídas ni reinicios.':'Pulsa Recorrido para entrar por una abertura transitable detectada en el modelo con movilidad completa.'}</p><button onClick={reloadModel}>Reintentar carga</button></div>
  </div>
}

function MobileWalkControls({move}:{move:React.MutableRefObject<MoveState>}){
  const [knob,setKnob]=useState({x:0,y:0})
  const joystickOrigin=useRef({x:0,y:0})
  const lookPoint=useRef({x:0,y:0})
  const startJoystick=(event:React.PointerEvent<HTMLDivElement>)=>{event.currentTarget.setPointerCapture(event.pointerId);const rect=event.currentTarget.getBoundingClientRect();joystickOrigin.current={x:rect.left+rect.width/2,y:rect.top+rect.height/2}}
  const moveJoystick=(event:React.PointerEvent<HTMLDivElement>)=>{if(!event.currentTarget.hasPointerCapture(event.pointerId))return;const dx=event.clientX-joystickOrigin.current.x;const dy=event.clientY-joystickOrigin.current.y;const length=Math.hypot(dx,dy);const scale=length>38?38/length:1;const x=dx*scale;const y=dy*scale;setKnob({x,y});move.current.x=x/38;move.current.z=-y/38}
  const endJoystick=(event:React.PointerEvent<HTMLDivElement>)=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);setKnob({x:0,y:0});move.current.x=0;move.current.z=0}
  const startLook=(event:React.PointerEvent<HTMLDivElement>)=>{event.currentTarget.setPointerCapture(event.pointerId);lookPoint.current={x:event.clientX,y:event.clientY}}
  const moveLook=(event:React.PointerEvent<HTMLDivElement>)=>{if(!event.currentTarget.hasPointerCapture(event.pointerId))return;move.current.lookX+=event.clientX-lookPoint.current.x;move.current.lookY+=event.clientY-lookPoint.current.y;lookPoint.current={x:event.clientX,y:event.clientY}}
  return <div className="mobile-walk-controls"><div className="virtual-joystick" onPointerDown={startJoystick} onPointerMove={moveJoystick} onPointerUp={endJoystick} onPointerCancel={endJoystick} onLostPointerCapture={()=>{move.current.x=0;move.current.z=0;setKnob({x:0,y:0})}}><i style={{transform:`translate(${knob.x}px,${knob.y}px)`}}/></div><div className="touch-look-zone" onPointerDown={startLook} onPointerMove={moveLook} onPointerUp={e=>e.currentTarget.releasePointerCapture(e.pointerId)} onPointerCancel={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}}><span>Arrastra para mirar</span></div></div>
}
