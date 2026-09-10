// Engine smoke test — run: node --experimental-sqlite scripts/smoke.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.env.TALLY_DATA = fs.mkdtempSync('/tmp/tally-smoke-');

const E = await import(path.join(ROOT, 'server/engine.js'));
const { setActiveCompany, getCompany, db } = await import(path.join(ROOT, 'server/db.js'));

let failed = 0;
function check(name, cond, extra = '') {
  if (cond) console.log('  ok  ' + name);
  else { failed++; console.log('FAIL  ' + name + '  ' + extra); }
}

// --- company ---
const c = E.createCompany({ name: 'Sharma Steel Traders', city: 'Pune', state: 'Maharashtra', state_code: '27', financial_year_from: '2025-04-01' });
setActiveCompany(c.id);
const co = getCompany(c.id);

const rahul = E.createLedgerAccount(co, { name: 'Rahul Traders', group_code: 'sundry_debtors' });
const mehta = E.createLedgerAccount(co, { name: 'Mehta Enterprises', group_code: 'sundry_creditors' });
const hdfc = E.createLedgerAccount(co, { name: 'HDFC Bank', group_code: 'bank_accounts', kind: 'Bank', opening_balance: '300000' });
const capital = E.createLedgerAccount(co, { name: 'Proprietor Capital', group_code: 'reserves_surplus', opening_balance: '500000', opening_type: 'Cr' });
const machinery = E.createLedgerAccount(co, { name: 'Machinery', group_code: 'fixed_tangible', kind: 'FixedAsset', opening_balance: '200000' });
check('opening balance credit stored negative', capital.opening_balance === -50000000);
check('opening balance debit stored positive', machinery.opening_balance === 20000000);

const insItem = db.prepare('INSERT INTO items(company_id,name,unit,hsn,gst_rate,is_service,created_at) VALUES(?,?,?,?,?,?,?)');
const iSteel = Number(insItem.run(c.id, 'MS Angle 50x50', 'kg', '7216', 18, 0, '2025-04-01').lastInsertRowid);
const iNails = Number(insItem.run(c.id, 'Nails 2 inch', 'box', '7317', 5, 0, '2025-04-01').lastInsertRowid);

// --- purchase ---
const p1 = E.createVoucher(co, { class: 'purchase', date: '2025-04-05', number: 'ME-101', party_id: mehta.id, regime: 'intra', narration: 'April purchase',
  items: [{ item_id: iSteel, qty: 1000, rate: '48.50' }, { item_id: iNails, qty: 200, rate: '120' }] });
let dsum = 0, csum = 0;
for (const e of p1.entries) { dsum += e.debit; csum += e.credit; }
check('purchase balanced', dsum === csum, `${dsum} vs ${csum}`);
const steelState = E.inventoryState(iSteel);
check('steel stock qty 1000', steelState.qty === 1000);
check('steel stock value 4,85,000', steelState.value === 4850000);

// --- sales ---
const s1 = E.createVoucher(co, { class: 'sales', date: '2025-04-12', number: 'SL-9001', party_id: rahul.id, regime: 'intra', narration: 'April sales',
  items: [{ item_id: iSteel, qty: 400, rate: '60' }] });
check('sales voucher has entries', s1.entries.length >= 6);
const steelAfter = E.inventoryState(iSteel);
check('steel qty after sale = 600', Math.abs(steelAfter.qty - 600) < 1e-9, String(steelAfter.qty));
const expectedVal = 4850000 - Math.round((4850000 / 1000) * 400);
check('steel value after sale (WAC)', steelAfter.value === expectedVal, `${steelAfter.value} vs ${expectedVal}`);

// --- edit a voucher (change narration + quantity 400 -> 300) ---
const s1b = E.updateVoucher(co, s1.id, { class: 'sales', date: '2025-04-12', number: 'SL-9001', party_id: rahul.id, regime: 'intra', narration: 'April sales (edited)',
  items: [{ item_id: iSteel, qty: 300, rate: '60' }] });
check('edited sales narration', s1b.narration === 'April sales (edited)');
const steelEdit = E.inventoryState(iSteel);
check('steel qty after edit = 700', Math.abs(steelEdit.qty - 700) < 1e-9, String(steelEdit.qty));
const log = E.voucherLog(s1.id);
check('edit log has create + edit', log.length === 2 && log[0].action === 'create' && log[1].action === 'edit', JSON.stringify(log.map(l => l.action)));

// --- journal + receipt ---
E.createVoucher(co, { class: 'journal', date: '2025-04-15', narration: 'transfer',
  entries: [{ account_id: hdfc.id, debit: '10000' }, { account_id: capital.id, credit: '10000' }] });
E.createVoucher(co, { class: 'receipt', date: '2025-04-20', narration: 'payment received',
  entries: [{ account_id: hdfc.id, debit: '10000' }, { account_id: rahul.id, credit: '10000' }] });

// --- CREDIT NOTE: customer returns 100kg steel (return reverses sale margin, stock back at cost 48.50) ---
const cn1 = E.createVoucher(co, { class: 'credit_note', date: '2025-04-22', number: 'CN-1', party_id: rahul.id, regime: 'intra', narration: 'return of steel',
  items: [{ item_id: iSteel, qty: 100, rate: '60' }] });
