import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, OrbitControls, useGLTF, useProgress } from '@react-three/drei'
import { acceleratedRaycast, MeshBVH, StaticGeometryGenerator } from 'three-mesh-bvh'
import { Box, Expand, Focus, Footprints, LocateFixed, MousePointer2, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import * as THREE from 'three'
import { WALK_KEYS, WALK_START_POSITION, WALK_START_TARGET } from '../three/walkConfig'

type Mode='exterior'|'walk'
type MoveState={x:number;z:number;lookX:number;lookY:number}
type WalkMetrics={eyeHeight:number;radius:number;speed:number;gravity:number;near:number;far:number}
type ModelRuntime={collider:THREE.Mesh;bounds:THREE.Box3;sphere:THREE.Sphere;size:THREE.Vector3;center:THREE.Vector3;metrics:WalkMetrics;triangles:number;detectedStart:THREE.Vector3|null;detectedTarget:THREE.Vector3|null;startScore:number}
type ColliderGeometry=THREE.BufferGeometry&{boundsTree:MeshBVH}

const tempBox=new THREE.Box3()
const tempSegment=new THREE.Line3()
const tempStart=new THREE.Vector3()
const tempEnd=new THREE.Vector3()
const tempTriPoint=new THREE.Vector3()
const tempCapsulePoint=new THREE.Vector3()
const tempCorrection=new THREE.Vector3()
const tempDirection=new THREE.Vector3()
const tempForward=new THREE.Vector3()
const tempRight=new THREE.Vector3()
const tempInput=new THREE.Vector3()
const tempEuler=new THREE.Euler(0,0,0,'YXZ')
const floorRaycaster=new THREE.Raycaster()
;(floorRaycaster as THREE.Raycaster&{firstHitOnly:boolean}).firstHitOnly=true
const scanRaycaster=new THREE.Raycaster()
const scanDirections=[new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1)]

function firstDistance(collider:THREE.Mesh,origin:THREE.Vector3,direction:THREE.Vector3,far:number){
  scanRaycaster.set(origin,direction);scanRaycaster.near=.01;scanRaycaster.far=far;(scanRaycaster as THREE.Raycaster&{firstHitOnly:boolean}).firstHitOnly=true
  return scanRaycaster.intersectObject(collider,false)[0]?.distance??Infinity
}

function detectWalkStart(collider:THREE.Mesh,bounds:THREE.Box3,size:THREE.Vector3,center:THREE.Vector3,metrics:WalkMetrics){
  const candidate=new THREE.Vector3();const origin=new THREE.Vector3();const down=new THREE.Vector3(0,-1,0);const up=new THREE.Vector3(0,1,0)
  const xSteps=20;const zSteps=40;const margin=.025;const rayTop=bounds.max.y+metrics.eyeHeight;const verticalRange=size.y+metrics.eyeHeight*2;const sideRange=metrics.eyeHeight*4.5
  let best:THREE.Vector3|null=null;let bestScore=-Infinity
  for(let xi=0;xi<=xSteps;xi++)for(let zi=0;zi<=zSteps;zi++){
    const x=THREE.MathUtils.lerp(bounds.min.x,bounds.max.x,margin+(1-margin*2)*xi/xSteps)
    const z=THREE.MathUtils.lerp(bounds.min.z,bounds.max.z,margin+(1-margin*2)*zi/zSteps)
    origin.set(x,rayTop,z);scanRaycaster.set(origin,down);scanRaycaster.near=.01;scanRaycaster.far=verticalRange;(scanRaycaster as THREE.Raycaster&{firstHitOnly:boolean}).firstHitOnly=false
    const surfaces=scanRaycaster.intersectObject(collider,false)
    for(let hitIndex=0;hitIndex<Math.min(surfaces.length,8);hitIndex++){
      candidate.set(x,surfaces[hitIndex].point.y+metrics.eyeHeight,z)
      if(candidate.y>bounds.max.y||candidate.y<bounds.min.y)continue
      const floorDistance=firstDistance(collider,candidate,down,metrics.eyeHeight*1.5)
      if(!Number.isFinite(floorDistance)||Math.abs(floorDistance-metrics.eyeHeight)>metrics.eyeHeight*.38)continue
      const ceiling=firstDistance(collider,candidate,up,metrics.eyeHeight*3.5)
      if(!Number.isFinite(ceiling)||ceiling<metrics.radius*2.2)continue
      const sideDistances=scanDirections.map(direction=>firstDistance(collider,candidate,direction,sideRange))
      const safeSides=sideDistances.filter(distance=>Number.isFinite(distance)&&distance>metrics.radius*1.35)
      if(safeSides.length<2)continue
      const edge=Math.min(candidate.x-bounds.min.x,bounds.max.x-candidate.x,candidate.z-bounds.min.z,bounds.max.z-candidate.z)
      const edgeBonus=1-Math.min(1,edge/(Math.min(size.x,size.z)*.5))
      const openness=sideDistances.reduce((sum,distance)=>sum+(Number.isFinite(distance)?Math.min(distance,sideRange):sideRange),0)/sideRange
      const score=safeSides.length*2+edgeBonus*3+openness+Math.min(2,ceiling/metrics.eyeHeight)
      if(score>bestScore){bestScore=score;best=candidate.clone()}
    }
  }
  if(!best)return {start:null,target:null,score:0}
  const target=center.clone();target.y=best.y;tempDirection.subVectors(target,best);tempDirection.y=0;if(tempDirection.lengthSq()<1e-6)tempDirection.set(0,0,-1);tempDirection.normalize();target.copy(best).addScaledVector(tempDirection,metrics.eyeHeight*3)
  return {start:best,target,score:bestScore}
}

