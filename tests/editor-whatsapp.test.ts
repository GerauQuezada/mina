import test from 'node:test'
import assert from 'node:assert/strict'
import { calibratedUnitMeters, distanceMeters, polylineMeters, rigidAlignmentMatrix } from '../src/lib/modelEditor'
import { Vector3 } from 'three'
import { dailyPrompt, parseFieldReport } from '../src/lib/whatsappParser'
import { parseReport as parseWebhookReport } from '../supabase/functions/_shared/report-parser.ts'
import { isGaussianPly, modelEntryNames, parsePlyObject, prepareModelUpload } from '../src/lib/modelImport'
import { zipSync, strToU8 } from 'fflate'
import { Mesh, Points } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const plyHeader='ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n'
const plyVertices='0 0 0 255 0 0\n1 0 0 0 255 0\n0 1 0 0 0 255\n'
test('Gaussian PLY is preserved byte for byte, including ZIP imports',async()=>{
  const fields=['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3']
  const bytes=strToU8('ply\nformat ascii 1.0\nelement vertex 1\n'+fields.map(name=>'property float '+name+'\n').join('')+'end_header\n0 0 0 0 0 0 1 -2 -2 -2 1 0 0 0\n')
  assert.equal(isGaussianPly(bytes.buffer as ArrayBuffer),true)
  assert.equal(isGaussianPly(strToU8(plyHeader+'end_header\n'+plyVertices).buffer as ArrayBuffer),false)
  for(const file of [new File([bytes],'scan.ply'),new File([zipSync({'scan/gaussian.ply':bytes})],'scan.zip')]){
    const prepared=await prepareModelUpload(file)
    assert.equal(prepared.format,'splat-ply')
    assert.deepEqual(new Uint8Array(prepared.data),bytes)
  }
})
test('PLY without faces remains visible as points rather than fabricated triangles',()=>{
  const pointData=strToU8(plyHeader+'end_header\n'+plyVertices)
  const points=parsePlyObject(pointData.buffer as ArrayBuffer,'points.ply')
  assert.ok(points instanceof Points)
  assert.equal(points.geometry.getAttribute('position').count,3)
  assert.equal(points.geometry.getAttribute('color').count,3)
  points.geometry.dispose();points.material.dispose()
  const meshData=strToU8(plyHeader+'element face 1\nproperty list uchar int vertex_indices\nend_header\n'+plyVertices+'3 0 1 2\n')
  const mesh=parsePlyObject(meshData.buffer as ArrayBuffer,'surface.ply')
  assert.ok(mesh instanceof Mesh)
  assert.equal(mesh.geometry.index?.count,3)
  mesh.geometry.dispose();mesh.material.dispose()
})

test('zipped point scan exports glTF POINTS mode and preserves vertex data',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'FileReader')
  class Reader {
    result:ArrayBuffer|null=null
    onloadend:()=>void=()=>{}
    readAsArrayBuffer(blob:Blob){void blob.arrayBuffer().then(value=>{this.result=value;this.onloadend()})}
  }
  Object.defineProperty(globalThis,'FileReader',{configurable:true,value:Reader})
  try{
    const zip=zipSync({'scan/model.ply':strToU8(plyHeader+'end_header\n'+plyVertices)})
    const file=new File([zip],'scan.zip')
    const result=await prepareModelUpload(file)
    const view=new DataView(result.data)
    assert.equal(view.getUint32(0,true),0x46546c67)
    const json=JSON.parse(new TextDecoder().decode(new Uint8Array(result.data,20,view.getUint32(12,true))).trim())
    assert.equal(json.meshes[0].primitives[0].mode,0)
    assert.ok('COLOR_0' in json.meshes[0].primitives[0].attributes)
    assert.equal(result.source,'zip-ply')
    const loaded=await new GLTFLoader().parseAsync(result.data,'')
    let pointObjects=0
    loaded.scene.traverse(object=>{if(object instanceof Points){pointObjects++;assert.equal(object.geometry.getAttribute('position').count,3);assert.ok(object.userData.pointSize>0)}})
    assert.equal(pointObjects,1)
  }finally{if(previous)Object.defineProperty(globalThis,'FileReader',previous);else Reflect.deleteProperty(globalThis,'FileReader')}
})

