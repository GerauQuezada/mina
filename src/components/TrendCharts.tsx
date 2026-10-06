import { useMemo } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { number } from '../lib/api'

type PageType = 'production' | 'expenses' | 'recoveries' | 'liquidations' | 'sales'

const YELLOW = '#f7bd3b'
const WHITE = '#eef3f0'
const COLORS = ['#f7bd3b', '#68d391', '#57a8ff', '#f07474', '#b18cff', '#4ed9d0', '#ff9d5c', '#e8fff1']

function groupBy(items: any[], dateKey: string, valueFn: (x: any) => number, value2Fn?: (x: any) => number) {
  const map = new Map<string, { label: string; value: number; value2: number }>()
  for (const x of items) {
    const d = String(x[dateKey] || '').slice(0, 10)
    if (!d) continue
    const cur = map.get(d) || { label: d.slice(5), value: 0, value2: 0 }
    cur.label = d.slice(5)
    cur.value += Number(valueFn(x)) || 0
    if (value2Fn) cur.value2 += Number(value2Fn(x)) || 0
    ;(cur as any).full = d
    map.set(d, cur)
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => ({
    ...v,
    value: Math.round(v.value * 100) / 100,
    value2: Math.round(v.value2 * 100) / 100,
  }))
}

const tooltipStyle = { background: '#111714', border: '1px solid #ffffff20', borderRadius: 14, color: '#fff' } as const

