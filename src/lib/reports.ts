/** Prevent spreadsheet formula interpretation in user-entered text. */
export function csvCell(value: unknown) {
  const raw = String(value ?? '')
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(raw) && typeof value !== 'number' ? "'" + raw : raw
  return `"${safe.replaceAll('"', '""')}"`
}
export function reportCsv(keys: string[], rows: Record<string, unknown>[]) {
  return '\ufeff' + [keys, ...rows.map(row => keys.map(key => row[key]))].map(row => row.map(csvCell).join(',')).join('\r\n')
}
export function reportKeys(rows: Record<string, unknown>[]) {
  return [...new Set(rows.flatMap(row => Object.keys(row)))].filter(key => !/receipt|photo|attachment|deleted_at/.test(key) && rows.some(row => row[key] !== null && row[key] !== undefined && typeof row[key] !== 'object'))
}
