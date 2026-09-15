import { useEffect, useMemo, useState } from 'react';
import { api, useApp } from '../state.jsx';
import { CompanyBrand } from '../brand.jsx';
import { CLASSES, dshort, inr, todayISO } from '../fmt.js';
import { SalesExcelPanel } from './SalesExcel.jsx';

/* ---------- helpers ---------- */
function rs2p(s) { return Math.round((Number(s) || 0) * 100); }
function halfEven(n) { const f = Math.floor(n); const d = n - f; return d > .5 ? f + 1 : d < .5 ? f : (f % 2 === 0 ? f : f + 1); }
function Err({ e }) { return e ? <div className="errbox">{e}</div> : null; }
const cmeta = (cls) => CLASSES[cls] || { label: cls };

/* ---------- modal ---------- */
export function Modal({ onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="portal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="box" style={{ borderColor: 'var(--gold)', maxWidth: wide ? 1000 : 680, width: '100%' }}>
        <div style={{ textAlign: 'right', marginBottom: 6 }} className="no-print">
          <button className="btn ghost sm" onClick={onClose}>✕ Close (Esc)</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- view voucher + edit-log audit ---------- */
export function VoucherModal({ voucherId, onClose, onDeleted, onEdit }) {
  const { notify, company } = useApp();
  const [v, setV] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api('/vouchers/' + voucherId).then((j) => setV(j)).catch((e) => { setErr(e.message); setV(false); });
  useEffect(() => { load(); }, [voucherId]);
  const del = async () => {
    if (!window.confirm('Delete this voucher? This cannot be undone.')) return;
    try { await api('/vouchers/' + voucherId, { method: 'DELETE' }); notify('Voucher deleted'); onDeleted && onDeleted(); onClose(); }
    catch (e) { notify(e.message); }
  };
  if (err) return <Modal onClose={onClose}><div className="errbox">{err}</div></Modal>;
  if (!v || !v.voucher) return <Modal onClose={onClose}><div className="empty">Loading voucher…</div></Modal>;
  const vc = v.voucher;
  const cmeta2 = cmeta(vc.class);
  let dr = 0, cr = 0;
  vc.entries.forEach((e) => { dr += e.debit; cr += e.credit; });
  return (
    <Modal onClose={onClose} wide>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }} className="no-print-hide">
        {company && <CompanyBrand company={company} compact />}
      </div>
      <div className="report-head">
        <div className="h1">{cmeta2.label} Voucher</div>
        <div className="h2">No. {vc.number || ('#' + vc.voucher_no)} · {dshort(vc.date)}{vc.ref ? ' · Ref: ' + vc.ref : ''}</div>
        {vc.narration && <div className="h2">“{vc.narration}”</div>}
      </div>
      {vc.items && vc.items.length > 0 && (
        <table className="grid" style={{ margin: '12px 0' }}>
          <thead><tr><th>Item</th><th className="tright">Qty</th><th className="tright">Rate</th><th className="tright">Amount</th></tr></thead>
          <tbody>
            {vc.items.map((it, i) => (
              <tr key={i}><td>{it.item_name} <span className="badge">{it.direction === 'in' ? 'IN' : 'OUT'}</span></td><td className="tright num">{it.qty}</td><td className="tright num">{inr(it.rate)}</td><td className="tright num">{inr(it.amount)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <table className="grid">
        <thead><tr><th>Account</th><th>Particulars</th><th className="tright">Debit</th><th className="tright">Credit</th></tr></thead>
        <tbody>
          {vc.entries.map((e, i) => (
            <tr key={i}>
              <td>{e.account_name}{e.is_stock ? <span className="tag">stock</span> : ''}</td>
              <td className="muted">{e.particulars}</td>
              <td className="tright num">{e.debit ? inr(e.debit) : ''}</td>
              <td className="tright num">{e.credit ? inr(e.credit) : ''}</td>
            </tr>
          ))}
          <tr className="gtotal"><td colSpan={2} className="tbold">Total</td><td className="tright num">{inr(dr)}</td><td className="tright num">{inr(cr)}</td></tr>
        </tbody>
      </table>
      {(v.log || []).length > 0 && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--gold-line-soft)', paddingTop: 8 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: 'var(--ink-faint)' }}>Edit log (audit trail)</div>
          {v.log.map((l, i) => (
            <div key={i} className="muted" style={{ fontSize: 12, marginTop: 3 }}>
              <b style={{ color: l.action === 'delete' ? '#e0a06b' : 'var(--gold)' }}>{l.action.toUpperCase()}</b> on {l.at}
              {l.action === 'edit' && ' (old version archived in audit trail)'}
            </div>
          ))}
        </div>
      )}
      <div className="no-print" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, flexWrap: 'wrap' }}>
        {vc.class === 'sales'
          ? <button className="btn" onClick={() => {
              import('../invprint.js').then((m) => {
                const d = m.docFromVoucher(vc, company);
                m.openInvoicePrint(`${d.number} · Proforma Invoice`, m.invoiceHtml(d));
              }).catch((e) => notify(e.message));
            }}>🖨 Invoice print</button>
          : <button className="btn" onClick={() => window.print()}>🖨 Print</button>}
        {onEdit && <button className="btn" onClick={() => { onEdit(v.voucher); onClose(); }}>✎ Edit voucher</button>}
        <button className="btn danger" onClick={del}>Delete voucher</button>
      </div>
    </Modal>
  );
}

/* ---------- generic (simple ledger-line) editor ---------- */
function GenericEditor({ cls, accounts, editing, onSaved }) {
  const { notify } = useApp();
  const accMap = useMemo(() => { const m = {}; accounts.forEach((a) => { m[a.name.toLowerCase()] = a; }); return m; }, [accounts]);
  const listId = 'acclist-' + cls;
  const toRows = (v) => {
    if (!v) return [{ acc: '', dr: '', cr: '', part: '' }];
    const rows = (v.entries || []).map((e) => ({ acc: e.account_name, dr: e.debit ? e.debit / 100 : '', cr: e.credit ? e.credit / 100 : '', part: e.particulars || '' }));
    return rows.length ? rows : [{ acc: '', dr: '', cr: '', part: '' }];
  };
  const [rows, setRows] = useState(() => toRows(editing));
  const [date, setDate] = useState(editing ? editing.date : todayISO());
  const [narration, setNarration] = useState(editing ? editing.narration : '');
  const [num, setNum] = useState(editing ? editing.number : '');
  const [ref, setRef] = useState(editing ? editing.ref : '');
  const [err, setErr] = useState('');
  const add = () => setRows([...rows, { acc: '', dr: '', cr: '', part: '' }]);
  const totals = rows.reduce((s, r) => ({ dr: s.dr + rs2p(r.dr), cr: s.cr + rs2p(r.cr) }), { dr: 0, cr: 0 });
  const save = async () => {
    setErr('');
    const entries = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.acc && !r.dr && !r.cr) continue;
      const a = accMap[r.acc.trim().toLowerCase()];
      if (!a) return setErr(`Line ${i + 1}: unknown ledger “${r.acc}”. Pick from the list.`);
      entries.push({ account_id: a.id, debit: r.dr || 0, credit: r.cr || 0, particulars: r.part });
    }
    try {
      const body = { class: cls, date, narration, number: num, ref, entries };
      const j = editing
        ? await api('/vouchers/' + editing.id, { method: 'PATCH', body })
        : await api('/vouchers', { body });
      notify((editing ? 'Updated' : 'Saved') + ' ' + cmeta(cls).label + ' ✓');
      onSaved && onSaved(j.voucher);
      if (!editing) { setRows([{ acc: '', dr: '', cr: '', part: '' }]); setNarration(''); setNum(''); setRef(''); }
    } catch (e) { setErr(e.message); }
  };
  return (
    <div className="card">
      {editing && <h3>Edit {cmeta(cls).label} #{editing.voucher_no} <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>(save = new version; old version kept in Edit Log)</span></h3>}
      <Err e={err} />
      <div className="frow" style={{ marginBottom: 10 }}>
        <label className="f" style={{ maxWidth: 170 }}><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f" style={{ maxWidth: 170 }}><span>Voucher no. (optional)</span><input value={num} onChange={(e) => setNum(e.target.value)} /></label>
        <label className="f" style={{ maxWidth: 170 }}><span>Ref (optional)</span><input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <label className="f" style={{ minWidth: 220 }}><span>Narration</span><input value={narration} onChange={(e) => setNarration(e.target.value)} /></label>
      </div>
      <datalist id={listId}>
        {accounts.map((a) => <option key={a.id} value={a.name} />)}
      </datalist>
      <div className="lines">
        <div className="lrow" style={{ color: 'var(--ink-faint)', fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' }}>
          <div>Account</div><div className="tright">Debit</div><div className="tright">Credit</div><div>Particulars</div><div></div>
        </div>
        {rows.map((r, i) => (
          <div className="lrow" key={i}>
            <input list={listId} value={r.acc} placeholder="Account / ledger" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, acc: e.target.value } : x)))} />
            <input className="num" placeholder="Debit" value={r.dr} inputMode="decimal" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, dr: e.target.value } : x)))} />
            <input className="num" placeholder="Credit" value={r.cr} inputMode="decimal" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, cr: e.target.value } : x)))} />
            <input placeholder="Particulars" value={r.part} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, part: e.target.value } : x)))} />
            <button className="minus" onClick={() => setRows(rows.filter((_, j) => j !== i))}>−</button>
          </div>
        ))}
        <button className="btn ghost sm" onClick={add}>+ Add line</button>
      </div>
      <div className="vfooter">
        <span className="muted" style={{ fontSize: 12 }}>{hintFor(cls)}</span>
        <span className="tot">
          <div className="lbl">Dr {inr(totals.dr)} · Cr {inr(totals.cr)}</div>
          <div className={`amt ${totals.dr === totals.cr && totals.dr > 0 ? 'okdiff' : 'baddiff'}`}>
            {totals.dr === totals.cr ? (totals.dr ? 'Balanced ✓' : '—') : 'Diff ' + inr(Math.abs(totals.dr - totals.cr))}
          </div>
        </span>
        <button className="btn" onClick={save}>{editing ? 'Update' : 'Save ' + cmeta(cls).label}</button>
      </div>
    </div>
  );
}

