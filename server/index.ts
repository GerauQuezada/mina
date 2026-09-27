import 'dotenv/config'
import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import PDFDocument from 'pdfkit'
import { z } from 'zod'
import { audit, db, migrate, transaction } from './db.ts'
import { calculateDistribution, calculateExpenseShare, calculatePendingAmount, calculateSaleTotal, money } from './calculations.ts'
import { hashPassword, newSessionToken, tokenHash, verifyPassword } from './security.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const uploadDir = path.resolve(root, process.env.STORAGE_URL || './uploads')
fs.mkdirSync(uploadDir, { recursive: true })
migrate()

const app = express()
app.set('trust proxy', 1)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }))
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: false }))

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false })
const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, allowedMimes.has(file.mimetype))
})

type User = { id: number; name: string; email: string; role: string }
type AuthedRequest = Request & { user?: User }

function cookies(req: Request) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(v => {
    const [key, ...rest] = v.trim().split('='); return [key, decodeURIComponent(rest.join('='))]
  }))
}

function setSession(res: Response, userId: number) {
  const token = newSessionToken()
  const hours = Math.max(1, Number(process.env.SESSION_HOURS || 12))
  const expires = new Date(Date.now() + hours * 3600000)
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash(token), userId, expires.toISOString())
  res.cookie('mina_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', expires, path: '/' })
}

function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = cookies(req).mina_session
  if (!token) return res.status(401).json({ error: 'Sesión requerida' })
  const row = db.prepare(`SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at > CURRENT_TIMESTAMP AND u.active=1`).get(tokenHash(token)) as User | undefined
  if (!row) return res.status(401).json({ error: 'Sesión vencida' })
  req.user = row
  next()
}

function adminOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Permiso de administrador requerido' })
  next()
}

function asyncRoute(fn: (req: AuthedRequest, res: Response) => Promise<unknown> | unknown) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next)
}

const text = z.string().trim().min(1)
const shares = z.object({ minePercent: z.coerce.number().int().min(0).max(100), partnerPercent: z.coerce.number().int().min(0).max(100) })
  .refine(v => v.minePercent + v.partnerPercent === 100, 'Los porcentajes deben sumar 100%')

app.get('/api/status', (_req, res) => {
  const users = Number((db.prepare('SELECT COUNT(*) count FROM users').get() as any).count)
  res.json({ initialized: users > 0, name: 'MINA OMAR MIRANDA' })
})

app.post('/api/auth/bootstrap', authLimiter, asyncRoute((req, res) => {
  const count = Number((db.prepare('SELECT COUNT(*) count FROM users').get() as any).count)
  if (count > 0) return res.status(409).json({ error: 'La cuenta inicial ya fue creada' })
  const input = z.object({ name: text.min(3), email: z.string().email(), password: z.string().min(10) }).parse(req.body)
  const result = db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')")
    .run(input.name, input.email.toLowerCase(), hashPassword(input.password))
  audit(Number(result.lastInsertRowid), 'CREATE', 'User', Number(result.lastInsertRowid), { role: 'admin' })
  setSession(res, Number(result.lastInsertRowid))
  res.status(201).json({ ok: true })
}))

app.post('/api/auth/login', authLimiter, asyncRoute((req, res) => {
  const input = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body)
  const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(input.email.toLowerCase()) as any
  if (!user || !verifyPassword(input.password, user.password_hash)) return res.status(401).json({ error: 'Correo o contraseña incorrectos' })
  setSession(res, Number(user.id)); audit(Number(user.id), 'LOGIN', 'Session')
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role })
}))

app.use('/api', auth)
app.use('/api',(req:AuthedRequest,res,next)=>{
  if(req.user?.role==='viewer'&&!['GET','HEAD'].includes(req.method)) return res.status(403).json({error:'El rol de consulta no puede modificar registros'})
  next()
})

app.get('/api/auth/me', (req: AuthedRequest, res) => res.json(req.user))
app.post('/api/auth/logout', (req: AuthedRequest, res) => {
  const token = cookies(req).mina_session
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(token))
  res.clearCookie('mina_session', { path: '/' }); audit(req.user!.id, 'LOGOUT', 'Session'); res.json({ ok: true })
})

