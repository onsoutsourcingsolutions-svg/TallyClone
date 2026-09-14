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
  // v1.11.30: Much more tolerant tabular detection
  const allowed = ['invoice_no','invoice_number','number','inv_no','buyer_name','party_name','customer_name','buyer','customer','item_name','description','description_of_goods','item','product','particulars','qty','quantity','qnty','rate','price','unit_price','amount','amt','value','hsn','unit','gst','gst_rate','tax_rate'];
  const hasTabular = firstKeys.some(k => allowed.includes(k) || allowed.some(a=>k.includes(a)||a.includes(k)));
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

function parseTabularBulk(aoa, rowsObj) {
  if (!rowsObj.length) return null;
  const firstKeys = Object.keys(rowsObj[0]).map(normalizeKey);
  const allowed = ['invoice_no','invoice_number','number','inv_no','buyer_name','party_name','customer_name','buyer','customer','item_name','description','description_of_goods','item','product','particulars','qty','quantity','qnty','rate','price','unit_price','amount','amt','value','hsn','unit','gst','gst_rate','tax_rate'];
  const hasTabular = firstKeys.some(k => allowed.includes(k) || allowed.some(a=>k.includes(a)||a.includes(k)));
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
  const results = [];
  for (const [invNo, grouped] of invoices.entries()) {
    if (!grouped.length) continue;
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
    if (!items.length) continue;
    let regime = 'intra';
    for (const r of grouped) {
      if (r.igst_rate || (String(r.regime||'').toLowerCase().includes('inter'))) { regime = 'inter'; break; }
    }
    results.push({
      invoice_no: N(invNo),
      date,
      ref: N(first.ref || first.reference_by || first.reference || ''),
      buyer,
      consignee: ship,
      items,
      regime,
      _source: 'tabular',
    });
  }
  return results.length ? results : null;
}