function createRuntime(scene:THREE.Object3D):ModelRuntime{
  scene.updateMatrixWorld(true)
  const bounds=new THREE.Box3().setFromObject(scene)
  const sphere=bounds.getBoundingSphere(new THREE.Sphere())
  const size=bounds.getSize(new THREE.Vector3())
  const center=bounds.getCenter(new THREE.Vector3())
  const generator=new StaticGeometryGenerator(scene)
  generator.attributes=['position']
  const geometry=generator.generate() as ColliderGeometry
  geometry.boundsTree=new MeshBVH(geometry,{maxLeafTris:12})
  const collider=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide}))
  collider.raycast=acceleratedRaycast
  collider.updateMatrixWorld(true)
  const base=Math.min(size.x,size.z)
  const eyeHeight=THREE.MathUtils.clamp(base*.07,1.2,1.8)
  const radius=THREE.MathUtils.clamp(eyeHeight*.21,.24,.42)
  const metrics={eyeHeight,radius,speed:eyeHeight*2.05,gravity:eyeHeight*9,near:Math.max(.025,eyeHeight*.025),far:Math.max(120,sphere.radius*12)}
  const triangles=geometry.index?geometry.index.count/3:(geometry.attributes.position?.count||0)/3
  const detected=detectWalkStart(collider,bounds,size,center,metrics)
  return {collider,bounds,sphere,size,center,metrics,triangles,detectedStart:detected.start,detectedTarget:detected.target,startScore:detected.score}
}

function MineModel({url,onReady}:{url:string;onReady:(runtime:ModelRuntime)=>void}){
  const {scene}=useGLTF(url)
  const runtime=useMemo(()=>createRuntime(scene),[scene])
  useEffect(()=>{scene.traverse(object=>{if((object as THREE.Mesh).isMesh){const mesh=object as THREE.Mesh;mesh.castShadow=false;mesh.receiveShadow=true;mesh.frustumCulled=true}});onReady(runtime);return()=>{runtime.collider.geometry.dispose();(runtime.collider.material as THREE.Material).dispose()}},[scene,runtime,onReady])
  return <primitive object={scene}/>
}

function Loading(){
  const {progress,errors}=useProgress()
  if(progress>=100&&!errors.length)return null
  return <div className="model-loading model-loading-overlay glass"><span className="loader"/><b>{errors.length?'No se pudo cargar el modelo':'Cargando modelo 3D…'}</b><div><i style={{width:`${progress}%`}}/></div><span>{Math.round(progress)}%</span></div>
}

function ExteriorCamera({active,runtime}:{active:boolean;runtime:ModelRuntime|null}){
  const {camera}=useThree()
  useEffect(()=>{if(!active||!runtime)return;const distance=runtime.sphere.radius*1.75;camera.near=Math.max(.05,runtime.metrics.near);camera.far=runtime.metrics.far;camera.position.copy(runtime.center).add(new THREE.Vector3(distance*.7,distance*.46,distance));camera.lookAt(runtime.center);camera.updateProjectionMatrix()},[active,runtime,camera])
  return null
}

