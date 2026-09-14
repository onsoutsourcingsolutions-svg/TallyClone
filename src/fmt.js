// client-side formatting: amounts travel as integer paise from the API
const NF = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export function inr(p, { sym = true, dec = true } = {}) {
  const v = Number(p || 0) / 100;
  const neg = v < 0;
  const s = NF.format(Math.abs(v));
  const [a, f = ''] = s.split('.');
  const body = a + (dec ? (f ? '.' + f : '.00') : '');
  return (neg ? '-' : '') + (sym ? '₹' : '') + body;
}
export function qty(n) { return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 }); }
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function ddMMyyyy(iso) {
  if (!iso) return '';
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return String(iso);
  return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
}
export function dshort(iso) {
  return ddMMyyyy(iso);
}
export function dlong(iso) {
  return ddMMyyyy(iso);
}
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fyStartFromDate(iso) {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return (m >= 4 ? y : y - 1) + '-04-01';
}
export const CLASSES = {
  receipt: { label: 'Receipt', short: 'RC' },
  payment: { label: 'Payment', short: 'PY' },
  contra: { label: 'Contra', short: 'CT' },
  sales: { label: 'Sales', short: 'SL' },
  purchase: { label: 'Purchase', short: 'PC' },
  journal: { label: 'Journal', short: 'JR' },
  credit_note: { label: 'Credit Note', short: 'CN' },
  debit_note: { label: 'Debit Note', short: 'DN' },
  stock_journal: { label: 'Stock Journal', short: 'SJ' },
};
export const STATE_CODES = {
  'Andaman & Nicobar': '35', 'Andhra Pradesh': '37', 'Arunachal Pradesh': '12', 'Assam': '18',
  'Bihar': '10', 'Chandigarh': '04', 'Chhattisgarh': '22', 'Dadra & Nagar Haveli and Daman & Diu': '26',
  'Delhi': '07', 'Goa': '30', 'Gujarat': '24', 'Haryana': '06', 'Himachal Pradesh': '02',
  'Jammu & Kashmir': '01', 'Jharkhand': '20', 'Karnataka': '29', 'Kerala': '32',
  'Ladakh': '38', 'Lakshadweep': '31', 'Madhya Pradesh': '23', 'Maharashtra': '27',
  'Manipur': '14', 'Meghalaya': '17', 'Mizoram': '15', 'Nagaland': '13', 'Odisha': '21',
  'Puducherry': '34', 'Punjab': '03', 'Rajasthan': '08', 'Sikkim': '11', 'Tamil Nadu': '33',
  'Telangana': '36', 'Tripura': '16', 'Uttar Pradesh': '09', 'Uttarakhand': '05', 'West Bengal': '19',
};