function hintFor(cls) {
  const h = {
    receipt: 'Dr: Bank/Cash · Cr: party or income (e.g. advance received)',
    payment: 'Dr: party or expense · Cr: Bank/Cash',
    contra: 'Dr: Bank or Cash · Cr: Bank or Cash',
    journal: 'Any adjustment — Dr and Cr sides must be equal',
    credit_note: 'Sales return without stock: Dr Sales & output GST · Cr party',
    debit_note: 'Purchase return without stock: Dr party · Cr Purchase/expense & input GST',
  };
  return h[cls] || '';
}

/* ---------- invoice editor (sales / purchase / credit note / debit note) ---------- */
function partyKindOf(cls) {
  return { sales: 'SundryDebtor', credit_note: 'SundryDebtor', purchase: 'SundryCreditor', debit_note: 'SundryCreditor' }[cls];
}
function isSalesSide(cls) { return cls === 'sales' || cls === 'credit_note'; }

export function InvoiceEditor({ cls, accounts, items, editing, onSaved }) {
  const { company, notify } = useApp();
  const kind = partyKindOf(cls);
  const partyOpts = accounts.filter((a) => a.kind === kind || a.kind === 'Cash' || a.kind === 'Bank' || a.group_code === 'sundry_debtors' || a.group_code === 'sundry_creditors');
  const itemOpts = items.filter((it) => !it.is_service);
  const listP = 'partylist-' + cls + (editing ? editing.id : 'new'), listI = 'itemlist-' + cls + (editing ? editing.id : 'new');
  const partyMap = useMemo(() => { const m = {}; partyOpts.forEach((a) => { m[a.name.toLowerCase()] = a; }); return m; }, [partyOpts]);
  const itemMap = useMemo(() => { const m = {}; itemOpts.forEach((it) => { m[it.name.toLowerCase()] = it; }); return m; }, [itemOpts]);
  const [detailItem, setDetailItem] = useState(null);
  const [viewVoucherId, setViewVoucherId] = useState(null);

  const initFrom = (v) => {
    if (!v) {
      return {
        date: todayISO(), num: '', party: '', narration: '', ref: '',
        regime: (company.extras && company.extras.tax_regime_default) || 'intra',
        invoice_type: 'tax_invoice',
        rows: [{ name: '', qty: '1', rate: '', gst: '' }],
      };
    }
    const entry = (v.entries || []).find((e) => ['SundryDebtor', 'SundryCreditor'].includes(e.kind)) || (v.entries || [])[0];
    const hasIGST = (v.entries || []).some((e) => /IGST/.test(e.account_name || ''));
    const invTypeRaw = String(v.invoice_type || 'tax_invoice').toLowerCase();
    const mapped = (v.items || []).map((it) => {
      // v1.11.50 FIX: Rate display with 3-4 decimals — compute from amount/qty for accuracy (0.068*200000=13600, not 14000)
      const qty = Number(it.qty) || 0;
      const amt = Number(it.amount) || 0; // paise
      const rateFromAmt = qty > 0 ? (amt / qty / 100) : (it.rate / 100);
      const rateStr = Number.isFinite(rateFromAmt) ? String(Number(rateFromAmt.toFixed(4))) : String(it.rate / 100);
      return { name: it.item_name, qty: String(it.qty), rate: rateStr, gst: it.item_gst_rate != null ? String(it.item_gst_rate) : '' };
    });
    return {
      date: v.date, num: v.number, party: entry ? entry.account_name : '', narration: v.narration, ref: v.ref,
      regime: hasIGST ? 'inter' : 'intra',
      invoice_type: invTypeRaw === 'proforma' || String(v.number||'').toUpperCase().startsWith('PI-') ? 'proforma' : 'tax_invoice',
      rows: mapped.length ? mapped : [{ name: '', qty: '1', rate: '', gst: '' }],
    };
  };
  const init = initFrom(editing);
  const [date, setDate] = useState(init.date);
  const [num, setNum] = useState(init.num);
  const [party, setParty] = useState(init.party);
  const [narration, setNarration] = useState(init.narration);
  const [ref, setRef] = useState(init.ref);
  const [regime, setRegime] = useState(init.regime);
  const [invoiceType, setInvoiceType] = useState(init.invoice_type || 'tax_invoice');
  const [rows, setRows] = useState(init.rows);
  const [err, setErr] = useState('');

  // auto-detect proforma from number PI- prefix + GST regime from debtor GSTIN vs company state (default 18% = 9+9)
  useEffect(() => {
    const up = String(num || '').toUpperCase();
    if (up.startsWith('PI-') || up.startsWith('PI/') || up.includes('PROFORMA')) {
      if (invoiceType === 'tax_invoice') setInvoiceType('proforma');
    }
  }, [num]);

  // v1.11.53 FIX: GST auto-calculated, default 18% or 9+9% based on debtor — intra if same state else inter
  useEffect(() => {
    if (!party) return;
    const acc = partyMap[party.trim().toLowerCase()];
    if (!acc) return;
    // GSTIN first 2 digits = state code
    const compState = String(company.state_code || company.extras?.state_code || '').padStart(2,'0');
    let partyState = '';
    if (acc.gstin && String(acc.gstin).length >= 2) {
      partyState = String(acc.gstin).slice(0,2);
    } else if (acc.state_code) {
      partyState = String(acc.state_code).padStart(2,'0');
    }
    if (compState && partyState) {
      if (compState === partyState) {
        if (regime !== 'intra') setRegime('intra');
      } else {
        if (regime !== 'inter') setRegime('inter');
      }
    }
    // If no GSTIN, keep existing regime but default to intra (9+9)
  }, [party]);

  const compute = () => {
    let taxable = 0;
    const tax = { CGST: 0, SGST: 0, IGST: 0 };
    const details = [];
    rows.forEach((r) => {
      const it = itemMap[r.name.trim().toLowerCase()];
      // v1.11.53 FIX: GST auto-calculated default 18% or 9+9% based on debtor — taxable qty*rate, GST auto
      const qty = Number(r.qty || 0);
      const rate = Number(r.rate || 0);
      const p = Math.round(qty * rate * 100); // paise
      taxable += p;
      // GST% override > item master > default 18% (9+9)
      let g = 18;
      if (r.gst !== '' && r.gst != null) {
        g = Number(r.gst);
      } else if (it && it.gst_rate != null && Number(it.gst_rate) > 0) {
        g = Number(it.gst_rate);
      } else {
        g = 18; // default 18% = 9+9
      }
      if (g > 0 && p > 0) {
        if (regime === 'intra') {
          const t = Math.round(p * g / 100);
          const a = halfEven(t / 2);
          tax.CGST += a; tax.SGST += t - a;
          details.push({ qty, rate, gst: g, taxable: p, cgst: a, sgst: t-a, igst: 0, total: p+t });
        } else {
          const t = Math.round(p * g / 100);
          tax.IGST += t;
          details.push({ qty, rate, gst: g, taxable: p, cgst: 0, sgst: 0, igst: t, total: p+t });
        }
      } else if (p>0) {
        details.push({ qty, rate, gst: g, taxable: p, cgst: 0, sgst: 0, igst: 0, total: p });
      }
    });
    const totalTax = tax.CGST + tax.SGST + tax.IGST;
    return { taxable, tax, total: taxable + totalTax, details };
  };
  const sum = compute();

  const save = async () => {
    setErr('');
    const partyAcc = partyMap[party.trim().toLowerCase()];
    if (!partyAcc) return setErr('Choose the party account (debtor / creditor / cash / bank).');
    const items2 = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.name.trim() && !r.rate && !r.qty) continue;
      const it = itemMap[r.name.trim().toLowerCase()];
      if (!it) return setErr(`Line ${i + 1}: unknown item “${r.name}”. Pick from the list.`);
      if (!(Number(r.qty) > 0)) return setErr(`Line ${i + 1}: quantity must be positive.`);
      if (!(Number(r.rate) > 0)) return setErr(`Line ${i + 1}: enter rate.`);
      const gstOverride = r.gst !== '' && r.gst != null ? Number(r.gst) : undefined;
      if (gstOverride != null && (gstOverride < 0 || gstOverride > 100)) return setErr(`Line ${i + 1}: GST% must be 0-100.`);
      items2.push({ item_id: it.id, qty: Number(r.qty), rate: Number(r.rate), gst_rate: gstOverride });
    }
    if (!items2.length) return setErr('Add at least one item line.');
    try {
      const body = { class: cls, date, number: num, narration, ref, regime, party_id: partyAcc.id, items: items2, auto_tax: true, invoice_type: invoiceType };
      const j = editing
        ? await api('/vouchers/' + editing.id, { method: 'PATCH', body })
        : await api('/vouchers', { body });
      notify((editing ? 'Updated' : 'Saved') + ' ' + cmeta(cls).label + ' ✓ Total ' + inr(sum.total));
      onSaved && onSaved(j.voucher);
      if (!editing) { setNum(''); setRef(''); setNarration(''); setRows([{ name: '', qty: '1', rate: '' }]); }
    } catch (e) { setErr(e.message); }
  };
  const setRow = (i, k) => (e) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));
  const label = cmeta(cls).label;
  const reverse = cls === 'credit_note' || cls === 'debit_note';
  return (
    <div className="card">
      {editing && <h3>Edit {label} #{editing.voucher_no} <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>(save = new version; old version kept in Edit Log)</span></h3>}
      <Err e={err} />
      <div className="frow" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <label className="f" style={{ maxWidth: 170 }}><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f" style={{ maxWidth: 170 }}><span>Invoice Type *</span>
          <select value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)} style={{ borderColor: invoiceType==='proforma' ? '#e0a06b' : 'var(--gold)' }}>
            <option value="tax_invoice">Tax Invoice (affects stock)</option>
            <option value="proforma">PI / Proforma / Quotation (NO stock)</option>
          </select>
        </label>
        <label className="f" style={{ maxWidth: 190 }}><span>{reverse ? 'Note no.' : 'Invoice no.'} (optional)</span><input value={num} onChange={(e) => setNum(e.target.value)} placeholder="auto" style={{ borderColor: String(num||'').toUpperCase().startsWith('PI-') && invoiceType==='tax_invoice' ? '#e06b6b' : '' }} /></label>
        <label className="f" style={{ maxWidth: 190 }}><span>Ref against</span><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={cls === 'sales' || cls === 'credit_note' ? 'invoice / PO' : 'bill no.'} /></label>
        <label className="f" style={{ minWidth: 200 }}><span>Party ({cls === 'sales' || cls === 'credit_note' ? 'debtor' : 'creditor'}) *</span>
          <input list={listP} value={party} onChange={(e) => setParty(e.target.value)} placeholder="Type name…" />
        </label>
        <label className="f" style={{ maxWidth: 200 }}><span>GST regime</span>
          <select value={regime} onChange={(e) => setRegime(e.target.value)}>
            <option value="intra">Intra-state (CGST + SGST)</option>
            <option value="inter">Inter-state (IGST)</option>
          </select>
        </label>
      </div>
      {invoiceType==='proforma' && <div className="errbox" style={{ borderColor: '#e0a06b', background: 'rgba(224,160,107,0.12)', color: '#e0a06b' }}>⚠ PI / Proforma / Quotation — this voucher will NOT affect stock (only accounting). Only Tax Invoice affects stock.</div>}
      <datalist id={listP}>{partyOpts.map((a) => <option key={a.id} value={a.name} />)}</datalist>
      <datalist id={listI}>{itemOpts.map((it) => <option key={it.id} value={it.name} />)}</datalist>
      <div className="lines">
        <div className="lrow2" style={{ color: 'var(--ink-faint)', fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', gridTemplateColumns: '2fr 60px 70px 80px 50px 80px 40px' }}>
          <div>Stock item * (hover/click 📜 for buy/sell — live stock)</div><div className="tright">In Hand</div><div className="tright">Qty</div><div className="tright">Rate ₹</div><div className="tright">GST%</div><div className="tright">Amount</div><div></div>
        </div>
        {rows.map((r, i) => {
          const it = itemMap[r.name.trim().toLowerCase()];
          const low = it && it.stock_qty != null && Number(r.qty) > 0 && it.stock_qty + 1e-9 < Number(r.qty);
          const qty = Number(r.qty||0);
          const rate = Number(r.rate||0);
          const amtPaise = Math.round(qty*rate*100);
          return (
            <div className="lrow2" key={i} style={{ gridTemplateColumns: '2fr 60px 70px 80px 50px 80px 40px', background: low ? 'rgba(224,160,107,0.12)' : 'transparent' }}>
              <input list={listI} value={r.name} onChange={setRow(i, 'name')} placeholder="Item — click 📜 for history" title={it ? `In hand: ${it.stock_qty} ${it.unit} — click 📜 for full history` : ''} />
              <div className="tright num" style={{ fontSize: 11, color: it ? (it.stock_qty > 0 ? '#8ec07c' : '#e06b6b') : 'var(--ink-faint)', alignSelf: 'center' }}>{it ? `${it.stock_qty ?? 0} ${it.unit}` : '—'}</div>
              <input className="num" value={r.qty} onChange={setRow(i, 'qty')} inputMode="decimal" placeholder={it ? `max ${it.stock_qty}` : 'qty'} />
              <input className="num" value={r.rate} onChange={setRow(i, 'rate')} placeholder={it ? `${it.unit} · GST ${it.gst_rate ?? 0}%` : 'rate'} inputMode="decimal" />
              <input className="num" value={r.gst} onChange={setRow(i, 'gst')} placeholder={it ? String(it.gst_rate ?? 0) : '18'} inputMode="decimal" style={{ borderColor: r.gst!=='' ? 'var(--gold-hi)' : '' }} />
              <div className="tright num" style={{ fontSize: 11, alignSelf: 'center' }}>{amtPaise ? inr(amtPaise) : ''}</div>
              <button className="minus" onClick={() => setRows(rows.filter((_, j) => j !== i))}>−</button>
            </div>
          );
        })}
        <button className="btn ghost sm" onClick={() => setRows([...rows, { name: '', qty: '1', rate: '', gst: '' }])}>+ Add item</button>
      </div>
      {detailItem && <StockDetailLazy itemId={detailItem.id} itemName={detailItem.name} onClose={() => setDetailItem(null)} onVoucher={(vid) => { setDetailItem(null); setViewVoucherId(vid); }} />}
      {viewVoucherId && <VoucherModalDirect voucherId={viewVoucherId} onClose={() => setViewVoucherId(null)} />}
      <div className="vfooter" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <label className="f" style={{ minWidth: 200, margin: 0 }}><span>Narration</span><input value={narration} onChange={(e) => setNarration(e.target.value)} /></label>
        <div style={{ minWidth: 380, border: '1px solid var(--gold-line-soft)', borderRadius: 6, padding: '6px 8px', background: 'rgba(212,175,55,0.06)' }}>
          <div style={{ fontSize: 11, color: 'var(--ink-dim)' }}>
            Taxable = Σ(qty×rate) = {sum.details?.map(d=>`${d.qty}×${d.rate}=${(d.taxable/100).toFixed(2)}`).join(' + ') || '0'} = <b style={{ color: 'var(--gold-hi)' }}>{inr(sum.taxable)}</b>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-dim)', marginTop: 2 }}>
            {regime==='intra' ? (
              <>CGST = Tax/2, SGST = Tax/2 — Total Tax = Σ(taxable×GST%) = {sum.details?.map(d=>`${(d.taxable/100).toFixed(2)}×${d.gst}%= ${( (d.taxable*d.gst/100)/100).toFixed(2)}`).join(' + ')} = <b>{inr(sum.tax.CGST + sum.tax.SGST)}</b> → CGST <b style={{ color: '#8ec07c' }}>{inr(sum.tax.CGST)}</b> + SGST <b style={{ color: '#8ec07c' }}>{inr(sum.tax.SGST)}</b></>
            ) : (
              <>IGST = Σ(taxable×GST%) = {sum.details?.map(d=>`${(d.taxable/100).toFixed(2)}×${d.gst}%`).join(' + ')} = <b>{inr(sum.tax.IGST)}</b></>
            )}
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--gold-hi)', marginTop: 4 }}>Total = Taxable + Tax = {inr(sum.taxable)} + {inr(sum.tax.CGST + sum.tax.SGST + sum.tax.IGST)} = {inr(sum.total)}</div>
          <div style={{ fontSize: 10, color: 'var(--ink-faint)', marginTop: 4 }}>
            v1.11.52 CALC: qty×rate exact (0.068×200000=13600) not rounded rate, GST% editable per row, CGST=SGST=Tax/2 half-even
          </div>
        </div>
        <button className="btn" onClick={save} style={{ alignSelf: 'center' }}>{editing ? 'Update ' + label : 'Save ' + label}</button>
      </div>
      <p className="ledger-hint no-print">
        {label}: {hintBody(cls)} Stock and GST ledgers are posted automatically.
      </p>
    </div>
  );
}
function StockDetailLazy(props) {
  const [Comp, setComp] = useState(null);
  useEffect(() => { import('./StockDetail.jsx').then(m => setComp(() => m.StockDetailModal)); }, []);
  if (!Comp) return <div className="portal"><div className="box">Loading history…</div></div>;
  return <Comp {...props} />;
}
function VoucherModalDirect({ voucherId, onClose }) {
  // Use VoucherModal directly — same file, no circular import
  return <VoucherModal voucherId={voucherId} onClose={onClose} />;
}

