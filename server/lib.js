// Shared server utilities: money (integer paise), dates, misc.
const NF_INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

// ---- money: everything is stored as integer paise ----
export function toPaise(x) {
  if (x === null || x === undefined || x === '') return 0;
  if (typeof x === 'string') x = x.replace(/[,₹\s]/g, '');
  const n = Number(x);
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${x}`);
  return Math.round(n * 100);
}
export function fromPaise(p) {
  return Math.round(Number(p)) / 100;
}
export function fmtPaise(p) {
  const v = Math.round(Number(p || 0));
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
export function fmtINR(p, { decimals = true, symbol = true } = {}) {
  const v = Number(p || 0) / 100;
  const parts = NF_INR.format(Math.abs(v)).split('.');
  const body = parts[0];
  const frac = parts[1] || '00';
  const s = (symbol ? '₹' : '') + (v < 0 ? '-' : '') + body + (decimals ? '.' + frac : '');
  return s;
}
export function roundHalfEven(n) {
  const f = Math.floor(n);
  const diff = n - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// ---- dates ----
export function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
export function validISO(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function fmtDateShort(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d)}-${MON[Number(m)]}-${iso.slice(2, 4)}`;
}
export function fmtDateLong(iso) {
  if (!iso) return '';
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MON[Number(m)]} ${y}`;
}
export function addDaysISO(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function fyEnd(fyStart) {
  return addDaysISO(String(Number(fyStart.slice(0, 4)) + 1) + '-' + fyStart.slice(5), -1);
}

// voucher class meta
export const CLASS_META = {
  receipt:      { label: 'Receipt',    short: 'RC',  txn: 'Receipts' },
  payment:      { label: 'Payment',    short: 'PY',  txn: 'Payments' },
  contra:       { label: 'Contra',     short: 'CT',  txn: 'Contra' },
  sales:        { label: 'Sales',      short: 'SL',  txn: 'Sales' },
  purchase:     { label: 'Purchase',   short: 'PC',  txn: 'Purchases' },
  journal:      { label: 'Journal',    short: 'JR',  txn: 'Journals' },
  stock_journal:{ label: 'Stock Journal', short: 'SJ', txn: 'Stock Journals' },
  debit_note:   { label: 'Debit Note', short: 'DN',  txn: 'Debit Notes' },
  credit_note:  { label: 'Credit Note', short: 'CN', txn: 'Credit Notes' },
};
