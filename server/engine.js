import { db, tx, getCompany, companyExtras, saveCompanyExtras, nextVoucherNo } from './db.js';
import { BS_TEMPLATE, PL_SECTIONS, groupMeta } from './chart.js';
import { toPaise, todayISO, validISO, addDaysISO, fyEnd, roundHalfEven, CLASS_META } from './lib.js';

export function fmtP(p) { return (Number(p) / 100).toFixed(2); }

// ============================ COMPANIES ============================
const SEED_LEDGERS = [
  ['Cash in Hand', 'cash_in_hand', 'Asset', 'Cash'],
  ['Sales', 'sales', 'Income', 'Income'],
  ['Purchases', 'purchases', 'Expense', 'Expense'],
  ['Cost of Goods Sold', 'expense_direct', 'Expense', 'Expense'],
  ['Stock-in-Hand', 'inventories', 'Asset', 'Inventory'],
  ['Rounding Off', 'expense_indirect', 'Expense', 'Expense'],
];

export function createCompany(payload) {
  const fyFrom = payload.financial_year_from || '2025-04-01';
  const booksFrom = payload.books_begin_from || fyFrom;
  if (!validISO(fyFrom)) throw new Error('Invalid financial year start date.');
  if (!validISO(booksFrom)) throw new Error('Invalid books-begin date.');
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Company name is required.');
  const now = todayISO();
  const id = tx(() => {
    const info = db.prepare(
      `INSERT INTO companies(name,address,city,state,pincode,state_code,gstin,pan,
        financial_year_from,books_begin_from,gst_enabled,inventory_enabled,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      name, String(payload.address || ''), String(payload.city || ''),
      String(payload.state || ''), String(payload.pincode || ''), String(payload.state_code || ''),
      String(payload.gstin || '').toUpperCase(), String(payload.pan || '').toUpperCase(),
      fyFrom, booksFrom, payload.gst_enabled === false ? 0 : 1, payload.inventory_enabled === false ? 0 : 1,
      now
    );
    const cid = Number(info.lastInsertRowid);
    const ins = db.prepare('INSERT INTO accounts(company_id,name,group_code,type,kind,created_at) VALUES(?,?,?,?,?,?)');
    const ids = {};
    for (const [n, g, t, k] of SEED_LEDGERS) {
      const r = ins.run(cid, n, g, t, k, now);
      ids[n] = Number(r.lastInsertRowid);
    }
    saveCompanyExtras(cid, {
      auto_tax: true,
      tax_regime_default: 'intra',
      inventory_account_id: ids['Stock-in-Hand'],
      cogs_account_id: ids['Cost of Goods Sold'],
      sales_account_id: ids['Sales'],
      purchases_account_id: ids['Purchases'],
      cash_account_id: ids['Cash in Hand'],
      roundoff_account_id: ids['Rounding Off'],
      fy: fyFrom.slice(0, 7),
    });
    return cid;
  });
  return getCompany(id);
}

// ============================ LOOKUPS ============================
export function listAccounts(companyId) {
  return db.prepare('SELECT * FROM accounts WHERE company_id = ? ORDER BY group_code, name').all(companyId);
}

export function createLedgerAccount(c, b) {
  const name = String(b.name || '').trim();
  const grp = groupMeta(b.group_code);
  if (!name) throw vErr('Ledger name is required.');
  if (!grp) throw vErr('Choose a group (classification) for the ledger.');
  const dup = db.prepare('SELECT id FROM accounts WHERE company_id = ? AND name = ?').get(c.id, name);
  if (dup) throw vErr(`A ledger named "${name}" already exists.`);
  let ob = toPaise(b.opening_balance || 0);
  if (b.opening_type === 'Cr') ob = -Math.abs(ob);
  else ob = Math.abs(ob);
  const r = db.prepare(
    `INSERT INTO accounts(company_id,name,group_code,type,kind,address,gstin,pan,credit_days,credit_limit,
      bank_name,ifsc,account_no,opening_balance,opening_balance_date,active,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`
  ).run(c.id, name, b.group_code, grp.type, b.kind || grp.kind || 'General',
    String(b.address || ''), String(b.gstin || '').toUpperCase(), String(b.pan || '').toUpperCase(),
    b.credit_days ? Number(b.credit_days) : null,
    b.credit_limit != null && b.credit_limit !== '' ? toPaise(b.credit_limit) : null,
    String(b.bank_name || ''), String(b.ifsc || '').toUpperCase(), String(b.account_no || ''),
    ob, b.opening_date || c.books_begin_from, todayISO());
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(r.lastInsertRowid));
}

// net balance per active account: +debit -credit + opening (signed, + = debit)
export function netBalances(c, { asOn = null, from = null, to = null, includeOpening = true } = {}) {
  const map = {};
  let sql = `SELECT a.id, a.name, a.group_code, a.type, ${includeOpening ? 'a.opening_balance AS opn' : '0 AS opn'}
    FROM accounts a WHERE a.company_id = ? AND a.active = 1`;
  for (const a of db.prepare(sql).all(c.id)) map[a.id] = { ...a, net: Number(a.opn || 0) };
  let psql = `SELECT e.account_id AS id, SUM(e.debit - e.credit) AS net FROM entries e
    JOIN vouchers v ON v.id = e.voucher_id
    WHERE e.company_id = ? AND v.active = 1`;
  const p2 = [c.id];
  if (asOn) { psql += ' AND v.date <= ?'; p2.push(asOn); }
  else if (to) { psql += ' AND v.date <= ?'; p2.push(to); }
  if (from) { psql += ' AND v.date >= ?'; p2.push(from); }
  psql += ' GROUP BY e.account_id';
  for (const t of db.prepare(psql).all(...p2)) if (map[t.id]) map[t.id].net += Number(t.net);
  return map;
}

export function accountBalanceOf(companyId, accountId, asOn) {
  const row = db.prepare(`
    SELECT a.opening_balance AS opn,
      COALESCE((SELECT SUM(e.debit - e.credit) FROM entries e JOIN vouchers v ON v.id = e.voucher_id
                WHERE e.account_id = a.id AND v.active = 1 AND v.date <= ?),0) AS posted
    FROM accounts a WHERE a.id = ? AND a.company_id = ?`).get(asOn, accountId, companyId);
  if (!row) return null;
  return Number(row.opn) + Number(row.posted);
}

// ============================ VALIDATION ============================
export function dateInBook(c, date) {
  if (!validISO(date)) return `Invalid date ${date}.`;
  const end = fyEnd(c.financial_year_from);
  if (date < c.books_begin_from) return `Date ${date} is before books begin date (${c.books_begin_from}).`;
  if (date > end) return `Date ${date} is beyond the current financial year (${end}).`;
  return null;
}

export function validateBalanced(c, rows, date) {
  const errs = [];
  let d = 0, cr = 0;
  rows.forEach((r, i) => {
    if (!r.account_id) { errs.push(`Line ${i + 1}: choose an account.`); return; }
    const a = db.prepare('SELECT id FROM accounts WHERE id = ? AND company_id = ? AND active = 1').get(r.account_id, c.id);
    if (!a) { errs.push(`Line ${i + 1}: account not found.`); return; }
    const dr = toPaise(r.debit), cd = toPaise(r.credit);
    if (dr < 0 || cd < 0) errs.push(`Line ${i + 1}: negative amounts are not allowed.`);
    if (dr === 0 && cd === 0) errs.push(`Line ${i + 1}: enter an amount.`);
    d += dr; cr += cd;
  });
  if (d !== cr) errs.push(`Not balanced: total debit ${fmtP(d)} ≠ total credit ${fmtP(cr)}.`);
  const de = dateInBook(c, date);
  if (de) errs.push(de);
  return errs;
}

export function vErr(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }

// ============================ GST DUTY LEDGERS ============================
export function rateLabel(r) {
  const n = Number(r);
  return (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)) + '%';
}
function dutyName(role, leg, rate) {
  const side = role === 'OUT' ? 'Output' : 'Input';
  return `${side} ${leg} ${rateLabel(rate)}`;
}
function roleGroup(role) { return role === 'OUT' ? 'statutory_dues' : 'input_tax_credit'; }
function roleType(role) { return role === 'OUT' ? 'Liability' : 'Asset'; }

export function resolveDutyAccount(c, role, leg, rate) {
  const name = dutyName(role, leg, rate);
  let a = db.prepare('SELECT * FROM accounts WHERE company_id = ? AND kind = ? AND group_code = ? AND name = ?')
    .get(c.id, 'Duty', roleGroup(role), name);
  if (a) return a;
  const r = db.prepare('INSERT INTO accounts(company_id,name,group_code,type,kind,created_at) VALUES(?,?,?,?,?,?)')
    .run(c.id, name, roleGroup(role), roleType(role), 'Duty', todayISO());
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(Number(r.lastInsertRowid));
}

// ============================ INVENTORY (weighted average) ============================
export function inventoryMoves(itemId) {
  return db.prepare(`
    SELECT ie.*, v.date FROM item_entries ie
    JOIN vouchers v ON v.id = ie.voucher_id
    WHERE ie.item_id = ? AND v.active = 1
    ORDER BY v.date, v.id, ie.line_no`).all(itemId);
}
export function inventoryState(itemId, asOf = null) {
  let qty = 0, value = 0;
  for (const m of inventoryMoves(itemId)) {
    if (asOf && m.date > asOf) break;
    if (m.direction === 'in') { qty += m.qty; value += Number(m.amount); }
    else {
      const unit = qty > 1e-9 ? value / qty : 0;
      const outVal = Math.min(Math.abs(m.qty) * unit, value);
      qty -= Math.abs(m.qty); value -= outVal;
    }
    if (qty < 1e-9) { qty = 0; value = 0; }
  }
  return { qty: roundQ(qty), value: Math.round(value), rate: qty > 1e-9 ? Math.round(value / qty) : 0 };
}
export function roundQ(q) { return Math.round(Number(q) * 10000) / 10000; }

function avgOutValue(itemId, qty) {
  const st = inventoryState(itemId);
  if (st.qty <= 1e-9 || qty <= 0) return { value: 0, qty: 0, state: st };
  return { value: Math.min(Math.round(st.rate * qty), st.value), qty, state: st };
}

// ============================ VOUCHER CORE ============================
export function voucherDetail(id) {
  const v = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(id);
  if (!v) return null;
  const entries = db.prepare(`SELECT e.*, a.name AS account_name, a.group_code, a.kind,
      a.address AS account_address, a.gstin AS account_gstin FROM entries e
    JOIN accounts a ON a.id = e.account_id WHERE e.voucher_id = ? ORDER BY e.line_no`).all(id);
  const items = db.prepare(`SELECT ie.*, i.name AS item_name, i.unit, i.hsn AS item_hsn, i.gst_rate AS item_gst_rate
    FROM item_entries ie JOIN items i ON i.id = ie.item_id
    WHERE ie.voucher_id = ? ORDER BY ie.line_no`).all(id);
  return { ...v, entries, items };
}
export function voucherLog(vid) {
  return db.prepare('SELECT id, action, at, old_json, new_json FROM edit_log WHERE voucher_id = ? ORDER BY id').all(vid);
}
function logChange(c, vid, action, before, after) {
  db.prepare('INSERT INTO edit_log(company_id,voucher_id,action,at,old_json,new_json) VALUES(?,?,?,?,?,?)')
    .run(c.id, vid, action, todayISO(), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null);
}

const GENERIC_CLASSES = new Set(['receipt', 'payment', 'contra', 'journal', 'sales', 'purchase', 'credit_note', 'debit_note']);
const INVOICE_CLASSES = new Set(['sales', 'purchase', 'credit_note', 'debit_note']);
const RETURN_CLASSES = new Set(['credit_note', 'debit_note']);

function openVoucherRow(c, payload, vid) {
  const date = payload.date || todayISO();
  const now = todayISO();
  if (vid) {
    const exists = db.prepare('SELECT * FROM vouchers WHERE id = ? AND company_id = ?').get(vid, c.id);
    if (!exists) throw vErr('Voucher not found.', 404);
    db.prepare('UPDATE vouchers SET date=?, number=?, narration=?, ref=?, ref_date=?, updated_at=? WHERE id=?')
      .run(date, String(payload.number || '').trim(), String(payload.narration || ''),
        String(payload.ref || ''), payload.ref_date || null, now, vid);
    return vid;
  }
  const no = nextVoucherNo(c.id, payload.class);
  const r = db.prepare(`INSERT INTO vouchers(company_id,class,voucher_no,date,number,narration,ref,ref_date,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(c.id, payload.class, no, date, String(payload.number || '').trim(), String(payload.narration || ''),
      String(payload.ref || ''), payload.ref_date || null, now, now);
  return Number(r.lastInsertRowid);
}

function wipeChildren(vid) {
  db.prepare('DELETE FROM item_entries WHERE voucher_id = ?').run(vid);
  db.prepare('DELETE FROM entries WHERE voucher_id = ?').run(vid);
}

function insE(cid, vid, line, account_id, debit, credit, particulars, taxable, is_stock) {
  db.prepare('INSERT INTO entries(voucher_id,company_id,line_no,account_id,debit,credit,particulars,taxable,is_stock) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(vid, cid, line, account_id, debit, credit, particulars, taxable ?? null, is_stock ? 1 : 0);
}
function insIE(cid, vid, line, item_id, qty, rate, amount, direction) {
  db.prepare('INSERT INTO item_entries(voucher_id,company_id,line_no,item_id,qty,rate,amount,direction) VALUES(?,?,?,?,?,?,?,?)')
    .run(vid, cid, line, item_id, qty, rate, amount, direction);
}

// ---- generic (simple ledger-line) voucher ----
function buildGeneric(c, vid, payload) {
  const row = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(vid);
  const rows = (payload.entries || []).filter(r => r.account_id && (toPaise(r.debit) || toPaise(r.credit)));
  if (!rows.length) throw vErr('Add at least one entry.');
  const errs = validateBalanced(c, rows, row.date);
  if (errs.length) throw vErr(errs.join(' '));
  let line = 0;
  for (const en of rows) insE(c.id, vid, line++, en.account_id, toPaise(en.debit), toPaise(en.credit), String(en.particulars || ''), null, 0);
}

// ---- invoice with stock items + auto GST (incl. returns) ----
function buildInvoice(c, vid, payload) {
  const row = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(vid);
  const cls = row.class;
  if (!INVOICE_CLASSES.has(cls)) throw vErr('Invalid invoice class.');
  const isSale = cls === 'sales';
  const isReturn = RETURN_CLASSES.has(cls);
  const party = db.prepare('SELECT * FROM accounts WHERE id = ? AND company_id = ? AND active = 1').get(payload.party_id, c.id);
  if (!party) throw vErr('Choose the party account.');
  const regime = payload.regime === 'inter' ? 'inter' : 'intra';
  const ex = companyExtras(c);
  const autoTax = c.gst_enabled && ex.auto_tax !== false && payload.auto_tax !== false;

  const lines = (payload.items || []).filter(x => x.item_id);
  if (!lines.length) throw vErr('Add at least one stock item line.');
  const resolved = [];
  for (const it of lines) {
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND company_id = ? AND active = 1').get(it.item_id, c.id);
    if (!item) throw vErr(`Item #${it.item_id} not found.`);
    const qty = Number(it.qty);
    const ratePaise = toPaise(it.rate);
    if (!(qty > 0)) throw vErr(`Item "${item.name}": enter quantity.`);
    if (ratePaise < 0) throw vErr(`Item "${item.name}": rate cannot be negative.`);
    if (!(ratePaise > 0)) throw vErr(`Item "${item.name}": enter rate.`);
    const amount = Math.round(ratePaise * qty);
    resolved.push({ item, qty, ratePaise, amount, gst: Number(item.gst_rate || 0) });
  }
  const baseTotal = resolved.reduce((s, x) => s + x.amount, 0);

  const bucketMap = new Map();
  const addBucket = (leg, rate, base, tax) => {
    const k = leg + '|' + rate;
    if (!bucketMap.has(k)) bucketMap.set(k, { leg, rate, base: 0, tax: 0 });
    const b = bucketMap.get(k);
    b.base += base; b.tax += tax;
  };
  if (autoTax) {
    for (const x of resolved) {
      const g = x.gst;
      if (!(g > 0)) continue;
      if (regime === 'intra') {
        const total = Math.round((x.amount * g) / 100);
        const a = roundHalfEven(total / 2);
        addBucket('CGST', g / 2, x.amount, a);
        addBucket('SGST', g / 2, x.amount, total - a);
      } else {
        addBucket('IGST', g, x.amount, Math.round((x.amount * g) / 100));
      }
    }
  }
  const taxBuckets = [...bucketMap.values()];
  const taxTotal = taxBuckets.reduce((s, b) => s + b.tax, 0);
  const invoiceTotal = baseTotal + taxTotal;
  const role = (cls === 'sales' || cls === 'credit_note') ? 'OUT' : 'IN';
  const isGoodsReturn = isReturn;

  // availability guard: goods leaving inventory must exist (sales & supplier returns)
  if (cls === 'sales' || (isReturn && cls === 'debit_note')) {
    for (const x of resolved) {
      const st = inventoryState(x.item.id);
      if (st.qty + 1e-9 < x.qty) throw vErr(`Item "${x.item.name}": insufficient stock — only ${roundQ(st.qty)} ${x.item.unit} available.`);
    }
  }
  if (isGoodsReturn && cls === 'debit_note') {
    for (const x of resolved) {
      const st = inventoryState(x.item.id);
      if (x.amount > st.value + 1) throw vErr(`Item "${x.item.name}": return value exceeds current stock value (₹${fmtP(st.value)}). Return at average cost or adjust stock first.`);
    }
  }

  wipeChildren(vid);
  // pre-compute inventory valuations BEFORE inserting any lines of this voucher
  // (state must not include this voucher's own pending stock movements)
  const stockVals = (cls === 'sales' || cls === 'credit_note')
    ? resolved.map(x => avgOutValue(x.item.id, x.qty).value)
    : null;
  let line = 0;
  const invId = ex.inventory_account_id;
  const saleAccId = ex.sales_account_id;
  if (cls === 'sales' || cls === 'credit_note') {
    // -------- sales & sales returns (customer) --------
    if (cls === 'sales') insE(c.id, vid, line++, party.id, invoiceTotal, 0, 'To Sales', null, 0);
    else insE(c.id, vid, line++, party.id, 0, invoiceTotal, 'By Credit Note', null, 0);
    if (!saleAccId) throw vErr('Default sales account not configured (Settings → Accounts).');
    const byAcc = new Map();
    for (const x of resolved) {
      const accId = x.item.sale_account_id || saleAccId;
      byAcc.set(accId, (byAcc.get(accId) || 0) + x.amount);
      insIE(c.id, vid, line, x.item.id, x.qty, x.ratePaise, x.amount, cls === 'sales' ? 'out' : 'in');
      line++;
    }
    for (const [accId, amt] of byAcc) insE(c.id, vid, line++, accId, cls === 'credit_note' ? amt : 0, cls === 'sales' ? amt : 0, cls === 'sales' ? 'By Sales' : 'To Sales Returns', null, 0);
    for (const b of taxBuckets) {
      const acc = resolveDutyAccount(c, role, b.leg, b.rate);
      insE(c.id, vid, line++, acc.id, cls === 'credit_note' ? b.tax : 0, cls === 'sales' ? b.tax : 0, cls === 'sales' ? 'By ' + acc.name : 'To ' + acc.name + ' reversal', b.base, 0);
    }
    if (ex.cogs_account_id && invId) {
      if (cls === 'sales') {
        const stockVal = stockVals.reduce((s, v) => s + v, 0);
        if (stockVal > 0) {
          insE(c.id, vid, line++, ex.cogs_account_id, stockVal, 0, 'Cost of goods sold (auto)', null, 1);
          insE(c.id, vid, line++, invId, 0, stockVal, 'Stock valuation (auto)', null, 1);
        }
      } else {
        // goods come back in at average COST (reverses the COGS booked at sale time)
        const backVal = stockVals.reduce((s, v) => s + v, 0);
        if (backVal > 0) {
          insE(c.id, vid, line++, invId, backVal, 0, 'Stock return at cost (auto)', null, 1);
          insE(c.id, vid, line++, ex.cogs_account_id, 0, backVal, 'COGS reversal (auto)', null, 1);
        }
      }
    }
  } else {
    // -------- purchase & purchase returns (supplier) --------
    if (!invId) throw vErr('Default inventory account not configured (Settings).');
    if (cls === 'purchase') {
      for (const x of resolved) { insIE(c.id, vid, line, x.item.id, x.qty, x.ratePaise, x.amount, 'in'); line++; }
      insE(c.id, vid, line++, invId, baseTotal, 0, 'To Stock (auto)', null, 1);
      for (const b of taxBuckets) {
        const acc = resolveDutyAccount(c, role, b.leg, b.rate);
        insE(c.id, vid, line++, acc.id, b.tax, 0, 'To ' + acc.name, b.base, 0);
      }
      insE(c.id, vid, line++, party.id, 0, invoiceTotal, 'By Purchase', null, 0);
    } else {
      // debit note: party Dr, goods Cr at bill value, ITC reversed
      for (const x of resolved) { insIE(c.id, vid, line, x.item.id, x.qty, x.ratePaise, x.amount, 'out'); line++; }
      insE(c.id, vid, line++, party.id, invoiceTotal, 0, 'To Debit Note', null, 0);
      insE(c.id, vid, line++, invId, 0, baseTotal, 'Stock return out (auto)', null, 1);
      for (const b of taxBuckets) {
        const acc = resolveDutyAccount(c, role, b.leg, b.rate);
        insE(c.id, vid, line++, acc.id, 0, b.tax, 'ITC reversal (auto)', b.base, 0);
      }
    }
  }
}

// ---- stock journal (opening stock & adjustments) ----
function buildStockJournal(c, vid, payload) {
  const row = db.prepare('SELECT * FROM vouchers WHERE id = ?').get(vid);
  const ctr = db.prepare('SELECT * FROM accounts WHERE id = ? AND company_id = ? AND active = 1').get(payload.counterpart_id, c.id);
  if (!ctr) throw vErr('Choose the balancing (counterpart) account — e.g. Reserves & Surplus for opening stock.');
  const invId = companyExtras(c).inventory_account_id;
  if (!invId) throw vErr('Default inventory account not configured (Settings).');
  const lines = (payload.items || []).filter(x => x.item_id);
  if (!lines.length) throw vErr('Add at least one stock line.');
  let totalVal = 0;
  const moves = [];
  for (const it of lines) {
    const item = db.prepare('SELECT * FROM items WHERE id = ? AND company_id = ? AND active = 1').get(it.item_id, c.id);
    if (!item) throw vErr(`Item #${it.item_id} not found.`);
    const qty = Number(it.qty);
    if (!(qty > 0)) throw vErr(`Item "${item.name}": enter quantity.`);
    const dir = it.direction === 'out' ? 'out' : 'in';
    const hasRate = it.rate !== undefined && it.rate !== '' && Number(it.rate) > 0;
    let ratePaise = 0, amount = 0;
    if (dir === 'in') {
      if (!hasRate) throw vErr(`Item "${item.name}": enter rate for stock going in.`);
      ratePaise = toPaise(it.rate); amount = Math.round(ratePaise * qty);
    } else {
      const st = inventoryState(item.id);
      if (st.qty + 1e-9 < qty) throw vErr(`Item "${item.name}": only ${roundQ(st.qty)} ${item.unit} available.`);
      if (hasRate) {
        ratePaise = toPaise(it.rate);
        amount = Math.round(ratePaise * qty);
        if (amount > st.value + 1) throw vErr(`Item "${item.name}": value ₹${fmtP(amount)} exceeds available stock value ₹${fmtP(st.value)}.`);
      } else {
        const av = avgOutValue(item.id, qty);
        ratePaise = st.qty > 1e-9 ? Math.round((av.value / qty)) : 0;
        amount = av.value;
      }
    }
    totalVal += amount;
    moves.push({ item, qty, ratePaise, amount, dir });
  }
  wipeChildren(vid);
  let line = 0;
  if (moves.length && moves[0].dir === 'in') {
    for (const m of moves) { insIE(c.id, vid, line, m.item.id, m.qty, m.ratePaise, m.amount, 'in'); line++; }
    insE(c.id, vid, line++, invId, totalVal, 0, 'To Stock (Stock Journal)', null, 1);
    insE(c.id, vid, line++, ctr.id, 0, totalVal, 'By ' + ctr.name, null, 0);
  } else {
    for (const m of moves) { insIE(c.id, vid, line, m.item.id, m.qty, m.ratePaise, m.amount, 'out'); line++; }
    insE(c.id, vid, line++, ctr.id, totalVal, 0, 'To ' + ctr.name, null, 0);
    insE(c.id, vid, line++, invId, 0, totalVal, 'By Stock (Stock Journal)', null, 1);
  }
}

// ---- unified create/update ----
export function createVoucher(c, payload) {
  const cls = payload.class;
  if (!CLASS_META[cls]) throw vErr(`Unknown voucher class: ${cls}`);
  const de = dateInBook(c, payload.date || todayISO());
  if (de) throw vErr(de);
  return tx(() => {
    const vid = openVoucherRow(c, payload, null);
    buildVoucherBody(c, vid, payload);
    const after = voucherDetail(vid);
    logChange(c, vid, 'create', null, after);
    return after;
  });
}

export function updateVoucher(c, id, payload) {
  const exists = db.prepare('SELECT * FROM vouchers WHERE id = ? AND company_id = ?').get(id, c.id);
  if (!exists) throw vErr('Voucher not found.', 404);
  payload.class = exists.class; // class is immutable
  const de = dateInBook(c, payload.date || exists.date);
  if (de) throw vErr(de);
  return tx(() => {
    const before = voucherDetail(id);
    const vid = openVoucherRow(c, payload, id);
    buildVoucherBody(c, vid, payload);
    const after = voucherDetail(vid);
    logChange(c, vid, 'edit', before, after);
    return after;
  });
}

function buildVoucherBody(c, vid, payload) {
  const cls = payload.class;
  const hasItems = Array.isArray(payload.items) && payload.items.some(x => x.item_id);
  if (cls === 'stock_journal') return buildStockJournal(c, vid, payload);
  if (hasItems && INVOICE_CLASSES.has(cls)) return buildInvoice(c, vid, payload);
  if (cls === 'stock_journal') throw vErr('Stock Journal needs items with direction In/Out.');
  if (!GENERIC_CLASSES.has(cls)) throw vErr(`Voucher class ${cls} is not supported with this form.`);
  return buildGeneric(c, vid, payload);
}

export function deleteVoucher(c, id) {
  const v = db.prepare('SELECT * FROM vouchers WHERE id = ? AND company_id = ?').get(id, c.id);
  if (!v) throw vErr('Voucher not found.', 404);
  tx(() => {
    const before = voucherDetail(id);
    wipeChildren(id);
    db.prepare('DELETE FROM vouchers WHERE id = ?').run(id);
    logChange(c, id, 'delete', before, null);
  });
  return { ok: true };
}

// ============================ REPORTS ============================
function signedValue(a) {
  return (a.type === 'Liability' || a.type === 'Income') ? -a.net : a.net;
}

export function trialBalance(c, asOn) {
  const m = netBalances(c, { asOn });
  const rows = Object.values(m).map(a => {
    const grp = groupMeta(a.group_code);
    return {
      account_id: a.id, name: a.name, group: a.group_code,
      group_name: grp ? grp.name : a.group_code,
      type: a.type, debit: a.net > 0 ? a.net : 0, credit: a.net < 0 ? -a.net : 0,
    };
  }).filter(r => r.debit || r.credit).sort((a, b) => a.name.localeCompare(b.name));
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  return { as_on: asOn, rows, totals: { debit, credit }, balanced: debit === credit };
}

export function balanceSheet(c, asOn) {
  const m = netBalances(c, { asOn });
  function section(template) {
    return template.map(sec => {
      const rows = [];
      for (const code of sec.children) {
        const members = Object.values(m).filter(a => a.group_code === code);
        if (!members.length) continue;
        const grp = groupMeta(code);
        const amount = members.reduce((s, a) => s + signedValue(a), 0);
        rows.push({
          kind: 'group', code, label: grp ? grp.name : code, amount,
          children: members.map(a => ({ kind: 'ledger', account_id: a.id, name: a.name, amount: signedValue(a) })),
        });
      }
      return { key: sec.key, label: sec.label, rows, amount: rows.reduce((s, r) => s + r.amount, 0) };
    });
  }
  const liabilities = section(BS_TEMPLATE.liabilities);
  const assets = section(BS_TEMPLATE.assets);
  // absorb current-period profit/loss into shareholders' funds (like Tally's P&L appropriation)
  const pl = profitLoss(c, c.books_begin_from, asOn);
  if (pl.netProfit !== 0) {
    const sf = liabilities.find(s => s.key === 'shareholders_funds');
    if (sf) {
      sf.rows.push({ kind: pl.netProfit > 0 ? 'profit' : 'loss', label: pl.netProfit > 0 ? 'Add: Net Profit for the period' : 'Less: Net Loss for the period', amount: pl.netProfit, children: [] });
      sf.amount += pl.netProfit;
    }
  }
  const totals = {
    liabilities: liabilities.reduce((s, x) => s + x.amount, 0),
    assets: assets.reduce((s, x) => s + x.amount, 0),
  };
  return { as_on: asOn, liabilities, assets, totals, balanced: totals.liabilities === totals.assets };
}

export function profitLoss(c, from, to) {
  const m = netBalances(c, { from, to, includeOpening: false });
  const sections = PL_SECTIONS.map(sec => {
    const rows = Object.values(m).filter(a => {
      const meta = groupMeta(a.group_code);
      return meta && meta.pl === sec.key;
    }).map(a => ({
      account_id: a.id, name: a.name, amount: signedValue(a), type: a.type,
    })).filter(r => r.amount !== 0).sort((a, b) => a.name.localeCompare(b.name));
    return { key: sec.key, label: sec.label, rows, total: rows.reduce((s, r) => s + r.amount, 0) };
  });
  const incomeTotal = sections.filter(s => s.key.endsWith('_income')).reduce((s, x) => s + x.total, 0);
  const expenseTotal = sections.filter(s => s.key.endsWith('_expense')).reduce((s, x) => s + x.total, 0);
  return { from, to, sections, incomeTotal, expenseTotal, netProfit: incomeTotal - expenseTotal };
}

export function dayBook(c, from, to) {
  const rows = db.prepare(`
    SELECT v.id, v.class, v.voucher_no, v.date, v.number, v.narration, v.ref,
      (SELECT COALESCE(SUM(e.debit),0) FROM entries e WHERE e.voucher_id = v.id) AS debit,
      (SELECT COALESCE(SUM(e.credit),0) FROM entries e WHERE e.voucher_id = v.id) AS credit,
      (SELECT COUNT(*) FROM entries e WHERE e.voucher_id = v.id) AS lines
    FROM vouchers v WHERE v.company_id = ? AND v.active = 1 AND v.date BETWEEN ? AND ?
    ORDER BY v.date, v.id`).all(c.id, from, to);
  return {
    from, to,
    rows: rows.map(r => ({ ...r, debit: Number(r.debit), credit: Number(r.credit), lines: Number(r.lines) })),
  };
}

export function ledgerReport(c, accountId, from, to) {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ? AND company_id = ?').get(accountId, c.id);
  if (!a) throw vErr('Account not found.', 404);
  const opening = accountBalanceOf(c.id, accountId, addDaysISO(from, -1));
  const rows = db.prepare(`
    SELECT e.voucher_id, e.debit, e.credit, e.particulars, v.date, v.class, v.voucher_no, v.number
    FROM entries e JOIN vouchers v ON v.id = e.voucher_id
    WHERE e.account_id = ? AND v.active = 1 AND v.date BETWEEN ? AND ?
    ORDER BY v.date, v.id`).all(accountId, from, to).map(r => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));
  let bal = opening;
  for (const r of rows) { bal += r.debit - r.credit; r.balance = bal; }
  return { account: a, from, to, opening, closing: bal, rows };
}

export function stockReport(c, itemId, from, to) {
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND company_id = ?').get(itemId, c.id);
  if (!item) throw vErr('Item not found.', 404);
  const opening = inventoryState(itemId, addDaysISO(from, -1));
  let qty = opening.qty, value = opening.value;
  const rows = db.prepare(`
    SELECT ie.*, v.date, v.class, v.voucher_no FROM item_entries ie
    JOIN vouchers v ON v.id = ie.voucher_id
    WHERE ie.item_id = ? AND v.active = 1 AND v.date BETWEEN ? AND ?
    ORDER BY v.date, v.id, ie.line_no`).all(itemId, from, to).map(m => {
    const isIn = m.direction === 'in';
    if (isIn) { qty += m.qty; value += Number(m.amount); }
    else {
      const unit = qty > 1e-9 ? value / qty : 0;
      const outVal = Math.min(Math.abs(m.qty) * unit, value);
      qty -= Math.abs(m.qty); value -= outVal;
    }
    if (qty < 1e-9) { qty = 0; value = 0; }
    return {
      ...m, date: m.date, class: m.class, voucher_no: m.voucher_no,
      inQty: isIn ? m.qty : 0, outQty: isIn ? 0 : m.qty,
      ratePaise: Number(m.rate), amountPaise: Number(m.amount),
      balQty: roundQ(qty), balValue: Math.round(value),
      balRate: qty > 1e-9 ? Math.round(value / qty) : 0,
    };
  });
  return { item, from, to, opening, rows, closing: { qty: roundQ(qty), value: Math.round(value) } };
}

export function gstSummary(c, from, to) {
  const rows = db.prepare(`
    SELECT a.name AS ledger, a.group_code, a.id AS account_id,
      SUM(e.credit - e.debit) AS tax, SUM(e.taxable) AS taxable
    FROM entries e JOIN accounts a ON a.id = e.account_id JOIN vouchers v ON v.id = e.voucher_id
    WHERE e.company_id = ? AND v.active = 1 AND v.date BETWEEN ? AND ? AND a.kind = 'Duty'
    GROUP BY a.id ORDER BY a.name`).all(c.id, from, to);
  return { from, to, rows: rows.map(r => ({ ...r, tax: Number(r.tax), taxable: Number(r.taxable || 0) })) };
}

export function dashboard(c) {
  const asOn = todayISO();
  const fyFrom = c.financial_year_from;
  const fyEndDate = fyEnd(fyFrom);
  const monthFrom = asOn.slice(0, 7) + '-01';
  // balances
  const allBal = netBalances(c, { asOn });
  const balList = Object.values(allBal);

  const bankAccs = balList.filter(a => a.group_code === 'bank_accounts').map(a => ({
    id: a.id, name: a.name, balance: a.net,
  }));
  const bankTotal = bankAccs.reduce((s, a) => s + a.balance, 0);

  const cashAccs = balList.filter(a => a.group_code === 'cash_in_hand').map(a => ({
    id: a.id, name: a.name, balance: a.net,
  }));
  const cashTotal = cashAccs.reduce((s, a) => s + a.balance, 0);

  const debtors = balList.filter(a => a.group_code === 'sundry_debtors');
  const debtorsTotal = debtors.reduce((s, a) => s + a.net, 0);
  const debtorsList = debtors.filter(a => a.net > 100).sort((a, b) => b.net - a.net).slice(0, 10).map(a => ({ id: a.id, name: a.name, balance: a.net }));

  const creditors = balList.filter(a => a.group_code === 'sundry_creditors');
  const creditorsTotal = creditors.reduce((s, a) => s + a.net, 0); // negative = Cr
  const creditorsList = creditors.filter(a => a.net < -100).sort((a, b) => a.net - b.net).slice(0, 10).map(a => ({ id: a.id, name: a.name, balance: a.net }));

  // stock
  const items = db.prepare('SELECT * FROM items WHERE company_id = ? AND active = 1 AND is_service = 0 ORDER BY name').all(c.id);
  let stockValue = 0, stockQty = 0;
  const stockItems = [];
  for (const it of items) {
    const st = inventoryState(it.id);
    stockValue += st.value;
    stockQty += st.qty;
    stockItems.push({ id: it.id, name: it.name, unit: it.unit, qty: st.qty, value: st.value, hsn: it.hsn, gst_rate: it.gst_rate });
  }
  const lowStock = stockItems.filter(s => s.qty > 0 && s.qty < 10).slice(0, 10);
  const outOfStock = stockItems.filter(s => s.qty <= 1e-9).slice(0, 10);
  const topStockValue = [...stockItems].sort((a, b) => b.value - a.value).slice(0, 10);

  // inventory aging — oldest stock-in that still contributes to current balance
  const aging = [];
  for (const it of items.slice(0, 50)) { // limit for perf
    const st = inventoryState(it.id);
    if (st.qty <= 1e-9) continue;
    const ins = db.prepare(`
      SELECT ie.qty, ie.amount, v.date FROM item_entries ie JOIN vouchers v ON v.id = ie.voucher_id
      WHERE ie.item_id = ? AND v.active = 1 AND ie.direction = 'in' ORDER BY v.date ASC, v.id ASC
    `).all(it.id);
    const outs = db.prepare(`
      SELECT SUM(ie.qty) AS outQty FROM item_entries ie JOIN vouchers v ON v.id = ie.voucher_id
      WHERE ie.item_id = ? AND v.active = 1 AND ie.direction = 'out'
    `).get(it.id);
    const outQty = Number(outs?.outQty || 0);
    let cumIn = 0;
    let oldestDate = null;
    for (const ie of ins) {
      cumIn += ie.qty;
      if (cumIn > outQty + 1e-9 && !oldestDate) {
        oldestDate = ie.date;
        break;
      }
    }
    if (oldestDate) {
      const days = Math.floor((new Date(asOn) - new Date(oldestDate)) / (1000 * 60 * 60 * 24));
      aging.push({ id: it.id, name: it.name, qty: st.qty, value: st.value, oldestDate, daysInStock: days });
    }
  }
  aging.sort((a, b) => b.daysInStock - a.daysInStock);
  const oldStock = aging.slice(0, 10);

  // sales / purchase totals
  const salesRows = db.prepare(`
    SELECT SUM(e.credit - e.debit) AS total FROM entries e JOIN accounts a ON a.id = e.account_id JOIN vouchers v ON v.id = e.voucher_id
    WHERE e.company_id = ? AND v.active = 1 AND a.group_code IN ('sales','income_direct') AND v.date BETWEEN ? AND ?
  `).get(c.id, monthFrom, asOn);
  const salesMonth = Number(salesRows?.total || 0);

  const salesFYRows = db.prepare(`
    SELECT SUM(e.credit - e.debit) AS total FROM entries e JOIN accounts a ON a.id = e.account_id JOIN vouchers v ON v.id = e.voucher_id
    WHERE e.company_id = ? AND v.active = 1 AND a.group_code IN ('sales','income_direct') AND v.date BETWEEN ? AND ?
  `).get(c.id, fyFrom, fyEndDate);
  const salesFY = Number(salesFYRows?.total || 0);

  const purchRows = db.prepare(`
    SELECT SUM(e.debit - e.credit) AS total FROM entries e JOIN accounts a ON a.id = e.account_id JOIN vouchers v ON v.id = e.voucher_id
    WHERE e.company_id = ? AND v.active = 1 AND a.group_code IN ('purchases','expense_direct') AND v.date BETWEEN ? AND ?
  `).get(c.id, monthFrom, asOn);
  const purchMonth = Number(purchRows?.total || 0);

  const purchFYRows = db.prepare(`
    SELECT SUM(e.debit - e.credit) AS total FROM entries e JOIN accounts a ON a.id = e.account_id JOIN vouchers v ON v.id = e.voucher_id
    WHERE e.company_id = ? AND v.active = 1 AND a.group_code IN ('purchases','expense_direct') AND v.date BETWEEN ? AND ?
  `).get(c.id, fyFrom, fyEndDate);
  const purchFY = Number(purchFYRows?.total || 0);

  // cash flow: receipts vs payments
  const receiptRows = db.prepare(`
    SELECT SUM(e.debit) AS total FROM entries e JOIN vouchers v ON v.id = e.voucher_id
    WHERE e.company_id = ? AND v.active = 1 AND v.class = 'receipt' AND v.date BETWEEN ? AND ?
  `).get(c.id, monthFrom, asOn);
  const receiptsMonth = Number(receiptRows?.total || 0);

  const paymentRows = db.prepare(`
    SELECT SUM(e.credit) AS total FROM entries e JOIN vouchers v ON v.id = e.voucher_id
    WHERE e.company_id = ? AND v.active = 1 AND v.class = 'payment' AND v.date BETWEEN ? AND ?
  `).get(c.id, monthFrom, asOn);
  const paymentsMonth = Number(paymentRows?.total || 0);

  const receiptFY = db.prepare(`
    SELECT SUM(e.debit) AS total FROM entries e JOIN vouchers v ON v.id = e.voucher_id
    WHERE e.company_id = ? AND v.active = 1 AND v.class = 'receipt' AND v.date BETWEEN ? AND ?
  `).get(c.id, fyFrom, fyEndDate);
  const paymentsFY = db.prepare(`
    SELECT SUM(e.credit) AS total FROM entries e JOIN vouchers v ON v.id = e.voucher_id
    WHERE e.company_id = ? AND v.active = 1 AND v.class = 'payment' AND v.date BETWEEN ? AND ?
  `).get(c.id, fyFrom, fyEndDate);

  // profit
  const plMonth = profitLoss(c, monthFrom, asOn);
  const plFY = profitLoss(c, fyFrom, fyEndDate);

  // GST
  const gstMonth = gstSummary(c, monthFrom, asOn);
  const gstFY = gstSummary(c, fyFrom, fyEndDate);
  const gstOutputMonth = gstMonth.rows.filter(r => r.group_code === 'statutory_dues').reduce((s, r) => s + r.tax, 0);
  const gstInputMonth = gstMonth.rows.filter(r => r.group_code === 'input_tax_credit').reduce((s, r) => s + r.tax, 0);
  const gstOutputFY = gstFY.rows.filter(r => r.group_code === 'statutory_dues').reduce((s, r) => s + r.tax, 0);
  const gstInputFY = gstFY.rows.filter(r => r.group_code === 'input_tax_credit').reduce((s, r) => s + r.tax, 0);

  // recent vouchers
  const recent = db.prepare(`
    SELECT v.id, v.class, v.voucher_no, v.date, v.number, v.narration,
      (SELECT COALESCE(SUM(e.debit),0) FROM entries e WHERE e.voucher_id = v.id) AS debit,
      (SELECT COALESCE(SUM(e.credit),0) FROM entries e WHERE e.voucher_id = v.id) AS credit
    FROM vouchers v WHERE v.company_id = ? AND v.active = 1 ORDER BY v.date DESC, v.id DESC LIMIT 12
  `).all(c.id).map(r => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) }));

  // buying vs selling tracking per item (last buy date, last sell date)
  const buySell = [];
  for (const it of items.slice(0, 30)) {
    const lastBuy = db.prepare(`
      SELECT v.date, ie.qty, ie.rate FROM item_entries ie JOIN vouchers v ON v.id = ie.voucher_id
      WHERE ie.item_id = ? AND ie.direction = 'in' AND v.active = 1 ORDER BY v.date DESC LIMIT 1
    `).get(it.id);
    const lastSell = db.prepare(`
      SELECT v.date, ie.qty, ie.rate FROM item_entries ie JOIN vouchers v ON v.id = ie.voucher_id
      WHERE ie.item_id = ? AND ie.direction = 'out' AND v.active = 1 ORDER BY v.date DESC LIMIT 1
    `).get(it.id);
    if (lastBuy || lastSell) {
      buySell.push({
        id: it.id, name: it.name, unit: it.unit,
        lastBuyDate: lastBuy?.date || null, lastBuyQty: lastBuy?.qty || null, lastBuyRate: lastBuy?.rate ? Number(lastBuy.rate) : null,
        lastSellDate: lastSell?.date || null, lastSellQty: lastSell?.qty || null, lastSellRate: lastSell?.rate ? Number(lastSell.rate) : null,
      });
    }
  }
  buySell.sort((a, b) => (b.lastSellDate || '').localeCompare(a.lastSellDate || ''));

  return {
    asOn, fyFrom, fyTo: fyEndDate, monthFrom,
    bank: { total: bankTotal, accounts: bankAccs },
    cash: { total: cashTotal, accounts: cashAccs },
    receivables: { total: debtorsTotal, top: debtorsList },
    payables: { total: creditorsTotal, top: creditorsList },
    stock: { totalValue: stockValue, totalQty: stockQty, count: items.length, lowStock, outOfStock, topValue: topStockValue, aging: oldStock },
    sales: { month: salesMonth, fy: salesFY },
    purchases: { month: purchMonth, fy: purchFY },
    cashflow: {
      receiptsMonth, paymentsMonth, netMonth: receiptsMonth - paymentsMonth,
      receiptsFY: Number(receiptFY?.total || 0), paymentsFY: Number(paymentsFY?.total || 0),
      netFY: Number(receiptFY?.total || 0) - Number(paymentsFY?.total || 0),
    },
    profit: { month: plMonth.netProfit, fy: plFY.netProfit, plMonth, plFY },
    gst: {
      outputMonth: gstOutputMonth, inputMonth: gstInputMonth, netMonth: gstOutputMonth + gstInputMonth,
      outputFY: gstOutputFY, inputFY: gstInputFY, netFY: gstOutputFY + gstInputFY,
      detailsMonth: gstMonth.rows, detailsFY: gstFY.rows,
    },
    recent,
    buySell,
  };
}