function hintBody(cls) {
  return {
    sales: 'debit party with the invoice total; Sales and output GST credited; stock goes out at weighted-average cost (COGS vs Stock auto entry).',
    purchase: 'Stock-in-Hand debited with item value; input GST (ITC) claimed; party credited with bill total.',
    credit_note: 'customer returns goods — party credited (bill value incl. tax), Sales and output GST reversed, stock returns at average cost.',
    debit_note: 'goods returned to supplier — party debited; stock reduced at bill value; ITC on returned goods reversed.',
  }[cls] || '';
}

/* ---------- stock journal editor (opening stock / adjustments) ---------- */
function StockJournalEditor({ accounts, items, editing, onSaved }) {
  const { company, notify } = useApp();
  const listC = 'sjc-' + (editing ? editing.id : 'new'), listI = 'sji-' + (editing ? editing.id : 'new');
  const itemMap = useMemo(() => { const m = {}; items.forEach((it) => { m[it.name.toLowerCase()] = it; }); return m; }, [items]);
  const accMap = useMemo(() => { const m = {}; accounts.forEach((a) => { m[a.name.toLowerCase()] = a; }); return m; }, [accounts]);

  const initFrom = (v) => {
    if (!v) return { date: todayISO(), ctr: '', narration: '', rows: [{ name: '', qty: '', rate: '', dir: 'in' }] };
    const stockEntry = (v.entries || []).find((e) => e.is_stock);
    const ctrEntry = (v.entries || []).find((e) => !e.is_stock);
    const dir = (v.items || [])[0] && (v.items)[0].direction === 'out' ? 'out' : 'in';
    return {
      date: v.date,
      ctr: ctrEntry ? ctrEntry.account_name : (stockEntry ? '' : ''),
      narration: v.narration,
      rows: (v.items || []).map((it) => ({ name: it.item_name, qty: String(it.qty), rate: dir === 'out' ? String(it.rate / 100) : String(it.rate / 100), dir })),
    };
  };
  const init = initFrom(editing);
  const [date, setDate] = useState(init.date);
  const [ctr, setCtr] = useState(init.ctr);
  const [narration, setNarration] = useState(init.narration);
  const [rows, setRows] = useState(init.rows);
  const [err, setErr] = useState('');
  const compute = () => {
    const t = { val: 0, n: 0 };
    rows.forEach((r) => {
      if (!r.name.trim()) return;
      const it = itemMap[r.name.trim().toLowerCase()];
      const q = Number(r.qty || 0);
      if (r.dir === 'out') { t.n += q; if (it && !it.is_service) t.val += q * (it.stock_qty ? (it.stock_value / it.stock_qty) : 0); }
      else t.val += q * Number(r.rate || 0);
    });
    return t;
  };
  const t = compute();
  const save = async () => {
    setErr('');
    const ctrAcc = accMap[ctr.trim().toLowerCase()];
    if (!ctrAcc) return setErr('Choose the counterpart (balancing) account — e.g. Reserves & Surplus for opening stock.');
    const itms = [];
    let dir = 'in';
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.name.trim() && !r.qty && !r.rate) continue;
      const it = itemMap[r.name.trim().toLowerCase()];
      if (!it) return setErr(`Line ${i + 1}: unknown item “${r.name}”.`);
      if (it.is_service) return setErr(`Line ${i + 1}: services are not stock-tracked.`);
      if (!(Number(r.qty) > 0)) return setErr(`Line ${i + 1}: enter quantity.`);
      if (i === 0) dir = r.dir;
      if (r.dir !== dir) return setErr('All lines of a stock journal must be same direction (In or Out).');
      if (r.dir === 'in' && !(Number(r.rate) > 0)) return setErr(`Line ${i + 1}: enter rate for stock going in.`);
      itms.push({ item_id: it.id, qty: Number(r.qty), rate: r.rate ? Number(r.rate) : undefined, direction: r.dir });
    }
    if (!itms.length) return setErr('Add at least one stock line.');
    try {
      const body = { class: 'stock_journal', date, narration, counterpart_id: ctrAcc.id, items: itms };
      const j = editing
        ? await api('/vouchers/' + editing.id, { method: 'PATCH', body })
        : await api('/vouchers', { body });
      notify((editing ? 'Updated' : 'Saved') + ' Stock Journal ✓');
      onSaved && onSaved(j.voucher);
      if (!editing) { setNarration(''); setRows([{ name: '', qty: '', rate: '', dir: 'in' }]); }
    } catch (e) { setErr(e.message); }
  };
  const setRow = (i, k) => (e) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));
  return (
    <div className="card">
      {editing && <h3>Edit Stock Journal #{editing.voucher_no} <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>(old version kept in Edit Log)</span></h3>}
      <Err e={err} />
      <div className="frow" style={{ marginBottom: 10 }}>
        <label className="f" style={{ maxWidth: 170 }}><span>Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="f" style={{ minWidth: 260 }}><span>Counterpart account * (e.g. Reserves & Surplus for opening stock)</span>
          <input list={listC} value={ctr} onChange={(e) => setCtr(e.target.value)} placeholder="Type account name…" />
        </label>
        <label className="f" style={{ minWidth: 220 }}><span>Narration</span><input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. opening stock / damage write-off" /></label>
      </div>
      <datalist id={listC}>{accounts.map((a) => <option key={a.id} value={a.name} />)}</datalist>
      <datalist id={listI}>{items.filter((i) => !i.is_service).map((it) => <option key={it.id} value={it.name} />)}</datalist>
      <div className="lines">
        <div className="lrow-sj" style={{ color: 'var(--ink-faint)', fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase' }}>
          <div>Item *</div><div style={{ maxWidth: 90 }}>In / Out</div><div className="tright">Qty</div><div className="tright">Rate (₹)</div><div></div>
        </div>
        {rows.map((r, i) => {
          const it = itemMap[r.name.trim().toLowerCase()];
          return (
            <div className="lrow-sj" key={i}>
              <input list={listI} value={r.name} onChange={setRow(i, 'name')} placeholder="Item…" />
              <select value={r.dir} onChange={setRow(i, 'dir')} style={{ padding: '7px 6px' }}>
                <option value="in">In</option><option value="out">Out</option>
              </select>
              <input className="num" value={r.qty} onChange={setRow(i, 'qty')} inputMode="decimal" placeholder="qty" />
              <input className="num" value={r.rate} onChange={setRow(i, 'rate')} placeholder={r.dir === 'out' && it ? `auto @ avg` : 'rate'} inputMode="decimal" />
              <button className="minus" onClick={() => setRows(rows.filter((_, j) => j !== i))}>−</button>
            </div>
          );
        })}
        <button className="btn ghost sm" onClick={() => setRows([...rows, { name: '', qty: '', rate: '', dir: 'in' }])}>+ Add line</button>
      </div>
      <div className="vfooter">
        <span className="muted" style={{ fontSize: 12 }}>
          {rows.some((r) => r.dir === 'out')
            ? 'Out at “auto” rate uses current weighted-average cost; you may override with a value ≤ stock value.'
            : 'Stock IN posts: Dr Stock-in-Hand, Cr counterpart account (use Reserves & Surplus for opening stock).'}
        </span>
        <span className="tot"><div className="lbl">Lines {rows.filter((r) => r.name.trim()).length}</div>
          <div className="amt okdiff">{t.val ? 'Total value ≈ ' + inr(t.val * 100) : ''}</div></span>
        <button className="btn" onClick={save}>{editing ? 'Update' : 'Save Stock Journal'}</button>
      </div>
    </div>
  );
}

/* ---------- main screen ---------- */
export function VoucherScreen({ cls }) {
  const { company, notify } = useApp();
  const [accounts, setAccounts] = useState(null);
  const [items, setItems] = useState(null);
  const [list, setList] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [useItems, setUseItems] = useState(cls === 'sales' || cls === 'purchase');
  const [salesMode, setSalesMode] = useState('excel'); // excel | form — user wanted Excel in sales column
  const [since, setSince] = useState(company ? company.books_begin_from : todayISO());
  const load = () => {
    api('/accounts').then((j) => setAccounts(j.rows)).catch((e) => notify(e.message));
    if (company.inventory_enabled || cls === 'sales' || cls === 'purchase') {
      api('/items').then((j) => setItems(j.rows)).catch(() => setItems([]));
    } else setItems([]);
    api('/vouchers?class=' + cls + '&from=' + since + '&to=' + todayISO())
      .then((j) => { setList(j.rows); setEditing(null); }).catch((e) => notify(e.message));
  };
  const loadListOnly = () => {
    // v1.11.49 FAST refresh — only vouchers list, no editing reset, reduces time for data to show
    api('/vouchers?class=' + cls + '&from=' + since + '&to=' + todayISO())
      .then((j) => { setList(j.rows); }).catch(()=>{});
  };
  useEffect(() => { setViewId(null); setEditing(null); load(); }, [cls, company && company.id]);
  useEffect(() => {
    // v1.11.49 auto-refresh list every 10 sec — data shows fast without manual refresh
    const id = setInterval(() => { if (!editing) loadListOnly(); }, 10000);
    return () => clearInterval(id);
  }, [cls, since, editing]);
  const del = async (id) => {
    if (!window.confirm('Delete this voucher?')) return;
    try { await api('/vouchers/' + id, { method: 'DELETE' }); notify('Deleted'); load(); }
    catch (e) { notify(e.message); }
  };
  const label = cmeta(cls).label;
  const isInvClass = ['sales', 'purchase', 'credit_note', 'debit_note'].includes(cls);
  const isStockJournal = cls === 'stock_journal';
  const isSales = cls === 'sales';
  const showItems = useItems && isInvClass;
  const showInvoice = showItems && items !== null && items.length > 0 && !(isSales && salesMode === 'excel');
  const showGeneric = !isInvClass && !isStockJournal;
  return (
    <div>
      <div className="pagetitle">
        <div><div className="crumb">Transactions · {label}</div><h1>{label} {isStockJournal || isInvClass ? '' : 'Voucher'}</h1></div>
        {isInvClass && (
          <div className="no-print" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {isSales && (
              <>
                <button className={`btn ${salesMode === 'excel' ? '' : 'ghost'}`} onClick={() => setSalesMode('excel')}>📊 Excel View</button>
                <button className={`btn ${salesMode === 'form' ? '' : 'ghost'}`} onClick={() => setSalesMode('form')}>📝 Form View</button>
              </>
            )}
            <button className={`btn ${showItems ? '' : 'ghost'}`} onClick={() => setUseItems(true)}>Stock items</button>
            <button className={`btn ${showItems ? 'ghost' : ''}`} onClick={() => setUseItems(false)}>Simple (ledgers)</button>
          </div>
        )}
      </div>
      {!accounts && <div className="card"><div className="empty">Loading…</div></div>}
      {showItems && items !== null && items.length === 0 && (
        <div className="errbox">No stock items yet — create items under <b>Masters → Stock Items</b>, or switch to “Simple”.</div>
      )}
      {accounts && isSales && salesMode === 'excel' && items && (
        <SalesExcelPanel accounts={accounts} items={items} onSaved={() => load()} />
      )}
      {accounts && showInvoice && (
        <InvoiceEditor key={(editing ? 'edit-' : 'new-') + cls} cls={cls} accounts={accounts} items={items} editing={editing} onSaved={() => load()} />
      )}
      {accounts && showGeneric && (
        <GenericEditor key={(editing ? 'edit-' : 'new-') + cls} cls={cls} accounts={accounts} editing={editing} onSaved={() => load()} />
      )}
      {accounts && isStockJournal && (
        <StockJournalEditor key={(editing ? 'edit-' : 'new-') + cls} accounts={accounts} items={items || []} editing={editing} onSaved={() => load()} />
      )}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Recent {label}s</h3>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <a className="btn ghost sm" href={`/api/export/${cls === 'sales' ? 'sales' : cls === 'purchase' ? 'purchases' : cls === 'stock_journal' ? 'stock-summary' : 'daybook'}`} download>⬇ Download {label} (Excel)</a>
            <a className="btn ghost sm" href="/api/export/daybook" download>⬇ Day Book</a>
            <a className="btn ghost sm" href="/api/export/dashboard" download>⬇ Dashboard</a>
          </div>
        </div>
        {list === null && <div className="empty">Loading…</div>}
        {list && !list.length && <div className="empty">No {label} vouchers recorded yet.</div>}
        {list && list.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="grid">
              <thead><tr><th>No.</th><th>Date</th><th>Ref / narration</th><th className="tright">Amount</th><th></th></tr></thead>
              <tbody>
                {list.map((v) => (
                  <tr key={v.id}>
                    <td className="num">{v.number || ('#' + v.voucher_no)}</td>
                    <td className="num">{dshort(v.date)}</td>
                    <td className="muted">{v.ref ? v.ref + ' · ' : ''}{v.narration}</td>
                    <td className="tright num" title={v.invoice_total ? `Invoice incl GST excl COGS: ${v.invoice_total/100} — debit incl COGS was ${v.debit/100}` : ''}>{inr(v.invoice_total || v.debit)}{v.invoice_total && v.debit!==v.invoice_total ? <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}> (excl COGS)</span> : ''}</td>
                    <td className="no-print" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm" onClick={() => setViewId(v.id)}>View</button>{' '}
                      <button className="btn ghost sm" onClick={async () => {
                        try { const j = await api('/vouchers/' + v.id); setEditing(j.voucher); setUseItems(true); setSalesMode('form'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
                        catch (e) { notify(e.message); }
                      }}>Edit</button>{' '}
                      <button className="btn danger sm" onClick={() => del(v.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {viewId && <VoucherModal voucherId={viewId} onClose={() => setViewId(null)} onDeleted={load} onEdit={(v) => { setEditing(v); setUseItems(true); setSalesMode('form'); window.scrollTo(0, 0); }} />}
    </div>
  );
}
