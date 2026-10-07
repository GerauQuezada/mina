export const databaseTables = ['labors', 'production', 'expenses', 'sales', 'audit', 'debts', 'recoveries', 'liquidations', 'withdrawals', 'shipments', 'whatsappContacts', 'fieldReports'] as const
export function validDate(value: unknown, optional = false): string {
  const text = String(value ?? '')
  if (optional && !text) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0, 10) !== text) throw new Error('Introduce una fecha válida.')
  return text
}
export function validTime(value: unknown): string {
  const text = String(value ?? '')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new Error('Introduce una hora válida.')
  return text
}
export function requiredText(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > 500) throw new Error(`Revisa ${label}.`)
  return text
}
export function validMedia(value: unknown, imageOnly = false): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > 4_000_000 || !(imageOnly ? /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/ : /^data:(image\/(jpeg|png|webp)|application\/pdf);base64,[A-Za-z0-9+/]+={0,2}$/).test(value)) throw new Error('Adjunto inválido: utiliza una imagen JPG, PNG, WebP o un PDF.')
  return value
}
export function validAttachments(value: unknown): {name:string;data:string}[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('Máximo 30 adjuntos por préstamo.')
  return value.map(item => ({name:requiredText(item?.name, 'el nombre del adjunto'), data:validMedia(item?.data)}))
}

/** Validate before replacing anything; legacy record fields remain preserved. */
export function validateBackup(input: unknown): Record<string, any[]> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Respaldo inválido.')
  const source = input as Record<string, any>
  const output: Record<string, any[]> = {}
  for (const table of databaseTables) {
    const rows = ['withdrawals','shipments','whatsappContacts','fieldReports'].includes(table) && source[table] === undefined ? [] : source[table]
    if (!Array.isArray(rows)) throw new Error('Respaldo inválido: ' + table)
    const ids = new Set<number>()
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || !Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id)) throw new Error('Identificador inválido o duplicado en ' + table)
      ids.add(row.id)
      for (const [key, value] of Object.entries(row)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Campo no permitido en respaldo.')
        if (key.endsWith('_cents') && value !== null && (!Number.isSafeInteger(value) || (Number(value) < 0 && key !== 'profit_cents'))) throw new Error('Importe inválido en ' + table)
        if (['partner_photo', 'photo'].includes(key)) validMedia(value, true)
        if (key === 'receipt_data_url') validMedia(value)
      }
      if (table === 'debts') {
        requiredText(row.name, 'el nombre'); validDate(row.date); validDate(row.due_date, true)
        if (!Number.isSafeInteger(row.amount_cents) || row.amount_cents <= 0 || !['PEN', 'USD'].includes(row.currency)) throw new Error('Préstamo inválido.')
        validAttachments(row.attachments)
        if (!Array.isArray(row.payments)) throw new Error('Abonos inválidos.')
        let paid = 0; const paymentIds = new Set<number>()
        for (const payment of row.payments) {
          if (!payment || !Number.isSafeInteger(payment.id) || payment.id <= 0 || paymentIds.has(payment.id) || !Number.isSafeInteger(payment.amount_cents) || payment.amount_cents <= 0) throw new Error('Abono inválido.')
          paymentIds.add(payment.id); paid += payment.amount_cents
          validDate(payment.date); validMedia(payment.receipt_data_url)
        }
        if (paid > row.amount_cents) throw new Error('Los abonos superan el préstamo.')
      }
    }
    output[table] = rows
  }
  return output
}
