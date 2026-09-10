import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BUILD_TAG } from '../version.js';
import { extractZip } from './unzip.js';
import { db, DATA_DIR, getCompany, getSetting, setSetting, activeCompanyId, setActiveCompany, companyExtras, saveCompanyExtras, nextVoucherNo } from './db.js';
import {
  createCompany, listAccounts, netBalances, createVoucher, updateVoucher, createLedgerAccount,
  deleteVoucher, trialBalance, balanceSheet, profitLoss, dayBook, ledgerReport,
  stockReport, gstSummary, voucherDetail, voucherLog, inventoryState, dashboard,
} from './engine.js';
import { exportKindData, exportKindTemplate, exportKindSample, importKind, parseWorkbook } from './dataio.js';
import { parseInvoiceWorkbook, importInvoiceExcel } from './invoiceExcel.js';
// (xlsx is loaded lazily inside dataio.js so a missing package never blocks startup)
import { GROUPS, groupMeta } from './chart.js';
import { toPaise, validISO, todayISO, fyEnd, CLASS_META } from './lib.js';

export const api = express.Router();
api.use(express.json({ limit: '4mb' }));

// ---- company logo upload ----
const LOGO_DIR = path.join(DATA_DIR, 'logos');
fs.mkdirSync(LOGO_DIR, { recursive: true });
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error('Logo must be a PNG, JPG or WebP image.'), { status: 400 }));
  },
});

api.post('/company/logo', logoUpload.single('logo'), (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try {
    if (!req.file) throw new Error('No image received.');
    const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }[req.file.mimetype];
    const name = `${c.id}-${Date.now()}${ext}`;
    fs.writeFileSync(path.join(LOGO_DIR, name), req.file.buffer);
    if (c.logo) { try { fs.unlinkSync(path.join(LOGO_DIR, c.logo)); } catch (_) { /* ignore */ } }
    db.prepare('UPDATE companies SET logo = ? WHERE id = ?').run(name, c.id);
    ok(res, { logo: name });
  } catch (e) { fail(res, e); }
});

api.get('/company/logo', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  const f = path.join(LOGO_DIR, c.logo || '');
  if (!c.logo || !fs.existsSync(f)) return res.status(404).json({ ok: false, error: 'No logo uploaded.' });
  res.type(path.extname(f).toLowerCase() === '.png' ? 'image/png' : path.extname(f).toLowerCase() === '.webp' ? 'image/webp' : path.extname(f).toLowerCase() === '.gif' ? 'image/gif' : 'image/jpeg');
  res.sendFile(f);
});

api.delete('/company/logo', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  if (c.logo) { try { fs.unlinkSync(path.join(LOGO_DIR, c.logo)); } catch (_) { /* ignore */ } }
  db.prepare('UPDATE companies SET logo = ? WHERE id = ?').run('', c.id);
  ok(res, { logo: '' });
});

function ok(res, data, status = 200) { res.status(status).json({ ok: true, ...data }); }
function fail(res, e) { res.status(e.status || 400).json({ ok: false, error: e.message || String(e) }); }
function companyOr(res) {
  const c = getCompany(activeCompanyId());
  if (!c) { res.status(409).json({ ok: false, error: 'No active company. Create or select a company first.' }); return null; }
  return c;
}

// ---------- bootstrap / companies ----------
api.get('/bootstrap', (req, res) => {
  const companies = db.prepare('SELECT id, name, city, state, financial_year_from, gstin, created_at FROM companies ORDER BY id').all();
  ok(res, { companies, active_company_id: activeCompanyId() });
});

api.post('/companies', (req, res) => {
  try {
    const c = createCompany(req.body || {});
    setActiveCompany(c.id);
    ok(res, { company: c }, 201);
  } catch (e) { fail(res, e); }
});

