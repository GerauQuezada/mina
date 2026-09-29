import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {loadGeometry} from './loadGeometry.ts'
import {createRuntime,firstDistance,isWalkPosition,stepWalk,stepWalkExplore} from '../src/three/walkPhysics.ts'

test('original mine: valid interior spawn, supported movement and intact geometry',async()=>{
  const scene=await loadGeometry('public/models/mine.glb')
  const original: number[]=[]
  scene.traverse(object=>{if((object as THREE.Mesh).isMesh)original.push(...(object as THREE.Mesh).geometry.attributes.position.array)})
  const runtime=createRuntime(scene)
  assert.equal(runtime.triangles,78803)
  assert.ok(runtime.size.distanceTo(new THREE.Vector3(22.248390197753906,25.00911235809326,46.96403503417969))<.0001)
  const start=runtime.detectedStart!
  assert.ok(start,'must locate a valid interior spawn')
  assert.ok(isWalkPosition(runtime.collider,start,runtime.metrics))
  const down=new THREE.Vector3(0,-1,0)
  assert.ok(Math.abs(firstDistance(runtime.collider,start,down,10)-runtime.metrics.eyeHeight)<.001)
  assert.ok(Number.isFinite(firstDistance(runtime.collider,start,new THREE.Vector3(0,1,0),runtime.metrics.eyeHeight*3.5)),'spawn has a scanned ceiling')
  const forward=runtime.detectedTarget!.clone().sub(start).setY(0).normalize()
  const position=start.clone(),velocity=new THREE.Vector3()
  for(let i=0;i<120*5;i++){
    velocity.copy(forward).multiplyScalar(runtime.metrics.speed)
    stepWalkExplore(position,velocity,runtime,1/120)
    assert.ok(position.y>runtime.bounds.min.y&&position.y<runtime.bounds.max.y,'live walkthrough keeps a safe supported height')
  }
  assert.ok(position.distanceTo(start)>runtime.metrics.eyeHeight*2,'W must move along an actual tunnel, not stop immediately')
  for(const direction of [new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,1)]){
    position.copy(start)
    for(let i=0;i<120*10;i++){
      velocity.copy(direction).multiplyScalar(runtime.metrics.speed)
      stepWalk(position,velocity,runtime,1/120)
      assert.ok(isWalkPosition(runtime.collider,position,runtime.metrics))
      assert.ok(runtime.bounds.containsPoint(position))
    }
    assert.ok(position.distanceTo(start)<runtime.metrics.speed*10*.95,'walls and scan boundaries stop movement')
  }
  position.copy(start)
  for(let i=0;i<120*10;i++){
    velocity.set(runtime.metrics.speed,0,0)
    stepWalkExplore(position,velocity,runtime,1/120)
  }
  assert.ok(position.x-start.x<runtime.metrics.speed*9.9,'selective walkthrough keeps broad mine walls solid')
  const after:number[]=[]
  scene.traverse(object=>{if((object as THREE.Mesh).isMesh)after.push(...(object as THREE.Mesh).geometry.attributes.position.array)})
  assert.deepEqual(after,original,'collision generation must not edit source positions')
})

test('selective walkthrough crosses a thin obstacle but stops at a broad wall',()=>{
  const makeRuntime=(width:number)=>{
    const scene=new THREE.Group()
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))
    floor.rotation.x=-Math.PI/2
    const blocker=new THREE.Mesh(new THREE.BoxGeometry(width,3,.08),new THREE.MeshBasicMaterial())
    blocker.position.set(0,1.5,0)
    scene.add(floor,blocker)
    return createRuntime(scene)
  }
  const cross=(runtime:ReturnType<typeof createRuntime>,seconds=4)=>{
    const position=new THREE.Vector3(0,runtime.metrics.eyeHeight,-1)
    const velocity=new THREE.Vector3(0,0,runtime.metrics.speed)
    for(let tick=0;tick<120*seconds;tick++)stepWalkExplore(position,velocity,runtime,1/120)
    return position
  }
  const postRuntime=makeRuntime(.05)
  const pastPost=cross(postRuntime)
  assert.ok(pastPost.z>.5,'thin supports and scan obstacles must not trap the visitor')
  const wallRuntime=makeRuntime(10)
  const beforeWall=cross(wallRuntime)
  assert.ok(beforeWall.z<0,'a continuous mine wall must remain solid')
  assert.ok(Math.abs(beforeWall.y-wallRuntime.metrics.eyeHeight)<.01,'the visitor remains on the floor')
  const overScanHole=cross(postRuntime,12)
  assert.ok(overScanHole.z>5,'the diagnostic path reaches beyond the scanned floor edge')
  assert.ok(Math.abs(overScanHole.y-postRuntime.metrics.eyeHeight)<.01,'a missing floor triangle never drops or resets the visitor')
})

test('low rubble is traversable but a full-height wall remains solid',()=>{
  const makeRuntime=(height:number)=>{
    const scene=new THREE.Group()
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))
    floor.rotation.x=-Math.PI/2
    const obstacle=new THREE.Mesh(new THREE.BoxGeometry(10,height,.12),new THREE.MeshBasicMaterial())
    obstacle.position.set(0,height/2,0)
    scene.add(floor,obstacle)
    return createRuntime(scene)
  }
  const cross=(runtime:ReturnType<typeof createRuntime>)=>{
    const position=new THREE.Vector3(0,runtime.metrics.eyeHeight,-1)
    const velocity=new THREE.Vector3(0,0,runtime.metrics.speed)
    for(let tick=0;tick<120*4;tick++)stepWalkExplore(position,velocity,runtime,1/120)
    return position.z
  }
  assert.ok(cross(makeRuntime(.2))>.5,'rocks and rubble below head level do not stop exploration')
  assert.ok(cross(makeRuntime(3))<0,'a continuous wall covering the tunnel remains solid')
})