function snapStartToFloor(runtime:ModelRuntime,eyeHeight:number){
  if(runtime.detectedStart)return runtime.detectedStart.clone()
  const start=WALK_START_POSITION.clone()
  const rayHeight=Math.max(runtime.size.y,eyeHeight*5)
  floorRaycaster.set(new THREE.Vector3(start.x,runtime.bounds.max.y+eyeHeight,start.z),new THREE.Vector3(0,-1,0))
  floorRaycaster.far=rayHeight+runtime.size.y
  const hit=floorRaycaster.intersectObject(runtime.collider,false)[0]
  if(hit&&hit.point.y<=runtime.bounds.max.y&&hit.point.y>=runtime.bounds.min.y)return new THREE.Vector3(start.x,hit.point.y+eyeHeight,start.z)
  return start
}

function resolveCapsule(position:THREE.Vector3,velocity:THREE.Vector3,runtime:ModelRuntime){
  const {radius,eyeHeight}=runtime.metrics
  tempStart.copy(position);tempStart.y+=radius*.4
  tempEnd.copy(position);tempEnd.y+=-eyeHeight+radius
  tempSegment.start.copy(tempStart);tempSegment.end.copy(tempEnd)
  tempBox.makeEmpty().expandByPoint(tempSegment.start).expandByPoint(tempSegment.end)
  tempBox.min.addScalar(-radius);tempBox.max.addScalar(radius)
  runtime.collider.geometry.boundsTree!.shapecast({
    intersectsBounds:box=>box.intersectsBox(tempBox),
    intersectsTriangle:triangle=>{
      const distance=triangle.closestPointToSegment(tempSegment,tempTriPoint,tempCapsulePoint)
      if(distance<radius){const depth=radius-distance;tempDirection.subVectors(tempCapsulePoint,tempTriPoint);if(tempDirection.lengthSq()>1e-10){tempDirection.normalize();tempSegment.start.addScaledVector(tempDirection,depth);tempSegment.end.addScaledVector(tempDirection,depth)}}
    }
  })
  tempCorrection.subVectors(tempSegment.start,tempStart)
  position.add(tempCorrection)
  const horizontal=Math.hypot(tempCorrection.x,tempCorrection.z)
  const onGround=tempCorrection.y>1e-4&&tempCorrection.y>horizontal*.25&&velocity.y<=0
  if(onGround)velocity.y=0
  return onGround
}