let cnDr = 0, cnCr = 0;
for (const e of cn1.entries) { cnDr += e.debit; cnCr += e.credit; }
check('credit note balanced', cnDr === cnCr && cnDr === 1193000, `${cnDr} vs ${cnCr}`); // sales 6000 + tax 1080 + stock 4850 = 11930 vs party 7080 + cogs 4850
const steelAfterCN = E.inventoryState(iSteel);
check('steel qty after credit note = 800', Math.abs(steelAfterCN.qty - 800) < 1e-9, String(steelAfterCN.qty));
const cnLed = E.ledgerReport(co, rahul.id, '2025-04-01', '2025-04-30');
check('debtor balance = invoice 21240 - receipt 10000 - CN 7080 = 4160', cnLed.closing === 416000, String(cnLed.closing));

// --- DEBIT NOTE: return 50 bags to supplier (at bill rate) ---
const dn1 = E.createVoucher(co, { class: 'debit_note', date: '2025-04-25', number: 'DN-1', party_id: mehta.id, regime: 'intra', narration: 'return to supplier',
  items: [{ item_id: iSteel, qty: 50, rate: '48.50' }] });
let dnDr = 0, dnCr = 0;
for (const e of dn1.entries) { dnDr += e.debit; dnCr += e.credit; }
check('debit note balanced', dnDr === dnCr && dnDr === 286150, `${dnDr} vs ${dnCr}`); // party Dr 2861.50 vs stock 2425 + ITC 436.50
const steelAfterDN = E.inventoryState(iSteel);
check('steel qty after debit note = 750', Math.abs(steelAfterDN.qty - 750) < 1e-9, String(steelAfterDN.qty));

// --- STOCK JOURNAL: opening stock of nails (new item, no invoice) ---
const iRod = Number(insItem.run(c.id, 'TMT Rod 12mm', 'kg', '7214', 18, 0, '2025-04-01').lastInsertRowid);
const sj1 = E.createVoucher(co, { class: 'stock_journal', date: '2025-04-02', narration: 'opening stock',
  counterpart_id: capital.id, items: [{ item_id: iRod, qty: 500, rate: '60', direction: 'in' }] });
check('stock journal posts stock-in', E.inventoryState(iRod).qty === 500 && E.inventoryState(iRod).value === 3000000);
let sjDr = 0, sjCr = 0;
for (const e of sj1.entries) { sjDr += e.debit; sjCr += e.credit; }
check('stock journal balanced', sjDr === sjCr, `${sjDr} vs ${sjCr}`);

// --- stock journal OUT (adjustment) with avg rate ---
const sj2 = E.createVoucher(co, { class: 'stock_journal', date: '2025-04-28', narration: 'damage write-off',
  counterpart_id: hdfc.id, items: [{ item_id: iRod, qty: 10, direction: 'out' }] });
check('stock journal out uses average rate 60', E.inventoryState(iRod).qty === 490 && E.inventoryState(iRod).value === 2940000, JSON.stringify(E.inventoryState(iRod)));

// --- try overselling ---
let threw = false;
try { E.createVoucher(co, { class: 'sales', date: '2025-04-29', party_id: rahul.id, regime: 'intra', items: [{ item_id: iRod, qty: 99999, rate: '60' }] }); }
catch (e) { threw = true; }
check('overselling blocked', threw);

// --- reports ---
const bs = E.balanceSheet(co, '2025-04-30');
check('balance sheet ties', bs.balanced, JSON.stringify({ l: bs.totals.liabilities, a: bs.totals.assets }));
const tb = E.trialBalance(co, '2025-04-30');
check('trial balance ties', tb.balanced, `${tb.totals.debit} vs ${tb.totals.credit}`);
const pl = E.profitLoss(co, '2025-04-01', '2025-04-30');
const salesRow = pl.sections.flatMap(s => s.rows).find(r => r.name === 'Sales');
check('P&L has sales line net of return = 12000', salesRow && salesRow.amount === 1200000, JSON.stringify(pl.sections.map(s => ({ k: s.key, t: s.total, rows: s.rows.map(r => r.name + ':' + r.amount) }))));
const gst = E.gstSummary(co, '2025-04-01', '2025-04-30');
const dayb = E.dayBook(co, '2025-04-01', '2025-04-30');
check('day book has 8 vouchers', dayb.rows.length === 8, String(dayb.rows.length));
check('gst summary still fine', gst && gst.rows.length >= 4, JSON.stringify(gst && gst.rows.map(r => r.ledger)));

// --- delete a voucher keeps its audit log ---
const vid = s1.id;
E.deleteVoucher(co, vid);
const l2 = E.voucherLog(vid);
check('delete logged after removal', l2.length === 3 && l2[2].action === 'delete');
check('stock qty restored after deleting the sale', E.inventoryState(iSteel).qty === 1050, String(E.inventoryState(iSteel).qty)); // 750 + 300 back

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed ? 1 : 0);