api.post('/companies/:id/activate', (req, res) => {
  const c = getCompany(Number(req.params.id));
  if (!c) return fail(res, Object.assign(new Error('Company not found.'), { status: 404 }));
  setActiveCompany(c.id);
  ok(res, { company: c });
});

api.get('/company', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  ok(res, { company: c, extras: companyExtras(c), fy_end: fyEnd(c.financial_year_from), chart: GROUPS });
});

api.patch('/company', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try {
    const b = req.body || {};
    const allowed = ['name', 'address', 'city', 'state', 'state_code', 'pincode', 'gstin', 'pan', 'gst_enabled', 'inventory_enabled', 'financial_year_from', 'books_begin_from'];
    if (b.financial_year_from !== undefined || b.books_begin_from !== undefined) {
      const usedV = db.prepare('SELECT COUNT(*) n FROM vouchers WHERE company_id = ?').get(c.id).n;
      if (usedV > 0) throw new Error('Books period cannot be changed once vouchers exist.');
      const fy = b.financial_year_from !== undefined ? String(b.financial_year_from) : c.financial_year_from;
      const bb = b.books_begin_from !== undefined ? String(b.books_begin_from) : c.books_begin_from;
      if (!validISO(fy) || !validISO(bb)) throw new Error('Invalid dates for books period.');
    }
    const sets = [], params = [];
    for (const k of allowed) {
      if (b[k] === undefined) continue;
      sets.push(`${k} = ?`);
      params.push(typeof b[k] === 'string' ? b[k].trim() : (b[k] ? 1 : 0));
    }
    if (sets.length) { params.push(c.id); db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`).run(...params); }
    if (b.extras && typeof b.extras === 'object') {
      const ex = { ...companyExtras(c), ...b.extras };
      const allowedEx = ['auto_tax', 'tax_regime_default', 'invoice_prefix'];
      const next = {};
      for (const k of allowedEx) if (ex[k] !== undefined) next[k] = ex[k];
      saveCompanyExtras(c.id, { ...companyExtras(c), ...next });
    }
    const fresh = getCompany(c.id);
    ok(res, { company: fresh, extras: companyExtras(fresh) });
  } catch (e) { fail(res, e); }
});

// ---------- accounts ----------
api.get('/accounts', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  let sql = 'SELECT * FROM accounts WHERE company_id = ? AND active = 1';
  const params = [c.id];
  if (req.query.group) { sql += ' AND group_code = ?'; params.push(req.query.group); }
  if (req.query.q) { sql += ' AND name LIKE ?'; params.push('%' + req.query.q + '%'); }
  sql += ' ORDER BY group_code, name';
  const rows = db.prepare(sql).all(...params);
  const balances = req.query.with_balances === '1' ? netBalances(c) : null;
  ok(res, {
    rows: rows.map(a => ({ ...a, balance: balances ? balances[a.id].net : null })),
  });
});

api.post('/accounts', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try {
    const account = createLedgerAccount(c, req.body || {});
    ok(res, { account }, 201);
  } catch (e) { fail(res, e); }
});

api.patch('/accounts/:id', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try {
    const a = db.prepare('SELECT * FROM accounts WHERE id = ? AND company_id = ?').get(Number(req.params.id), c.id);
    if (!a) throw Object.assign(new Error('Ledger not found.'), { status: 404 });
    const used = db.prepare('SELECT COUNT(*) n FROM entries WHERE account_id = ?').get(a.id).n > 0;
    const b = req.body || {};
    if (used && (b.group_code && b.group_code !== a.group_code)) throw new Error('Cannot change the group of a ledger that has postings. Create a new ledger instead.');
    if ((b.opening_balance !== undefined && b.opening_balance !== '') && used) throw new Error('Opening balance can only be set before any postings exist.');
    if (b.opening_balance !== undefined || b.opening_type) {
      const raw = (b.opening_balance !== undefined && b.opening_balance !== '') ? b.opening_balance : a.opening_balance;
      const sign = b.opening_type ? (b.opening_type === 'Cr' ? -1 : 1) : (Number(a.opening_balance) < 0 ? -1 : 1);
      const ob = Math.abs(toPaise(raw)) * sign;
      db.prepare('UPDATE accounts SET opening_balance = ?, opening_balance_date = ? WHERE id = ?').run(ob, c.books_begin_from, a.id);
    }
    const name = b.name !== undefined ? String(b.name).trim() : a.name;
    if (!name) throw new Error('Ledger name cannot be empty.');
    const dup = db.prepare('SELECT id FROM accounts WHERE company_id = ? AND name = ? AND id != ?').get(c.id, name, a.id);
    if (dup) throw new Error(`A ledger named "${name}" already exists.`);
    db.prepare(`UPDATE accounts SET name=?, address=?, gstin=?, pan=?, credit_days=?, credit_limit=?, bank_name=?, ifsc=?, account_no=? WHERE id=?`)
      .run(name,
        b.address !== undefined ? String(b.address) : a.address,
        b.gstin !== undefined ? String(b.gstin).toUpperCase() : a.gstin,
        b.pan !== undefined ? String(b.pan).toUpperCase() : a.pan,
        b.credit_days !== undefined && b.credit_days !== '' ? Number(b.credit_days) : a.credit_days,
        b.credit_limit !== undefined && b.credit_limit !== '' ? toPaise(b.credit_limit) : a.credit_limit,
        b.bank_name !== undefined ? String(b.bank_name) : a.bank_name,
        b.ifsc !== undefined ? String(b.ifsc).toUpperCase() : a.ifsc,
        b.account_no !== undefined ? String(b.account_no) : a.account_no,
        a.id);
    ok(res, { account: db.prepare('SELECT * FROM accounts WHERE id = ?').get(a.id) });
  } catch (e) { fail(res, e); }
});

api.delete('/accounts/:id', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try {
    const a = db.prepare('SELECT * FROM accounts WHERE id = ? AND company_id = ?').get(Number(req.params.id), c.id);
    if (!a) throw Object.assign(new Error('Ledger not found.'), { status: 404 });
    const used = db.prepare('SELECT COUNT(*) n FROM entries WHERE account_id = ?').get(a.id).n > 0
      || db.prepare('SELECT COUNT(*) n FROM items WHERE sale_account_id = ? OR purchase_account_id = ?').get(a.id, a.id).n > 0;
    if (used) throw new Error('Cannot delete: this ledger has transactions. You may edit it or disable it.');
    db.prepare('DELETE FROM accounts WHERE id = ?').run(a.id);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});

// ---------- items ----------
api.get('/items', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  let sql = 'SELECT * FROM items WHERE company_id = ? AND active = 1';
  const params = [c.id];
  if (req.query.q) { sql += ' AND (name LIKE ? OR hsn LIKE ?)'; params.push('%' + req.query.q + '%', '%' + req.query.q + '%'); }
  sql += ' ORDER BY name';
  const rows = db.prepare(sql).all(...params).map(it => {
    const st = it.is_service ? null : inventoryState(it.id);
    return { ...it, stock_qty: st ? st.qty : null, stock_value: st ? st.value : null };
  });
  ok(res, { rows });
});

api.post('/items', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) throw new Error('Item name is required.');
    const dup = db.prepare('SELECT id FROM items WHERE company_id = ? AND name = ?').get(c.id, name);
    if (dup) throw new Error(`An item named "${name}" already exists.`);
    const r = db.prepare(
      `INSERT INTO items(company_id,name,unit,hsn,gst_rate,is_service,sale_account_id,purchase_account_id,opening_qty,active,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,1,?)`)
      .run(c.id, name, String(b.unit || 'nos'), String(b.hsn || ''),
        b.gst_rate !== '' && b.gst_rate != null ? Number(b.gst_rate) : null,
        b.is_service ? 1 : 0,
        b.sale_account_id || null, b.purchase_account_id || null,
        b.opening_qty ? Number(b.opening_qty) : 0, todayISO());
    ok(res, { item: db.prepare('SELECT * FROM items WHERE id = ?').get(Number(r.lastInsertRowid)) }, 201);
  } catch (e) { fail(res, e); }
});

api.patch('/items/:id', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try {
    const it = db.prepare('SELECT * FROM items WHERE id = ? AND company_id = ?').get(Number(req.params.id), c.id);
    if (!it) throw Object.assign(new Error('Item not found.'), { status: 404 });
    const b = req.body || {};
    const name = b.name !== undefined ? String(b.name).trim() : it.name;
    const dup = db.prepare('SELECT id FROM items WHERE company_id = ? AND name = ? AND id != ?').get(c.id, name, it.id);
    if (dup) throw new Error(`An item named "${name}" already exists.`);
    db.prepare(`UPDATE items SET name=?, unit=?, hsn=?, gst_rate=?, is_service=?, sale_account_id=?, purchase_account_id=? WHERE id=?`)
      .run(name,
        b.unit !== undefined ? String(b.unit) : it.unit,
        b.hsn !== undefined ? String(b.hsn) : it.hsn,
        b.gst_rate !== undefined && b.gst_rate !== '' ? Number(b.gst_rate) : it.gst_rate,
        b.is_service !== undefined ? (b.is_service ? 1 : 0) : it.is_service,
        b.sale_account_id !== undefined ? b.sale_account_id : it.sale_account_id,
        b.purchase_account_id !== undefined ? b.purchase_account_id : it.purchase_account_id,
        it.id);
    ok(res, { item: db.prepare('SELECT * FROM items WHERE id = ?').get(it.id) });
  } catch (e) { fail(res, e); }
});

api.delete('/items/:id', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try {
    const it = db.prepare('SELECT * FROM items WHERE id = ? AND company_id = ?').get(Number(req.params.id), c.id);
    if (!it) throw Object.assign(new Error('Item not found.'), { status: 404 });
    const used = db.prepare('SELECT COUNT(*) n FROM item_entries WHERE item_id = ?').get(it.id).n > 0;
    if (used) throw new Error('Cannot delete: this item has stock movements. You may edit it.');
    db.prepare('DELETE FROM items WHERE id = ?').run(it.id);
    ok(res, { deleted: true });
  } catch (e) { fail(res, e); }
});

// ---------- vouchers ----------
api.get('/vouchers/next', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  const cls = req.query.class;
  if (!CLASS_META[cls]) return fail(res, Object.assign(new Error('Unknown class.'), { status: 400 }));
  ok(res, { number: nextVoucherNo(c.id, cls) });
});

api.get('/vouchers', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  const from = req.query.from || c.books_begin_from;
  const to = req.query.to || todayISO();
  let sql = `
    SELECT v.id, v.class, v.voucher_no, v.date, v.number, v.narration, v.ref,
      (SELECT COALESCE(SUM(e.debit),0) FROM entries e WHERE e.voucher_id = v.id) AS debit,
      (SELECT COALESCE(SUM(e.credit),0) FROM entries e WHERE e.voucher_id = v.id) AS credit,
      (SELECT COUNT(*) FROM entries e WHERE e.voucher_id = v.id) AS lines
    FROM vouchers v WHERE v.company_id = ? AND v.active = 1 AND v.date BETWEEN ? AND ?`;
  const params = [c.id, from, to];
  if (req.query.class) { sql += ' AND v.class = ?'; params.push(req.query.class); }
  if (req.query.account) { sql += ' AND v.id IN (SELECT voucher_id FROM entries WHERE account_id = ?)'; params.push(Number(req.query.account)); }
  sql += ' ORDER BY v.date, v.id DESC';
  ok(res, {
    rows: db.prepare(sql).all(...params).map(r => ({ ...r, debit: Number(r.debit), credit: Number(r.credit), lines: Number(r.lines) })),
  });
});

api.get('/vouchers/:id', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  const v = db.prepare('SELECT id FROM vouchers WHERE id = ? AND company_id = ?').get(Number(req.params.id), c.id);
  if (!v) return fail(res, Object.assign(new Error('Voucher not found.'), { status: 404 }));
  ok(res, { voucher: voucherDetail(Number(req.params.id)), log: voucherLog(Number(req.params.id)) });
});

api.post('/vouchers', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try { ok(res, { voucher: createVoucher(c, req.body || {}) }, 201); }
  catch (e) { fail(res, e); }
});

api.patch('/vouchers/:id', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try { ok(res, { voucher: updateVoucher(c, Number(req.params.id), req.body || {}) }); }
  catch (e) { fail(res, e); }
});

api.delete('/vouchers/:id', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try { ok(res, deleteVoucher(c, Number(req.params.id))); }
  catch (e) { fail(res, e); }
});

// ---------- Excel import / export ----------
const DATA_KINDS = new Set(['ledgers', 'items', 'stock', 'vouchers']);
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|xls|csv)$/i.test(file.originalname) || /^(application\/vnd\.openxmlformats|application\/vnd\.ms-excel|text\/csv)/.test(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error('File must be .xlsx, .xls or .csv'), { status: 400 }));
  },
});

api.get('/export/:kind', async (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  const kind = req.params.kind;
  if (!DATA_KINDS.has(kind)) return fail(res, new Error('Unknown export kind.'));
  try {
    const m = req.query.mode;
    const out = m === 'template' ? await exportKindTemplate(kind, c)
      : m === 'sample' ? await exportKindSample(kind, c)
      : await exportKindData(kind, c);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${out.file}"`);
    res.send(out.buf);
  } catch (e) { fail(res, e); }
});