function parseFormatted(aoa) {
  // v1.11.30: MUCH MORE TOLERANT — accepts many column name variations and header positions
  const invLabel = findLabel(aoa, 'invoice no') || findLabel(aoa, 'invoice number') || findLabel(aoa, 'inv no') || findLabel(aoa, 'bill no');
  let invoice_no = '';
  let invoice_date = '';
  if (invLabel) {
    invoice_no = nearbyValue(aoa, invLabel.r, invLabel.c);
    const row = aoa[invLabel.r] || [];
    let datedCol = -1;
    for (let c = invLabel.c + 1; c < row.length; c++) {
      if (N(row[c]).toLowerCase().includes('dated') || N(row[c]).toLowerCase().includes('date')) { datedCol = c; break; }
    }
    if (datedCol >= 0) {
      invoice_date = nearbyValue(aoa, invLabel.r, datedCol);
      if (!invoice_date) invoice_date = cellAt(aoa, invLabel.r + 1, datedCol);
    }
  }
  if (!invoice_date) {
    const dLabel = findLabel(aoa, 'dated') || findLabel(aoa, 'invoice date') || findLabel(aoa, 'date');
    if (dLabel) invoice_date = nearbyValue(aoa, dLabel.r, dLabel.c) || cellAt(aoa, dLabel.r + 1, dLabel.c);
  }
  const date = parseDateAny(invoice_date) || todayISO();

  const refLabel = findLabel(aoa, 'reference by') || findLabel(aoa, 'reference') || findLabel(aoa, 'ref');
  let ref = '';
  if (refLabel) ref = nearbyValue(aoa, refLabel.r, refLabel.c) || cellAt(aoa, refLabel.r + 1, refLabel.c);

  const buyerLabel = findLabel(aoa, 'buyer bill') || findLabel(aoa, 'bill to') || findLabel(aoa, 'buyer') || findLabel(aoa, 'customer') || findLabel(aoa, 'party');
  let buyerName = '', buyerAddrLines = [], buyerGstin = '';
  if (buyerLabel) {
    let r = buyerLabel.r + 1;
    while (r < aoa.length && !cellAt(aoa, r, buyerLabel.c)) r++;
    buyerName = cellAt(aoa, r, buyerLabel.c);
    r++;
    for (let i = 0; i < 8 && r + i < aoa.length; i++) {
      const v = cellAt(aoa, r + i, buyerLabel.c);
      if (!v) continue;
      const low = v.toLowerCase();
      if (low.includes('dispatch') || low.includes('consignee') || low.includes('ship to') || low.includes('gst-') || low.includes('gstin') || low.includes('state:-') || extractGSTIN(v)) {
        if (low.includes('gst') || extractGSTIN(v)) {
          buyerGstin = extractGSTIN(v) || buyerGstin;
          break;
        }
        if (low.includes('dispatch') || low.includes('consignee') || low.includes('ship')) break;
      }
      buyerAddrLines.push(v);
      const next = cellAt(aoa, r + i + 1, buyerLabel.c);
      if (next.toLowerCase().includes('gst') || extractGSTIN(next)) {
        buyerGstin = extractGSTIN(next) || buyerGstin;
        break;
      }
    }
    if (!buyerGstin) {
      for (let rr = buyerLabel.r + 1; rr < buyerLabel.r + 10 && rr < aoa.length; rr++) {
        for (let cc = 0; cc < (aoa[rr] || []).length; cc++) {
          const v = cellAt(aoa, rr, cc);
          if (extractGSTIN(v)) { buyerGstin = extractGSTIN(v); break; }
        }
        if (buyerGstin) break;
      }
    }
  }

  const shipLabel = findLabel(aoa, 'consignee') || findLabel(aoa, 'ship to') || findLabel(aoa, 'delivery');
  let shipName = '', shipAddrLines = [], shipGstin = '';
  if (shipLabel) {
    let r = shipLabel.r + 1;
    while (r < aoa.length && !cellAt(aoa, r, shipLabel.c)) r++;
    shipName = cellAt(aoa, r, shipLabel.c);
    r++;
    for (let i = 0; i < 8 && r + i < aoa.length; i++) {
      const v = cellAt(aoa, r + i, shipLabel.c);
      if (!v) continue;
      const low = v.toLowerCase();
      if (low.includes('buyer') || low.includes('bill to') || low.includes('dispatch') || low.includes('gst-') || low.includes('gstin') || extractGSTIN(v)) {
        if (low.includes('gst') || extractGSTIN(v)) {
          shipGstin = extractGSTIN(v) || shipGstin;
          break;
        }
        if (low.includes('buyer') || low.includes('bill')) break;
      }
      shipAddrLines.push(v);
      const next = cellAt(aoa, r + i + 1, shipLabel.c);
      if (next.toLowerCase().includes('gst') || extractGSTIN(next)) {
        shipGstin = extractGSTIN(next) || shipGstin;
        break;
      }
    }
  }

  // ---- v1.11.30: Flexible header detection — accepts Description, Item, Product, Particulars, Goods, etc ----
  const DESC_KEYS = ['description', 'description of goods', 'particulars', 'item', 'item name', 'product', 'goods', 'desc', 'name', 'product name', 'material'];
  const QTY_KEYS = ['quantity', 'qty', 'qnty', 'qty.', 'quantity (kgs)', 'quantity kgs', 'kgs', 'nos', 'qty nos', 'quantity nos', 'qty kgs', 'units', 'unit qty'];
  const RATE_KEYS = ['rate', 'unit rate', 'price', 'unit price', 'rate per', 'price per', 'unit rate', 'per unit', 'mrp'];
  const AMT_KEYS = ['amount', 'amt', 'value', 'total amount', 'total', 'taxable value', 'taxable amount', 'line total', 'net amount'];
  const HSN_KEYS = ['hsn', 'sac', 'hsn/sac', 'hsn code'];
  const UNIT_KEYS = ['per', 'unit', 'uom', 'uqc'];

  function isHeaderMatch(cell, keys) {
    const h = N(cell).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!h) return false;
    for (const k of keys) {
      if (h === k || h.includes(k) || k.includes(h)) return true;
    }
    return false;
  }

  let headerRow = -1;
  let colMap = {};
  // Scan all rows for header with at least 2 matches (desc+qty or desc+rate or qty+rate)
  for (let r = 0; r < Math.min(aoa.length, 50); r++) {
    const row = aoa[r] || [];
    if (!row.length) continue;
    let d=0,q=0,ra=0,a=0,hs=0;
    const tmpMap = {};
    for (let c = 0; c < row.length; c++) {
      const cell = N(row[c]);
      if (!cell) continue;
      if (isHeaderMatch(cell, DESC_KEYS)) { d++; if (tmpMap.desc===undefined) tmpMap.desc=c; }
      if (isHeaderMatch(cell, QTY_KEYS)) { q++; if (tmpMap.qty===undefined) tmpMap.qty=c; }
      if (isHeaderMatch(cell, RATE_KEYS)) { ra++; if (tmpMap.rate===undefined) tmpMap.rate=c; }
      if (isHeaderMatch(cell, AMT_KEYS)) { a++; if (tmpMap.amt===undefined) tmpMap.amt=c; }
      if (isHeaderMatch(cell, HSN_KEYS)) { hs++; if (tmpMap.hsn===undefined) tmpMap.hsn=c; }
      if (isHeaderMatch(cell, UNIT_KEYS)) { if (tmpMap.per===undefined) tmpMap.per=c; }
      const low = cell.toLowerCase();
      if (low.includes('no') && (low==='no.'||low.includes('s.no')||low==='no'||low.includes('sr')||low==='s no')) tmpMap.no=c;
    }
    const score = d+q+ra+a;
    if (score >= 2 || (d>=1 && (q>=1||ra>=1||a>=1)) || (q>=1 && ra>=1)) {
      headerRow = r;
      colMap = tmpMap;
      break;
    }
  }
  // Fallback: if still not found, look for row with 3+ hits of any invoice keywords
  if (headerRow < 0) {
    for (let r = 0; r < Math.min(aoa.length, 80); r++) {
      const row = aoa[r] || [];
      let hits = 0;
      for (const cell of row) {
        const h = N(cell).toLowerCase();
        if (h.includes('description') || h.includes('item') || h.includes('particular') || h.includes('hsn') || h.includes('quantity') || h.includes('qty') || h.includes('rate') || h.includes('price') || h.includes('amount') || h.includes('value')) hits++;
      }
      if (hits >= 3) { headerRow = r; 
        // build map from this row
        for (let c=0;c<row.length;c++) {
          const h = N(row[c]).toLowerCase();
          if (h.includes('description')||h.includes('particular')||h.includes('item')||h.includes('product')||h.includes('goods')) { if (colMap.desc===undefined) colMap.desc=c; }
          if (h.includes('hsn')||h.includes('sac')) { if (colMap.hsn===undefined) colMap.hsn=c; }
          if (h.includes('quantity')||h==='qty'||h.includes('qty')) { if (colMap.qty===undefined) colMap.qty=c; }
          if (h.includes('rate')||h.includes('price')) { if (colMap.rate===undefined) colMap.rate=c; }
          if (h.includes('amount')||h.includes('value')||h.includes('total')) { if (colMap.amt===undefined) colMap.amt=c; }
          if (h==='per'||h.includes('per')||h.includes('unit')||h.includes('uom')) { if (colMap.per===undefined) colMap.per=c; }
        }
        break; 
      }
    }
  }

  const items = [];
  if (headerRow >= 0) {
    // Guess missing columns: if only desc found, try next columns for qty/rate/amt
    if (colMap.desc !== undefined) {
      if (colMap.qty === undefined) {
        // look 1-3 cols right of desc for qty-like numeric
        for (let c = colMap.desc+1; c <= colMap.desc+3 && c < 20; c++) {
          if (colMap.qty===undefined) colMap.qty=c;
        }
      }
      if (colMap.rate === undefined) {
        for (let c = (colMap.qty||colMap.desc)+1; c <= (colMap.qty||colMap.desc)+3 && c < 20; c++) {
          if (c!==colMap.qty && colMap.rate===undefined) colMap.rate=c;
        }
      }
      if (colMap.amt === undefined) {
        for (let c = (colMap.rate||colMap.qty||colMap.desc)+1; c < 20; c++) {
          if (c!==colMap.qty && c!==colMap.rate && colMap.amt===undefined) colMap.amt=c;
        }
      }
    } else {
      // No desc col found but header row exists — assume col 1 = desc, 3=qty, 4=rate, 6=amt as before
      if (colMap.desc === undefined) colMap.desc = 1;
      if (colMap.qty === undefined) colMap.qty = 3;
      if (colMap.rate === undefined) colMap.rate = 4;
      if (colMap.amt === undefined) colMap.amt = 6;
    }

    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      if (!row.some(v=>N(v))) continue; // skip empty
      const descCell = colMap.desc!==undefined ? N(row[colMap.desc]||'').trim() : '';
      const qtyCellRaw = colMap.qty!==undefined ? N(row[colMap.qty]||'') : '';
      const rateCellRaw = colMap.rate!==undefined ? N(row[colMap.rate]||'') : '';
      const amtCellRaw = colMap.amt!==undefined ? N(row[colMap.amt]||'') : '';

      const joined = row.map(N).join(' ').toLowerCase();
      if (joined.includes('taxable value') || joined.includes('output sgst') || joined.includes('output cgst') || joined.includes('output igst') || joined.includes('round off') || (joined.trim()==='total') || joined.includes('grand total') || joined.includes('total amount')) {
        // Check if this is actually total row — break if amount present but no desc
        if (!descCell || joined.includes('taxable') || joined.includes('output') || joined.includes('round')) {
          // If taxable/total row, capture but don't treat as item unless it has qty
          if (joined.includes('taxable value') || joined.includes('total')) break;
        }
      }
      if (!descCell && !qtyCellRaw && !rateCellRaw) {
        const nextRow = aoa[r + 1] || [];
        if (!nextRow.some(v => N(v))) {
          const next2 = aoa[r + 2] || [];
          if (!next2.some(v => N(v))) break;
        }
        if (!descCell) continue;
      }
      // Skip rows that look like headers again or totals
      const lowDesc = descCell.toLowerCase();
      if (lowDesc.includes('taxable value') || lowDesc.includes('output sgst') || lowDesc.includes('output cgst') || lowDesc.includes('output igst') || lowDesc==='total' || lowDesc.includes('grand total')) break;

      let qty = NUM(qtyCellRaw);
      let unit = '';
      if (qty === null && qtyCellRaw) {
        const m = qtyCellRaw.match(/([\d,.]+)\s*([A-Za-z]+)?/);
        if (m) {
          qty = NUM(m[1]);
          unit = (m[2] || '').toUpperCase();
        }
      }
      // If qty still null but rate and amount present, try to infer qty=1 or from amount/rate
      if (qty === null) {
        const amtTmp = NUM(amtCellRaw);
        const rateTmp = NUM(rateCellRaw);
        if (amtTmp !== null && rateTmp !== null && rateTmp>0) {
          qty = amtTmp / rateTmp;
        } else if (descCell) {
          // If description exists but qty missing, assume 1 (user may have only amount)
          qty = 1;
        }
      }
      if (qty === null || qty <= 0) {
        // If description exists but qty invalid, still try to keep if amount exists
        if (!descCell) continue;
        // Try amount as qty=1 case
        if (NUM(amtCellRaw)!==null) qty = 1;
        else continue;
      }

      let rate = NUM(rateCellRaw);
      let amount = NUM(amtCellRaw);
      let hsn = colMap.hsn !== undefined ? N(row[colMap.hsn]) : '';
      let per = colMap.per !== undefined ? N(row[colMap.per]) : '';
      if (per) unit = per.toUpperCase() || unit;
      if (!unit) unit = 'KGS';
      if (rate === null) {
        if (amount !== null && qty) rate = amount / qty;
        else rate = amount || 0;
      }
      if (amount === null) amount = qty * rate;
      if (hsn) hsn = hsn.replace(/[^0-9]/g, '').slice(0, 10);
      // Final validation: need at least description and some value
      if (!descCell) continue;
      if (rate <=0 && amount <=0) continue;
      items.push({ name: descCell, hsn, qty, unit, rate, amount, gst_rate: null });
    }
  } else {
    // v1.11.30: NO header found — try to detect items by pattern: any row with at least 3 columns where col 1 is text and col 2-3 are numbers
    for (let r = 0; r < aoa.length; r++) {
      const row = aoa[r] || [];
      if (row.length < 2) continue;
      const c0 = N(row[0]), c1 = N(row[1]), c2 = N(row[2]||''), c3 = N(row[3]||'');
      const n1 = NUM(c1), n2 = NUM(c2), n3 = NUM(c3);
      // Pattern: Description | Qty | Rate | Amount  OR  Sr | Description | Qty | Rate
      if (c0 && (n1!==null || n2!==null)) {
        let desc = c1 && n1===null ? c1 : c0;
        let qty = n1!==null ? n1 : (n2!==null ? n2 : 1);
        let rate = n2!==null ? n2 : (n3!==null ? n3 : (n1!==null ? n1 : 0));
        let amount = n3!==null ? n3 : qty*rate;
        if (desc && qty>0 && (rate>0||amount>0)) {
          if (desc.toLowerCase().includes('description')||desc.toLowerCase().includes('item')||desc.toLowerCase().includes('particular')) continue;
          items.push({ name: desc, hsn: '', qty, unit: 'KGS', rate: rate||amount, amount: amount||qty*rate, gst_rate: null });
        }
      }
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
    _debug: { headerRow, colMap, aoaRows: aoa.length }
  };
}

