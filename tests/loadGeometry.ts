import { readFileSync } from 'node:fs'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** Headless diagnostic: original positions/indices/transforms, no image decoding. */
export async function loadGeometry(path: string) {
  const bytes = readFileSync(path)
  if (bytes.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB')
  const jsonLength = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'))
  const binOffset = 20 + jsonLength
  const binary = bytes.subarray(binOffset + 8, binOffset + 8 + bytes.readUInt32LE(binOffset))
  json.buffers[0].uri = 'data:application/octet-stream;base64,' + binary.toString('base64')
  // Only the in-memory diagnostic copy omits surface materials; source is untouched.
  delete json.materials; delete json.textures; delete json.images
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material
  if (!globalThis.ProgressEvent) Object.defineProperty(globalThis, 'ProgressEvent', {value: class { constructor(public type: string) {} }, configurable: true})
  return (await new GLTFLoader().parseAsync(JSON.stringify(json), '')).scene
}