api.post('/import/:kind', fileUpload.single('file'), async (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  const kind = req.params.kind;
  if (!DATA_KINDS.has(kind)) return fail(res, new Error('Unknown import kind.'));
  try {
    if (!req.file) throw new Error('No file received — choose an .xlsx / .csv file first.');
    const rows = await parseWorkbook(req.file.buffer, req.file.originalname);
    const mode = String(req.body.mode || 'add') === 'update' ? 'update' : 'add';
    if (String(req.body.preview) === '1') {
      const headers = rows.length ? Object.keys(rows[0]) : [];
      return ok(res, { preview: true, total: rows.length, headers, rows: rows.slice(0, 15), mode });
    }
    const result = importKind(kind, c, rows, { mode, date: req.body.date || undefined, counterpart_id: req.body.counterpart_id || undefined });
    ok(res, result);
  } catch (e) { fail(res, e); }
});

// ---- sales invoice Excel import (keeps user's Excel format, books + prints) ----
api.post('/import/invoice_excel', fileUpload.single('file'), async (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try {
    if (!req.file) throw new Error('No file received — choose an .xlsx / .csv file first.');
    const isPreview = String(req.body.preview) === '1';
    if (isPreview) {
      const parsed = await parseInvoiceWorkbook(req.file.buffer, req.file.originalname);
      return ok(res, { preview: true, parsed, filename: req.file.originalname });
    }
    const out = await importInvoiceExcel(c, req.file.buffer, req.file.originalname);
    ok(res, { ok: true, voucher: out.voucher, parsed: out.parsed, message: `Sales ${out.voucher.number || '#' + out.voucher.voucher_no} booked ✓` });
  } catch (e) { fail(res, e); }
});

