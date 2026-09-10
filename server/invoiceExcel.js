// Sales invoice Excel import — reads the user's existing Excel invoice (same visual format as PI-200-REFTECH.pdf)
// and creates a Sales voucher with stock items + GST, then printable via invprint.js.
// Supports two layouts:
//  1) Tabular: header row contains invoice_no, buyer_name, item_name, qty, rate, etc. (one row per item)
//  2) Formatted PI-200: visual invoice sheet with labels like "Invoice No.", "Buyer Bill (Bill To)", "Description of Goods", "Taxable Value", etc.
// The user's Excel file is never modified; we only read it.

let _xlsxPromise = null;
function xlsxLib() {
  if (!_xlsxPromise) {
    _xlsxPromise = (async () => {
      try {
        const m = await import('xlsx');
        return m && m.default && m.default.utils ? m.default : m;
      } catch (e) {
        _xlsxPromise = null;
        const { vErr } = await import('./engine.js');
        throw vErr('Excel package not installed — run npm install.');
      }
    })();
  }
  return _xlsxPromise;
}

import { db, tx } from './db.js';
import { validISO, todayISO } from './lib.js';
import { vErr, dateInBook, createVoucher, inventoryState } from './engine.js';

const N = (v) => (v === undefined || v === null ? '' : String(v).trim());
const NUM = (v) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[,₹\s]/g, '').replace(/[^0-9.\-]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ---- date parsing ----
function parseDateAny(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') {
    if (v > 20000 && v < 60000) {
      const d = new Date(Math.round((v - 25569) * 86400 * 1000));
      const iso = d.toISOString().slice(0, 10);
      if (validISO(iso)) return iso;
    }
    return null;
  }
  let s = String(v).trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const dd = m[1].padStart(2, '0'), mm = m[2].padStart(2, '0'), yyyy = m[3];
    const iso = `${yyyy}-${mm}-${dd}`;
    if (validISO(iso)) return iso;
  }
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const yyyy = m[1], mm = m[2].padStart(2, '0'), dd = m[3].padStart(2, '0');
    const iso = `${yyyy}-${mm}-${dd}`;
    if (validISO(iso)) return iso;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const iso = d.toISOString().slice(0, 10);
    if (validISO(iso)) return iso;
  }
  return null;
}

function extractGSTIN(text) {
  const s = String(text || '');
  const m = s.match(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]/i);
  if (m) return m[0].toUpperCase();
  const m2 = s.match(/GST[IN-]*\s*[-:]*\s*([0-9A-Z]{15})/i);
  if (m2) return m2[1].toUpperCase();
  const m3 = s.match(/GST-\s*([0-9A-Z]{15})/i);
  if (m3) return m3[1].toUpperCase();
  return '';
}

