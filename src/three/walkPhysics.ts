import * as THREE from 'three'
import { acceleratedRaycast, MeshBVH, StaticGeometryGenerator } from 'three-mesh-bvh'
import { WALK_START_POSITION } from './walkConfig'

export type WalkMetrics={eyeHeight:number;radius:number;speed:number;gravity:number;near:number;far:number}
export type ModelRuntime={collider:THREE.Mesh;bounds:THREE.Box3;sphere:THREE.Sphere;size:THREE.Vector3;center:THREE.Vector3;metrics:WalkMetrics;triangles:number;detectedStart:THREE.Vector3|null;detectedTarget:THREE.Vector3|null;startScore:number}
type ColliderGeometry=THREE.BufferGeometry&{boundsTree:MeshBVH}

const tempBox=new THREE.Box3()
const tempSegment=new THREE.Line3()
const tempStart=new THREE.Vector3()
const tempEnd=new THREE.Vector3()
const tempTriPoint=new THREE.Vector3()
const tempCapsulePoint=new THREE.Vector3()
const tempCorrection=new THREE.Vector3()
const tempDirection=new THREE.Vector3()
const clearanceBox=new THREE.Box3()
const clearanceSegment=new THREE.Line3()
const downDirection=new THREE.Vector3(0,-1,0)
const upDirection=new THREE.Vector3(0,1,0)
const stepPrevious=new THREE.Vector3()
const stepDesired=new THREE.Vector3()
const stepRaised=new THREE.Vector3()
const groundOrigin=new THREE.Vector3()
const groundHits:THREE.Intersection[]=[]
const floorRaycaster=new THREE.Raycaster()
;(floorRaycaster as THREE.Raycaster&{firstHitOnly:boolean}).firstHitOnly=true
const wallRaycaster=new THREE.Raycaster()
const wallHits:THREE.Intersection[]=[]
const wallOrigin=new THREE.Vector3()
const wallDirection=new THREE.Vector3()
const wallSide=new THREE.Vector3()
const wallHeightFactors=[-.72,-.4,-.08]
const wallSideFactors=[-.35,0,.35]
const floorProbeOffsets=[[0,0],[-.38,0],[.38,0],[0,-.38],[0,.38]] as const
const headProbeOffsets=[[0,0],[-.55,0],[.55,0],[0,-.55],[0,.55]] as const
const scanRaycaster=new THREE.Raycaster()
const scanDirections=[new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1)]

