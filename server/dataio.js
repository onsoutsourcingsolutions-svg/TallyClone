// Excel (and CSV) import/export for masters & transactions.
// Templates: GET  /api/export/:kind?mode=template
// Data:       GET  /api/export/:kind
// Import:     POST /api/import/:kind   (multipart: file, mode=add|update, [date], [counterpart])
let _xlsxPromise = null;
function xlsxLib() {
  if (!_xlsxPromise) {
    _xlsxPromise = (async () => {
      try {
        const m = await import('xlsx');
        return (m && m.default && m.default.utils) ? m.default : m;
      } catch (e) {
        _xlsxPromise = null; // allow a retry after npm install has run
        throw vErr('Excel support package is not installed yet — close this window, run START_ME.bat once with internet access, then try again.');
      }
    })();
  }
  return _xlsxPromise;
}
import { db, tx, getCompany, companyExtras, nextVoucherNo } from './db.js';
import { GROUPS, groupMeta } from './chart.js';
import { toPaise, validISO, todayISO, fyEnd, CLASS_META } from './lib.js';
import { vErr, dateInBook, voucherDetail, inventoryState, resolveDutyAccount, rateLabel } from './engine.js';
import { netBalances } from './engine.js';

const N = (v, fallback = '') => (v === undefined || v === null || v === '' ? fallback : String(v).trim());
const NUM = (v) => { if (v === undefined || v === null || v === '') return null; if (typeof v === 'number') return v; return Number(String(v).replace(/[,₹\s]/g, '')); };

