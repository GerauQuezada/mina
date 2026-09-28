import { loadGeometry } from '../tests/loadGeometry.ts'
import { createRuntime, isWalkPosition, firstDistance, stepWalk } from '../src/three/walkPhysics.ts'
import * as THREE from 'three'
const scene=await loadGeometry('public/models/mine.glb')
const runtime=createRuntime(scene)
const start=runtime.detectedStart
console.log(JSON.stringify({size:runtime.size.toArray(),center:runtime.center.toArray(),bounds:{min:runtime.bounds.min.toArray(),max:runtime.bounds.max.toArray()},sphere:runtime.sphere.radius,metrics:runtime.metrics,triangles:runtime.triangles,start:start?.toArray(),target:runtime.detectedTarget?.toArray(),startScore:runtime.startScore,clear:start&&isWalkPosition(runtime.collider,start,runtime.metrics),groundDistance:start&&firstDistance(runtime.collider,start,new THREE.Vector3(0,-1,0),20)},null,2))
if(start){for(let angle=0;angle<360;angle+=45){const position=start.clone(),velocity=new THREE.Vector3();for(let i=0;i<120*8;i++){velocity.x=Math.sin(angle*Math.PI/180)*runtime.metrics.speed;velocity.z=Math.cos(angle*Math.PI/180)*runtime.metrics.speed;stepWalk(position,velocity,runtime,1/120)}console.log('walk',angle,'distance',position.distanceTo(start).toFixed(3),'end',position.toArray(),'clear',isWalkPosition(runtime.collider,position,runtime.metrics))}}
