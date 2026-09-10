// Number/date formatting helpers for the printable invoice sheet.
// Amounts travel as integer paise; formats mirror the reference invoice PDF
// (Indian grouping, ₹ symbol, dd-mm-yyyy dates, amount in words).

const NF = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export function invAmount(p, { sym = true, dec = true } = {}) {
  const v = Number(p || 0) / 100;
  const neg = v < 0;
  const s = NF.format(Math.abs(v));
  const [a, f = ''] = s.split('.');
  const body = a + (dec ? (f ? '.' + f : '.00') : '');
  return (neg ? '-' : '') + (sym ? '₹' : '') + body;
}

export function invQty(n) {
  const v = Number(n || 0);
  const s = NF.format(Math.abs(v));
  return (v < 0 ? '-' : '') + s;
}

export function invDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return String(iso);
  return `${d}-${m}-${y}`;
}

/* ---------- amount in words (Indian system) ---------- */
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function two(n) {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? t + ' ' + o : t;
}
function three(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (!h) return r ? two(r) : '';
  return ONES[h] + ' Hundred' + (r ? ' and ' + two(r) : '');
}
function wordsFor(whole) {
  if (whole === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(whole / 10000000);
  whole %= 10000000;
  const lakh = Math.floor(whole / 100000);
  whole %= 100000;
  const thousand = Math.floor(whole / 1000);
  whole %= 1000;
  if (crore) parts.push(two(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lac');
  if (thousand) parts.push(two(thousand) + ' Thousand');
  if (whole) parts.push(three(whole));
  return parts.join(' ');
}

/** paise amount -> "Rupees One Lac Eighty Nine Thousand Nine Hundred and Eighty Only" */
export function invWords(paise) {
  const v = Math.round(Number(paise || 0));
  const neg = v < 0;
  const abs = Math.abs(v);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const pre = neg ? 'Minus ' : '';
  if (!abs) return 'Rupees Zero Only';
  if (!frac) return `Rupees ${pre}${wordsFor(whole)} Only`;
  const w = wordsFor(whole);
  const f = two(frac);
  const mid = w ? `and ${f} Paise` : `${f} Paise`;
  return `Rupees ${pre}${w ? w + ' ' : ''}${mid} Only`;
}