export async function parseInvoiceWorkbook(buf, filename = '', sheetNameHint = '') {
  const X = await xlsxLib();
  const wb = X.read(buf, { type: 'buffer' });
  // If sheet hint provided, use it, else find first invoice-like sheet
  let sheetName = sheetNameHint || wb.SheetNames.find(s => /invoice|pi|sales/i.test(s)) || wb.SheetNames[0];
  if (!wb.Sheets[sheetName]) sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const aoa = X.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
  const rowsObj = X.utils.sheet_to_json(ws, { defval: '' });

  // Try bulk tabular first (many invoices in one sheet grouped by invoice_no)
  try {
    const bulk = parseTabularBulk(aoa, rowsObj);
    if (bulk && bulk.length) {
      if (bulk.length === 1) return bulk[0];
      return bulk;
    }
  } catch (_) {}
  let parsed = null;
  try {
    parsed = parseTabular(aoa, rowsObj);
  } catch (_) {}
  if (parsed && parsed.items && parsed.items.length) return parsed;

  parsed = parseFormatted(aoa);
  if (parsed && parsed.items && parsed.items.length) {
    // Attach sheet name as invoice source if invoice_no is generic
    if (!parsed.invoice_no || /^PI-/.test(parsed.invoice_no)) {
      // Use sheet name as invoice no if sheet name looks like invoice number
      if (sheetName && !/^(Info|Mapping|Read Me|Instructions|Template|Sample|Invoices)$/i.test(sheetName)) {
        parsed.invoice_no = sheetName;
      }
    }
  }
  return parsed;
}

