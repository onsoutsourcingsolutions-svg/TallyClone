// A4 "PROFORMA INVOICE" print — geometry transcribed from the reference
// PI-200-REFTECH.pdf (O.N.S. OUTSOURCING SOLUTIONS). All units are pt on an
// A4 sheet 595.3 x 841.9, origin top-left. "y" values are pdf.js text-box
// tops measured on the reference (see _invoice/spec.json + text-parts.json).
// Calibri renders its ink ~3.1-3.6 pt below the text-box top, so a small
// optical pad is added (css top = y + pad(size)); pad was calibrated so the
// ink lands exactly where the reference PDF put it.
//
// Below the item table every row is anchored to the measured Total row
// (K = measured offset at S=0). Extra item lines (>4) or extra tax lines
// (>2) insert rows above the total ("Excel insert-row" behaviour): the
// Total row and everything anchored to it moves down by (extra * 13.2).
import { invAmount, invQty, invDate, invWords } from './invnum.js';

export const FONT = "Calibri, 'Segoe UI', Arial, sans-serif";

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const nl = (s) => String(s == null ? '' : s).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const fmtRate = (r) => { const n = num(r); return (Math.round(n * 100) / 100) + '%'; };
const PAD = { 12: 1.4, 10.8: 1.1, 9.6: 1.0, 7.2: 0.8 }; // css top = y + pad
const r2 = (n) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ defaults */
export const INV_DEFAULTS = {
  title: 'PROFORMA INVOICE',
  termsPayment: 'ADVANCE',
  termsDelivery: 'ADVANCE PAYMENT',
  noReturns: 'NO RETURNS OR REFUNDS',
  enquiry: 'FOR FURTHER ENQUIRIES CONTACT US AT 8692881045',
  bankTitle: 'Our Banking Details',
  bankHolder: 'O N S OUTSOURICNG SOLUTIONS',
  bankName: 'INDUSIND BANK',
  bankAcct: '258369270124',
  bankBranch: 'Mahim Mumbai-16 & INDB0001825',
  jurisdiction: 'SUBJECT TO MUMBAI JURISDICTION',
  computerGenerated: 'This is a Computer Generated Invoice',
};

// measured lines of the declaration paragraph (7.2 pt, x14.2, pitch 9.12)
const DECL = [
  '"I/We hereby certify that my/our registration under the relevant laws and bylaws of the Central',
  'Goods and Service Tax Act, 2017 is in force on the date on which the sale of the goods specified',
  'in this TAX INVOICE is made by me/us and that the relevant transaction of sale covered by this',
  'TAX INVOICE has been effected by me/us and it shall be accounted for in the turnover of sales',
  'while filling of return and the due tax, if any, payable on the sale has been paid or shall be paid."',
];
const LATE = [
  'Please ensure payments are completed on time. Interest on late payments will be charged at 21%',
  'p.a. Please ensure that all goods have been checked at the time of delivery. Requests for',
  'damaged/ missing goods will be entertained only if reported 24hrs within receiving delivery.',
];

/* ------------------------------------------------------------------ measured geometry */
const ROW = 13.2;                 // item/table row pitch
const FRAME = { l: 13.5, r: 571, top: 41, bot: 695 };

// column borders (item table + meta grid share them)
const CX = { noR: 33.5, dscL: 33.5, dscR: 217.5, hsnR: 301, qtyR: 393.5, rateR: 447.5, perR: 501, amtR: 571 };
const CEN = {
  no: (13.5 + CX.noR) / 2, dsc: (CX.dscL + CX.dscR) / 2, hsn: (CX.dscR + CX.hsnR) / 2,
  qty: (CX.hsnR + CX.qtyR) / 2, rate: (CX.qtyR + CX.rateR) / 2,
  per: (CX.rateR + CX.perR) / 2, amt: (CX.perR + CX.amtR) / 2,
};
// accounting cells: currency glyph pinned near the cell's left, number right-aligned
const CELL = {
  rateL: 398.6, rateR: 442.2,            // rate column (393.5-447.5)
  amtL: 506.3, amtR: 566.0,              // amount column (501-571)
  miniL: [305.2, 397.7, 451.4, 506.0],
  miniR: [389.0, 442.8, 496.6, 566.5],
};