test('3D measurements respect calibration and curved segments',()=>{
  assert.equal(distanceMeters([0,0,0],[3,4,0],2),10)
  assert.equal(polylineMeters([[0,0,0],[3,0,0],[3,4,0]],.5),3.5)
  assert.equal(calibratedUnitMeters([[0,0,0],[3,4,0]],10),2)
  assert.throws(()=>calibratedUnitMeters([[0,0,0],[0,0,0]],10),/puntos separados/)
  assert.throws(()=>calibratedUnitMeters([[0,0,0],[1,0,0]],-2),/distancia real válida/)
})

test('three-point alignment maps an imported scan onto matching mine references',()=>{
  const source:[[number,number,number],[number,number,number],[number,number,number]]=[[0,0,0],[1,0,0],[0,1,0]]
  const target:[[number,number,number],[number,number,number],[number,number,number]]=[[10,2,-3],[10,2,-2],[10,3,-3]]
  const matrix=rigidAlignmentMatrix(source,target)
  source.forEach((point,index)=>{
    const aligned=new Vector3(...point).applyMatrix4(matrix)
    assert.ok(aligned.distanceTo(new Vector3(...target[index]))<1e-8)
  })
  assert.throws(()=>rigidAlignmentMatrix([[0,0,0],[1,0,0],[2,0,0]],target),/misma línea/)
})

test('Polycam ZIP importer finds supported scans and ignores texture files',()=>{
  const entries={'scan/textures/albedo.jpg':new Uint8Array(), 'scan/model.ply':new Uint8Array(), 'notes.txt':new Uint8Array()}
  assert.deepEqual(modelEntryNames(entries),['scan/model.ply'])
})

test('WhatsApp report extracts sacks and categorized expenses',()=>{
  const parsed=parseFieldReport('Hoy sacamos 18 sacos; gastamos 120 soles en gasolina; 80 soles en comida')
  assert.equal(parsed.status,'worked')
  assert.equal(parsed.sacks,18)
  assert.deepEqual(parsed.expenses.map(x=>[x.amount,x.category]),[[120,'Gasolina'],[80,'Alimentación']])
  assert.ok(parsed.confidence>.8)
})

test('WhatsApp report recognizes no work and waste-only days',()=>{
  assert.equal(parseFieldReport('Hoy no se trabajó por lluvia').status,'no_work')
  assert.equal(parseFieldReport('Solo sacamos desmonte').status,'waste_only')
  assert.equal(parseFieldReport('Hoy solo botamos desmonte').status,'waste_only')
  assert.equal(parseWebhookReport('Hoy solo botamos desmonte').status,'waste_only')
  assert.match(dailyPrompt('Ramal Este'),/Ramal Este/)
})

test('sack counts are never duplicated as expense amounts',()=>{
  for(const parser of [parseFieldReport,parseWebhookReport]){
    assert.equal(parser('Sacamos 12 sacos, sin gastos').expenses.length,0)
    assert.equal(parser('12 sacos y 40 soles en gasolina').expenses[0]?.amount,40)
    assert.equal(parser('Gastamos 40 gasolina y 20 comida').expenses.length,0)
    assert.ok(parser('12 sacos; no, fueron 10 sacos').confidence<.6)
    assert.ok(parser('No trabajamos; 12 sacos').confidence<.6)
  }
})

test('ZIP ignores macOS duplicate models and reports unsupported contents',async()=>{
  assert.deepEqual(modelEntryNames({'__MACOSX/._scan.ply':new Uint8Array(),'scan.ply':new Uint8Array()}),['scan.ply'])
  const zip=zipSync({'photo.jpg':strToU8('image')})
  await assert.rejects(prepareModelUpload(new File([zip],'empty.zip')),/no contiene ningún archivo GLB o PLY/)
})

test('webhook and dashboard interpret the same field report',()=>{
  const message='Sacamos 12 sacos; gastamos 45 soles en herramientas'
  assert.deepEqual(parseWebhookReport(message),Object.fromEntries(Object.entries(parseFieldReport(message)).filter(([key])=>key!=='notes')))
})