// ---- 2D array helpers ----
function findLabel(aoa, needle) {
  const n = needle.toLowerCase();
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] || [];
    for (let c = 0; c < row.length; c++) {
      const v = N(row[c]).toLowerCase();
      if (v && v.includes(n)) return { r, c, v: N(row[c]) };
    }
  }
  return null;
}
function cellAt(aoa, r, c) {
  if (r < 0 || r >= aoa.length) return '';
  const row = aoa[r] || [];
  if (c < 0 || c >= row.length) return '';
  return N(row[c]);
}
function nearbyValue(aoa, r, c) {
  const candidates = [
    [r, c + 1], [r, c + 2], [r + 1, c], [r + 1, c + 1], [r + 1, c - 1], [r + 2, c], [r, c + 3],
  ];
  for (const [rr, cc] of candidates) {
    const v = cellAt(aoa, rr, cc);
    if (v && !v.toLowerCase().includes('invoice no') && !v.toLowerCase().includes('dated') && v.length > 0) return v;
  }
  return '';
}
function normalizeKey(k) {
  return N(k).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function parseTabular(aoa, rowsObj) {
  if (!rowsObj.length) return null;
  const firstKeys = Object.keys(rowsObj[0]).map(normalizeKey);
  const hasTabular = firstKeys.some(k => ['invoice_no','buyer_name','item_name','qty','quantity','rate','item'].includes(k));
  if (!hasTabular) return null;

  const normRows = rowsObj.map(o => {
    const m = {};
    for (const [k, v] of Object.entries(o)) m[normalizeKey(k)] = v;
    return m;
  });

  const invoices = new Map();
  for (const r of normRows) {
    const invNo = N(r.invoice_no || r.invoice_number || r.number || 'INV').trim() || 'INV';
    if (!invoices.has(invNo)) invoices.set(invNo, []);
    invoices.get(invNo).push(r);
  }
  const firstInvNo = [...invoices.keys()][0];
  const grouped = invoices.get(firstInvNo);
  const first = grouped[0];
  const date = parseDateAny(first.date || first.dated || first.invoice_date) || todayISO();
  const buyer = {
    name: N(first.buyer_name || first.party_name || first.customer_name || first.buyer || ''),
    address: N(first.buyer_address || first.address || first.party_address || ''),
    gstin: N(first.buyer_gstin || first.gstin || first.gst || '').toUpperCase() || extractGSTIN(first.buyer_address || ''),
  };
  const ship = {
    name: N(first.ship_name || first.consignee_name || buyer.name),
    address: N(first.ship_address || first.consignee_address || buyer.address),
    gstin: N(first.ship_gstin || first.consignee_gstin || buyer.gstin).toUpperCase(),
  };

  const items = [];
  for (const r of grouped) {
    const name = N(r.item_name || r.description || r.description_of_goods || r.item || '');
    if (!name) continue;
    const qty = NUM(r.qty ?? r.quantity) || 0;
    const rate = NUM(r.rate) || 0;
    const hsn = N(r.hsn || r.hsn_sac || '');
    const unit = N(r.unit || r.per || r.uom || 'KGS').toUpperCase() || 'KGS';
    const gst_rate = NUM(r.gst_rate ?? r.gst ?? r.tax_rate) ?? null;
    const amount = NUM(r.amount) ?? (qty * rate);
    if (qty <= 0 || rate <= 0) continue;
    items.push({ name, hsn, qty, unit, rate, gst_rate, amount });
  }
  if (!items.length) return null;

  let regime = 'intra';
  let igstRate = null;
  for (const r of grouped) {
    if (r.igst_rate) { regime = 'inter'; igstRate = NUM(r.igst_rate); }
  }

  return {
    invoice_no: N(firstInvNo),
    date,
    ref: N(first.ref || first.reference_by || first.reference || ''),
    buyer,
    consignee: ship,
    items,
    regime,
    _source: 'tabular',
  };
}

function parseFormatted(aoa) {
  const invLabel = findLabel(aoa, 'invoice no');
  let invoice_no = '';
  let invoice_date = '';
  if (invLabel) {
    invoice_no = nearbyValue(aoa, invLabel.r, invLabel.c);
    const row = aoa[invLabel.r] || [];
    let datedCol = -1;
    for (let c = invLabel.c + 1; c < row.length; c++) {
      if (N(row[c]).toLowerCase().includes('dated')) { datedCol = c; break; }
    }
    if (datedCol >= 0) {
      invoice_date = nearbyValue(aoa, invLabel.r, datedCol);
      if (!invoice_date) invoice_date = cellAt(aoa, invLabel.r + 1, datedCol);
    }
  }
  if (!invoice_date) {
    const dLabel = findLabel(aoa, 'dated');
    if (dLabel) invoice_date = nearbyValue(aoa, dLabel.r, dLabel.c) || cellAt(aoa, dLabel.r + 1, dLabel.c);
  }
  const date = parseDateAny(invoice_date) || todayISO();

  const refLabel = findLabel(aoa, 'reference by');
  let ref = '';
  if (refLabel) ref = nearbyValue(aoa, refLabel.r, refLabel.c) || cellAt(aoa, refLabel.r + 1, refLabel.c);

  const buyerLabel = findLabel(aoa, 'buyer bill') || findLabel(aoa, 'bill to') || findLabel(aoa, 'buyer');
  let buyerName = '', buyerAddrLines = [], buyerGstin = '';
  if (buyerLabel) {
    let r = buyerLabel.r + 1;
    while (r < aoa.length && !cellAt(aoa, r, buyerLabel.c)) r++;
    buyerName = cellAt(aoa, r, buyerLabel.c);
    r++;
    for (let i = 0; i < 6 && r + i < aoa.length; i++) {
      const v = cellAt(aoa, r + i, buyerLabel.c);
      if (!v) continue;
      const low = v.toLowerCase();
      if (low.includes('dispatch') || low.includes('consignee') || low.includes('gst-') || low.includes('gstin') || low.includes('state:-') || extractGSTIN(v)) {
        if (low.includes('gst') || extractGSTIN(v)) {
          buyerGstin = extractGSTIN(v) || buyerGstin;
          break;
        }
        if (low.includes('dispatch') || low.includes('consignee')) break;
      }
      buyerAddrLines.push(v);
      const next = cellAt(aoa, r + i + 1, buyerLabel.c);
      if (next.toLowerCase().includes('gst') || extractGSTIN(next)) {
        buyerGstin = extractGSTIN(next) || buyerGstin;
        break;
      }
    }
    if (!buyerGstin) {
      for (let rr = buyerLabel.r + 1; rr < buyerLabel.r + 8 && rr < aoa.length; rr++) {
        for (let cc = 0; cc < (aoa[rr] || []).length; cc++) {
          const v = cellAt(aoa, rr, cc);
          if (extractGSTIN(v)) { buyerGstin = extractGSTIN(v); break; }
        }
        if (buyerGstin) break;
      }
    }
  }

  const shipLabel = findLabel(aoa, 'consignee') || findLabel(aoa, 'ship to');
  let shipName = '', shipAddrLines = [], shipGstin = '';
  if (shipLabel) {
    let r = shipLabel.r + 1;
    while (r < aoa.length && !cellAt(aoa, r, shipLabel.c)) r++;
    shipName = cellAt(aoa, r, shipLabel.c);
    r++;
    for (let i = 0; i < 6 && r + i < aoa.length; i++) {
      const v = cellAt(aoa, r + i, shipLabel.c);
      if (!v) continue;
      const low = v.toLowerCase();
      if (low.includes('buyer') || low.includes('dispatch') || low.includes('gst-') || low.includes('gstin') || extractGSTIN(v)) {
        if (low.includes('gst') || extractGSTIN(v)) {
          shipGstin = extractGSTIN(v) || shipGstin;
          break;
        }
        if (low.includes('buyer')) break;
      }
      shipAddrLines.push(v);
      const next = cellAt(aoa, r + i + 1, shipLabel.c);
      if (next.toLowerCase().includes('gst') || extractGSTIN(next)) {
        shipGstin = extractGSTIN(next) || shipGstin;
        break;
      }
    }
  }

  let headerRow = -1;
  let colMap = {};
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const low = row.map(v => N(v).toLowerCase()).join('|');
    if ((low.includes('description') && (low.includes('quantity') || low.includes('qty'))) || low.includes('description of goods')) {
      headerRow = r;
      for (let c = 0; c < row.length; c++) {
        const h = N(row[c]).toLowerCase();
        if (h.includes('no') && (h === 'no.' || h.includes('s.no') || h === 'no' || h.includes('sr'))) colMap.no = c;
        if (h.includes('description')) colMap.desc = c;
        if (h.includes('hsn') || h.includes('sac')) colMap.hsn = c;
        if (h.includes('quantity') || h === 'qty' || h.includes('qty')) colMap.qty = c;
        if (h.includes('rate') && !h.includes('tax')) colMap.rate = c;
        if (h === 'per' || h.includes('per') || h.includes('unit') || h.includes('uom')) colMap.per = c;
        if (h.includes('amount')) colMap.amt = c;
      }
      break;
    }
  }
  if (headerRow < 0) {
    for (let r = 0; r < aoa.length; r++) {
      const row = aoa[r] || [];
      let hits = 0;
      for (const cell of row) {
        const h = N(cell).toLowerCase();
        if (h.includes('description') || h.includes('hsn') || h.includes('quantity') || h.includes('rate') || h.includes('amount')) hits++;
      }
      if (hits >= 3) { headerRow = r; break; }
    }
  }

  const items = [];
  if (headerRow >= 0) {
    if (colMap.desc === undefined) colMap.desc = 1;
    if (colMap.qty === undefined) colMap.qty = 3;
    if (colMap.rate === undefined) colMap.rate = 4;
    if (colMap.amt === undefined) colMap.amt = 6;
    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const firstCell = N(row[colMap.desc] || '').trim();
      const qtyCell = N(row[colMap.qty] || '');
      const rateCell = N(row[colMap.rate] || '');
      const amtCell = N(row[colMap.amt] || '');
      const joined = row.map(N).join(' ').toLowerCase();
      if (joined.includes('taxable value') || joined.includes('output sgst') || joined.includes('output cgst') || joined.includes('output igst') || joined.includes('round off') || joined.includes('total')) break;
      if (!firstCell && !qtyCell && !rateCell) {
        const nextRow = aoa[r + 1] || [];
        const nextJoined = nextRow.map(N).join(' ').toLowerCase();
        if (nextJoined.includes('taxable value') || !nextRow.some(v => N(v))) {
          const next2 = aoa[r + 2] || [];
          if (!nextRow.some(v => N(v)) && !next2.some(v => N(v))) break;
        }
        if (!firstCell) continue;
      }
      if (firstCell.toLowerCase().includes('taxable value')) break;
      let qty = NUM(qtyCell);
      let unit = '';
      if (qty === null) {
        const m = qtyCell.match(/([\d,.]+)\s*([A-Za-z]+)?/);
        if (m) {
          qty = NUM(m[1]);
          unit = (m[2] || '').toUpperCase();
        }
      }
      if (qty === null || qty <= 0) continue;
      let rate = NUM(rateCell);
      let amount = NUM(amtCell);
      let hsn = colMap.hsn !== undefined ? N(row[colMap.hsn]) : '';
      let per = colMap.per !== undefined ? N(row[colMap.per]) : '';
      if (per) unit = per.toUpperCase() || unit;
      if (!unit) unit = 'KGS';
      if (rate === null) {
        if (amount !== null && qty) rate = amount / qty;
        else rate = 0;
      }
      if (amount === null) amount = qty * rate;
      if (hsn) hsn = hsn.replace(/[^0-9]/g, '').slice(0, 10);
      items.push({ name: firstCell, hsn, qty, unit, rate, amount, gst_rate: null });
    }
  }

  let taxable = null, roundOff = null, total = null;
  const taxRows = [];
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const low = row.map(v => N(v).toLowerCase()).join(' | ');
    if (low.includes('taxable value')) {
      let amt = null;
      if (colMap.amt !== undefined) amt = NUM(row[colMap.amt]);
      if (amt === null) {
        for (let c = row.length - 1; c >= 0; c--) {
          const n = NUM(row[c]);
          if (n !== null) { amt = n; break; }
        }
      }
      if (amt !== null) taxable = amt;
    }
    if (low.includes('output sgst') || low.includes('output cgst') || low.includes('output igst')) {
      const m = low.match(/output\s+(sgst|cgst|igst)\s*([\d.]+)?\s*%/);
      let leg = '', rate = null;
      if (m) {
        leg = m[1].toUpperCase();
        rate = m[2] ? Number(m[2]) : null;
      } else {
        if (low.includes('sgst')) leg = 'SGST';
        if (low.includes('cgst')) leg = 'CGST';
        if (low.includes('igst')) leg = 'IGST';
        const rm = low.match(/([\d.]+)\s*%/);
        if (rm) rate = Number(rm[1]);
      }
      let amt = null;
      if (colMap.amt !== undefined) amt = NUM(row[colMap.amt]);
      if (amt === null) {
        for (let c = row.length - 1; c >= 0; c--) {
          const n = NUM(row[c]);
          if (n !== null) { amt = n; break; }
        }
      }
      if (leg && amt !== null) taxRows.push({ leg, rate, tax: Math.round(amt * 100), taxable: taxable !== null ? Math.round(taxable * 100) : null });
    }
    if (low.includes('round off')) {
      let amt = null;
      if (colMap.amt !== undefined) amt = NUM(row[colMap.amt]);
      if (amt === null) {
        for (let c = row.length - 1; c >= 0; c--) {
          const n = NUM(row[c]);
          if (n !== null) { amt = n; break; }
        }
      }
      if (amt !== null) roundOff = amt;
      else roundOff = 0;
    }
    if ((low === 'total' || low.includes(' total') || (low.startsWith('total') && !low.includes('taxable'))) && !low.includes('taxable') && !low.includes('total tax')) {
      let amt = null;
      if (colMap.amt !== undefined) amt = NUM(row[colMap.amt]);
      if (amt === null) {
        for (let c = row.length - 1; c >= 0; c--) {
          const n = NUM(row[c]);
          if (n !== null) { amt = n; break; }
        }
      }
      if (amt !== null) total = amt;
    }
  }

  let regime = 'intra';
  if (taxRows.some(t => t.leg === 'IGST')) regime = 'inter';

  if (items.length) {
    let totalGstRate = null;
    if (regime === 'inter') {
      const igst = taxRows.find(t => t.leg === 'IGST');
      if (igst && igst.rate) totalGstRate = igst.rate;
    } else {
      const sgst = taxRows.find(t => t.leg === 'SGST');
      const cgst = taxRows.find(t => t.leg === 'CGST');
      if (sgst && cgst && sgst.rate && cgst.rate) totalGstRate = sgst.rate + cgst.rate;
      else if (sgst && sgst.rate) totalGstRate = sgst.rate * 2;
      else if (cgst && cgst.rate) totalGstRate = cgst.rate * 2;
    }
    if (totalGstRate === null && taxable && total) {
      const taxTotal = total - taxable - (roundOff || 0);
      if (taxable > 0) totalGstRate = Math.round((taxTotal / taxable) * 100 * 100) / 100;
    }
    if (totalGstRate === null) totalGstRate = 18;
    for (const it of items) it.gst_rate = totalGstRate;
  }

  if (!invoice_no) invoice_no = `PI-${Date.now().toString().slice(-6)}`;
  if (!buyerName) buyerName = 'Customer';

  return {
    invoice_no: N(invoice_no) || `PI-${Date.now().toString().slice(-6)}`,
    date,
    ref,
    buyer: { name: buyerName, address: buyerAddrLines.join('\n'), gstin: buyerGstin },
    consignee: { name: shipName || buyerName, address: shipAddrLines.join('\n') || buyerAddrLines.join('\n'), gstin: shipGstin || buyerGstin },
    items,
    taxable,
    taxRows,
    roundOff,
    total,
    regime,
    _source: 'formatted',
  };
}

