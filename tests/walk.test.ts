import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {loadGeometry} from './loadGeometry.ts'
import {createRuntime,firstDistance,isWalkPosition,stepWalk,stepWalkFree} from '../src/three/walkPhysics.ts'

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
    stepWalk(position,velocity,runtime,1/120)
    assert.ok(isWalkPosition(runtime.collider,position,runtime.metrics),'capsule remains clear')
    assert.ok(Math.abs(firstDistance(runtime.collider,position,down,10)-runtime.metrics.eyeHeight)<.01,'feet stay on original floor')
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
    stepWalkFree(position,velocity,runtime,1/120)
  }
  assert.ok(position.x-start.x>runtime.metrics.speed*9.9,'free walkthrough crosses scanned walls and narrow obstacles')
  const after:number[]=[]
  scene.traverse(object=>{if((object as THREE.Mesh).isMesh)after.push(...(object as THREE.Mesh).geometry.attributes.position.array)})
  assert.deepEqual(after,original,'collision generation must not edit source positions')
})