function WalkController({active,runtime,move,onPosition,onLock}:{active:boolean;runtime:ModelRuntime|null;move:React.MutableRefObject<MoveState>;onPosition:(position:THREE.Vector3)=>void;onLock:(locked:boolean)=>void}){
  const {camera,gl}=useThree()
  const keys=useRef<Record<string,boolean>>({})
  const velocity=useRef(new THREE.Vector3())
  const grounded=useRef(false)
  const lastPositionReport=useRef(0)
  const startPosition=useRef(new THREE.Vector3())
  useEffect(()=>{if(!active||!runtime)return;const start=snapStartToFloor(runtime,runtime.metrics.eyeHeight);startPosition.current.copy(start);camera.position.copy(start);camera.near=runtime.metrics.near;camera.far=runtime.metrics.far;camera.up.set(0,1,0);camera.lookAt(runtime.detectedTarget||WALK_START_TARGET);camera.updateProjectionMatrix();tempEuler.setFromQuaternion(camera.quaternion,'YXZ');velocity.current.set(0,0,0);onPosition(camera.position)},[active,runtime,camera,onPosition])
  useEffect(()=>{if(!active)return;const down=(event:KeyboardEvent)=>{if(WALK_KEYS.has(event.code)){event.preventDefault();keys.current[event.code]=true}};const up=(event:KeyboardEvent)=>{if(WALK_KEYS.has(event.code)){event.preventDefault();keys.current[event.code]=false}};addEventListener('keydown',down,{passive:false});addEventListener('keyup',up,{passive:false});return()=>{removeEventListener('keydown',down);removeEventListener('keyup',up)}},[active])
  useEffect(()=>{if(!active)return;const isTouch=matchMedia('(pointer: coarse)').matches;const pointerLock=()=>{if(!isTouch&&document.pointerLockElement!==gl.domElement)gl.domElement.requestPointerLock?.()};const lockChange=()=>onLock(document.pointerLockElement===gl.domElement);const mouseMove=(event:MouseEvent)=>{if(document.pointerLockElement===gl.domElement){move.current.lookX+=event.movementX;move.current.lookY+=event.movementY}};gl.domElement.addEventListener('mousedown',pointerLock);document.addEventListener('pointerlockchange',lockChange);document.addEventListener('mousemove',mouseMove);return()=>{gl.domElement.removeEventListener('mousedown',pointerLock);document.removeEventListener('pointerlockchange',lockChange);document.removeEventListener('mousemove',mouseMove);if(document.pointerLockElement===gl.domElement)document.exitPointerLock?.();onLock(false)}},[active,gl,move,onLock])
  useFrame(({clock},frameDelta)=>{
    if(!active||!runtime)return
    const delta=Math.min(frameDelta,.1)
    tempEuler.setFromQuaternion(camera.quaternion,'YXZ')
    tempEuler.y-=move.current.lookX*.0022;tempEuler.x=THREE.MathUtils.clamp(tempEuler.x-move.current.lookY*.0022,-Math.PI*.47,Math.PI*.47);tempEuler.z=0;camera.quaternion.setFromEuler(tempEuler);move.current.lookX=0;move.current.lookY=0
    camera.getWorldDirection(tempForward);tempForward.y=0;if(tempForward.lengthSq()<1e-8)tempForward.set(0,0,-1);tempForward.normalize();tempRight.crossVectors(tempForward,camera.up).normalize()
    const forward=(keys.current.KeyW||keys.current.ArrowUp?1:0)-(keys.current.KeyS||keys.current.ArrowDown?1:0)+move.current.z
    const side=(keys.current.KeyD||keys.current.ArrowRight?1:0)-(keys.current.KeyA||keys.current.ArrowLeft?1:0)+move.current.x
    tempInput.set(0,0,0).addScaledVector(tempForward,forward).addScaledVector(tempRight,side);if(tempInput.lengthSq()>1)tempInput.normalize()
    const damping=Math.exp(-10*delta);velocity.current.x*=damping;velocity.current.z*=damping
    velocity.current.x+=tempInput.x*runtime.metrics.speed*10*delta;velocity.current.z+=tempInput.z*runtime.metrics.speed*10*delta
    if(!grounded.current)velocity.current.y-=runtime.metrics.gravity*delta
    const steps=Math.min(3,Math.max(1,Math.ceil(delta/(1/30))));const step=delta/steps
    for(let index=0;index<steps;index++){camera.position.addScaledVector(velocity.current,step);grounded.current=resolveCapsule(camera.position,velocity.current,runtime)}
    const margin=runtime.metrics.eyeHeight*2
    if(camera.position.x<runtime.bounds.min.x-margin||camera.position.x>runtime.bounds.max.x+margin||camera.position.y<runtime.bounds.min.y-margin||camera.position.y>runtime.bounds.max.y+margin||camera.position.z<runtime.bounds.min.z-margin||camera.position.z>runtime.bounds.max.z+margin){camera.position.copy(startPosition.current);velocity.current.set(0,0,0)}
    if(clock.elapsedTime-lastPositionReport.current>.25){lastPositionReport.current=clock.elapsedTime;onPosition(camera.position)}
  })
  return null
}