app.get('/api/users', adminOnly, (_req, res) => res.json(db.prepare('SELECT id,name,email,role,active,created_at FROM users ORDER BY name').all()))
app.post('/api/users', adminOnly, asyncRoute((req, res) => {
  const input = z.object({ name: text, email: z.string().email(), password: z.string().min(10), role: z.enum(['admin','supervisor','operator','viewer']) }).parse(req.body)
  const result = db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,?)').run(input.name,input.email.toLowerCase(),hashPassword(input.password),input.role)
  audit(req.user!.id,'CREATE','User',Number(result.lastInsertRowid),{ email: input.email, role: input.role }); res.status(201).json({ id: Number(result.lastInsertRowid) })
}))
app.put('/api/users/:id',adminOnly,asyncRoute((req,res)=>{const id=Number(req.params.id);const input=z.object({role:z.enum(['admin','supervisor','operator','viewer']),active:z.coerce.boolean()}).parse(req.body);if(id===req.user!.id&&!input.active)return res.status(400).json({error:'No puedes desactivar tu propia cuenta'});db.prepare('UPDATE users SET role=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(input.role,input.active?1:0,id);audit(req.user!.id,'UPDATE','User',id,input);res.json({ok:true})}))

app.get('/api/dashboard', (_req, res) => {
  const scalar = (sql: string) => Number((db.prepare(sql).get() as any)?.value || 0)
  const cards = {
    todaySacks: scalar("SELECT SUM(sacks) value FROM production_records WHERE deleted_at IS NULL AND date=date('now','localtime')"),
    monthSacks: scalar("SELECT SUM(sacks) value FROM production_records WHERE deleted_at IS NULL AND strftime('%Y-%m',date)=strftime('%Y-%m','now','localtime')"),
    totalSacks: scalar('SELECT SUM(sacks) value FROM production_records WHERE deleted_at IS NULL'),
    activeLabors: scalar("SELECT COUNT(*) value FROM labors WHERE status='active'"),
    monthExpensesCents: scalar("SELECT SUM(amount_cents) value FROM expenses WHERE deleted_at IS NULL AND strftime('%Y-%m',expense_date)=strftime('%Y-%m','now','localtime')"),
    monthSalesCents: scalar("SELECT SUM(total_cents) value FROM sales WHERE strftime('%Y-%m',sale_date)=strftime('%Y-%m','now','localtime')")
  }
  const expenseShare = scalar(`SELECT SUM(ROUND(e.amount_cents*e.partner_percent/100.0)) value FROM expenses e WHERE e.deleted_at IS NULL`)
  const recovered = scalar('SELECT SUM(amount_cents) value FROM recoveries')
  Object.assign(cards, { pendingCents: calculatePendingAmount(expenseShare, recovered) })
  const daily = db.prepare(`SELECT date label, ROUND(SUM(sacks),2) value FROM production_records WHERE deleted_at IS NULL GROUP BY date ORDER BY date DESC LIMIT 30`).all().reverse()
  const byLabor = db.prepare(`SELECT l.name label, COALESCE(SUM(p.sacks),0) value FROM labors l LEFT JOIN production_records p ON p.labor_id=l.id AND p.deleted_at IS NULL GROUP BY l.id ORDER BY value DESC`).all()
  const expensesByLabor = db.prepare(`SELECT l.name label, ROUND(COALESCE(SUM(e.amount_cents),0)/100.0,2) value FROM labors l LEFT JOIN expenses e ON e.labor_id=l.id AND e.deleted_at IS NULL GROUP BY l.id ORDER BY value DESC`).all()
  const categories = db.prepare(`SELECT category label, ROUND(SUM(amount_cents)/100.0,2) value FROM expenses WHERE deleted_at IS NULL GROUP BY category ORDER BY value DESC`).all()
  const activity = db.prepare(`SELECT a.id,a.action,a.entity,a.details,a.created_at,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 8`).all()
  res.json({ cards, daily, byLabor, expensesByLabor, categories, activity })
})

app.get('/api/labors', (_req, res) => {
  const rows = db.prepare(`SELECT l.*,p.name partner_name,p.phone partner_phone,
    COALESCE((SELECT SUM(sacks) FROM production_records pr WHERE pr.labor_id=l.id AND pr.deleted_at IS NULL),0) production_total,
    COALESCE((SELECT SUM(sacks) FROM production_records pr WHERE pr.labor_id=l.id AND pr.deleted_at IS NULL AND strftime('%Y-%m',pr.date)=strftime('%Y-%m','now','localtime')),0) production_month,
    COALESCE((SELECT SUM(amount_cents) FROM expenses e WHERE e.labor_id=l.id AND e.deleted_at IS NULL),0) expenses_cents,
    COALESCE((SELECT MAX(created_at) FROM audit_logs a WHERE a.entity_id=l.id AND a.entity='Labor'),l.created_at) last_activity
    FROM labors l JOIN partners p ON p.id=l.partner_id ORDER BY l.status,l.name`).all()
  res.json(rows)
})

app.post('/api/labors', asyncRoute((req, res) => {
  const input = z.object({ name: text, partnerName: text, code: z.string().optional(), level: z.string().optional(), location: z.string().optional(), description: z.string().optional(), status: z.enum(['active','inactive']).default('active') }).and(shares).parse(req.body)
  const tx = () => transaction(() => {
    const partner = db.prepare('INSERT INTO partners(name) VALUES(?)').run(input.partnerName)
    return db.prepare(`INSERT INTO labors(name,code,level,location,description,status,partner_id,mine_percent,partner_percent) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(input.name,input.code||null,input.level||null,input.location||null,input.description||null,input.status,partner.lastInsertRowid,input.minePercent,input.partnerPercent)
  })
  const result = tx(); audit(req.user!.id,'CREATE','Labor',Number(result.lastInsertRowid),input); res.status(201).json({ id: Number(result.lastInsertRowid) })
}))

app.put('/api/labors/:id', asyncRoute((req, res) => {
  const id = Number(req.params.id)
  const input = z.object({ name: text, partnerName: text, code: z.string().optional(), level: z.string().optional(), location: z.string().optional(), description: z.string().optional(), status: z.enum(['active','inactive']) }).and(shares).parse(req.body)
  const previous = db.prepare('SELECT * FROM labors WHERE id=?').get(id) as any
  if (!previous) return res.status(404).json({ error: 'Labor no encontrada' })
  const tx = () => transaction(() => {
    db.prepare('UPDATE partners SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(input.partnerName,previous.partner_id)
    db.prepare(`UPDATE labors SET name=?,code=?,level=?,location=?,description=?,status=?,mine_percent=?,partner_percent=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(input.name,input.code||null,input.level||null,input.location||null,input.description||null,input.status,input.minePercent,input.partnerPercent,id)
  }); tx(); audit(req.user!.id,'UPDATE','Labor',id,{ previous, next: input }); res.json({ ok: true })
}))

app.delete('/api/labors/:id', adminOnly, (req, res) => {
  const id=Number(req.params.id); db.prepare("UPDATE labors SET status='inactive',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id)
  audit((req as AuthedRequest).user!.id,'DEACTIVATE','Labor',id); res.json({ ok:true })
})

app.get('/api/production', (req, res) => {
  const laborId=Number(req.query.laborId||0)
  const rows=db.prepare(`SELECT pr.*,l.name labor_name,ROUND(pr.sacks*pr.mine_percent/100.0,2) mine_sacks,ROUND(pr.sacks*pr.partner_percent/100.0,2) partner_sacks
    FROM production_records pr JOIN labors l ON l.id=pr.labor_id WHERE pr.deleted_at IS NULL AND (?=0 OR pr.labor_id=?) ORDER BY pr.date DESC,pr.id DESC`).all(laborId,laborId)
  res.json(rows)
})

app.post('/api/production', asyncRoute((req,res)=>{
  const input=z.object({laborId:z.coerce.number().int().positive(),date:z.iso.date(),sacks:z.coerce.number().positive(),note:z.string().optional()}).parse(req.body)
  const labor=db.prepare('SELECT mine_percent,partner_percent FROM labors WHERE id=?').get(input.laborId) as any
  if(!labor) return res.status(404).json({error:'Labor no encontrada'})
  const result=db.prepare('INSERT INTO production_records(labor_id,date,sacks,note,mine_percent,partner_percent,created_by) VALUES(?,?,?,?,?,?,?)')
    .run(input.laborId,input.date,input.sacks,input.note||null,labor.mine_percent,labor.partner_percent,req.user!.id)
  audit(req.user!.id,'CREATE','ProductionRecord',Number(result.lastInsertRowid),input); res.status(201).json({id:Number(result.lastInsertRowid)})
}))

app.put('/api/production/:id', asyncRoute((req,res)=>{
  const id=Number(req.params.id); const input=z.object({date:z.iso.date(),sacks:z.coerce.number().positive(),note:z.string().optional()}).parse(req.body)
  const previous=db.prepare('SELECT * FROM production_records WHERE id=?').get(id); db.prepare('UPDATE production_records SET date=?,sacks=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(input.date,input.sacks,input.note||null,id)
  audit(req.user!.id,'UPDATE','ProductionRecord',id,{previous,next:input}); res.json({ok:true})
}))
app.delete('/api/production/:id', (req,res)=>{const id=Number(req.params.id);db.prepare('UPDATE production_records SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(id);audit((req as AuthedRequest).user!.id,'DELETE','ProductionRecord',id);res.json({ok:true})})

app.get('/api/expenses', (req,res)=>{const id=Number(req.query.laborId||0);res.json(db.prepare(`SELECT e.*,l.name labor_name,u.name user_name,ROUND(e.amount_cents/100.0,2) amount,ROUND(e.amount_cents*e.partner_percent/10000.0,2) partner_share FROM expenses e JOIN labors l ON l.id=e.labor_id JOIN users u ON u.id=e.created_by WHERE e.deleted_at IS NULL AND (?=0 OR e.labor_id=?) ORDER BY e.expense_date DESC,e.expense_time DESC`).all(id,id))})
app.post('/api/expenses', upload.single('receipt'), asyncRoute((req,res)=>{
  const input=z.object({laborId:z.coerce.number().int().positive(),name:text,amount:z.coerce.number().nonnegative(),description:z.string().optional(),expenseDate:z.iso.date(),expenseTime:z.string().regex(/^\d{2}:\d{2}/),category:text,paymentMethod:text,observation:z.string().optional()}).parse(req.body)
  const labor=db.prepare('SELECT mine_percent,partner_percent FROM labors WHERE id=?').get(input.laborId) as any;if(!labor)return res.status(404).json({error:'Labor no encontrada'})
  const result=db.prepare(`INSERT INTO expenses(labor_id,name,amount_cents,description,expense_date,expense_time,category,payment_method,observation,receipt_path,mine_percent,partner_percent,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(input.laborId,input.name,money(input.amount),input.description||null,input.expenseDate,input.expenseTime,input.category,input.paymentMethod,input.observation||null,req.file?.filename||null,labor.mine_percent,labor.partner_percent,req.user!.id)
  audit(req.user!.id,'CREATE','Expense',Number(result.lastInsertRowid),{...input,receipt:req.file?.filename});res.status(201).json({id:Number(result.lastInsertRowid)})
}))
app.put('/api/expenses/:id', upload.single('receipt'), asyncRoute((req,res)=>{const id=Number(req.params.id);const input=z.object({name:text,amount:z.coerce.number().nonnegative(),description:z.string().optional(),expenseDate:z.iso.date(),expenseTime:z.string(),category:text,paymentMethod:text,observation:z.string().optional()}).parse(req.body);const previous=db.prepare('SELECT * FROM expenses WHERE id=?').get(id) as any;if(!previous)return res.status(404).json({error:'Gasto no encontrado'});db.prepare(`UPDATE expenses SET name=?,amount_cents=?,description=?,expense_date=?,expense_time=?,category=?,payment_method=?,observation=?,receipt_path=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(input.name,money(input.amount),input.description||null,input.expenseDate,input.expenseTime,input.category,input.paymentMethod,input.observation||null,req.file?.filename||previous.receipt_path,id);audit(req.user!.id,'UPDATE','Expense',id,{previous,next:input});res.json({ok:true})}))
app.delete('/api/expenses/:id',(req,res)=>{const id=Number(req.params.id);db.prepare('UPDATE expenses SET deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(id);audit((req as AuthedRequest).user!.id,'DELETE','Expense',id);res.json({ok:true})})

app.get('/api/recoveries',(req,res)=>{const id=Number(req.query.laborId||0);res.json(db.prepare(`SELECT r.*,l.name labor_name,u.name user_name,ROUND(r.amount_cents/100.0,2) amount FROM recoveries r JOIN labors l ON l.id=r.labor_id JOIN users u ON u.id=r.created_by WHERE (?=0 OR r.labor_id=?) ORDER BY r.recovery_date DESC,r.recovery_time DESC`).all(id,id))})
app.post('/api/recoveries',upload.single('receipt'),asyncRoute((req,res)=>{const input=z.object({laborId:z.coerce.number().int().positive(),liquidationId:z.coerce.number().int().positive().optional(),date:z.iso.date(),time:z.string(),amount:z.coerce.number().positive(),paymentMethod:text,observation:z.string().optional()}).parse(req.body);const result=db.prepare(`INSERT INTO recoveries(labor_id,liquidation_id,recovery_date,recovery_time,amount_cents,payment_method,observation,receipt_path,created_by) VALUES(?,?,?,?,?,?,?,?,?)`).run(input.laborId,input.liquidationId||null,input.date,input.time,money(input.amount),input.paymentMethod,input.observation||null,req.file?.filename||null,req.user!.id);audit(req.user!.id,'CREATE','ExpenseRecovery',Number(result.lastInsertRowid),input);res.status(201).json({id:Number(result.lastInsertRowid)})}))

app.get('/api/liquidations',(req,res)=>{const id=Number(req.query.laborId||0);res.json(db.prepare(`SELECT li.*,l.name labor_name,p.name partner_name,ROUND(li.expenses_cents/100.0,2) expenses,ROUND(li.partner_expense_cents/100.0,2) partner_expense,ROUND(li.paid_cents/100.0,2) paid,ROUND(MAX(0,li.partner_expense_cents-li.paid_cents)/100.0,2) pending,CASE WHEN li.paid_cents>=li.partner_expense_cents THEN 'Pagado' WHEN li.paid_cents>0 THEN 'Parcial' ELSE 'Pendiente' END status FROM liquidations li JOIN labors l ON l.id=li.labor_id JOIN partners p ON p.id=l.partner_id WHERE (?=0 OR li.labor_id=?) ORDER BY li.liquidation_date DESC`).all(id,id))})
app.post('/api/liquidations',upload.single('receipt'),asyncRoute((req,res)=>{const input=z.object({laborId:z.coerce.number().int().positive(),date:z.iso.date(),sacks:z.coerce.number().positive(),paid:z.coerce.number().nonnegative().default(0),observation:z.string().optional()}).parse(req.body);const labor=db.prepare('SELECT mine_percent,partner_percent FROM labors WHERE id=?').get(input.laborId) as any;if(!labor)return res.status(404).json({error:'Labor no encontrada'});const exp=Number((db.prepare('SELECT COALESCE(SUM(amount_cents),0) value FROM expenses WHERE labor_id=? AND deleted_at IS NULL').get(input.laborId) as any).value);const dist=calculateDistribution(input.sacks,labor.mine_percent,labor.partner_percent);const share=calculateExpenseShare(exp,labor.mine_percent,labor.partner_percent);const result=db.prepare(`INSERT INTO liquidations(labor_id,liquidation_date,sacks,mine_percent,partner_percent,mine_sacks,partner_sacks,expenses_cents,partner_expense_cents,paid_cents,observation,receipt_path,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.laborId,input.date,input.sacks,labor.mine_percent,labor.partner_percent,dist.mine,dist.partner,exp,share.partnerCents,money(input.paid),input.observation||null,req.file?.filename||null,req.user!.id);audit(req.user!.id,'CREATE','Liquidation',Number(result.lastInsertRowid),input);res.status(201).json({id:Number(result.lastInsertRowid)})}))

app.get('/api/sales',(req,res)=>{const id=Number(req.query.laborId||0);res.json(db.prepare(`SELECT s.*,l.name labor_name,ROUND(s.price_cents/100.0,2) price,ROUND(s.total_cents/100.0,2) total FROM sales s JOIN labors l ON l.id=s.labor_id WHERE (?=0 OR s.labor_id=?) ORDER BY s.sale_date DESC,s.sale_time DESC`).all(id,id))})
app.post('/api/sales',upload.single('receipt'),asyncRoute((req,res)=>{const input=z.object({laborId:z.coerce.number().int().positive(),date:z.iso.date(),time:z.string(),sacks:z.coerce.number().positive(),price:z.coerce.number().nonnegative(),buyer:text,observation:z.string().optional()}).parse(req.body);const price=money(input.price);const result=db.prepare(`INSERT INTO sales(labor_id,sale_date,sale_time,sacks,price_cents,total_cents,buyer,observation,receipt_path,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(input.laborId,input.date,input.time,input.sacks,price,calculateSaleTotal(input.sacks,price),input.buyer,input.observation||null,req.file?.filename||null,req.user!.id);audit(req.user!.id,'CREATE','Sale',Number(result.lastInsertRowid),input);res.status(201).json({id:Number(result.lastInsertRowid)})}))

app.get('/api/audit',(req,res)=>res.json(db.prepare(`SELECT a.*,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500`).all()))
app.get('/api/pois',(_req,res)=>res.json(db.prepare('SELECT * FROM points_of_interest WHERE active=1 ORDER BY name').all()))
app.post('/api/pois',adminOnly,asyncRoute((req,res)=>{const input=z.object({name:text,laborId:z.coerce.number().int().positive().optional(),x:z.coerce.number(),y:z.coerce.number(),z:z.coerce.number(),description:z.string().optional()}).parse(req.body);const result=db.prepare('INSERT INTO points_of_interest(name,labor_id,x,y,z,description) VALUES(?,?,?,?,?,?)').run(input.name,input.laborId||null,input.x,input.y,input.z,input.description||null);audit(req.user!.id,'CREATE','PointOfInterest',Number(result.lastInsertRowid),input);res.status(201).json({id:Number(result.lastInsertRowid)})}))

app.get('/api/reports/export', asyncRoute(async(req,res)=>{
  const kind=String(req.query.type||'general');const format=String(req.query.format||'csv');const laborId=Number(req.query.laborId||0);const from=String(req.query.from||'0000-01-01');const to=String(req.query.to||'9999-12-31')
  const sources:any={production:{sql:`SELECT pr.date Fecha,l.name Labor,pr.sacks Sacos,pr.mine_percent 'Mina %',pr.partner_percent 'Socio %' FROM production_records pr JOIN labors l ON l.id=pr.labor_id WHERE pr.deleted_at IS NULL AND pr.date BETWEEN ? AND ? AND (?=0 OR pr.labor_id=?)`,params:[from,to,laborId,laborId]},expenses:{sql:`SELECT e.expense_date Fecha,l.name Labor,e.name Gasto,ROUND(e.amount_cents/100.0,2) Monto,e.category Categoria,e.payment_method Metodo FROM expenses e JOIN labors l ON l.id=e.labor_id WHERE e.deleted_at IS NULL AND e.expense_date BETWEEN ? AND ? AND (?=0 OR e.labor_id=?)`,params:[from,to,laborId,laborId]},sales:{sql:`SELECT s.sale_date Fecha,l.name Labor,s.sacks Sacos,ROUND(s.price_cents/100.0,2) Precio,ROUND(s.total_cents/100.0,2) Total,s.buyer Comprador FROM sales s JOIN labors l ON l.id=s.labor_id WHERE s.sale_date BETWEEN ? AND ? AND (?=0 OR s.labor_id=?)`,params:[from,to,laborId,laborId]},liquidations:{sql:`SELECT li.liquidation_date Fecha,l.name Labor,li.sacks Sacos,li.mine_sacks Mina,li.partner_sacks Socio,ROUND(li.partner_expense_cents/100.0,2) 'Gasto socio',ROUND(li.paid_cents/100.0,2) Pagado FROM liquidations li JOIN labors l ON l.id=li.labor_id WHERE li.liquidation_date BETWEEN ? AND ? AND (?=0 OR li.labor_id=?)`,params:[from,to,laborId,laborId]}}
  const selected=sources[kind]||sources.production;const rows=db.prepare(selected.sql).all(...selected.params) as Record<string,unknown>[];const columns=rows.length?Object.keys(rows[0]):['Sin registros']
  const filename=`reporte-${kind}-${new Date().toISOString().slice(0,10)}`
  if(format==='xlsx'){const xmlEscape=(v:unknown)=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');const rowXml=(values:unknown[])=>`<Row>${values.map(v=>`<Cell><Data ss:Type="String">${xmlEscape(v)}</Data></Cell>`).join('')}</Row>`;const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Reporte"><Table>${rowXml(columns)}${rows.map(r=>rowXml(columns.map(c=>r[c]))).join('')}</Table></Worksheet></Workbook>`;res.setHeader('Content-Disposition',`attachment; filename=${filename}.xls`);res.setHeader('Content-Type','application/vnd.ms-excel; charset=utf-8');return res.send(xml)}
  if(format==='pdf'){res.setHeader('Content-Disposition',`attachment; filename=${filename}.pdf`);res.setHeader('Content-Type','application/pdf');const doc=new PDFDocument({margin:40,size:'A4'});doc.pipe(res);doc.fontSize(18).text(`MINA OMAR MIRANDA — ${kind.toUpperCase()}`);doc.moveDown();if(!rows.length)doc.fontSize(11).text('No hay registros todavía.');rows.forEach(r=>{doc.fontSize(9).text(columns.map(c=>`${c}: ${r[c]??''}`).join('  |  '));doc.moveDown(.35)});doc.end();return}
  const escape=(v:unknown)=>`"${String(v??'').replaceAll('"','""')}"`;const csv=[columns.map(escape).join(','),...rows.map(r=>columns.map(c=>escape(r[c])).join(','))].join('\n');res.setHeader('Content-Disposition',`attachment; filename=${filename}.csv`);res.type('text/csv').send('\ufeff'+csv)
}))

app.get('/api/files/:name',(req,res)=>{const name=path.basename(req.params.name);const file=path.join(uploadDir,name);if(!fs.existsSync(file))return res.status(404).json({error:'Archivo no encontrado'});res.sendFile(file)})

const distDir=path.join(root,'dist')
if(fs.existsSync(distDir)){
  app.use(express.static(distDir,{index:false,maxAge:'1h'}))
  app.use((req,res,next)=>{if(req.method==='GET'&&req.accepts('html'))return res.sendFile(path.join(distDir,'index.html'));next()})
}

app.use((err:any,_req:Request,res:Response,_next:NextFunction)=>{
  console.error(err)
  if(err instanceof z.ZodError)return res.status(400).json({error:err.issues[0]?.message||'Datos inválidos',issues:err.issues})
  if(err instanceof multer.MulterError)return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'El archivo supera 8 MB':'Archivo no válido'})
  if(String(err?.message).includes('UNIQUE'))return res.status(409).json({error:'Ya existe un registro con ese valor'})
  res.status(500).json({error:'No se pudo completar la operación'})
})

export function startServer(port=Number(process.env.PORT||3001)) { return app.listen(port,()=>console.log(`API MINA OMAR MIRANDA http://localhost:${port}`)) }
if(process.env.NODE_ENV!=='test')startServer()
export default app