api.get('/export/invoice_excel_template', async (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  try {
    const { exportInvoiceTemplate } = await import('./invoiceExcel.js');
    const out = await exportInvoiceTemplate(c);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${out.file}"`);
    res.send(out.buf);
  } catch (e) { fail(res, e); }
});

// phone access info (which address a phone on the same Wi-Fi can open / install)
api.get('/phone-info', (req, res) => {
  try {
    const port = Number(process.env.PORT || 8080);
    const nets = os.networkInterfaces();
    const urls = [];
    for (const name of Object.keys(nets)) {
      for (const ni of nets[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) urls.push('http://' + ni.address + ':' + port);
      }
    }
    ok(res, { port, urls: urls.slice(0, 4) });
  } catch (e) { fail(res, e); }
});

// live USD->INR rate (free services, cached 10 min; graceful when offline)
let _usdCache = null; // { rate, updatedAt, source }
let _usdFetching = null;
async function usdRate() {
  if (_usdCache && Date.now() - _usdCache.at < 10 * 60 * 1000) return _usdCache;
  if (_usdFetching) return _usdFetching;
  _usdFetching = (async () => {
    const tries = [
      { url: 'https://open.er-api.com/v6/latest/USD', pick: (j) => j && j.rates && j.rates.INR, src: 'open.er-api.com' },
      { url: 'https://api.frankfurter.app/latest?from=USD&to=INR', pick: (j) => j && j.rates && j.rates.INR, src: 'frankfurter.app' },
    ];
    for (const t of tries) {
      try {
        const r = await fetch(t.url, { signal: AbortSignal.timeout(4500), headers: { accept: 'application/json' } });
        if (!r.ok) continue;
        const j = await r.json();
        const rate = Number(t.pick(j));
        if (rate > 0) {
          _usdCache = { rate, at: Date.now(), updatedAt: new Date().toISOString(), source: t.src };
          return _usdCache;
        }
      } catch (_) { /* try next */ }
    }
    _usdCache = null;
    return null;
  })().finally(() => { _usdFetching = null; });
  return _usdFetching;
}
api.get('/rates', async (req, res) => {
  try {
    const c = companyOr(res);
    if (!c) return;
    const u = await usdRate();
    ok(res, { usd: u ? { rate: u.rate, updatedAt: u.updatedAt, source: u.source } : null });
  } catch (e) { fail(res, e); }
});