export default function Model3D(){
  const [mode,setMode]=useState<Mode>('exterior')
  const [retry,setRetry]=useState(0)
  const [runtime,setRuntime]=useState<ModelRuntime|null>(null)
  const [position,setPosition]=useState(new THREE.Vector3())
  const [pointerLocked,setPointerLocked]=useState(false)
  const wrap=useRef<HTMLDivElement>(null)
  const controls=useRef<any>(null)
  const move=useRef<MoveState>({x:0,z:0,lookX:0,lookY:0})
  const touchDevice=matchMedia('(pointer: coarse)').matches
  const mobile=matchMedia('(max-width: 760px)').matches||((navigator.hardwareConcurrency||8)<=4)
  const url=mobile?'/models/mine-mobile.glb':'/models/mine.glb'
  const handlePosition=useCallback((value:THREE.Vector3)=>setPosition(value.clone()),[])
  const enterWalk=()=>{setMode('walk');move.current={x:0,z:0,lookX:0,lookY:0}}
  const exitWalk=()=>{document.exitPointerLock?.();setMode('exterior');move.current={x:0,z:0,lookX:0,lookY:0}}
  const reloadModel=()=>{document.exitPointerLock?.();setRuntime(null);move.current={x:0,z:0,lookX:0,lookY:0};setRetry(value=>value+1)}
  const reset=()=>{if(mode==='walk')reloadModel();else controls.current?.reset()}
  const fullscreen=()=>wrap.current?.requestFullscreen?.()
  const ready=runtime!==null
  return <div className="model-page">
    <div className="model-toolbar glass"><div><Box/><span><b>Modelo Polycam real</b><small>{runtime?`${runtime.size.x.toFixed(1)} × ${runtime.size.y.toFixed(1)} × ${runtime.size.z.toFixed(1)} u · ${Math.round(runtime.triangles).toLocaleString('es-PE')} triángulos`:(mobile?'Calidad móvil optimizada':'Calidad original · 43.9 MB')}</small></span></div><div className="mode-buttons"><button className={mode==='exterior'?'active':''} onClick={exitWalk}><Focus/> Exterior</button><button className={mode==='walk'?'active':''} onClick={enterWalk} disabled={!ready}><Footprints/> Recorrido</button></div></div>
    <div className={`viewer glass ${mode==='walk'?'walking':''}`} ref={wrap}>
      <Canvas key={retry} camera={{position:[22,18,28],fov:58,near:.03,far:500}} dpr={mobile?[.75,1.25]:[1,1.75]} gl={{antialias:!mobile,powerPreference:'high-performance'}}>
        <color attach="background" args={['#090d0b']}/><ambientLight intensity={1.35}/><directionalLight position={[12,20,10]} intensity={2.2}/>
        <Suspense fallback={null}><MineModel url={url} onReady={setRuntime}/><Environment preset="warehouse"/></Suspense>
        <ExteriorCamera active={mode==='exterior'} runtime={runtime}/>
        {mode==='exterior'&&<OrbitControls ref={controls} makeDefault enableDamping target={runtime?.center||new THREE.Vector3()} minDistance={.2} maxDistance={runtime?runtime.sphere.radius*4:120}/>} 
        <WalkController active={mode==='walk'} runtime={runtime} move={move} onPosition={handlePosition} onLock={setPointerLocked}/>
      </Canvas>
      <Loading/>
      <div className="viewer-actions"><button onClick={()=>controls.current?.dollyIn(1.3)} title="Acercar" disabled={mode==='walk'}><ZoomIn/></button><button onClick={()=>controls.current?.dollyOut(1.3)} title="Alejar" disabled={mode==='walk'}><ZoomOut/></button><button onClick={reset} title="Restablecer"><Undo2/></button><button onClick={fullscreen} title="Pantalla completa"><Expand/></button></div>
      {mode==='walk'&&<><div className="walk-debug glass"><LocateFixed/><span>X {position.x.toFixed(2)} · Y {position.y.toFixed(2)} · Z {position.z.toFixed(2)}</span><small>Altura {runtime?.metrics.eyeHeight.toFixed(2)} u · Radio {runtime?.metrics.radius.toFixed(2)} u · BVH activo · {runtime?.detectedStart?'Entrada detectada':'Entrada configurable'}</small></div><div className="walk-crosshair"/><div className="walk-help glass"><MousePointer2/><span>{touchDevice?'Joystick para caminar · Arrastra a la derecha para mirar':pointerLocked?'WASD/Flechas para caminar · Ratón para mirar · ESC libera el ratón':'Haz clic dentro del visor para controlar la mirada'}</span></div><button className="exit-walk glass" onClick={exitWalk}><X/> Salir del recorrido</button>{touchDevice&&<MobileWalkControls move={move}/>}</>}
    </div>
    <div className="model-note"><b>{mode==='walk'?'Recorrido interno en primera persona':'Modelo original sin modificaciones'}</b><p>{mode==='walk'?'La cámara utiliza gravedad y una cápsula que colisiona con los triángulos reales del GLB mediante BVH.':'Pulsa Recorrido para entrar por una abertura transitable detectada en el modelo y caminar con colisiones reales.'}</p><button onClick={reloadModel}>Reintentar carga</button></div>
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
  return <div className="mobile-walk-controls"><div className="virtual-joystick" onPointerDown={startJoystick} onPointerMove={moveJoystick} onPointerUp={endJoystick} onPointerCancel={endJoystick}><i style={{transform:`translate(${knob.x}px,${knob.y}px)`}}/></div><div className="touch-look-zone" onPointerDown={startLook} onPointerMove={moveLook}><span>Arrastra para mirar</span></div></div>
}