export async function parseInvoiceWorkbook(buf, filename = '') {
  const X = await xlsxLib();
  const wb = X.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames.find(s => /invoice|pi|sales/i.test(s)) || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const aoa = X.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
  const rowsObj = X.utils.sheet_to_json(ws, { defval: '' });

  let parsed = null;
  try {
    parsed = parseTabular(aoa, rowsObj);
  } catch (_) {}
  if (parsed && parsed.items && parsed.items.length) return parsed;

  parsed = parseFormatted(aoa);
  return parsed;
}

function ensureAccount(c, name, address, gstin) {
  if (!name) throw vErr('Buyer name is required in Excel.');
  let acc = db.prepare('SELECT * FROM accounts WHERE company_id = ? AND lower(name) = lower(?) AND active = 1').get(c.id, name);
  if (acc) {
    if ((address && !acc.address) || (gstin && !acc.gstin)) {
      db.prepare('UPDATE accounts SET address = COALESCE(NULLIF(?, \'\'), address), gstin = COALESCE(NULLIF(?, \'\'), gstin) WHERE id = ?')
        .run(address || '', gstin || '', acc.id);
      acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(acc.id);
    }
    return acc;
  }
  const r = db.prepare(`INSERT INTO accounts(company_id,name,group_code,type,kind,address,gstin,active,created_at,opening_balance,opening_balance_date)
    VALUES(?,?,?,?,?,?,?,?,?,0,?)`).run(c.id, name, 'sundry_debtors', 'Asset', 'SundryDebtor', address || '', gstin || '', 1, todayISO(), c.books_begin_from);
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(r.lastInsertRowid);
}