// edit log for the company (audit trail screen)
api.get('/edit-log', (req, res) => {
  const c = companyOr(res);
  if (!c) return;
  const rows = db.prepare(`
    SELECT l.id, l.voucher_id, l.action, l.at,
      v.class, v.voucher_no, v.number AS vnumber, v.date AS vdate
    FROM edit_log l LEFT JOIN vouchers v ON v.id = l.voucher_id
    WHERE l.company_id = ? ORDER BY l.id DESC LIMIT 500`).all(c.id);
  ok(res, { rows });
});

// ---------- reports ----------
function period(res, req) {
  const c = companyOr(res);
  if (!c) return null;
  const from = req.query.from || c.books_begin_from;
  const to = req.query.to || todayISO();
  if (!validISO(from) || !validISO(to) || from > to) { fail(res, new Error('Invalid period.')); return null; }
  return { c, from, to };
}

api.get('/reports/trial-balance', (req, res) => {
  const c = companyOr(res); if (!c) return;
  const asOn = req.query.as_on && validISO(req.query.as_on) ? req.query.as_on : todayISO();
  ok(res, trialBalance(c, asOn));
});
api.get('/reports/balance-sheet', (req, res) => {
  const c = companyOr(res); if (!c) return;
  const asOn = req.query.as_on && validISO(req.query.as_on) ? req.query.as_on : todayISO();
  ok(res, balanceSheet(c, asOn));
});
api.get('/reports/profit-loss', (req, res) => {
  const p = period(res, req); if (!p) return;
  ok(res, profitLoss(p.c, p.from, p.to));
});
api.get('/reports/day-book', (req, res) => {
  const p = period(res, req); if (!p) return;
  ok(res, dayBook(p.c, p.from, p.to));
});
api.get('/reports/ledger', (req, res) => {
  const p = period(res, req); if (!p) return;
  if (!req.query.account_id) return fail(res, new Error('account_id required.'));
  ok(res, ledgerReport(p.c, Number(req.query.account_id), p.from, p.to));
});
api.get('/reports/stock', (req, res) => {
  const p = period(res, req); if (!p) return;
  if (!req.query.item_id) return fail(res, new Error('item_id required.'));
  ok(res, stockReport(p.c, Number(req.query.item_id), p.from, p.to));
});
api.get('/reports/gst', (req, res) => {
  const p = period(res, req); if (!p) return;
  ok(res, gstSummary(p.c, p.from, p.to));
});

