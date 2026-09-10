import { taxRowsFromVoucher, docFromVoucher, invoiceHtml } from '../src/invprint.js';

// ---- fixture: sales voucher detail as served by /api/vouchers/:id ----
const vv = {
  id: 200, class: 'sales', number: 'ONS/PI-200', date: '2026-09-09', ref: 'Virag Vohra',
  voucher_no: 42,
  entries: [
    { account_id: 1, kind: 'SundryDebtor', account_name: 'REFTECH IMPEX', account_address: 'F/620, Sundaram II SV Road Ram Baug Lane\nBehind Vijay Sales Sai Baba Nagar\nBorivali West Mumbai- 400092', account_gstin: '27AKOPD7221N1ZT', debit: 18998000, credit: 0, particulars: 'To Sales', taxable: null },
    { account_id: 2, kind: 'Duty', account_name: 'Output CGST 9%', debit: 0, credit: 1449000, particulars: 'By Output CGST 9%', taxable: 16100000 },
    { account_id: 3, kind: 'Duty', account_name: 'Output SGST 9%', debit: 0, credit: 1449000, particulars: 'By Output SGST 9%', taxable: 16100000 },
  ],
  items: [
    { item_id: 5, item_name: 'CHEMIEBOR - 36 (GRANULAR)', item_hsn: '28401900', unit: 'KGS', qty: 2000, rate: 8050, amount: 16100000 },
  ],
};
const company = {
  name: 'O.N.S. OUTSOURCING SOLUTIONS',
  address: 'T7 Summit, 20th Floor Apt. No. 2001\nJoyville Virar, Stephen Menezes Marg\nBolinj Virar West, Palghar- 401303',
  state: 'Maharashtra', state_code: 27, gstin: '27GOCPM8040A1Z6',
};

const tr = taxRowsFromVoucher(vv);
console.log('taxRows:', JSON.stringify(tr));
if (tr.length !== 2 || tr[0].leg !== 'SGST' || tr[1].leg !== 'CGST' || tr[0].rate !== 9) throw new Error('tax rows wrong');
const doc = docFromVoucher(vv, company);
console.log('doc:', JSON.stringify({ taxable: doc.taxable, taxTotal: doc.taxTotal, total: doc.total, roundOff: doc.roundOff, qtyTotal: doc.qtyTotal, regime: doc.regime }));
if (doc.taxable !== 16100000) throw new Error('taxable');
if (doc.total !== 18998000) throw new Error('total');
if (doc.roundOff !== 0) throw new Error('roundOff should be 0');
if (doc.qtyTotal !== 2000) throw new Error('qty');
if (doc.regime !== 'intra') throw new Error('regime');