// measured offsets below the Total row (Total y = 492.82 when S = 0)
const G = {
  item0: 307.42, taxable: 360.46, tax1: 413.26, taxGap: 52.8,
  roSlots: 2, roToTotal: 53.16,           // RO sits roSlots rows under tax1; total = RO + roToTotal
  words: 13.32, wordsVal: 26.76,          // "Amount To Be Paid in Words" rows
  miniHdr: 40.08, miniVal: 53.52,         // Declaration / mini tax table
  para1: 53.52, paraStep: 9.12,           // 8 lines declaration + late payment
  bankTitle: 65.6, bank0: 78.1, bankStep: 12.16,
  caption: 128.6,                         // "Customer's Seal and Signature"
  sealTop: 133.93,                        // lower-right artwork (seal.png)
  hTotal: 0.68, hAfterTotal: 14.18,       // rules 493.5 / 507 relative to Total row
  hMiniHdr: 40.68, hMiniVal: 54.18,       // rules 533.5 / 547
  hMiniBot: 66.68, hCaption: 129.2,       // rules 559.5 (x300-571) / 622
  vTableBot: 13.68,                       // item-table verticals end under Total (506.5)
  vResume: 32.68,                         // x301 vertical resumes at 525.5
  vMini: [39.68, 66.18],                  // mini-table verticals 532.5 -> 559
};

/* ------------------------------------------------------------------ helpers */
/** absolute left-aligned span; o = { size, bold } */
function T(x, y, s, o = {}) {
  const size = o.size || 10.8;
  return `<span style="position:absolute;left:${r2(x)}pt;top:${r2(y + PAD[size])}pt;` +
    `font:${o.bold ? 'bold ' : ''}${size}pt ${FONT};color:#000;white-space:nowrap;">${esc(s)}</span>`;
}
/** centered on cx */
function TC(cx, y, s, o = {}) {
  const size = o.size || 10.8;
  return `<span style="position:absolute;left:${r2(cx)}pt;top:${r2(y + PAD[size])}pt;` +
    `transform:translateX(-50%);font:${o.bold ? 'bold ' : ''}${size}pt ${FONT};color:#000;white-space:nowrap;">${esc(s)}</span>`;
}
/** right edge at rx */
function TR(rx, y, s, o = {}) {
  const size = o.size || 10.8;
  return `<span style="position:absolute;right:${r2(595.3 - rx)}pt;top:${r2(y + PAD[size])}pt;` +
    `font:${o.bold ? 'bold ' : ''}${size}pt ${FONT};color:#000;white-space:nowrap;">${esc(s)}</span>`;
}
/** accounting amount: ₹ at left x, number right-aligned to right edge r */
function MONEY(lx, rx, y, paise, o = {}) {
  const size = o.size || 10.8;
  const v = num(paise);
  if (!v) return '';
  const neg = v < 0;
  const sym = neg ? '-₹' : '₹';
  return `<span style="position:absolute;left:${r2(lx)}pt;top:${r2(y + PAD[size])}pt;` +
    `font:${o.bold ? 'bold ' : ''}${size}pt ${FONT};color:#000;white-space:nowrap;">${sym}</span>` +
    `<span style="position:absolute;right:${r2(595.3 - rx)}pt;top:${r2(y + PAD[size])}pt;` +
    `font:${o.bold ? 'bold ' : ''}${size}pt ${FONT};color:#000;white-space:nowrap;">${invAmount(Math.abs(v), { sym: false })}</span>`;
}
function H(y, x1, x2) {
  return `<div style="position:absolute;left:${r2(x1)}pt;top:${r2(y - 0.5)}pt;width:${r2(x2 - x1)}pt;height:1pt;background:#000;"></div>`;
}
function V(x, y1, y2) {
  return `<div style="position:absolute;left:${r2(x - 0.5)}pt;top:${r2(y1)}pt;width:1pt;height:${r2(y2 - y1)}pt;background:#000;"></div>`;
}

/* ------------------------------------------------------------------ tax rows from the posted voucher */
export function taxRowsFromVoucher(vv) {
  const rows = (vv.entries || [])
    .filter((e) => String(e.account_name || '').startsWith('Output '))
    .map((e) => {
      const m = /^Output (SGST|CGST|IGST) (.+)%$/.exec(String(e.account_name));
      return m
        ? { leg: m[1], rate: Number(m[2]), tax: Math.max(num(e.credit), num(e.debit)), taxable: num(e.taxable) }
        : null;
    }).filter(Boolean);
  const pri = { SGST: 0, CGST: 1, IGST: 2 };
  rows.sort((a, b) => (pri[a.leg] - pri[b.leg]) || (a.rate - b.rate));
  return rows;
}