api.get('/dashboard', (req, res) => {
  const c = companyOr(res); if (!c) return;
  try { ok(res, dashboard(c)); }
  catch (e) { fail(res, e); }
});

// ---------------------------------------------------------------
// In-app one-click updates. The app fetches the newest PC package
// from GitHub, unpacks it over its own code (data/ is never touched),
// then restarts itself. This is how you get new builds without
// downloading and copying files by hand.
// ---------------------------------------------------------------
const APP_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// (the env overrides exist so the update flow can be tested against a local stand-in)
const PKG_URL = process.env.ONS_UPDATE_ZIP_URL || 'https://github.com/onsoutsourcingsolutions-svg/TallyClone/raw/arena/01a0827e-tallyclone/ONS-Books-PC-Package.zip';
const TAG_URL = process.env.ONS_UPDATE_VERSION_URL || 'https://raw.githubusercontent.com/onsoutsourcingsolutions-svg/TallyClone/arena/01a0827e-tallyclone/version.js';

// paths that are never replaced by an update
const UPDATE_SKIP = ['data', 'node_modules', '.git', '_update_stage', 'ONS-Books-PC-Package.zip', 'install-log.txt', 'diag.txt'];
// roots that may be pruned of files a newer package no longer has — NOTE: dist is NOT pruned because package may exclude it and we rebuild it
const CODE_ROOTS = ['server', 'src', 'public', 'scripts', 'templates'];
const ROOT_FILES = ['index.html', 'package.json', 'package-lock.json', 'vite.config.js', 'version.js', 'README.md',
  'start-windows.bat', 'START_ME.bat', 'start-mac-linux.sh', 'TEST.bat', 'diagnose.bat'];

