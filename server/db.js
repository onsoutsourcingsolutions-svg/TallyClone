import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DATA_DIR = process.env.TALLY_DATA || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'tally.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  pincode TEXT NOT NULL DEFAULT '',
  state_code TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  pan TEXT NOT NULL DEFAULT '',
  financial_year_from TEXT NOT NULL,
  books_begin_from TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'INR',
  gst_enabled INTEGER NOT NULL DEFAULT 1,
  inventory_enabled INTEGER NOT NULL DEFAULT 1,
  extras TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(name)
);
CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  group_code TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Asset','Liability','Income','Expense')),
  kind TEXT NOT NULL DEFAULT 'General',
  is_group INTEGER NOT NULL DEFAULT 0,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  opening_balance_date TEXT,
  address TEXT NOT NULL DEFAULT '',
  gstin TEXT NOT NULL DEFAULT '',
  pan TEXT NOT NULL DEFAULT '',
  credit_days INTEGER,
  credit_limit INTEGER,
  bank_name TEXT NOT NULL DEFAULT '',
  ifsc TEXT NOT NULL DEFAULT '',
  account_no TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_accounts_company ON accounts(company_id);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'nos',
  hsn TEXT NOT NULL DEFAULT '',
  gst_rate REAL,
  is_service INTEGER NOT NULL DEFAULT 0,
  sale_account_id INTEGER REFERENCES accounts(id),
  purchase_account_id INTEGER REFERENCES accounts(id),
  opening_qty REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_items_company ON items(company_id);

CREATE TABLE IF NOT EXISTS vouchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  class TEXT NOT NULL,
  voucher_no INTEGER NOT NULL,
  date TEXT NOT NULL,
  number TEXT NOT NULL DEFAULT '',
  narration TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  ref_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(company_id, class, voucher_no)
);
CREATE INDEX IF NOT EXISTS idx_vouchers_company_date ON vouchers(company_id, date);
CREATE INDEX IF NOT EXISTS idx_vouchers_company_class ON vouchers(company_id, class);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL,
  line_no INTEGER NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit INTEGER NOT NULL DEFAULT 0,
  credit INTEGER NOT NULL DEFAULT 0,
  is_stock INTEGER NOT NULL DEFAULT 0,
  particulars TEXT NOT NULL DEFAULT '',
  taxable INTEGER,
  UNIQUE(voucher_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_entries_account ON entries(company_id, account_id);
CREATE INDEX IF NOT EXISTS idx_entries_voucher ON entries(voucher_id);

CREATE TABLE IF NOT EXISTS item_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voucher_id INTEGER NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL,
  line_no INTEGER NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty REAL NOT NULL,
  rate INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in','out'))
);
CREATE INDEX IF NOT EXISTS idx_item_entries_item ON item_entries(item_id);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS edit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  voucher_id INTEGER,
  action TEXT NOT NULL,
  at TEXT NOT NULL,
  old_json TEXT,
  new_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_editlog_voucher ON edit_log(voucher_id);
`;
db.exec(SCHEMA);
db.exec(`INSERT OR IGNORE INTO meta(k,v) VALUES ('schema_version','1')`);
// --- lightweight migrations (existing databases) ---
{
  const companyCols = db.prepare('PRAGMA table_info(companies)').all().map(c => c.name);
  if (!companyCols.includes('logo')) db.exec(`ALTER TABLE companies ADD COLUMN logo TEXT NOT NULL DEFAULT ''`);
}

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }
}

export function getSetting(k, def = null) {
  const r = db.prepare('SELECT v FROM settings WHERE k = ?').get(k);
  return r ? r.v : def;
}
export function setSetting(k, v) {
  db.prepare('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
}

export function activeCompanyId() {
  const v = getSetting('active_company', null);
  return v ? Number(v) : null;
}
export function setActiveCompany(id) { setSetting('active_company', id); }

export function getCompany(id) {
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(id) || null;
}
export function activeCompany() {
  const id = activeCompanyId();
  return id ? getCompany(id) : null;
}
export function companyExtras(company) {
  try { return JSON.parse(company.extras || '{}'); } catch { return {}; }
}
export function saveCompanyExtras(companyId, extras) {
  db.prepare('UPDATE companies SET extras = ? WHERE id = ?').run(JSON.stringify(extras), companyId);
}

export function nextVoucherNo(companyId, cls) {
  const r = db.prepare('SELECT COALESCE(MAX(voucher_no),0) + 1 AS n FROM vouchers WHERE company_id = ? AND class = ?').get(companyId, cls);
  return Number(r.n);
}