export function firstDistance(collider:THREE.Mesh,origin:THREE.Vector3,direction:THREE.Vector3,far:number){
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
    for(let hitIndex=0;hitIndex<Math.min(surfaces.length,24);hitIndex++){
      candidate.set(x,surfaces[hitIndex].point.y+metrics.eyeHeight,z)
      if(candidate.y>bounds.max.y||candidate.y<bounds.min.y)continue
      if(!isWalkPosition(collider,candidate,metrics))continue
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
  const direction=scanDirections.reduce((bestDir,d)=>firstDistance(collider,best!,d,sideRange)>firstDistance(collider,best!,bestDir,sideRange)?d:bestDir,scanDirections[0]);const target=best.clone().addScaledVector(direction,metrics.eyeHeight*3)
  return {start:best,target,score:bestScore}
}

export function createRuntime(scene:THREE.Object3D):ModelRuntime{
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
  // The scan contains very narrow stopes and imperfect openings. Use a compact
  // exploration profile while keeping walking speed tied to the model scale.
  const eyeHeight=base*.028
  const radius=base*.0018
  const metrics={eyeHeight,radius,speed:base*.068,gravity:base*.423,near:Math.max(.002,eyeHeight*.008),far:Math.max(120,sphere.radius*12)}
  const triangles=geometry.index?geometry.index.count/3:(geometry.attributes.position?.count||0)/3
  const detected=detectWalkStart(collider,bounds,size,center,metrics)
  const runtime={collider,bounds,sphere,size,center,metrics,triangles,detectedStart:detected.start,detectedTarget:detected.target,startScore:detected.score}
  if(detected.start)runtime.detectedTarget=walkTarget(runtime,detected.start)
  return runtime
}

/** Aim into a path the entire capsule can follow, not merely a clear eye-level ray. */
export function walkTarget(runtime:ModelRuntime,start:THREE.Vector3){
  const probe=new THREE.Vector3(),velocity=new THREE.Vector3(),bestDirection=new THREE.Vector3(0,0,-1)
  let bestDistance=-1
  for(let i=0;i<16;i++){
    const angle=i*Math.PI/8,dx=Math.sin(angle),dz=Math.cos(angle)
    probe.copy(start)
    for(let tick=0;tick<360;tick++){velocity.set(dx*runtime.metrics.speed,0,dz*runtime.metrics.speed);stepWalk(probe,velocity,runtime,1/120)}
    const distance=probe.distanceToSquared(start)
    if(distance>bestDistance){bestDistance=distance;bestDirection.set(dx,0,dz)}
  }
  return start.clone().addScaledVector(bestDirection,runtime.metrics.eyeHeight*3)
}

export function isWalkPosition(collider:THREE.Mesh,position:THREE.Vector3,metrics:WalkMetrics){
  const {radius,eyeHeight}=metrics
  const segment=clearanceSegment
  segment.start.copy(position);segment.start.y+=radius*.15
  segment.end.copy(position);segment.end.y+=-eyeHeight+radius
  const box=clearanceBox.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(radius*.97)
  let blocked=false
  ;(collider.geometry as ColliderGeometry).boundsTree.shapecast({intersectsBounds:b=>b.intersectsBox(box),intersectsTriangle:triangle=>{if(triangle.closestPointToSegment(segment,tempTriPoint,tempCapsulePoint)<radius*.97){blocked=true;return true}return false}})
  return !blocked
}
export function snapStartToFloor(runtime:ModelRuntime,eyeHeight:number){
  // Editable coordinates must have real support too; empty air is not a valid start.
  for(const candidate of [WALK_START_POSITION,runtime.detectedStart]){
    if(!candidate||!runtime.bounds.containsPoint(candidate)||!isWalkPosition(runtime.collider,candidate,runtime.metrics))continue
    const floor=firstDistance(runtime.collider,candidate,downDirection,eyeHeight*1.1)
    if(Math.abs(floor-eyeHeight)<runtime.metrics.radius*.15)return candidate.clone()
  }
  return null
}

/** Follow only nearby scanned floor, with a bounded step and slope. No invented support. */
function supportedPosition(position:THREE.Vector3,previous:THREE.Vector3,runtime:ModelRuntime){
  const {eyeHeight,radius}=runtime.metrics
  const maxStep=eyeHeight*.22
  groundOrigin.copy(position);groundOrigin.y=previous.y-eyeHeight+maxStep+radius*.1
  floorRaycaster.set(groundOrigin,downDirection);floorRaycaster.near=0;floorRaycaster.far=maxStep*2+radius*.2
  groundHits.length=0;floorRaycaster.intersectObject(runtime.collider,false,groundHits)
  const floor=groundHits[0]
  if(!floor||Math.abs(floor.face?.normal.y||0)<.6)return false
  const nextY=floor.point.y+eyeHeight
  if(Math.abs(nextY-previous.y)>maxStep)return false
  position.y=nextY
  return isWalkPosition(runtime.collider,position,runtime.metrics)
}

/** Same substep in the live viewer and geometry regression tests. */
export function stepWalk(position:THREE.Vector3,velocity:THREE.Vector3,runtime:ModelRuntime,delta:number){
  stepPrevious.copy(position)
  velocity.y-=runtime.metrics.gravity*delta
  stepDesired.copy(position).addScaledVector(velocity,delta)
  position.copy(stepDesired)
  for(let pass=0;pass<3;pass++)resolveCapsule(position,velocity,runtime)
  const wasBlocked=Math.hypot(position.x-stepDesired.x,position.z-stepDesired.z)>runtime.metrics.radius*.015
  // Try a small step only when there is genuine support at the destination.
  if(wasBlocked){
    stepRaised.copy(stepDesired);stepRaised.y=stepPrevious.y+runtime.metrics.eyeHeight*.22
    if(isWalkPosition(runtime.collider,stepRaised,runtime.metrics)&&supportedPosition(stepRaised,stepPrevious,runtime))position.copy(stepRaised)
  }
  if(!supportedPosition(position,stepPrevious,runtime)){
    position.copy(stepPrevious);velocity.set(0,0,0);return false
  }
  velocity.y=0
  return position.distanceToSquared(stepPrevious)>1e-12
}

function broadWallBetween(position:THREE.Vector3,dx:number,dz:number,runtime:ModelRuntime){
  const distance=Math.hypot(dx,dz)
  if(distance<1e-8)return false
  wallDirection.set(dx/distance,0,dz/distance)
  wallSide.set(-wallDirection.z,0,wallDirection.x)
  const {eyeHeight,radius}=runtime.metrics
  let rows=0,rowMask=0,columns=0,total=0,centerRows=0
  for(let row=0;row<wallHeightFactors.length;row++){
    let rowHit=false
    for(let column=0;column<wallSideFactors.length;column++){
      wallOrigin.copy(position).addScaledVector(wallSide,eyeHeight*wallSideFactors[column]);wallOrigin.y+=eyeHeight*wallHeightFactors[row]
      wallRaycaster.set(wallOrigin,wallDirection);wallRaycaster.near=.002;wallRaycaster.far=distance+radius*1.8
      ;(wallRaycaster as THREE.Raycaster&{firstHitOnly:boolean}).firstHitOnly=false
      wallHits.length=0;wallRaycaster.intersectObject(runtime.collider,false,wallHits)
      let verticalHit=false
      for(let hit=0;hit<wallHits.length;hit++)if(Math.abs(wallHits[hit].face?.normal.y||0)<.58){verticalHit=true;break}
      if(verticalHit){rowHit=true;columns|=1<<column;total++;if(column===1)centerRows++}
    }
    if(rowHit){rows++;rowMask|=1<<row}
  }
  const columnCount=(columns&1?1:0)+(columns&2?1:0)+(columns&4?1:0)
  // Edges on both sides are a doorway, not a solid wall. A genuine blocking
  // wall must also cover the center line at more than one body height.
  return centerRows>=2&&rows>=2&&(rowMask&4)!==0&&columnCount>=2&&total>=3
}

/**
 * Selective exploration collision: broad continuous walls remain solid, while
 * thin supports, scan noise and narrow details are non-blocking. Multiple
 * downward probes keep the camera grounded and bridge holes in the scan.
 */
export function stepWalkExplore(position:THREE.Vector3,velocity:THREE.Vector3,runtime:ModelRuntime,delta:number){
  stepPrevious.copy(position)
  const dx=velocity.x*delta,dz=velocity.z*delta
  if(!broadWallBetween(stepPrevious,dx,dz,runtime)){
    position.x+=dx;position.z+=dz
  }else{
    if(!broadWallBetween(stepPrevious,dx,0,runtime))position.x+=dx
    if(!broadWallBetween(stepPrevious,0,dz,runtime))position.z+=dz
    velocity.x*=.35;velocity.z*=.35
  }

  const {eyeHeight,radius,speed}=runtime.metrics
  // The floor ray must begin above the feet, never above the camera: starting
  // it over the head can mistake a low tunnel ceiling for a higher floor.
  const maxStep=eyeHeight*.8
  const desiredEyeY=stepPrevious.y+velocity.y*delta
  let floorEyeY=NaN,bestDelta=Infinity
  ;(floorRaycaster as THREE.Raycaster&{firstHitOnly:boolean}).firstHitOnly=true
  for(let probe=0;probe<floorProbeOffsets.length;probe++){
    const offset=floorProbeOffsets[probe]
    groundOrigin.set(position.x+offset[0]*radius,stepPrevious.y-eyeHeight+maxStep+radius*.1,position.z+offset[1]*radius)
    floorRaycaster.set(groundOrigin,downDirection);floorRaycaster.near=0;floorRaycaster.far=eyeHeight*4.8
    groundHits.length=0;floorRaycaster.intersectObject(runtime.collider,false,groundHits)
    const floor=groundHits[0]
    if(!floor||Math.abs(floor.face?.normal.y||0)<.35)continue
    const candidate=floor.point.y+eyeHeight
    const difference=Math.abs(candidate-desiredEyeY)
    if(candidate<=stepPrevious.y+maxStep&&candidate>=runtime.bounds.min.y+radius&&difference<bestDelta){floorEyeY=candidate;bestDelta=difference}
  }

  if(Number.isFinite(floorEyeY)){
    // Descend progressively instead of floating at the previous level or
    // teleporting to a lower gallery. Looking down slightly increases the
    // descent rate, while upward steps still attach immediately to the floor.
    const downwardIntent=Math.max(0,-velocity.y/Math.max(speed,1e-6))
    const maxDrop=speed*(1.65+downwardIntent*.65)*delta
    position.y=floorEyeY<stepPrevious.y?Math.max(floorEyeY,stepPrevious.y-maxDrop):floorEyeY
  }else position.y=stepPrevious.y

  // Do not let horizontal motion carry the eye through a descending roof.
  // Multiple short upward probes ignore isolated scan noise but catch a
  // continuous ceiling that leaves no room for the visitor's head.
  let blockedHeadProbes=0,centerHeadBlocked=false
  for(let probe=0;probe<headProbeOffsets.length;probe++){
    const offset=headProbeOffsets[probe]
    groundOrigin.set(position.x+offset[0]*radius,position.y-radius*.8,position.z+offset[1]*radius)
    if(firstDistance(runtime.collider,groundOrigin,upDirection,radius*1.9)<radius*1.65){blockedHeadProbes++;if(probe===0)centerHeadBlocked=true}
  }
  if(centerHeadBlocked&&blockedHeadProbes>=3){position.x=stepPrevious.x;position.z=stepPrevious.z;position.y=stepPrevious.y;velocity.x*=.2;velocity.z*=.2}
  velocity.y=0
  return position.distanceToSquared(stepPrevious)>1e-12
}

export function resolveCapsule(position:THREE.Vector3,velocity:THREE.Vector3,runtime:ModelRuntime){
  const {radius,eyeHeight}=runtime.metrics
  tempStart.copy(position);tempStart.y+=radius*.15
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