function semverOf(tag) {
  const m = /v(\d+)\.(\d+)\.(\d+)/.exec(tag || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function newerThan(a, b) { // a > b ?
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

async function remoteBuildTag() {
  const r = await fetch(TAG_URL + '?t=' + Date.now(), {
    signal: AbortSignal.timeout(12000),
    headers: { accept: 'text/plain', 'user-agent': 'ONS-Books-updater' },
  });
  if (!r.ok) throw new Error('update server answered HTTP ' + r.status);
  const txt = await r.text();
  const m = /BUILD_TAG\s*=\s*'([^']+)'/.exec(txt);
  if (!m || !m[1]) throw new Error('update server sent an unreadable reply');
  return m[1];
}

let _updCheckCache = null; // { at, body }
api.get('/update/check', async (req, res) => {
  if (_updCheckCache && Date.now() - _updCheckCache.at < 60000) return ok(res, _updCheckCache.body);
  const cur = semverOf(BUILD_TAG);
  let body;
  try {
    const latestTag = await remoteBuildTag();
    const latest = semverOf(latestTag);
    body = {
      current: BUILD_TAG,
      latest: latest ? latestTag : null,
      update: !!(cur && latest && newerThan(latest, cur)),
      offline: false,
    };
  } catch (_) {
    body = { current: BUILD_TAG, latest: null, update: false, offline: true };
  }
  _updCheckCache = { at: Date.now(), body };
  ok(res, body);
});

api.get('/ping', (req, res) => ok(res, {}));

api.post('/update/apply', async (req, res) => {
  try {
    // 1. confirm a genuinely newer build is published
    let latest = null;
    try { latest = await remoteBuildTag(); } catch (_) { /* fall through */ }
    const cur = semverOf(BUILD_TAG);
    const ls = semverOf(latest);
    if (!ls) return fail(res, new Error('Could not reach the update server. Check the internet and try again.'));
    if (!cur || !newerThan(ls, cur)) return fail(res, new Error('Already on the newest build (' + BUILD_TAG + ') — nothing to install.'));

    // 2. download the package
    const r = await fetch(PKG_URL + '?t=' + Date.now(), {
      signal: AbortSignal.timeout(90000),
      headers: { accept: 'application/zip', 'user-agent': 'ONS-Books-updater' },
    });
    if (!r.ok) throw new Error('Download failed (HTTP ' + r.status + '). Try again in a minute.');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 500 || buf.readUInt32LE(0) !== 0x04034b50) {
      throw new Error('Downloaded package is not a valid zip. Try again in a minute.');
    }

    // 3. unpack into a staging folder, skipping anything protected
    const stage = path.join(APP_ROOT, '_update_stage');
    fs.rmSync(stage, { recursive: true, force: true });
    const files = extractZip(buf, stage, { skip: UPDATE_SKIP });
    const have = new Set(files);
    if (!have.has('server/index.js') && !have.has('dist/index.html')) {
      fs.rmSync(stage, { recursive: true, force: true });
      throw new Error('Package looks wrong — install stopped, nothing was changed.');
    }

    // 4. move the new files over the running copy (each rename is quick)
    for (const rel of files) {
      try {
        const dst = path.join(APP_ROOT, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.renameSync(path.join(stage, rel), dst);
      } catch (_) { /* a busy file can wait for the next update run */ }
    }
    fs.rmSync(stage, { recursive: true, force: true });

    // 5. remove code files a newer package no longer ships
    for (const root of CODE_ROOTS) {
      const dir = path.join(APP_ROOT, root);
      if (!fs.existsSync(dir)) continue;
      const walk = (d) => {
        for (const n of fs.readdirSync(d)) {
          const f = path.join(d, n);
          if (fs.statSync(f).isDirectory()) { walk(f); continue; }
          const rel = path.relative(APP_ROOT, f).split(path.sep).join('/');
          if (!have.has(rel)) { try { fs.unlinkSync(f); } catch (_) { /* file busy — ignore */ } }
        }
      };
      walk(dir);
    }
    for (const name of ROOT_FILES) {
      const f = path.join(APP_ROOT, name);
      if (fs.existsSync(f) && !have.has(name) && fs.statSync(f).isFile()) {
        try { fs.unlinkSync(f); } catch (_) { /* ignore */ }
      }
    }

    // 6. tell the browser it worked, then restart this server in a moment
    res.json({ ok: true, installed: latest });
    // (the new instance waits ~3s so the old one has fully released port 8080)
    setTimeout(() => {
      try {
        if (process.platform === 'win32') {
          const bat = path.join(APP_ROOT, '_apply-restart.bat');
          fs.writeFileSync(bat,
            '@echo off\r\ncd /d "%~dp0"\r\ntimeout /t 3 /nobreak >nul\r\nnode server\\run.js\r\n');
          const p = spawn('cmd.exe', ['/c', 'start', '""', '"' + bat + '"'], { detached: true, stdio: 'ignore' });
          p.unref();
        } else {
          const p = spawn('/bin/sh', ['-c', 'sleep 3; exec node server/run.js'],
            { cwd: APP_ROOT, detached: true, stdio: 'ignore' });
          p.unref();
        }
      } catch (_) { /* nothing else we can do */ }
    }, 800);
    setTimeout(() => { try { process.exit(0); } catch (_) { /* ignore */ } }, 2500);
  } catch (e) { fail(res, e); }
});