function ensureItem(c, it) {
  let item = db.prepare('SELECT * FROM items WHERE company_id = ? AND lower(name) = lower(?) AND active = 1').get(c.id, it.name);
  if (item) {
    if ((it.hsn && !item.hsn) || (it.gst_rate && item.gst_rate == null)) {
      db.prepare('UPDATE items SET hsn = COALESCE(NULLIF(?, \'\'), hsn), gst_rate = COALESCE(?, gst_rate), unit = COALESCE(NULLIF(?, \'\'), unit) WHERE id = ?')
        .run(it.hsn || '', it.gst_rate ?? null, it.unit || '', item.id);
      item = db.prepare('SELECT * FROM items WHERE id = ?').get(item.id);
    }
    return item;
  }
  const r = db.prepare(`INSERT INTO items(company_id,name,unit,hsn,gst_rate,is_service,active,created_at)
    VALUES(?,?,?,?,?,0,1,?)`).run(c.id, it.name, it.unit || 'KGS', it.hsn || '', it.gst_rate ?? 18, todayISO());
  return db.prepare('SELECT * FROM items WHERE id = ?').get(r.lastInsertRowid);
}

function findStockCounterpart(c) {
  const candidates = ['Opening Stock','Stock Opening','Reserves & Surplus','Reserves and Surplus','Capital','Capital Account','Opening Balance','Opening Stock Adjustment'];
  for (const nm of candidates) {
    const acc = db.prepare('SELECT * FROM accounts WHERE company_id = ? AND lower(name) = lower(?) AND active = 1').get(c.id, nm);
    if (acc) return acc;
  }
  const acc = db.prepare(`SELECT * FROM accounts WHERE company_id = ? AND active = 1 AND group_code IN ('reserves_surplus','capital','other_current_liab','current_liab') ORDER BY id LIMIT 1`).get(c.id);
  if (acc) return acc;
  const any = db.prepare(`SELECT * FROM accounts WHERE company_id = ? AND active = 1 AND type = 'Liability' ORDER BY id LIMIT 1`).get(c.id);
  if (any) return any;
  // auto-create Opening Stock Adjustment under reserves_surplus
  const r = db.prepare(`INSERT INTO accounts(company_id,name,group_code,type,kind,active,created_at,opening_balance,opening_balance_date)
    VALUES(?,?,?,?,?,?,?,0,?)`).run(c.id, 'Opening Stock Adjustment', 'reserves_surplus', 'Liability', 'General', 1, todayISO(), c.books_begin_from);
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(r.lastInsertRowid);
}

