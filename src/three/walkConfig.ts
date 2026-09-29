import * as THREE from 'three'

/**
 * Punto editable de entrada al recorrido, en coordenadas originales del GLB.
 * Ajusta estos dos vectores si un levantamiento posterior identifica con mayor
 * precisión la boca de la mina.
 */
export const WALK_START_POSITION=new THREE.Vector3(0,0,21.5)
export const WALK_START_TARGET=new THREE.Vector3(0,0,15)

export const WALK_KEYS=new Set([
  'KeyW','KeyA','KeyS','KeyD',
  'ArrowUp','ArrowLeft','ArrowDown','ArrowRight',
  'ShiftLeft','ShiftRight'
])