/* ------------------------------------------------------------------ voucher -> print document */
export function docFromVoucher(vv, company) {
  const items = (vv.items || []).map((it) => ({
    name: it.item_name || '',
    hsn: it.item_hsn != null && it.item_hsn !== '' ? String(it.item_hsn) : '',
    qty: num(it.qty), unit: it.unit || '', rate: num(it.rate), amount: num(it.amount),
  }));
  const taxRows = taxRowsFromVoucher(vv);
  const taxable = items.reduce((s, x) => s + x.amount, 0);
  const rawTotal = taxable + taxRows.reduce((s, r) => s + r.tax, 0);
  const total = Math.round(rawTotal / 100) * 100;      // whole rupees, Excel style
  const roundOff = total - rawTotal;                   // paise adjustment row
  const pKind = (vv.class === 'sales' || vv.class === 'credit_note') ? 'SundryDebtor' : 'SundryCreditor';
  const party = (vv.entries || []).find((e) => e.kind === pKind) || (vv.entries || [])[0] || {};
  const city = (company && company.city) || '';
  const compAddr = [
    (company && company.address) || '',
    city ? `${city}${company && company.pincode ? ' - ' + company.pincode : ''}` : '',
  ].filter(Boolean).join('\n');
  return {
    cfg: {},
    kind: vv.class,
    number: vv.number || ('#' + vv.voucher_no),
    date: vv.date || '',
    ref: vv.ref || '',
    refDate: vv.ref_date || '',
    regime: taxRows.some((r) => r.leg === 'IGST') ? 'inter' : 'intra',
    company: {
      name: (company && company.name) || '',
      address: compAddr,
      state: (company && company.state) || '',
      stateCode: company && company.state_code != null ? String(company.state_code) : '',
      gstin: (company && company.gstin) || '',
      logo: (company && company.logo) || null,
    },
    party: {
      name: party.account_name || '',
      address: party.account_address || '',
      gstin: party.account_gstin || '',
    },
    items, taxRows,
    taxable, taxTotal: taxRows.reduce((s, r) => s + r.tax, 0),
    total, roundOff, qtyTotal: items.reduce((s, x) => s + x.qty, 0),
  };
}