export async function exportInvoiceTemplate(c) {
  const X = await xlsxLib();
  const rows = [
    {
      invoice_no: 'ONS/PI-200',
      date: todayISO(),
      ref: 'Virag Vohra',
      buyer_name: 'REFTECH IMPEX',
      buyer_address: 'F/620, Sundaram II SV Road Ram Baug Lane\nBehind Vijay Sales Sai Baba Nagar\nBorivali West Mumbai- 400092',
      buyer_gstin: '27AKOPD7221N1ZT',
      ship_name: 'REFTECH IMPEX',
      ship_address: 'F/620, Sundaram II SV Road Ram Baug Lane\nBorivali West Mumbai- 400092',
      ship_gstin: '27AKOPD7221N1ZT',
      item_name: 'CHEMIEBOR - 36 (GRANULAR)',
      hsn: '28401900',
      qty: 2000,
      unit: 'KGS',
      rate: 80.5,
      gst_rate: 18,
      amount: 161000,
    },
  ];
  const wb = X.utils.book_new();
  const ws = X.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 22 }, { wch: 40 }, { wch: 18 }, { wch: 22 }, { wch: 40 }, { wch: 18 }, { wch: 32 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
  X.utils.book_append_sheet(wb, ws, 'Invoices');
  const info = [
    'SALES INVOICE IMPORT — keeps your Excel format, books + prints as PI-200-REFTECH.pdf',
    'One row = one item. If an invoice has 2 items, use 2 rows with same invoice_no.',
    'Required: invoice_no, date (YYYY-MM-DD or DD-MM-YYYY), buyer_name, item_name, qty, rate',
    'Optional: buyer_address, buyer_gstin, ship_*, hsn, unit (KGS/NOS), gst_rate (e.g. 18)',
    'If buyer_name does not exist, it will be created as Sundry Debtor. If item_name does not exist, it will be created.',
    'GST: if gst_rate is 18, system posts SGST 9% + CGST 9% for intra-state, or IGST 18% for inter-state.',
    'You can also upload your existing formatted invoice sheet (with Invoice No., Buyer Bill To, Description of Goods, etc.) — the parser will read it.',
    'After import, open Day Book → click the voucher → Invoice print for exact PI-200 layout.',
  ];
  const is = X.utils.aoa_to_sheet(info.map(t => [t]));
  is['!cols'] = [{ wch: 120 }];
  X.utils.book_append_sheet(wb, is, 'Info');
  const buf = X.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buf, file: `sales-invoice-template-${todayISO()}.xlsx` };
}