// NEW v1.11.23: Multi-sheet support — one workbook, each sheet = one bill
// User has Excel with all previous bills, each in different sheet of same worksheet
export async function parseInvoiceWorkbookBulk(buf, filename = '') {
  const X = await xlsxLib();
  const wb = X.read(buf, { type: 'buffer' });
  const skipSheets = new Set(['Info', 'Mapping', 'Read Me', 'Instructions', 'Template', 'Sample', 'Invoices', 'Info Sheet']);
  const results = [];

  for (const sheetName of wb.SheetNames) {
    if (skipSheets.has(sheetName)) continue;
    if (/^(info|mapping|read me|instructions|template|sample)$/i.test(sheetName)) continue;
    
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    
    const aoa = X.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
    const rowsObj = X.utils.sheet_to_json(ws, { defval: '' });
    
    if (!aoa.length && !rowsObj.length) continue; // empty sheet
    
    try {
      // Try tabular bulk first — if sheet itself has multiple invoices grouped by invoice_no
      const bulk = parseTabularBulk(aoa, rowsObj);
      if (bulk && bulk.length) {
        for (const inv of bulk) {
          if (inv.items && inv.items.length) {
            // Ensure invoice_no uses sheet name if generic
            if (!inv.invoice_no || inv.invoice_no === 'INV' || /^PI-/.test(inv.invoice_no)) {
              if (!/^(Sheet\d+)$/i.test(sheetName)) inv.invoice_no = sheetName;
            }
            inv._sheet = sheetName;
            results.push(inv);
          }
        }
        continue;
      }
    } catch (_) {}
    
    try {
      const single = parseTabular(aoa, rowsObj);
      if (single && single.items && single.items.length) {
        if (!single.invoice_no || single.invoice_no === 'INV' || /^PI-/.test(single.invoice_no)) {
          if (!/^(Sheet\d+)$/i.test(sheetName)) single.invoice_no = sheetName;
        }
        single._sheet = sheetName;
        results.push(single);
        continue;
      }
    } catch (_) {}
    
    try {
      const formatted = parseFormatted(aoa);
      if (formatted && formatted.items && formatted.items.length) {
        if (!formatted.invoice_no || /^PI-/.test(formatted.invoice_no)) {
          if (!/^(Sheet\d+)$/i.test(sheetName)) formatted.invoice_no = sheetName;
        }
        formatted._sheet = sheetName;
        results.push(formatted);
      }
    } catch (_) {}
  }

  // Fallback: if no sheets parsed (maybe all were skipped), try original single-sheet logic
  if (!results.length) {
    const fallback = await parseInvoiceWorkbook(buf, filename, '');
    if (Array.isArray(fallback)) return fallback;
    return fallback ? [fallback] : [];
  }

  // Sort by date chrono order (DD/MM/YYYY) if dates available
  results.sort((a, b) => {
    const da = a.date || '', db = b.date || '';
    if (da && db) return da.localeCompare(db);
    return 0;
  });

  return results;
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
      date: (()=>{const d=new Date();return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;})(),
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
    'Required: invoice_no, date (DD/MM/YYYY — e.g. 15/09/2026), buyer_name, item_name, qty, rate',
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
  return { buf, file: `sales-invoice-template-${(() => { const d=new Date(); return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; })()}.xlsx` };
}

