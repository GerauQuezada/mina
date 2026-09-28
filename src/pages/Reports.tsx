import { useEffect, useState } from 'react'
import { Download, FileText, Table2 } from 'lucide-react'
import { api, today } from '../lib/api'
import { downloadFile } from '../lib/media'
import { reportCsv, reportKeys } from '../lib/reports'
import type { Labor } from './Labors'

const dateFields: Record<string, string> = { production: 'date', expenses: 'expense_date', sales: 'sale_date', debts: 'date' }
const names: Record<string, string> = { production: 'producción', expenses: 'gastos', sales: 'ventas', debts: 'préstamos y deudas' }

export default function Reports() {
  const [labors, setLabors] = useState<Labor[]>([])
  const [type, setType] = useState('production')
  const [labor, setLabor] = useState('0')
  const [from, setFrom] = useState(today().slice(0, 8) + '01')
  const [to, setTo] = useState(today())
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Labor[]>('/labors').then(setLabors).catch(e => setMessage(e.message)) }, [])

  async function download(format: 'csv' | 'pdf') {
    if (busy) return
    if (!from || !to || from > to) { setMessage('Revisa el intervalo de fechas.'); return }
    const popup = format === 'pdf' ? window.open('', '_blank') : null
    if (format === 'pdf' && !popup) { setMessage('Permite ventanas emergentes para imprimir.'); return }
    setBusy(true); setMessage('')
    try {
      const result = await api<Record<string, unknown>[]>('/' + type + '?laborId=' + (type === 'debts' ? '0' : labor))
      const rows = result.filter(row => { const date = String(row[dateFields[type]] || '').slice(0, 10); return date >= from && date <= to })
      if (!rows.length) { popup?.close(); setMessage('No hay registros en el periodo seleccionado.'); return }
      const keys = reportKeys(rows)
      if (popup) {
        // Never interpolate user fields as HTML: all content uses text nodes.
        const doc = popup.document
        doc.title = 'Reporte de ' + names[type]
        const style = doc.createElement('style')
        style.textContent = 'body{font-family:Arial;padding:24px;color:#111}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px;text-align:left;font-size:10px;overflow-wrap:anywhere}h1{font-size:20px}@page{size:landscape}'
        doc.head.append(style)
        const heading = doc.createElement('h1'); heading.textContent = 'MINA OMAR MIRANDA · ' + names[type].toUpperCase()
        const detail = doc.createElement('p'); detail.textContent = from + ' — ' + to + ' · Importes *_cents en céntimos; moneda indicada por registro.'
        const table = doc.createElement('table')
        const header = table.createTHead().insertRow()
        keys.forEach(key => { const cell = doc.createElement('th'); cell.textContent = key; header.append(cell) })
        const body = table.createTBody()
        rows.forEach(row => { const tr = body.insertRow(); keys.forEach(key => { tr.insertCell().textContent = String(row[key] ?? '') }) })
        doc.body.append(heading, detail, table)
        popup.focus(); popup.print()
      } else {
        downloadFile(type + '-' + from + '-' + to + '.csv', new Blob([reportCsv(keys, rows)], { type: 'text/csv;charset=utf-8' }))
      }
      setMessage('Reporte generado. Los importes *_cents están en céntimos y las monedas no se suman entre sí.')
    } catch (error) { popup?.close(); setMessage(error instanceof Error ? error.message : 'No se pudo generar el reporte.') }
    finally { setBusy(false) }
  }

  return <section className="reports"><article className="panel glass report-builder">
    <div className="panel-head"><div><span className="eyebrow">Registros sincronizados</span><h2>Crear reporte</h2></div><FileText /></div>
    <div className="form-grid">
      <label>Tipo de reporte<select value={type} onChange={e => setType(e.target.value)}><option value="production">Producción</option><option value="expenses">Gastos</option><option value="sales">Ventas</option><option value="debts">Préstamos y deudas</option></select></label>
      <label>Labor<select disabled={type === 'debts'} value={labor} onChange={e => setLabor(e.target.value)}><option value="0">Toda la mina</option>{labors.map(l => <option value={l.id} key={l.id}>{l.name}</option>)}</select></label>
      <label>Desde<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>Hasta<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
    </div>
    {message && <div className="alert" role="status">{message}</div>}
    <div className="export-buttons">
      <button disabled={busy} onClick={() => download('pdf')}><FileText /><span><b>Imprimir / PDF</b><small>Guardar como PDF desde la impresión</small></span><Download /></button>
      <button disabled={busy} onClick={() => download('csv')}><Table2 /><span><b>CSV para Excel</b><small>Datos tabulares con encabezados</small></span><Download /></button>
    </div>
  </article><article className="panel glass report-info"><span className="eyebrow">Tu información</span><h2>Datos privados sincronizados</h2><p>Estos reportes consultan tu cuenta. Se descargan al dispositivo y contienen información privada: compártelos con cuidado.</p><div><span>✓ Filtros por fecha y labor</span><span>✓ Moneda y unidades por registro</span><span>✓ Respaldo completo con fotos en Ajustes</span></div><p>Los históricos de Recuperaciones y Liquidaciones se conservan en el respaldo completo; ya no forman parte de los formularios activos.</p></article></section>
}