test('holding forward automatically skirts a tall isolated rock',()=>{
  const scene=new THREE.Group()
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))
  floor.rotation.x=-Math.PI/2
  const rock=new THREE.Mesh(new THREE.BoxGeometry(.5,2,.3),new THREE.MeshBasicMaterial())
  rock.position.set(0,1,0)
  scene.add(floor,rock)
  const runtime=createRuntime(scene)
  const position=new THREE.Vector3(0,runtime.metrics.eyeHeight,-1)
  const velocity=new THREE.Vector3(0,0,runtime.metrics.speed)
  for(let tick=0;tick<120*8;tick++)stepWalkExplore(position,velocity,runtime,1/120)
  assert.ok(position.z>.5,'the visitor moves around an isolated obstacle and continues forward')
  assert.ok(Math.abs(position.x)>.1,'automatic avoidance uses the open side of the obstacle')
})

test('look-guided movement follows an upper and lower floor level',()=>{
  const scene=new THREE.Group()
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))
  floor.rotation.x=-Math.PI/2
  const upper=new THREE.Mesh(new THREE.BoxGeometry(10,.2,5),new THREE.MeshBasicMaterial())
  upper.position.set(0,.1,2.5)
  scene.add(floor,upper)
  const runtime=createRuntime(scene)
  const position=new THREE.Vector3(0,runtime.metrics.eyeHeight,-1)
  const velocity=new THREE.Vector3()
  for(let tick=0;tick<120*2;tick++){velocity.set(0,runtime.metrics.speed,runtime.metrics.speed);stepWalkExplore(position,velocity,runtime,1/120)}
  assert.ok(position.y>runtime.metrics.eyeHeight+.15,'looking upward while advancing reaches the upper level')
  for(let tick=0;tick<120*2;tick++){velocity.set(0,-runtime.metrics.speed,-runtime.metrics.speed);stepWalkExplore(position,velocity,runtime,1/120)}
  assert.ok(Math.abs(position.y-runtime.metrics.eyeHeight)<.02,'looking downward while advancing returns to the lower level')
})

test('a low ceiling is never selected as floor and cannot be crossed',()=>{
  const scene=new THREE.Group()
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))
  floor.rotation.x=-Math.PI/2
  const lowRoof=new THREE.Mesh(new THREE.BoxGeometry(10,.1,5),new THREE.MeshBasicMaterial())
  lowRoof.position.set(0,.34,2.5)
  scene.add(floor,lowRoof)
  const runtime=createRuntime(scene)
  const position=new THREE.Vector3(0,runtime.metrics.eyeHeight,-1)
  const velocity=new THREE.Vector3(0,0,runtime.metrics.speed)
  for(let tick=0;tick<120*3;tick++)stepWalkExplore(position,velocity,runtime,1/120)
  assert.ok(position.z<.05,'a descending roof blocks forward motion before the camera crosses it')
  assert.ok(Math.abs(position.y-runtime.metrics.eyeHeight)<.02,'the underside of a low roof is never mistaken for an upper floor')
  const crouchedHeight=runtime.metrics.eyeHeight*.44
  const crouchedPosition=new THREE.Vector3(0,runtime.metrics.eyeHeight,-1)
  const crouchedVelocity=new THREE.Vector3(0,0,runtime.metrics.speed)
  for(let tick=0;tick<120*3;tick++)stepWalkExplore(crouchedPosition,crouchedVelocity,runtime,1/120,crouchedHeight)
  assert.ok(crouchedPosition.z>.5,'crouching lowers the collider enough to continue under the same roof')
  assert.ok(Math.abs(crouchedPosition.y-crouchedHeight)<.02,'the camera remains attached to the floor at crouched height')
})

test('a centered narrow opening is traversable even when both edges are close',()=>{
  const scene=new THREE.Group()
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))
  floor.rotation.x=-Math.PI/2
  const left=new THREE.Mesh(new THREE.BoxGeometry(4.98,2,.08),new THREE.MeshBasicMaterial())
  const right=left.clone()
  left.position.set(-2.51,1,0);right.position.set(2.51,1,0)
  scene.add(floor,left,right)
  const runtime=createRuntime(scene)
  const position=new THREE.Vector3(0,runtime.metrics.eyeHeight,-1)
  const velocity=new THREE.Vector3(0,0,runtime.metrics.speed)
  for(let tick=0;tick<120*3;tick++)stepWalkExplore(position,velocity,runtime,1/120)
  assert.ok(position.z>.5,'nearby doorway edges must not be classified as a solid wall across the center')
})

test('the visitor descends from a ledge to real lower ground',()=>{
  const scene=new THREE.Group()
  const lowerFloor=new THREE.Mesh(new THREE.PlaneGeometry(10,10),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))
  lowerFloor.rotation.x=-Math.PI/2
  const upperFloor=new THREE.Mesh(new THREE.BoxGeometry(10,.8,5),new THREE.MeshBasicMaterial())
  upperFloor.position.set(0,.4,-2.5)
  scene.add(lowerFloor,upperFloor)
  const runtime=createRuntime(scene)
  const position=new THREE.Vector3(0,.8+runtime.metrics.eyeHeight,-1)
  const velocity=new THREE.Vector3(0,-runtime.metrics.speed,runtime.metrics.speed)
  for(let tick=0;tick<120*4;tick++)stepWalkExplore(position,velocity,runtime,1/120)
  assert.ok(position.z>.5,'the visitor advances beyond the upper ledge')
  assert.ok(Math.abs(position.y-runtime.metrics.eyeHeight)<.03,'gravity settles the camera on the lower floor instead of leaving it floating')
})