export async function importInvoiceExcel(c, buf, filename = '') {
  const parsed = await parseInvoiceWorkbook(buf, filename);
  if (!parsed.items || !parsed.items.length) throw vErr('No items found in Excel — check that the sheet has Description, Quantity, Rate, Amount columns and at least one item row.');
  if (!parsed.date) parsed.date = todayISO();
  const de = dateInBook(c, parsed.date);
  if (de) throw vErr(de);

  // ensure buyer and items exist (outside any voucher tx)
  const buyerAcc = ensureAccount(c, parsed.buyer.name, parsed.buyer.address, parsed.buyer.gstin);
  const itemRows = [];
  for (const it of parsed.items) {
    const dbItem = ensureItem(c, it);
    itemRows.push({ item_id: dbItem.id, qty: it.qty, rate: it.rate, dbItem });
  }
  // ensure stock exists for each item, auto-create opening stock if needed
  for (const ir of itemRows) {
    const st = inventoryState(ir.item_id);
    if (st.qty + 1e-9 < ir.qty) {
      const need = ir.qty - st.qty;
      const ctr = findStockCounterpart(c);
      if (!ctr) throw vErr('No balancing account for opening stock — create a Reserves & Surplus / Capital ledger first (Masters → Ledgers).');
      const payload = {
        class: 'stock_journal',
        date: c.books_begin_from || parsed.date,
        number: '',
        narration: `Auto stock-in for invoice import ${parsed.invoice_no} — ${ir.dbItem.name} +${need} ${ir.dbItem.unit}`,
        counterpart_id: ctr.id,
        items: [{ item_id: ir.item_id, qty: need, rate: ir.rate, direction: 'in' }],
      };
      createVoucher(c, payload);
    }
  }
  const payload = {
    class: 'sales',
    date: parsed.date,
    number: parsed.invoice_no,
    ref: parsed.ref || '',
    narration: `Imported from Excel ${filename || ''} — ${parsed.buyer.name}`.trim(),
    party_id: buyerAcc.id,
    regime: parsed.regime || 'intra',
    items: itemRows.map(r => ({ item_id: r.item_id, qty: r.qty, rate: r.rate })),
    auto_tax: true,
  };
  const v = createVoucher(c, payload);

  return { parsed, voucher: v };
}