function sheetOut(X, rows, name = 'Data', info = []) {
  const wb = X.utils.book_new();
  const ws = X.utils.json_to_sheet(rows.length ? rows : [{ '(empty)': '' }]);
  X.utils.book_append_sheet(wb, ws, name);
  if (info.length) {
    const is = X.utils.aoa_to_sheet(info.map((t) => [t]));
    is['!cols'] = [{ wch: 110 }];
    X.utils.book_append_sheet(wb, is, 'Info');
  }
  return X.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

export async function parseWorkbook(buf, name = '') {
  const X = await xlsxLib();
  const wb = /\.csv$/i.test(name) ? X.read(buf.toString('utf8'), { type: 'string' }) : X.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames.find((s) => s !== 'Info' && s !== 'Instructions' && s !== 'Mapping' && s !== 'Read Me') || wb.SheetNames[0];
  return X.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
}

// ---------------- export column builders ----------------
const ITEM_COLS = [
  ['name', 'Item name (REQUIRED)'], ['unit', 'Unit e.g. nos/kg/box'], ['hsn', 'HSN code'],
  ['gst_rate', 'GST rate % e.g. 18 (blank = exempt)'], ['is_service', '0 = goods, 1 = service (no stock)'],
  ['sale_account', 'Sales ledger for this item (blank = default)'], ['purchase_account', 'Purchase ledger (blank = default)'],
];
const LEDGER_COLS = [
  ['name', 'Ledger name (REQUIRED)'], ['group', 'Group — pick from the list in Info sheet'],
  ['opening_balance', 'Opening balance amount (blank = 0)'], ['opening_type', 'Dr or Cr (side of opening balance)'],
  ['address', 'Address (parties)'], ['gstin', 'GSTIN (parties)'], ['pan', 'PAN'],
  ['credit_days', 'Credit days (parties)'], ['credit_limit', 'Credit limit (parties)'],
  ['bank_name', 'Bank name'], ['ifsc', 'IFSC'], ['account_no', 'Account number'],
];
const STOCK_COLS = [
  ['item_name', 'Item name (REQUIRED, must already exist)'],
  ['qty', 'Quantity (REQUIRED)'],
  ['rate', 'Rate per unit ₹ (REQUIRED)'],
  ['date', 'Date of buying YYYY-MM-DD (when you bought this stock) — for tracking buy vs sell age, e.g. 2026-08-15'],
  ['narration', 'Narration / Batch / Supplier ref (optional)'],
];
const VOUCHER_COLS = [
  ['class', 'Type: Receipt / Payment / Contra / Journal'], ['date', 'Date YYYY-MM-DD (REQUIRED)'],
  ['number', 'Your voucher number (optional)'], ['narration', 'Narration'],
  ['dr_account', 'Debit ledger name (REQUIRED)'], ['dr_amount', 'Debit amount ₹ (REQUIRED)'],
  ['cr_account', 'Credit ledger name (REQUIRED)'], ['cr_amount', 'Credit amount ₹ (REQUIRED)'],
];

const GROUP_NAMES = GROUPS.map((g) => g.name).sort();

export async function exportKindData(kind, c) {
  const X = await xlsxLib();
  const companyName = c.name.replace(/[\\/:*?"<>|]+/g, '-').trim();
  const stamp = todayISO();
  if (kind === 'ledgers') {
    const balances = netBalances(c);
    const rows = db.prepare('SELECT * FROM accounts WHERE company_id = ? AND active = 1 ORDER BY name').all(c.id).map((a) => {
      const g = groupMeta(a.group_code);
      const bal = balances[a.id].net;
      return {
        name: a.name, group: g ? g.name : a.group_code,
        opening_balance: a.opening_balance ? Math.abs(a.opening_balance) / 100 : '', opening_type: a.opening_balance ? (a.opening_balance < 0 ? 'Cr' : 'Dr') : '',
        address: a.address, gstin: a.gstin, pan: a.pan,
        credit_days: a.credit_days ?? '', credit_limit: a.credit_limit ? a.credit_limit / 100 : '',
        bank_name: a.bank_name, ifsc: a.ifsc, account_no: a.account_no,
        current_balance: bal ? bal / 100 : '',
      };
    });
    const info = ['LEDGERS IMPORT — one row per ledger.', 'group column: use one of these exact names:', ...GROUP_NAMES,
      'current_balance is for your information only (not imported).', 'Keep the header row. Delete the example rows before importing.'];
    return { buf: sheetOut(X, rows, 'Ledgers', info), file: `${companyName}-ledgers-${stamp}.xlsx` };
  }
  if (kind === 'items') {
    const rows = db.prepare('SELECT * FROM items WHERE company_id = ? AND active = 1 ORDER BY name').all(c.id).map((it) => {
      const st = it.is_service ? null : inventoryState(it.id);
      return {
        name: it.name, unit: it.unit, hsn: it.hsn, gst_rate: it.gst_rate ?? '', is_service: it.is_service ? 1 : 0,
        sale_account: it.sale_account_id ? (db.prepare('SELECT name FROM accounts WHERE id = ?').get(it.sale_account_id)?.name ?? '') : '',
        purchase_account: it.purchase_account_id ? (db.prepare('SELECT name FROM accounts WHERE id = ?').get(it.purchase_account_id)?.name ?? '') : '',
        stock_qty: st ? st.qty : '', stock_value: st ? st.value / 100 : '',
      };
    });
    const info = ['ITEMS IMPORT — one row per stock item/service.', 'gst_rate is a number like 18, 12, 5, 0 or 28. is_service: 0 or 1.',
      'stock_qty / stock_value are shown for information only — enter opening quantities with the "Opening Stock" template instead.', 'Keep the header row. Delete example rows before importing.'];
    return { buf: sheetOut(X, rows, 'Items', info), file: `${companyName}-items-${stamp}.xlsx` };
  }
  if (kind === 'stock') {
    // current stock = suggested opening values (fill-in template)
    const rows = db.prepare('SELECT * FROM items WHERE company_id = ? AND active = 1 AND is_service = 0 ORDER BY name').all(c.id)
      .map((it) => { const st = inventoryState(it.id); return { item_name: it.name, qty: st.qty || '', rate: st.qty > 1e-9 ? (st.value / st.qty / 100) : '', }; });
    const info = ['OPENING STOCK — brings stock INTO the books as one Stock Journal voucher.',
      'item_name must already exist (import Items template first). qty and rate are REQUIRED.', 'Use Import → Opening Stock and choose the date + the balancing account (e.g. Reserves & Surplus / Capital).'];
    return { buf: sheetOut(X, rows, 'OpeningStock', info), file: `${companyName}-opening-stock-${stamp}.xlsx` };
  }
  if (kind === 'vouchers') {
    // only simple two-line vouchers (no item lines) round-trip cleanly
    const rows = db.prepare(`
      SELECT v.id, v.class, v.date, v.number, v.narration, v.ref, v.voucher_no,
        (SELECT COUNT(*) FROM entries e WHERE e.voucher_id = v.id) AS n
      FROM vouchers v WHERE v.company_id = ? AND v.active = 1
        AND v.class IN ('receipt','payment','contra','journal')
      ORDER BY v.date, v.id`).all(c.id)
      .filter((v) => v.n === 2)
      .map((v) => {
        const es = db.prepare('SELECT e.debit, e.credit, a.name AS an FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.voucher_id = ? ORDER BY e.line_no').all(v.id);
        const dr = es.find((e) => e.debit > 0), cr = es.find((e) => e.credit > 0);
        return {
          class: CLASS_META[v.class] ? CLASS_META[v.class].label : v.class,
          date: v.date, number: v.number || '', narration: v.narration, ref: v.ref,
          dr_account: dr ? dr.an : '', dr_amount: dr ? dr.debit / 100 : '',
          cr_account: cr ? cr.an : '', cr_amount: cr ? cr.credit / 100 : '',
        };
      });
    const info = ['VOUCHERS — simple Receipt / Payment / Contra / Journal lines.', 'class can be: Receipt, Payment, Contra, Journal.',
      'Each row must balance: dr_amount = cr_amount.', 'Dates must be inside the books period (YYYY-MM-DD).'];
    return { buf: sheetOut(X, rows, 'Vouchers', info), file: `${companyName}-vouchers-${stamp}.xlsx` };
  }
  throw vErr('Unknown export kind.');
}

export async function exportKindTemplate(kind, c) {
  const X = await xlsxLib();
  const info = {
    ledgers: ['Fill one ledger per row. Required: name, group.', 'opening_type is Dr or Cr.', ...(kind === 'ledgers' ? GROUP_NAMES.map((g) => 'Group available: ' + g) : [])],
    items: ['Fill one item per row. Required: name. Example row is marked EXAMPLE — delete it before importing.'],
    stock: ['Fill one item per row. Required: item_name (must exist), qty, rate.', 'Optional: date = date of buying YYYY-MM-DD for tracking buy vs sell age. If blank, uses the date you choose in the import screen.', 'Optional: narration = batch / supplier ref.'],
    vouchers: ['Fill one voucher per row. class: Receipt / Payment / Contra / Journal. Each row must balance.'],
  }[kind];
  const cols = { ledgers: LEDGER_COLS, items: ITEM_COLS, stock: STOCK_COLS, vouchers: VOUCHER_COLS }[kind];
  const example = {
    ledgers: { name: 'EXAMPLE — delete this row', group: GROUP_NAMES[0] || '', opening_balance: '', opening_type: 'Dr' },
    items: { name: 'EXAMPLE — delete this row', unit: 'nos', hsn: '', gst_rate: 18, is_service: 0 },
    stock: { item_name: 'EXAMPLE — delete this row', qty: 100, rate: 80.5, date: todayISO(), narration: 'Batch A / Supplier XYZ' },
    vouchers: { class: 'Receipt', date: '2026-04-01', number: '', narration: '', dr_account: 'EXAMPLE — delete', dr_amount: '', cr_account: '', cr_amount: '' },
  }[kind];
  const row = {};
  for (const [k] of cols) row[k] = example[k] ?? '';
  return { buf: sheetOut(X, [row], 'Template', info), file: `template-${kind}-${todayISO()}.xlsx` };
}

export async function exportKindSample(kind, c) {
  const X = await xlsxLib();
  if (kind !== 'items') throw vErr('A sample file is available for Stock Items only.');
  const companyName = String(c ? c.name : 'ONS').replace(/[\\/:*?"<>|]+/g, '-').trim();
  const rows = [
    { name: 'EXAMPLE-1  Steel Rod 12mm — rename to your real item name', unit: 'qty', hsn: '7214', gst_rate: 18, is_service: 0, sale_account: 'Sales', purchase_account: 'Purchases' },
    { name: 'EXAMPLE-2  Cement 43 grade 50kg — rename to your real item name', unit: 'bag', hsn: '2523', gst_rate: 28, is_service: 0, sale_account: '', purchase_account: '' },
    { name: 'EXAMPLE-3  Door fabrication (service) — rename to your real service name', unit: '', hsn: '9987', gst_rate: 18, is_service: 1, sale_account: '', purchase_account: '' },
    { name: 'EXAMPLE-4  already-existing item — rename to an existing item name to UPDATE it', unit: 'nos', hsn: '', gst_rate: 12, is_service: 0, sale_account: '', purchase_account: '' },
  ];
  const mapping = [
    'SAMPLE FILE — how to fill the Stock Items upload (same columns as the real upload)',
    '',
    'ADD or UPDATE when you upload:',
    '  ADD    -> names that do not exist yet are CREATED. Names that already exist are SKIPPED.',
    '  UPDATE -> a name that already exists is UPDATED with this row (unit, HSN, GST rate, service flag, default ledgers). New names are still CREATED.',
    '',
    'Rows whose name starts with EXAMPLE- are NEVER imported — rename them to your real item names.',
    '',
    'COLUMN MAPPING (keep the header row exactly as row 1):',
    '  name            -> item name as shown in the app. REQUIRED. This name is the key for add/update.',
    '  unit            -> unit of measure: nos, qty, kg, bag, box, mtr, pcs … (blank = nos)',
    '  hsn             -> HSN code for goods / SAC for services, e.g. 7214, 2523, 9987',
    '  gst_rate        -> GST rate as a number: 0, 5, 12, 18 or 28 (blank = exempt)',
    '  is_service      -> 0 = goods (stock quantity is tracked), 1 = service (no stock)',
    '  sale_account    -> name of the ledger used when this item is sold (blank = default Sales)',
    '  purchase_account-> name of the ledger used when this item is bought (blank = default Purchases)',
    '',
    'NOT read on upload (they only appear when you export "My current items"): stock_qty, stock_value.',
    'To enter opening stock quantities/rates use the Opening Stock workbook (Data -> Import/Export).',
    'Files may be .xlsx, .xls or .csv with this same header row.',
  ];
  const wb = X.utils.book_new();
  const ws = X.utils.json_to_sheet(rows);
  ws['!cols'] = [{ wch: 58 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 11 }, { wch: 15 }, { wch: 18 }];
  X.utils.book_append_sheet(wb, ws, 'Sample');
  const ms = X.utils.aoa_to_sheet(mapping.map((t) => [t]));
  ms['!cols'] = [{ wch: 118 }];
  X.utils.book_append_sheet(wb, ms, 'Mapping');
  return { buf: X.write(wb, { type: 'buffer', bookType: 'xlsx' }), file: `${companyName}-stock-items-SAMPLE.xlsx` };
}

// ---------------- import helpers ----------------
// Common short names people type instead of the long official group names.
const GROUP_ALIASES = {
  sundry_debtors: ['sundry debtors', 'debtors', 'trade receivables', 'sundry debtor'],
  sundry_creditors: ['sundry creditors', 'creditors', 'trade payables', 'sundry creditor'],
  bank_accounts: ['bank accounts', 'bank', 'banks'],
  cash_in_hand: ['cash in hand', 'cash'],
  sales: ['sales', 'sales accounts', 'sale', 'direct income', 'sales account'],
  income_direct: ['other direct income', 'direct income other'],
  income_indirect: ['indirect income', 'other income'],
  purchases: ['purchases', 'purchase accounts', 'purchase', 'direct expenses', 'purchases account', 'direct expense'],
  expense_direct: ['other direct expenses', 'direct expenses other'],
  expense_indirect: ['indirect expenses', 'expenses', 'expense', 'indirect expense', 'administrative expenses'],
  reserves_surplus: ['reserves & surplus', 'reserves and surplus', 'capital', 'reserve & surplus', 'opening balance'],
  input_tax_credit: ['input tax credit', 'itc', 'input gst', 'input tax'],
  statutory_dues: ['statutory dues', 'gst payable', 'tax payable'],
  inventories: ['inventories', 'stock in hand', 'stock', 'inventory'],
  current_assets: ['other current assets', 'current assets', 'current asset'],
  fixed_tangible: ['fixed assets', 'fixed asset', 'assets'],
  long_loans_adv: ['long term loans & advances', 'loans & advances', 'advances', 'long term loans'],
  short_loans_adv: ['short term loans & advances', 'short term loans', 'loans and advances'],
};
function findGroup(v) {
  const s = String(v).trim();
  if (!s) return null;
  const direct = groupMeta(s);
  if (direct) return direct;
  const hit = GROUPS.find((g) => g.name.toLowerCase() === s.toLowerCase());
  if (hit) return hit;
  const code = Object.keys(GROUP_ALIASES).find((cd) => GROUP_ALIASES[cd].includes(s.toLowerCase()));
  return code ? groupMeta(code) : null;
}
function findAccount(c, name, kindHint = null) {
  const s = String(name || '').trim();
  if (!s) return null;
  const a = db.prepare('SELECT * FROM accounts WHERE company_id = ? AND name = ? AND active = 1').get(c.id, s);
  if (a) return a;
  const like = db.prepare('SELECT * FROM accounts WHERE company_id = ? AND active = 1 AND lower(name) = lower(?)').get(c.id, s);
  if (like) return like;
  if (kindHint === 'party') {
    // allow suffix matching like "Rahul Traders A/c"
    return null;
  }
  return null;
}
const CLASS_BY_LABEL = {};
for (const k of Object.keys(CLASS_META)) CLASS_BY_LABEL[k] = k;
for (const k of Object.keys(CLASS_META)) CLASS_BY_LABEL[CLASS_META[k].label.toLowerCase()] = k;

export function importKind(kind, c, rows, { mode = 'add', date, counterpart_id } = {}) {
  const created = [], updated = [], skipped = [], errors = [];
  if (!rows || !rows.length) throw vErr('The file has no data rows (header only?).');
  const pushErr = (i, msg) => errors.push(`Row ${i + 2}: ${msg}`);

  if (kind === 'ledgers') {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = N(r.name);
      if (!name || /^example/i.test(name)) { skipped.push(i + 2); continue; }
      const grp = findGroup(r.group);
      if (!grp) { pushErr(i, `unknown group "${N(r.group)}" — use one of the group names in the Info sheet.`); continue; }
      const existing = db.prepare('SELECT * FROM accounts WHERE company_id = ? AND name = ?').get(c.id, name);
      if (existing) {
        if (mode === 'update') {
          const used = db.prepare('SELECT COUNT(*) n FROM entries WHERE account_id = ?').get(existing.id).n > 0;
          const groupChange = grp.code !== existing.group_code;
          if (groupChange && used) { pushErr(i, `ledger "${name}" already has postings — cannot change its group.`); continue; }
          const obRaw = NUM(r.opening_balance);
          const ob = obRaw === null ? existing.opening_balance : Math.abs(toPaise(obRaw)) * (String(r.opening_type).trim().toLowerCase() === 'cr' ? -1 : 1);
          if (obRaw !== null && used) { pushErr(i, `ledger "${name}" already has postings — opening balance cannot be changed.`); continue; }
          db.prepare(`UPDATE accounts SET name=?, group_code=?, type=?, opening_balance=?, address=?, gstin=?, pan=?,
            credit_days=?, credit_limit=?, bank_name=?, ifsc=?, account_no=? WHERE id=?`).run(name, grp.code, grp.type, ob,
            N(r.address), N(r.gstin).toUpperCase(), N(r.pan).toUpperCase(),
            NUM(r.credit_days) ?? null, NUM(r.credit_limit) !== null ? toPaise(NUM(r.credit_limit)) : null,
            N(r.bank_name), N(r.ifsc).toUpperCase(), N(r.account_no), existing.id);
          updated.push(name);
        } else skipped.push(`${i + 2}: already exists`);
        continue;
      }
      const obRaw = NUM(r.opening_balance);
      const ob = obRaw === null ? 0 : Math.abs(toPaise(obRaw)) * (String(r.opening_type).trim().toLowerCase() === 'cr' ? -1 : 1);
      db.prepare(`INSERT INTO accounts(company_id,name,group_code,type,kind,address,gstin,pan,credit_days,credit_limit,bank_name,ifsc,account_no,opening_balance,opening_balance_date,active,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`).run(c.id, name, grp.code, grp.type, grp.kind || 'General',
        N(r.address), N(r.gstin).toUpperCase(), N(r.pan).toUpperCase(),
        NUM(r.credit_days) ?? null, NUM(r.credit_limit) !== null ? toPaise(NUM(r.credit_limit)) : null,
        N(r.bank_name), N(r.ifsc).toUpperCase(), N(r.account_no), ob, c.books_begin_from, todayISO());
      created.push(name);
    }
  } else if (kind === 'items') {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = N(r.name);
      if (!name || /^example/i.test(name)) { skipped.push(i + 2); continue; }
      const gst = r.gst_rate === '' || r.gst_rate === null || r.gst_rate === undefined ? null : Number(r.gst_rate);
      if (gst !== null && (Number.isNaN(gst) || gst < 0)) { pushErr(i, `GST rate must be a number like 18.`); continue; }
      const isSvc = String(r.is_service).trim() === '1' || /^(yes|true|y|service)$/i.test(String(r.is_service).trim());
      const saleAcc = findAccount(c, r.sale_account);
      const purchAcc = findAccount(c, r.purchase_account);
      if (N(r.sale_account) && !saleAcc) { pushErr(i, `sale_account "${N(r.sale_account)}" not found — create that ledger first.`); continue; }
      if (N(r.purchase_account) && !purchAcc) { pushErr(i, `purchase_account "${N(r.purchase_account)}" not found — create that ledger first.`); continue; }
      const existing = db.prepare('SELECT id FROM items WHERE company_id = ? AND name = ?').get(c.id, name);
      if (existing) {
        if (mode === 'update') {
          db.prepare('UPDATE items SET unit=?, hsn=?, gst_rate=?, is_service=?, sale_account_id=?, purchase_account_id=? WHERE id=?')
            .run(N(r.unit, 'nos'), N(r.hsn).toUpperCase(), gst, isSvc ? 1 : 0, saleAcc ? saleAcc.id : null, purchAcc ? purchAcc.id : null, existing.id);
          updated.push(name);
        } else skipped.push(`${i + 2}: already exists`);
        continue;
      }
      db.prepare('INSERT INTO items(company_id,name,unit,hsn,gst_rate,is_service,sale_account_id,purchase_account_id,active,created_at) VALUES(?,?,?,?,?,?,?,?,1,?)')
        .run(c.id, name, N(r.unit, 'nos'), N(r.hsn).toUpperCase(), gst, isSvc ? 1 : 0, saleAcc ? saleAcc.id : null, purchAcc ? purchAcc.id : null, todayISO());
      created.push(name);
    }
  } else if (kind === 'stock') {
    // Stock import now supports per-row buying date for tracking buy vs sell age
    // If rows have a date column, they are grouped by date and each date gets its own Stock Journal voucher
    // Otherwise uses the date chosen in the UI (or today)
    const defaultDate = date || todayISO();
    const de0 = dateInBook(c, defaultDate);
    if (de0) throw vErr(de0);
    if (!counterpart_id) throw vErr('Choose the balancing account for opening stock.');
    const ctr = db.prepare('SELECT * FROM accounts WHERE id = ? AND company_id = ? AND active = 1').get(Number(counterpart_id), c.id);
    if (!ctr) throw vErr('Balancing account not found.');
    // helper to parse date from row
    const parseRowDate = (r) => {
      const raw = N(r.date || r.buy_date || r.buying_date || r.purchase_date || r.bought_on || r.purchased_on || r.stock_date || '');
      if (!raw) return null;
      // try ISO first
      if (validISO(raw)) return raw;
      // try dd-mm-yyyy or dd/mm/yyyy
      const m1 = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
      if (m1) {
        const iso = `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
        if (validISO(iso)) return iso;
      }
      const m2 = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
      if (m2) {
        const iso = `${m2[1]}-${m2[2].padStart(2,'0')}-${m2[3].padStart(2,'0')}`;
        if (validISO(iso)) return iso;
      }
      // try Date parse
      const d = new Date(raw);
      if (!Number.isNaN(d.getTime())) {
        const iso = d.toISOString().slice(0,10);
        if (validISO(iso)) return iso;
      }
      return null;
    };
    const grouped = new Map(); // date -> lines[]
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const name = N(r.item_name || r.name);
      if (!name || /^example/i.test(name)) { skipped.push(i + 2); continue; }
      const it = db.prepare('SELECT * FROM items WHERE company_id = ? AND active = 1 AND lower(name) = lower(?)').get(c.id, name);
      if (!it) { pushErr(i, `item "${name}" not found — import the Items template first.`); continue; }
      if (it.is_service) { pushErr(i, `item "${name}" is a service — no stock.`); continue; }
      const qty = NUM(r.qty);
      const rate = NUM(r.rate);
      if (!(qty > 0)) { pushErr(i, `qty must be a positive number.`); continue; }
      if (!(rate > 0)) { pushErr(i, `rate must be a positive number.`); continue; }
      let d = parseRowDate(r);
      if (!d) d = defaultDate;
      const de = dateInBook(c, d);
      if (de) { pushErr(i, `date ${d}: ${de}`); continue; }
      const narr = N(r.narration || r.batch || r.supplier || r.ref || r.remarks || '');
      if (!grouped.has(d)) grouped.set(d, []);
      grouped.get(d).push({ item_id: it.id, qty, ratePaise: toPaise(rate), narration: narr, item_name: it.name });
    }
    if (!grouped.size) {
      if (!errors.length) throw vErr('No valid rows to import.');
    } else {
      for (const [vdate, lines] of grouped.entries()) {
        tx(() => {
          const no = nextVoucherNo(c.id, 'stock_journal');
          const combinedNarr = lines.some(l => l.narration) ? `Stock import ${vdate} — ${lines.map(l => l.narration).filter(Boolean).join(', ').slice(0,120)}` : `Opening stock import (${lines.length} lines) on ${vdate}`;
          const r = db.prepare(`INSERT INTO vouchers(company_id,class,voucher_no,date,number,narration,ref,ref_date,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)`).run(c.id, 'stock_journal', no, vdate, '', combinedNarr, '', null, todayISO(), todayISO());
          const vid = Number(r.lastInsertRowid);
          const invId = companyExtras(c).inventory_account_id;
          const totalVal = lines.reduce((s, l) => s + Math.round(l.ratePaise * l.qty), 0);
          let ln = 0;
          const insIE = db.prepare('INSERT INTO item_entries(voucher_id,company_id,line_no,item_id,qty,rate,amount,direction) VALUES(?,?,?,?,?,?,?,?)');
          for (const l of lines) insIE.run(vid, c.id, ln++, l.item_id, l.qty, l.ratePaise, Math.round(l.ratePaise * l.qty), 'in');
        const insE = db.prepare('INSERT INTO entries(voucher_id,company_id,line_no,account_id,debit,credit,particulars,taxable,is_stock) VALUES(?,?,?,?,?,?,?,?,?)');
        insE.run(vid, c.id, ln++, invId, totalVal, 0, 'To Stock (opening import)', null, 1);
        insE.run(vid, c.id, ln++, ctr.id, 0, totalVal, 'By ' + ctr.name, null, 0);
        db.prepare('INSERT INTO edit_log(company_id,voucher_id,action,at,old_json,new_json) VALUES(?,?,?,?,?,?)')
          .run(c.id, vid, 'create', todayISO(), null, JSON.stringify({ via: 'excel-import', lines: lines.length, total: totalVal }));
        created.push(`${lines.length} lines on ${vdate}`);
        });
      }
    }
  } else if (kind === 'vouchers') {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const cls = CLASS_BY_LABEL[String(r.class || '').trim().toLowerCase()];
      if (!cls || !['receipt', 'payment', 'contra', 'journal'].includes(cls)) { pushErr(i, `class must be Receipt, Payment, Contra or Journal (got "${N(r.class)}").`); continue; }
      const date = N(r.date);
      if (!validISO(date)) { pushErr(i, `date must be YYYY-MM-DD (got "${date}").`); continue; }
      const de = dateInBook(c, date);
      if (de) { pushErr(i, de); continue; }
      const drAcc = findAccount(c, r.dr_account);
      const crAcc = findAccount(c, r.cr_account);
      if (!drAcc) { pushErr(i, `debit account "${N(r.dr_account)}" not found — create that ledger first.`); continue; }
      if (!crAcc) { pushErr(i, `credit account "${N(r.cr_account)}" not found — create that ledger first.`); continue; }
      const drAmt = NUM(r.dr_amount);
      const crAmt = NUM(r.cr_amount);
      if (!(drAmt > 0)) { pushErr(i, 'dr_amount must be a positive number.'); continue; }
      if (toPaise(drAmt) !== toPaise(crAmt)) { pushErr(i, `row not balanced: debit ${drAmt} vs credit ${crAmt}.`); continue; }
      tx(() => {
        const no = nextVoucherNo(c.id, cls);
        const r2 = db.prepare(`INSERT INTO vouchers(company_id,class,voucher_no,date,number,narration,ref,ref_date,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(c.id, cls, no, date, N(r.number), N(r.narration), '', null, todayISO(), todayISO());
        const vid = Number(r2.lastInsertRowid);
        const insE = db.prepare('INSERT INTO entries(voucher_id,company_id,line_no,account_id,debit,credit,particulars,taxable,is_stock) VALUES(?,?,?,?,?,?,?,?,?)');
        insE.run(vid, c.id, 0, drAcc.id, toPaise(drAmt), 0, N(r.narration), null, 0);
        insE.run(vid, c.id, 1, crAcc.id, 0, toPaise(crAmt), N(r.narration), null, 0);
        db.prepare('INSERT INTO edit_log(company_id,voucher_id,action,at,old_json,new_json) VALUES(?,?,?,?,?,?)')
          .run(c.id, vid, 'create', todayISO(), null, JSON.stringify({ via: 'excel-import' }));
        created.push(`${CLASS_META[cls].label} #${no}`);
      });
    }
  } else throw vErr('Unknown import kind.');
  return { created: created.length, updated: updated.length, skipped: skipped.length, errors, samples: created.slice(0, 5), updatedSamples: updated.slice(0, 5) };
}
