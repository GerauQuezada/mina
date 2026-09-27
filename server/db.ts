import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const rawPath = process.env.DATABASE_URL || './data/mina-omar-miranda.db'
const databasePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(root, rawPath)
fs.mkdirSync(path.dirname(databasePath), { recursive: true })

export const db = new DatabaseSync(databasePath)
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'operator', active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, document TEXT, phone TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS labors (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, code TEXT, level TEXT, location TEXT, description TEXT,
      status TEXT NOT NULL DEFAULT 'active', partner_id INTEGER NOT NULL REFERENCES partners(id),
      mine_percent INTEGER NOT NULL DEFAULT 50 CHECK(mine_percent BETWEEN 0 AND 100),
      partner_percent INTEGER NOT NULL DEFAULT 50 CHECK(partner_percent BETWEEN 0 AND 100),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(mine_percent + partner_percent = 100)
    );
    CREATE TABLE IF NOT EXISTS production_records (
      id INTEGER PRIMARY KEY, labor_id INTEGER NOT NULL REFERENCES labors(id), date TEXT NOT NULL, sacks REAL NOT NULL CHECK(sacks > 0),
      note TEXT, mine_percent INTEGER NOT NULL, partner_percent INTEGER NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id), deleted_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY, labor_id INTEGER NOT NULL REFERENCES labors(id), name TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
      description TEXT, expense_date TEXT NOT NULL, expense_time TEXT NOT NULL, category TEXT NOT NULL, payment_method TEXT NOT NULL,
      observation TEXT, receipt_path TEXT, mine_percent INTEGER NOT NULL, partner_percent INTEGER NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id), deleted_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS recoveries (
      id INTEGER PRIMARY KEY, labor_id INTEGER NOT NULL REFERENCES labors(id), liquidation_id INTEGER,
      recovery_date TEXT NOT NULL, recovery_time TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
      payment_method TEXT NOT NULL, observation TEXT, receipt_path TEXT, created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS liquidations (
      id INTEGER PRIMARY KEY, labor_id INTEGER NOT NULL REFERENCES labors(id), liquidation_date TEXT NOT NULL,
      sacks REAL NOT NULL CHECK(sacks > 0), mine_percent INTEGER NOT NULL, partner_percent INTEGER NOT NULL,
      mine_sacks REAL NOT NULL, partner_sacks REAL NOT NULL, expenses_cents INTEGER NOT NULL,
      partner_expense_cents INTEGER NOT NULL, paid_cents INTEGER NOT NULL DEFAULT 0, observation TEXT, receipt_path TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY, labor_id INTEGER NOT NULL REFERENCES labors(id), sale_date TEXT NOT NULL, sale_time TEXT NOT NULL,
      sacks REAL NOT NULL CHECK(sacks > 0), price_cents INTEGER NOT NULL CHECK(price_cents >= 0), total_cents INTEGER NOT NULL,
      buyer TEXT NOT NULL, observation TEXT, receipt_path TEXT, created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL, entity TEXT NOT NULL,
      entity_id INTEGER, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS model3d (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, size_bytes INTEGER NOT NULL, format TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, optimization_status TEXT NOT NULL DEFAULT 'original', active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS points_of_interest (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, labor_id INTEGER REFERENCES labors(id), x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
      description TEXT, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_production_labor_date ON production_records(labor_id, date);
    CREATE INDEX IF NOT EXISTS idx_expenses_labor_date ON expenses(labor_id, expense_date) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_sales_labor_date ON sales(labor_id, sale_date);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  `)
  db.exec('PRAGMA optimize;')
  const model = db.prepare('SELECT id FROM model3d WHERE active = 1 LIMIT 1').get()
  if (!model) db.prepare(`INSERT INTO model3d(name,path,size_bytes,format,optimization_status) VALUES(?,?,?,?,?)`).run('Modelo Polycam de la mina','/models/mine.glb',43933100,'GLB','original')
}

export function audit(userId: number | null, action: string, entity: string, entityId?: number, details?: unknown) {
  db.prepare('INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)')
    .run(userId, action, entity, entityId ?? null, details ? JSON.stringify(details) : null)
}

export function transaction<T>(work:()=>T):T {
  db.exec('BEGIN IMMEDIATE')
  try { const result=work(); db.exec('COMMIT'); return result }
  catch(error){ db.exec('ROLLBACK'); throw error }
}
