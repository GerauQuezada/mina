export const money = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100)
export const fromCents = (cents: number) => cents / 100

export function validateShares(minePercent: number, partnerPercent: number) {
  if (minePercent < 0 || partnerPercent < 0 || minePercent + partnerPercent !== 100) {
    throw new Error('Los porcentajes de Mina y Socio deben sumar 100%')
  }
}

export function calculateDistribution(total: number, minePercent = 50, partnerPercent = 50) {
  validateShares(minePercent, partnerPercent)
  const mine = Math.round(total * minePercent * 100) / 10000
  const partner = Math.round((total - mine) * 100) / 100
  return { total, mine, partner, minePercent, partnerPercent }
}

export function calculateExpenseShare(totalCents: number, minePercent = 50, partnerPercent = 50) {
  validateShares(minePercent, partnerPercent)
  const mineCents = Math.round(totalCents * minePercent / 100)
  return { totalCents, mineCents, partnerCents: totalCents - mineCents, minePercent, partnerPercent }
}

export const calculatePendingAmount = (partnerShareCents: number, recoveredCents: number) =>
  Math.max(0, partnerShareCents - recoveredCents)

export const calculateSaleTotal = (sacks: number, priceCents: number) => Math.round(sacks * priceCents)
