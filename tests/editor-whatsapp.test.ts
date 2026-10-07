import test from 'node:test'
import assert from 'node:assert/strict'
import { distanceMeters, polylineMeters } from '../src/lib/modelEditor'
import { dailyPrompt, parseFieldReport } from '../src/lib/whatsappParser'

test('3D measurements respect calibration and curved segments',()=>{
  assert.equal(distanceMeters([0,0,0],[3,4,0],2),10)
  assert.equal(polylineMeters([[0,0,0],[3,0,0],[3,4,0]],.5),3.5)
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
  assert.match(dailyPrompt('Ramal Este'),/Ramal Este/)
})