async function importOneInvoice(c, parsed, filename) {
  if (!parsed.items || !parsed.items.length) {
    const dbg = parsed._debug ? ` (headerRow=${parsed._debug.headerRow}, colMap=${JSON.stringify(parsed._debug.colMap)}, rows=${parsed._debug.aoaRows})` : '';
    const sheetInfo = parsed._sheet ? ` Sheet: ${parsed._sheet}.` : '';
    throw vErr(`No items found in Excel${sheetInfo} — check that the sheet has Description/Item, Quantity/Qty, Rate/Price, Amount columns and at least one item row. Detected: ${dbg}. Tip: Use template from /api/export/invoice_excel_template — it has correct headers. For multi-sheet: one bill per sheet. For single sheet: one row per item with same invoice_no.`);
  }
  if (!parsed.date) parsed.date = todayISO();
  const de = dateInBook(c, parsed.date);
  if (de) throw vErr(`Invoice ${parsed.invoice_no}: ${de}`);

  const buyerAcc = ensureAccount(c, parsed.buyer.name, parsed.buyer.address, parsed.buyer.gstin);
  const itemRows = [];
  for (const it of parsed.items) {
    const dbItem = ensureItem(c, it);
    itemRows.push({ item_id: dbItem.id, qty: it.qty, rate: it.rate, dbItem });
  }
  // v1.11.42: Only auto stock-in for TAX INVOICE, not for PI/Proforma
  const invNoUpperCheck = String(parsed.invoice_no || '').toUpperCase();
  const isProformaForStock = invNoUpperCheck.startsWith('PI-') || invNoUpperCheck.startsWith('PI/') || invNoUpperCheck.includes('PROFORMA') || invNoUpperCheck.includes('QUOTATION') || invNoUpperCheck.includes('ESTIMATE');
  if (!isProformaForStock) {
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
  }
  // v1.11.42: PI/Proforma should NOT affect stock — only Tax Invoice affects stock
  const invNoUpper = String(parsed.invoice_no || '').toUpperCase();
  const isProformaInvoice = invNoUpper.startsWith('PI-') || invNoUpper.startsWith('PI/') || invNoUpper.includes('PROFORMA') || invNoUpper.includes('QUOTATION') || invNoUpper.includes('ESTIMATE') || invNoUpper.startsWith('QT-') || invNoUpper.startsWith('EST-');
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
    invoice_type: isProformaInvoice ? 'proforma' : 'tax_invoice',
  };
  const v = createVoucher(c, payload);
  return { parsed, voucher: v };
}