/* ------------------------------------------------------------------ html */
export function invoiceHtml(doc) {
  const cfg = { ...INV_DEFAULTS, ...((doc && doc.cfg) || {}) };
  const co = (doc && doc.company) || {};
  const party = (doc && doc.party) || {};
  const items = (doc && doc.items) || [];
  const taxRows = (doc && doc.taxRows) || [];

  const R = items.length;                                   // item lines
  const N = taxRows.length;                                 // tax lines
  const S = Math.max(0, R - 4) * ROW + Math.max(0, N - 2) * ROW;

  // row chain (S = 0 reproduces the reference exactly)
  const yTaxable = G.taxable + Math.max(0, R - 4) * ROW;
  const yRO = G.tax1 + Math.max(0, R - 4) * ROW + Math.max(N, G.roSlots) * ROW;
  const yTotal = yRO + G.roToTotal;                         // 492.82 + S at the reference
  const Y = (k) => yTotal + k;                              // everything below Total

  const out = [];
  const q = (s) => out.push(s);

  q(`<div style="position:relative;width:595.3pt;min-height:841.9pt;background:#fff;font-family:${FONT};">`);
  // outer frame (fixed page rectangle) — 1pt border centered on FRAME edges
  q(`<div style="position:absolute;left:${r2(FRAME.l - 0.5)}pt;top:${r2(FRAME.top - 0.5)}pt;` +
    `width:${r2(FRAME.r - FRAME.l + 1)}pt;height:${r2(FRAME.bot - FRAME.top + 1)}pt;border:1pt solid #000;"></div>`);

  /* ---- title (above the frame) ---- */
  q(T(206.8, 21.34, cfg.title, { size: 12, bold: true }));

  /* ---- top-left company block ---- */
  q(T(14.6, 40.78, co.name));
  [53.98, 67.54, 80.74].forEach((y, i) => q(T(14.6, y, (nl(co.address) || [])[i] || '')));
  q(T(14.6, 94.30, co.state ? `State:- ${co.state}${co.stateCode ? `, Code :- ${co.stateCode}` : ''}` : ''));
  q(T(14.6, 107.50, co.gstin ? `GST- ${co.gstin}` : ''));

  /* ---- top-right meta grid (labels; values one row below each label) ---- */
  const meta = [
    { y: 40.78, c1: 'Invoice No.', v1: doc.number || '', c2: 'Dated', v2: invDate(doc.date) },
    { y: 67.54, c1: 'Delivery Note', v1: '', c2: 'Terms of Payment', v2: cfg.termsPayment },
    { y: 94.30, c1: 'Reference By', v1: doc.ref || '', c2: 'Dated', v2: doc.refDate ? invDate(doc.refDate) : '' },
  ];
  meta.forEach((m) => {
    q(T(218.6, m.y, m.c1)); q(T(302.3, m.y, m.c2));
    q(T(218.6, m.y + 13.2, m.v1)); q(T(302.3, m.y + 13.2, m.v2));
  });

  /* ---- crest artwork (top-right cell) ---- */
  q(`<img src="${co.logo ? '/api/company/logo' : '/inv/crest.png'}" style="position:absolute;left:407.9pt;top:44.6pt;width:148.3pt;height:122.4pt;"/>`);

  /* ---- party band ---- */
  q(T(14.6, 121.06, 'Buyer Bill (Bill To)'));
  q(T(14.6, 134.26, party.name, { bold: true }));
  [147.82, 160.78, 174.34].forEach((y, i) => q(T(14.6, y, (nl(party.address) || [])[i] || '')));
  q(T(14.6, 187.54, party.gstin ? `GST- ${party.gstin}` : ''));
  q(T(218.6, 121.06, 'Dispatch Doc.No. Delivery Note Date'));
  q(T(218.6, 147.82, 'Dispatched via'));
  q(T(302.3, 147.82, 'Destination'));
  q(T(218.6, 174.34, 'Terms of Delivery'));
  q(T(218.6, 201.10, cfg.termsDelivery));
  q(T(218.6, 214.54, cfg.noReturns));
  q(T(218.6, 227.50, cfg.enquiry));
  q(T(14.6, 201.10, 'Consignee (Ship To)'));
  q(T(14.6, 214.54, party.name, { bold: true }));
  [227.50, 240.70, 253.90].forEach((y, i) => q(T(14.6, y, (nl(party.address) || [])[i] || '')));
  q(T(14.6, 267.10, party.gstin ? `GST- ${party.gstin}` : ''));

  /* ---- item table header ---- */
  const hdr = [
    ['No.', CEN.no], ['Description of Goods', CEN.dsc], ['HSN/SAC', CEN.hsn],
    ['Quantity', CEN.qty], ['Rate', CEN.rate], ['per', CEN.per], ['Amount', CEN.amt],
  ];
  hdr.forEach(([s, cx]) => q(TC(cx, 280.66, s)));

  /* ---- item rows (one line per item) ---- */
  items.forEach((it, i) => {
    const y = G.item0 + i * ROW;
    q(TC(CEN.no, y, String(i + 1)));
    q(TC(CEN.dsc, y, it.name));
    if (it.hsn) q(TC(CEN.hsn, y, it.hsn));
    q(TC(CEN.qty, y, invQty(it.qty)));
    if (it.unit) q(TC(CEN.per, y, String(it.unit).toUpperCase()));
    q(MONEY(CELL.rateL, CELL.rateR, y, it.rate));
    q(MONEY(CELL.amtL, CELL.amtR, y, it.amount));
  });

  /* ---- taxable / tax rows / round off / total ---- */
  q(TR(214.8, yTaxable, 'Taxable Value'));
  q(MONEY(CELL.amtL, CELL.amtR, yTaxable, doc.taxable));
  taxRows.forEach((t, i) => {
    const y = yTaxable + G.taxGap + i * ROW;
    q(TR(214.8, y, `Output ${t.leg}`));
    q(TC(CEN.rate, y, fmtRate(t.rate)));
    q(MONEY(CELL.amtL, CELL.amtR, y, t.tax));
  });
  q(TR(214.8, yRO, 'Round Off'));
  if (num(doc.roundOff) === 0) { q(T(506.9, yRO, '₹')); q(T(551.6, yRO, '-')); }
  else q(MONEY(CELL.amtL, CELL.amtR, yRO, doc.roundOff));
  q(TR(214.8, yTotal, 'Total', { bold: true }));
  q(TC(CEN.qty, yTotal, invQty(doc.qtyTotal), { bold: true }));
  q(MONEY(CELL.amtL, CELL.amtR, yTotal, doc.total, { bold: true }));

  /* ---- amount in words ---- */
  q(T(14.6, Y(G.words), 'Amount To Be Paid in Words'));
  q(TR(566.7, Y(G.words), 'E.O.E'));
  q(T(14.6, Y(G.wordsVal), invWords(doc.total), { bold: true }));

  /* ---- mini tax table + declaration heading ---- */
  q(T(14.6, Y(G.miniHdr), 'Declaration', { bold: true }));
  [['Taxable Value', 347.25], ['SGST', 420.5], ['CGST', 474.25], ['Total Tax', 536]]
    .forEach(([s, cx]) => q(TC(cx, Y(G.miniHdr), s, { bold: true })));
  const miniV = [
    doc.taxable,
    taxRows.filter((t) => t.leg === 'SGST').reduce((s, t) => s + t.tax, 0),
    taxRows.filter((t) => t.leg === 'CGST').reduce((s, t) => s + t.tax, 0),
    taxRows.reduce((s, t) => s + t.tax, 0),
  ];
  miniV.forEach((v, i) => {
    if (num(v)) q(MONEY(CELL.miniL[i], CELL.miniR[i], Y(G.miniVal), v, { size: 9.6 }));
    else { q(T(CELL.miniL[i], Y(G.miniVal), '₹', { size: 9.6 })); q(TR(CELL.miniR[i], Y(G.miniVal), '-', { size: 9.6 })); }
  });

  /* ---- declaration + late-payment paragraph (8 lines, left column) ---- */
  [...DECL, ...LATE].forEach((ln, i) => q(T(14.2, Y(G.para1) + i * G.paraStep, ln, { size: 7.2 })));

  /* ---- banking block ---- */
  q(T(302.0, Y(G.bankTitle), cfg.bankTitle, { size: 9.6 }));
  [
    ['Name of A/c Holder- ', cfg.bankHolder],
    ['Name of the Bank- ', cfg.bankName],
    ['Current A/c No.- ', cfg.bankAcct],
    ['Branch & IFSC Code- ', cfg.bankBranch],
  ].forEach(([label, val], i) => {
    if (val) q(T(302.0, Y(G.bank0) + i * G.bankStep, label + val, { size: 9.6 }));
  });

  /* ---- caption + lower-right artwork ---- */
  q(T(93.8, Y(G.caption), "Customer's Seal and Signature", { size: 9.6 }));
  q(`<img src="/inv/seal.png" style="position:absolute;left:342.9pt;top:${r2(Y(G.sealTop))}pt;width:193.7pt;height:61.9pt;"/>`);

  /* ---- footer (below the frame) ---- */
  q(T(222.4, 706.30, cfg.jurisdiction, { size: 9.6 }));
  q(T(232.2, 718.42, cfg.computerGenerated, { size: 9.6 }));

  /* ---- grid rules ---- */
  // upper grid (fixed)
  q(H(68, 216, 393.5)); q(H(94.5, 216, 393.5));
  q(H(121.5, 13.5, 393.5)); q(H(148.5, 216, 393.5)); q(H(175, 216, 571));
  q(H(202, 13.5, 217)); q(H(281.5, 13.5, 571)); q(H(295, 13.5, 571));
  // upper verticals (fixed)
  q(V(217.5, 40, Y(G.vTableBot)));       // 40 -> 506.5 (+S)
  q(V(301, 40, 174.5)); q(V(393.5, 40, 174.5));
  // item-table verticals (bottom follows Total)
  [33.5, 217.5, 301, 393.5, 447.5, 501].forEach((x) => {
    if (x !== 217.5) q(V(x, 280.5, Y(G.vTableBot)));
  });
  // lower zone verticals (mini table + bank divider)
  q(V(301, Y(G.vResume), 694.5));        // resumes below the words row
  [393.5, 447.5, 501].forEach((x) => q(V(x, Y(G.vMini[0]), Y(G.vMini[1]))));
  // lower horizontals (follow the Total row)
  q(H(Y(G.hTotal), 13.5, 571)); q(H(Y(G.hAfterTotal), 13.5, 571));
  q(H(Y(G.hMiniHdr), 13.5, 571)); q(H(Y(G.hMiniVal), 13.5, 571));
  q(H(Y(G.hMiniBot), 300, 571));
  q(H(Y(G.hCaption), 13.5, 571));

  q('</div>');
  return out.join('\n');
}

/* ------------------------------------------------------------------ css / print */
export function printStyle() {
  return `@page { size: A4 portrait; margin: 0; }
html, body { margin: 0; padding: 0; }
.hint { font: 11px/1.5 Arial; color: #777; padding: 10px 14px; }
@media print { .hint { display: none; } }`;
}

export function openInvoicePrint(title, html) {
  const w = window.open('', '_blank', 'width=960,height=1280');
  if (!w) { alert('Please allow pop-ups to print the invoice.'); return null; }
  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>${printStyle()}</style></head><body>
<div class="hint">Print dialog → Save as PDF · Paper A4 · Margins: <b>None</b> · Scale 100 · uncheck Headers &amp; footers.</div>
${html}
<script>window.onload = function(){ setTimeout(function(){ window.focus(); window.print(); }, 400); };</script>
</body></html>`);
  w.document.close();
  return w;
}
