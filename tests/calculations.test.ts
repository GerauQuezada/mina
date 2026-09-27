import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateDistribution, calculateExpenseShare, calculatePendingAmount, calculateSaleTotal, money } from '../server/calculations.ts'

test('distribución predeterminada 50/50',()=>{
  assert.deepEqual(calculateDistribution(500),{total:500,mine:250,partner:250,minePercent:50,partnerPercent:50})
})
test('porcentajes personalizados conservan el total',()=>{
  const result=calculateDistribution(125,60,40);assert.equal(result.mine,75);assert.equal(result.partner,50)
})
test('gasto S/ 1450 reparte S/ 725 a cada parte',()=>{
  const result=calculateExpenseShare(money(1450));assert.equal(result.mineCents,72500);assert.equal(result.partnerCents,72500)
})
test('pago de S/ 500 deja S/ 225 pendiente',()=>assert.equal(calculatePendingAmount(money(725),money(500)),money(225)))
test('venta calcula sacos por precio sin error flotante',()=>assert.equal(calculateSaleTotal(7,money(12.35)),8645))
test('rechaza porcentajes que no suman 100',()=>assert.throws(()=>calculateDistribution(100,60,50)))