export default function TrendCharts({ type, items, currency='PEN' }: { type: PageType; items: any[]; currency?:string }) {
  const { daily, total, total2, label1, label2, title, subtitle, pieData, barData } = useMemo(() => {
    if (type === 'production') {
      const daily = groupBy(items, 'date', (x) => x.sacks, (x) => x.mine_sacks)
      // value = total sacos, value2 = parte mina (segunda línea estilo foto)
      const byLabor = new Map<string, number>()
      for (const x of items) byLabor.set(x.labor_name || 'Sin labor', (byLabor.get(x.labor_name || 'Sin labor') || 0) + Number(x.sacks || 0))
      return {
        daily: daily.map((d) => ({ ...d, socio: Math.round((d.value - d.value2) * 100) / 100 })),
        total: items.reduce((a, x) => a + Number(x.sacks || 0), 0),
        total2: items.reduce((a, x) => a + Number(x.mine_sacks || 0), 0),
        label1: 'Sacos totales', label2: 'Parte mina',
        title: 'Sacos diarios', subtitle: 'Evolución de sacos · Mina vs Socio',
        pieData: [...byLabor.entries()].map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 })),
        barData: [] as any[],
      }
    }
    if (type === 'expenses') {
      const daily = groupBy(items, 'expense_date', (x) => (x.amount_cents || 0) / 100, (x) => Number(x.partner_share || 0))
      const byCat = new Map<string, number>()
      for (const x of items) byCat.set(x.category || 'Otros', (byCat.get(x.category || 'Otros') || 0) + (x.amount_cents || 0) / 100)
      return {
        daily,
        total: items.reduce((a, x) => a + (x.amount_cents || 0) / 100, 0),
        total2: items.reduce((a, x) => a + Number(x.partner_share || 0), 0),
        label1: 'Gasto total', label2: 'Parte socio',
        title: 'Gastos diarios', subtitle: 'Evolución de gastos · Total vs Socio',
        pieData: [...byCat.entries()].map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 })),
        barData: [] as any[],
      }
    }
    if (type === 'sales') {
      const daily = groupBy(items, 'sale_date', (x) => Number(x.total || 0))
      return {
        daily, total: items.reduce((a, x) => a + Number(x.total || 0), 0),
        total2: 0,
        label1: `Ingresos ${currency}`, label2: '',
        title: 'Ventas diarias', subtitle: 'Dinero recibido por fecha de venta',
        pieData: [], barData: [],
      }
    }
    if (type === 'recoveries') {
      const daily = groupBy(items, 'recovery_date', (x) => Number(x.amount || 0))
      return {
        daily, total: items.reduce((a, x) => a + Number(x.amount || 0), 0), total2: 0,
        label1: 'Recuperado S/', label2: '',
        title: 'Recuperación diaria', subtitle: 'Pagos del socio en el tiempo',
        pieData: [], barData: [],
      }
    }
    const daily = groupBy(items, 'liquidation_date', (x) => Number(x.sacks || 0), (x) => Number(x.paid || 0))
    return {
      daily, total: items.reduce((a, x) => a + Number(x.sacks || 0), 0),
      total2: items.reduce((a, x) => a + Number(x.paid || 0), 0),
      label1: 'Sacos liquidados', label2: 'Pagado S/',
      title: 'Liquidaciones', subtitle: 'Sacos y montos pagados',
      pieData: [], barData: [],
    }
  }, [type, items, currency])

  const last = daily[daily.length - 1]
  const primaryColor = type === 'expenses' ? '#ff5f67' : type === 'sales' || type === 'recoveries' ? '#42d98b' : YELLOW
  const secondaryColor = type === 'expenses' ? '#ff9d4d' : type === 'production' ? '#62a9ff' : WHITE
  const pct = daily.length > 1 && daily[daily.length - 2].value
    ? Math.round(((last?.value || 0) - daily[daily.length - 2].value) / Math.abs(daily[daily.length - 2].value) * 100)
    : null

  return (
    <section className="trend-grid">
      <article className="panel glass trend-main">
        <div className="panel-head">
          <div><span className="eyebrow">Tiempo real</span><h2>{title} ●</h2><small className="trend-sub">{subtitle}</small></div>
          {last && <span className="trend-badge">{type === 'expenses' || type === 'sales' || type === 'recoveries' ? `${currency==='USD'?'US$':'S/'} ${number(last.value)}` : number(last.value)}</span>}
        </div>
        {daily.length ? <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={daily} margin={{ top: 18, right: 12, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id={`g1-${type}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={primaryColor} stopOpacity={0.45} />
                <stop offset="1" stopColor={primaryColor} stopOpacity={0} />
              </linearGradient>
              <linearGradient id={`g2-${type}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={secondaryColor} stopOpacity={0.35} />
                <stop offset="1" stopColor={secondaryColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
            <XAxis dataKey="label" stroke="#82908a" fontSize={11} tickLine={false} axisLine={false} minTickGap={28} />
            <YAxis stroke="#82908a" fontSize={11} tickLine={false} axisLine={false} width={52} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(_, p: any) => p?.[0]?.payload?.full || ''} />
            <Area type="monotone" dataKey="value" name={label1} stroke={primaryColor} strokeWidth={3} fill={`url(#g1-${type})`} dot={false} activeDot={{ r: 5, fill: primaryColor, stroke: '#000' }} />
            {(type === 'production' || type === 'expenses' || type === 'liquidations') && (
              <Area type="monotone" dataKey={type === 'production' ? 'socio' : 'value2'} name={label2} stroke={secondaryColor} strokeWidth={2.5} fill={`url(#g2-${type})`} dot={false} />
            )}
          </AreaChart>
        </ResponsiveContainer> : <div className="trend-empty"><span>La progresión aparecerá cuando registres el primer valor.</span></div>}
        <div className="trend-legend">
          <span><i style={{ background: primaryColor }} />{label1}</span>
          {label2 && <span><i style={{ background: secondaryColor }} />{label2}</span>}
        </div>
      </article>

      <article className="panel glass trend-side">
        <span className="eyebrow">{type === 'expenses' ? 'Resumen de gastos' : 'Resumen'}</span>
        <div className="trend-spark">
          <svg viewBox="0 0 100 28" width="86" height="24"><polyline points={daily.map((d, i) => `${(i / Math.max(1, daily.length - 1)) * 98 + 1},${26 - (d.value / Math.max(1, ...daily.map((x) => x.value))) * 22}`).join(' ')} fill="none" stroke={primaryColor} strokeWidth="2.5" strokeLinecap="round" /></svg>
          <span className="trend-pct">{pct===null?'Sin comparación':`${pct>=0?'▲':'▼'} ${Math.abs(pct)}%`}</span>
        </div>
        <strong className="trend-total" style={{color:primaryColor}}>
          {type === 'expenses' ? `${currency==='USD'?'US$':'S/'} ${number(total)}` : type === 'sales' ? `${currency==='USD'?'US$':'S/'} ${number(total)}` : type === 'recoveries' ? `${currency==='USD'?'US$':'S/'} ${number(total)}` : `${number(total)} sacos`}
        </strong>
        <small>{type === 'production' ? `Mina: ${number(total2)} · Socio: ${number(total - total2)}` : type === 'expenses' ? `Parte socio: ${currency==='USD'?'US$':'S/'} ${number(total2)}` : type === 'sales' ? `${items.length} ventas · ${currency}` : `${daily.length} días con registro`}</small>
        {pieData.length > 0 && (
          <div className="trend-mini-pie">
            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="label" innerRadius={42} outerRadius={62} paddingAngle={4} stroke="none">
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <div className="legend mini">{pieData.slice(0, 4).map((x, i) => <span key={x.label}><i style={{ background: COLORS[i % COLORS.length] }} />{x.label}<b>{typeof x.value === 'number' && type === 'expenses' ? `${currency==='USD'?'US$':'S/'} ${number(x.value)}` : number(x.value)}</b></span>)}</div>
          </div>
        )}
        {!pieData.length && daily.length > 0 && (
          <div className="trend-mini-bar">
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={daily.slice(-10)}>
                <CartesianGrid stroke="#ffffff08" vertical={false} />
                <XAxis dataKey="label" fontSize={9} stroke="#82908a" tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="value" name={label1} radius={[6, 6, 0, 0]}>
                  {daily.slice(-10).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </article>
    </section>
  )
}