export async function importInvoiceExcel(c, buf, filename = '') {
  // v1.11.23: Use bulk parser — supports multi-sheet workbook where each sheet = one bill
  // v1.11.30: More tolerant + better error
  const list = await parseInvoiceWorkbookBulk(buf, filename);
  if (!list.length) throw vErr('No bills found in Excel — file appears empty or all sheets are named Info/Mapping/Template/Sample (skipped). Rename your bill sheets to invoice numbers like PI-200, INV-001 etc. Each sheet = one bill. Or use single sheet with invoice_no, buyer_name, item_name, qty, rate columns.');
  if (!list[0].items || !list[0].items.length) {
    const first = list[0];
    const dbg = first._debug ? ` headerRow=${first._debug.headerRow} colMap=${JSON.stringify(first._debug.colMap)} rows=${first._debug.aoaRows}` : '';
    throw vErr(`No items found in first sheet (${first._sheet||first.invoice_no||'Sheet1'}) — check columns. Need Description/Item/Product, Quantity/Qty, Rate/Price, Amount. Found debug:${dbg}. Download template from Export Template button — it has correct headers: invoice_no, date DD/MM/YYYY, buyer_name, item_name, qty, rate, gst_rate, etc.`);
  }

  const results = [];
  const errors = [];
  for (const p of list) {
    try {
      const one = await importOneInvoice(c, p, filename);
      results.push(one);
    } catch (e) {
      errors.push(`Sheet ${p._sheet || p.invoice_no}: ${e.message}`);
    }
  }
  if (!results.length) {
    throw vErr(`No bills could be imported. Errors: ${errors.slice(0,5).join(' | ')}`);
  }
  if (results.length === 1) return { ...results[0], errors };
  return { parsed: list, vouchers: results.map(r => r.voucher), count: results.length, errors };
}