const html = invoiceHtml(doc);
// ---- position spot checks (S = 0, css top = y + 1.1 for 10.8pt) ----
const checks = [
  ['Title', 'PROFORMA INVOICE', 'top:22.74pt'],
  ['Taxable label', 'Taxable Value', `top:${(360.46 + 1.1).toFixed(2)}pt`],
  ['SGST row', 'Output SGST', `top:${(413.26 + 1.1).toFixed(2)}pt`],
  ['CGST row', 'Output CGST', `top:${(426.46 + 1.1).toFixed(2)}pt`],
  ['Round Off row', 'Round Off', `top:${(439.66 + 1.1).toFixed(2)}pt`],
  ['Total row', '>Total<', `top:${(492.82 + 1.1).toFixed(2)}pt`],
  ['Words label', 'Amount To Be Paid in Words', `top:${(492.82 + 13.32 + 1.1).toFixed(2)}pt`],
];
for (const [name, txt, top] of checks) {
  const i = html.indexOf(txt);
  if (i < 0) throw new Error('missing: ' + name);
  const seg = html.slice(Math.max(0, i - 140), i + 30);
  if (!seg.includes(top)) throw new Error(`wrong position for ${name}: want ${top}; seg=...${seg.slice(Math.max(0, seg.indexOf('top:')), seg.indexOf('top:') + 30)}`);
}
if (!html.includes('right:29.3pt')) throw new Error('right align 566 expected (595.3-566=29.3)');
// ---- zero round-off must render ₹ at 506.9 + dash at 551.6, no "0.00" ----
const roSeg = html.slice(html.indexOf('Round Off'), html.indexOf('Round Off') + 900);
if (!roSeg.includes('left:506.9pt')) throw new Error('RO zero rupee missing at 506.9');
if (!roSeg.includes('left:551.6pt')) throw new Error('RO zero dash missing at 551.6');
if (roSeg.includes('0.00')) throw new Error('RO must not print a numeric zero');
// ---- inter-state: single IGST at full rate ----
const vv2 = JSON.parse(JSON.stringify(vv));
vv2.entries = [
  { account_id: 1, kind: 'SundryDebtor', account_name: 'ACME', account_address: 'Addr 1', account_gstin: '29ABCDE1234F1Z5', debit: 18998000, credit: 0, particulars: 'To Sales' },
  { account_id: 4, kind: 'Duty', account_name: 'Output IGST 18%', debit: 0, credit: 2898000, particulars: 'By Output IGST 18%', taxable: 16100000 },
];
const doc2 = docFromVoucher(vv2, company);
const html2 = invoiceHtml(doc2);
if (doc2.regime !== 'inter') throw new Error('inter regime');
if (!html2.includes('Output IGST')) throw new Error('IGST row missing');
if (!html2.includes('>18%<')) throw new Error('IGST 18% missing');
if (html2.includes('Output SGST')) throw new Error('intra rows leaked into inter');
// ---- half-rate display ----
const vv3 = JSON.parse(JSON.stringify(vv));
vv3.entries = [
  { account_id: 1, kind: 'SundryDebtor', account_name: 'ACME', account_address: '', account_gstin: '', debit: 1, credit: 0, particulars: 'To Sales' },
  { account_id: 5, kind: 'Duty', account_name: 'Output SGST 2.5%', debit: 0, credit: 250000, particulars: '', taxable: 10000000 },
  { account_id: 6, kind: 'Duty', account_name: 'Output CGST 2.5%', debit: 0, credit: 250000, particulars: '', taxable: 10000000 },
];
vv3.items = [{ item_id: 1, item_name: 'A', item_hsn: '', unit: 'kg', qty: 1000, rate: 10000, amount: 10000000 }];
const h3 = invoiceHtml(docFromVoucher(vv3, company));
if (!h3.includes('>2.5%<')) throw new Error('half rate missing');
// ---- >4 items: table shifts by (R-4)*13.2 ----
const vv4 = JSON.parse(JSON.stringify(vv3));
vv4.items = Array.from({ length: 6 }, (_, i) => ({ item_id: i + 1, item_name: 'Item ' + (i + 1), item_hsn: '', unit: 'kg', qty: 1, rate: 10000, amount: 10000 }));
const d4 = docFromVoucher(vv4, { name: 'X' });
const h4 = invoiceHtml(d4);
const S = Math.max(0, 6 - 4) * 13.2;
const totalTop = (492.82 + S + 1.1).toFixed(2);
const segT = h4.slice(Math.max(0, h4.indexOf('>Total<') - 140), h4.indexOf('>Total<') + 10);
if (!segT.includes(`top:${totalTop}pt`)) throw new Error('shifted Total expected at ' + totalTop + ' got ' + segT);
const sealI = h4.indexOf('/inv/seal.png');
const sealSeg = h4.slice(sealI, sealI + 160);
if (!sealSeg.includes(`top:${(626.75 + S).toFixed(2)}pt`)) throw new Error('seal not shifted');
// ---- whole lower chain must shift by S: words, mini table, para, bank, caption ----
function nthIndexOf(str, sub, n) {
  let idx = -1;
  for (let k = 0; k < n; k++) {
    idx = str.indexOf(sub, idx + 1);
    if (idx < 0) return -1;
  }
  return idx;
}
const shiftChecks = [
  ['Amount To Be Paid in Words', 13.32, 10.8, 1],
  ['Declaration', 40.08, 10.8, 1],
  ['Taxable Value', 40.08, 10.8, 2], // second occurrence is mini header
  ['Customer\'s Seal and Signature', 128.6, 9.6, 1],
];
const cssNum = (n) => String(Math.round(n * 100) / 100); // emitters never print trailing zeros
for (const [txt, off, size, occ] of shiftChecks) {
  const yCss = cssNum(492.82 + S + off + ({ 10.8: 1.1, 9.6: 1.0, 7.2: 0.8 })[size]);
  const i = occ > 1 ? nthIndexOf(h4, txt, occ) : h4.indexOf(txt);
  if (i < 0) throw new Error('missing shifted text: ' + txt);
  const seg = h4.slice(Math.max(0, i - 150), i + 20);
  if (!seg.includes(`top:${yCss}pt`)) throw new Error(`shift check failed for ${txt} (occ ${occ}): want ${yCss}; seg=...${seg.slice(Math.max(0, seg.indexOf('top:')), seg.indexOf('top:') + 40)}`);
}
const bankSeg = h4.slice(h4.indexOf('Name of A/c Holder') - 150, h4.indexOf('Name of A/c Holder') + 10);
const bankTop = cssNum(492.82 + S + 78.1 + 1.0);
if (!bankSeg.includes(`top:${bankTop}pt`)) throw new Error('bank rows not shifted: want ' + bankTop + ' got ' + bankSeg);
// base-case (S=0) Declaration + para spot checks
const baseDecl = html.slice(html.indexOf('Declaration') - 150, html.indexOf('Declaration') + 10);
if (!baseDecl.includes(`top:${cssNum(492.82 + 40.08 + 1.1)}pt`)) throw new Error('Declaration base row wrong: ' + baseDecl);
const paraI = html.indexOf('I/We hereby certify');
const paraSeg = html.slice(Math.max(0, paraI - 150), paraI + 10);
if (!paraSeg.includes(`top:${cssNum(492.82 + 53.52 + 0.8)}pt`)) throw new Error('para line 1 base row wrong: ' + paraSeg);
console.log('shifted Total row top:', totalTop, '| seal top:', (626.75 + S).toFixed(1));
console.log('ALL SMOKE CHECKS PASSED');
